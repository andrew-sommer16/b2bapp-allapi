import { NextResponse } from 'next/server';
import { fetchAllCompanies, fetchB2BOrdersForCompanies, fetchLineItemsForOrders, fetchProductCatalog } from '@/lib/bcDirectAPI';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sku = searchParams.get('sku');
  const product_id = searchParams.get('product_id');
  const mode = searchParams.get('mode') || 'sku';
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const companyStatus = searchParams.get('companyStatus') || 'all';

  try {
    // Start catalog fetch immediately — it's independent of company IDs
    const catalogPromise = fetchProductCatalog();

    let allCompanies = await fetchAllCompanies();
    if (companyStatus === 'active') allCompanies = allCompanies.filter(c => c.status === '1');
    else if (companyStatus === 'inactive') allCompanies = allCompanies.filter(c => ['0', '2', '3'].includes(c.status));

    if (allCompanies.length === 0) {
      return NextResponse.json({ product: null, skus: [], companies: [], scorecards: { totalCompanies: 0, totalOrders: 0, totalQuantity: 0, totalSpend: 0 } });
    }

    const companyIds = allCompanies.map(c => c.bc_company_id);
    const companyMap = {};
    allCompanies.forEach(c => { companyMap[c.bc_company_id] = c; });

    let orders = await fetchB2BOrdersForCompanies(companyIds, { dateFrom, dateTo });
    orders = orders.filter(o =>
      o.custom_status !== 'Invoice Payment' &&
      o.custom_status !== 'Incomplete' &&
      o.custom_status !== 'Cancelled' &&
      o.company_id
    );

    if (orders.length === 0) {
      return NextResponse.json({ product: null, skus: [], companies: [], scorecards: { totalCompanies: 0, totalOrders: 0, totalQuantity: 0, totalSpend: 0 } });
    }

    const orderIds = orders.map(o => o.bc_order_id);
    const orderMap = {};
    orders.forEach(o => { orderMap[o.bc_order_id] = o; });

    // Fetch all line items + product catalog in parallel
    const [allLineItems, catalog] = await Promise.all([
      fetchLineItemsForOrders(orderIds),
      catalogPromise,
    ]);

    // Filter line items to the requested product/sku
    const lineItems = allLineItems.filter(item => {
      if (mode === 'sku') return item.sku === sku;
      return product_id && item.product_id === product_id;
    });

    // Get product info from catalog
    const catalogMap = {};
    catalog.forEach(p => { catalogMap[p.bc_product_id] = p; });
    const productInfo = product_id ? catalogMap[product_id] : null;

    // Aggregate by company
    const companyAgg = {};
    lineItems.forEach(item => {
      const order = orderMap[item.bc_order_id];
      if (!order?.company_id) return;
      const companyId = order.company_id;
      if (!companyAgg[companyId]) {
        const co = companyMap[companyId];
        companyAgg[companyId] = {
          company_id: companyId,
          company_name: co?.company_name || companyId,
          customer_group_name: co?.customer_group_name || null,
          order_count: new Set(),
          total_quantity: 0,
          total_spend: 0,
          last_order_date: null,
        };
      }
      companyAgg[companyId].order_count.add(item.bc_order_id);
      companyAgg[companyId].total_quantity += parseInt(item.quantity || 0);
      companyAgg[companyId].total_spend += parseFloat(item.line_total || 0);
      const orderDate = order.created_at_bc;
      if (orderDate && (!companyAgg[companyId].last_order_date || orderDate > companyAgg[companyId].last_order_date)) {
        companyAgg[companyId].last_order_date = orderDate;
      }
    });

    const companies = Object.values(companyAgg)
      .map(c => ({ ...c, order_count: c.order_count.size, total_spend: Math.round(c.total_spend * 100) / 100 }))
      .sort((a, b) => b.total_spend - a.total_spend);

    // For product mode — aggregate by SKU (child variants)
    let skus = [];
    if (mode === 'product') {
      const skuAgg = {};
      lineItems.forEach(item => {
        const s = item.sku || 'Unknown';
        if (!skuAgg[s]) {
          skuAgg[s] = { sku: s, product_name: item.product_name, order_count: new Set(), total_quantity: 0, total_spend: 0, last_order_date: null };
        }
        skuAgg[s].order_count.add(item.bc_order_id);
        skuAgg[s].total_quantity += parseInt(item.quantity || 0);
        skuAgg[s].total_spend += parseFloat(item.line_total || 0);
        const orderDate = orderMap[item.bc_order_id]?.created_at_bc;
        if (orderDate && (!skuAgg[s].last_order_date || orderDate > skuAgg[s].last_order_date)) {
          skuAgg[s].last_order_date = orderDate;
        }
      });
      skus = Object.values(skuAgg)
        .map(s => ({ ...s, order_count: s.order_count.size, total_spend: Math.round(s.total_spend * 100) / 100 }))
        .sort((a, b) => b.total_spend - a.total_spend);
    }

    const totalQuantity = companies.reduce((s, c) => s + c.total_quantity, 0);
    const totalSpend = companies.reduce((s, c) => s + c.total_spend, 0);
    const totalOrders = new Set(lineItems.map(i => i.bc_order_id)).size;

    return NextResponse.json({
      product: {
        sku: mode === 'sku' ? sku : (productInfo?.sku || sku),
        product_name: lineItems[0]?.product_name || productInfo?.name || sku,
        brand: productInfo?.brand || null,
        category: productInfo?.category || null,
        custom_fields: productInfo?.custom_fields || {},
        mode,
      },
      scorecards: { totalCompanies: companies.length, totalOrders, totalQuantity, totalSpend: Math.round(totalSpend * 100) / 100 },
      skus,
      companies,
    });

  } catch (err) {
    console.error('Product detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
