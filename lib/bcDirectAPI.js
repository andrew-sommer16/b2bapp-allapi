import { b2bAPI, bcAPI } from './bigcommerce';

const creds = () => ({
  storeHash: process.env.BC_STORE_HASH,
  accessToken: process.env.BC_ACCESS_TOKEN,
});

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Stores results in server memory so repeated page loads don't re-hit the API.
// TTLs: slow-changing data (companies, products, reps) = 15 mins
//       orders (can change more often) = 5 mins
const cache = new Map();
const inFlight = new Map(); // deduplicates simultaneous requests for same key

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Wraps a fetch function so that if two callers request the same key at the
// same time (before the cache is warm), they share one API call instead of
// each firing their own.
async function cachedFetch(key, fetcher, ttlMs) {
  const hit = cacheGet(key);
  if (hit) return hit;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = fetcher().then(result => {
    cacheSet(key, result, ttlMs);
    inFlight.delete(key);
    return result;
  }).catch(err => {
    inFlight.delete(key);
    throw err;
  });
  inFlight.set(key, promise);
  return promise;
}

const TTL = {
  COMPANIES: 15 * 60 * 1000,       // 15 minutes
  SALES_REPS: 15 * 60 * 1000,      // 15 minutes
  CUSTOMER_GROUPS: 15 * 60 * 1000, // 15 minutes
  PRODUCT_CATALOG: 15 * 60 * 1000, // 15 minutes
  ORDERS: 5 * 60 * 1000,           // 5 minutes
  LINE_ITEMS: 15 * 60 * 1000,      // 15 minutes
};

// ─── B2B API (offset-based pagination) ────────────────────────────────────────
export async function fetchAllB2B(endpoint, params = {}) {
  const { storeHash, accessToken } = creds();
  const api = b2bAPI(storeHash, accessToken);
  let offset = 0;
  const limit = 250;
  const results = [];
  while (true) {
    const queryParams = new URLSearchParams({ limit, offset, ...params }).toString();
    const { data } = await api.get(`${endpoint}?${queryParams}`);
    const items = data?.data || [];
    results.push(...items);
    const total = data?.meta?.pagination?.totalCount || 0;
    offset += limit;
    if (items.length === 0 || offset >= total) break;
  }
  return results;
}

// ─── BC REST API (page-based pagination) ──────────────────────────────────────
export async function fetchAllBC(endpoint, params = {}) {
  const { storeHash, accessToken } = creds();
  const api = bcAPI(storeHash, accessToken);
  let page = 1;
  const limit = 250;
  const results = [];
  while (true) {
    const { data } = await api.get(endpoint, { params: { ...params, limit, page } });
    const items = Array.isArray(data) ? data : (data?.data || []);
    results.push(...items);
    if (items.length < limit) break;
    page++;
  }
  return results;
}

// ─── All companies ─────────────────────────────────────────────────────────────
export async function fetchAllCompanies() {
  return cachedFetch('companies', async () => {
    const companies = await fetchAllB2B('/companies');
    return companies.map(c => ({
      bc_company_id: String(c.companyId),
      company_name: c.companyName,
      status: String(c.companyStatus ?? ''),
      sales_rep_id: c.salesRepId ? String(c.salesRepId) : null,
      customer_group_id: c.bcGroupId ? String(c.bcGroupId) : null,
      customer_group_name: c.bcGroupName || null,
      primary_email: c.companyEmail || null,
      created_at_bc: c.createdAt ? new Date(c.createdAt * 1000).toISOString() : null,
      custom_fields: buildCustomFields(c.extraFields),
    }));
  }, TTL.COMPANIES);
}

// ─── Single company detail ─────────────────────────────────────────────────────
export async function fetchCompanyDetail(companyId) {
  const { storeHash, accessToken } = creds();
  const api = b2bAPI(storeHash, accessToken);
  const { data } = await api.get(`/companies/${companyId}`);
  const c = data?.data;
  if (!c) return null;
  return {
    bc_company_id: String(c.companyId || companyId),
    company_name: c.companyName,
    status: String(c.companyStatus ?? ''),
    sales_rep_id: c.salesRepId ? String(c.salesRepId) : null,
    customer_group_id: c.bcGroupId ? String(c.bcGroupId) : null,
    customer_group_name: c.bcGroupName || null,
    primary_email: c.companyEmail || c.primaryEmail || null,
    parent_company_name: c.parentCompany?.name || null,
    created_at_bc: c.createdAt ? new Date(c.createdAt * 1000).toISOString() : null,
    custom_fields: buildCustomFields(c.extraFields),
  };
}

// ─── All sales reps ────────────────────────────────────────────────────────────
export async function fetchAllSalesReps() {
  return cachedFetch('sales_reps', async () => {
    const reps = await fetchAllB2B('/sales-staffs');
    return reps.map(r => ({
      bc_rep_id: String(r.id),
      first_name: r.salesRepName?.split(' ')[0] || r.firstName || r.first_name || '',
      last_name: r.salesRepName?.split(' ').slice(1).join(' ') || r.lastName || r.last_name || '',
    }));
  }, TTL.SALES_REPS);
}

// ─── All customer groups ───────────────────────────────────────────────────────
export async function fetchAllCustomerGroups() {
  return cachedFetch('customer_groups', async () => {
    const groups = await fetchAllBC('/v2/customer_groups');
    return groups.map(g => ({
      bc_group_id: String(g.id),
      group_name: g.name,
    }));
  }, TTL.CUSTOMER_GROUPS);
}

// ─── B2B orders for a list of company IDs ─────────────────────────────────────
export async function fetchB2BOrdersForCompanies(companyIds, { dateFrom, dateTo } = {}) {
  const cacheKey = `orders:${[...companyIds].sort().join(',')}:${dateFrom || ''}:${dateTo || ''}`;
  return cachedFetch(cacheKey, async () => {
    const { storeHash, accessToken } = creds();
    const api = b2bAPI(storeHash, accessToken);
    const allOrders = [];
    const seen = new Set();

    const dateFromUnix = dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000) : null;
    const dateToUnix = dateTo ? Math.floor(new Date(dateTo + 'T23:59:59').getTime() / 1000) : null;

    const BATCH = 10;
    for (let i = 0; i < companyIds.length; i += BATCH) {
      const batch = companyIds.slice(i, i + BATCH);
      await Promise.all(batch.map(async (companyId) => {
        let offset = 0;
        const limit = 250;
        while (true) {
          const params = new URLSearchParams({ limit, offset, companyId });
          if (dateFromUnix) params.set('beginDateAt', dateFromUnix);
          if (dateToUnix) params.set('endDateAt', dateToUnix);
          const { data } = await api.get(`/orders?${params}`);
          const items = data?.data || [];
          for (const o of items) {
            const key = String(o.bcOrderId);
            if (!seen.has(key)) {
              seen.add(key);
              allOrders.push({
                bc_order_id: key,
                company_id: String(companyId),
                status: o.status || '',
                custom_status: o.customStatus || o.status || '',
                total_inc_tax: parseFloat(o.totalIncTax || 0),
                currency_code: o.currencyCode || 'USD',
                po_number: o.poNumber || null,
                created_at_bc: o.createdAt ? new Date(o.createdAt * 1000).toISOString() : null,
              });
            }
          }
          const total = data?.meta?.pagination?.totalCount || 0;
          offset += limit;
          if (items.length === 0 || offset >= total) break;
        }
      }));
    }
    return allOrders;
  }, TTL.ORDERS);
}

// ─── Line items for multiple orders (batched) ─────────────────────────────────
export async function fetchLineItemsForOrders(orderIds, batchSize = 50) {
  // v2 = cache version; bump this to invalidate old cached entries after code changes
  const cacheKey = `line_items_v2:${[...orderIds].sort().join(',')}`;
  return cachedFetch(cacheKey, async () => {
    const { storeHash, accessToken } = creds();
    const api = bcAPI(storeHash, accessToken);
    const allItems = [];
    for (let i = 0; i < orderIds.length; i += batchSize) {
      const batch = orderIds.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (orderId) => {
          try {
            const { data } = await api.get(`/v2/orders/${orderId}/products`, { params: { limit: 250 } });
            // Debug: log the first item's product_options shape so we can verify
            if (Array.isArray(data) && data.length > 0) {
              console.log('[line-items debug] product_options sample:', JSON.stringify(data[0].product_options));
            }
            return (Array.isArray(data) ? data : []).map(item => {
              // product_options can be an array (inline) or a {url, resource} object (sub-resource ref)
              const rawOptions = item.product_options;
              const options = Array.isArray(rawOptions) ? rawOptions : [];
              const variantLabel = options.length > 0
                ? options.map(o => o.display_value).filter(Boolean).join(' / ')
                : null;
              return {
                bc_order_id: String(orderId),
                product_id: item.product_id ? String(item.product_id) : null,
                sku: item.sku || null,
                product_name: item.name || null,
                variant_label: variantLabel,
                quantity: parseInt(item.quantity || 0),
                base_price: parseFloat(item.base_price || 0),
                line_total: parseFloat(item.total_inc_tax || 0),
              };
            });
          } catch {
            return [];
          }
        })
      );
      allItems.push(...results.flat());
    }
    return allItems;
  }, TTL.LINE_ITEMS);
}

// ─── Product catalog with brand + category names ───────────────────────────────
export async function fetchProductCatalog() {
  return cachedFetch('product_catalog', async () => {
    const [categories, brands, products] = await Promise.all([
      fetchAllBC('/v2/categories'),
      fetchAllBC('/v2/brands'),
      fetchAllBC('/v3/catalog/products', { include: 'custom_fields' }),
    ]);

    const categoryMap = {};
    categories.forEach(c => { categoryMap[c.id] = c.name; });

    const brandMap = {};
    brands.forEach(b => { brandMap[b.id] = b.name; });

    return products.map(p => {
      const topCategoryId = Array.isArray(p.categories) ? p.categories[0] : null;
      const customFields = {};
      (p.custom_fields || []).forEach(f => {
        if (f.name && f.value) customFields[f.name] = f.value;
      });
      return {
        bc_product_id: String(p.id),
        name: p.name,
        sku: p.sku,
        brand: p.brand_id ? (brandMap[p.brand_id] || null) : null,
        category: topCategoryId ? (categoryMap[topCategoryId] || null) : null,
        custom_fields: customFields,
      };
    });
  }, TTL.PRODUCT_CATALOG);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function buildCustomFields(extraFields) {
  const out = {};
  (extraFields || []).forEach(f => {
    const name = f.labelName || f.fieldName || f.name;
    const value = f.fieldValue !== undefined ? f.fieldValue : f.value;
    if (name && value != null && value !== '') out[name] = String(value);
  });
  return out;
}

export const parseList = (val) => val ? val.split(',').filter(Boolean) : [];
