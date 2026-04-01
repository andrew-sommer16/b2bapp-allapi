import { NextResponse } from 'next/server';
import {
  fetchAllCompanies,
  fetchB2BOrdersForCompanies, fetchLineItemsForOrders,
  fetchProductCatalog, parseList,
} from '@/lib/bcDirectAPI';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const companyStatus = searchParams.get('companyStatus') || 'all';
  let companies = parseList(searchParams.get('companies'));
  const customerGroups = parseList(searchParams.get('customerGroups'));
  const salesReps = parseList(searchParams.get('salesReps'));

  const customFieldFilters = {};
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('ccf_')) {
      customFieldFilters[decodeURIComponent(key.slice(4))] = value.split(',').filter(Boolean);
    }
  }

  try {
    const catalogPromise = fetchProductCatalog();

    let allCompanies = await fetchAllCompanies();

    if (companyStatus === 'active') allCompanies = allCompanies.filter(c => c.status === '1');
    else if (companyStatus === 'inactive') allCompanies = allCompanies.filter(c => ['0', '2', '3'].includes(c.status));
    if (customerGroups.length > 0) allCompanies = allCompanies.filter(c => customerGroups.includes(c.customer_group_id));
    if (salesReps.length > 0) allCompanies = allCompanies.filter(c => c.sales_rep_id && salesReps.includes(c.sales_rep_id));
    if (companies.length > 0) allCompanies = allCompanies.filter(c => companies.includes(c.bc_company_id));
    if (Object.keys(customFieldFilters).length > 0) {
      allCompanies = allCompanies.filter(c =>
        Object.entries(customFieldFilters).every(([f, vals]) => vals.includes(c.custom_fields?.[f]))
      );
    }

    if (allCompanies.length === 0) {
      return NextResponse.json({
        scorecards: { totalBrands: 0, totalRevenue: 0, totalUnits: 0, topBrand: null },
        brands: [],
      });
    }

    // Build a lookup of companyId → company name for fast joining
    const companyLookup = {};
    allCompanies.forEach(c => {
      companyLookup[c.bc_company_id] = c.company_name;
    });

    const companyIds = allCompanies.map(c => c.bc_company_id);
    let orders = await fetchB2BOrdersForCompanies(companyIds, { dateFrom, dateTo });
    orders = orders.filter(o =>
      o.custom_status !== 'Invoice Payment' &&
      o.custom_status !== 'Incomplete' &&
      o.custom_status !== 'Cancelled'
    );

    if (orders.length === 0) {
      return NextResponse.json({
        scorecards: { totalBrands: 0, totalRevenue: 0, totalUnits: 0, topBrand: null },
        brands: [],
      });
    }

    // Map orderId → companyId for line item joining
    const orderCompanyMap = {};
    orders.forEach(o => { orderCompanyMap[o.bc_order_id] = o.company_id; });

    const orderIds = orders.map(o => o.bc_order_id);
    const [lineItems, catalog] = await Promise.all([
      fetchLineItemsForOrders(orderIds),
      catalogPromise,
    ]);

    const catalogMap = {};
    catalog.forEach(p => { catalogMap[p.bc_product_id] = p; });

    // ── Aggregate by brand ──────────────────────────────────────────────────
    const brandMap = {};

    lineItems.forEach(item => {
      const prod = item.product_id ? catalogMap[item.product_id] : null;
      const brandName = prod?.brand || 'Unbranded';
      const revenue = item.line_total || 0;
      const units = item.quantity || 0;
      const companyId = orderCompanyMap[item.bc_order_id];
      const companyName = companyId ? (companyLookup[companyId] || companyId) : null;

      if (!brandMap[brandName]) {
        brandMap[brandName] = {
          name: brandName,
          revenue: 0,
          units: 0,
          orderIds: new Set(),
          products: {},
          companiesBought: {},   // companyId → { name, revenue, units, orders }
        };
      }

      brandMap[brandName].revenue += revenue;
      brandMap[brandName].units += units;
      brandMap[brandName].orderIds.add(item.bc_order_id);

      // Track per-company stats for this brand
      if (companyId && companyName) {
        if (!brandMap[brandName].companiesBought[companyId]) {
          brandMap[brandName].companiesBought[companyId] = {
            company_id: companyId,
            company_name: companyName,
            revenue: 0,
            units: 0,
            orderIds: new Set(),
          };
        }
        brandMap[brandName].companiesBought[companyId].revenue += revenue;
        brandMap[brandName].companiesBought[companyId].units += units;
        brandMap[brandName].companiesBought[companyId].orderIds.add(item.bc_order_id);
      }

      // Track top products per brand
      const productKey = prod?.name || item.product_name || item.sku || 'Unknown';
      if (!brandMap[brandName].products[productKey]) {
        brandMap[brandName].products[productKey] = {
          name: productKey,
          sku: prod?.sku || item.sku || '—',
          revenue: 0,
          units: 0,
        };
      }
      brandMap[brandName].products[productKey].revenue += revenue;
      brandMap[brandName].products[productKey].units += units;
    });

    const totalRevenue = Object.values(brandMap).reduce((s, b) => s + b.revenue, 0);
    const totalUnits = Object.values(brandMap).reduce((s, b) => s + b.units, 0);

    // Set of all company IDs in scope (for "not bought" calculation)
    const allCompanyIds = new Set(companyIds);

    const brands = Object.values(brandMap)
      .map(b => {
        const boughtIds = new Set(Object.keys(b.companiesBought));

        const companiesBought = Object.values(b.companiesBought)
          .map(c => ({
            company_id: c.company_id,
            company_name: c.company_name,
            revenue: Math.round(c.revenue * 100) / 100,
            units: c.units,
            orders: c.orderIds.size,
          }))
          .sort((a, b) => b.revenue - a.revenue);

        const companiesNotBought = allCompanies
          .filter(c => !boughtIds.has(c.bc_company_id))
          .map(c => ({ company_id: c.bc_company_id, company_name: c.company_name }))
          .sort((a, b) => a.company_name.localeCompare(b.company_name));

        return {
          name: b.name,
          revenue: Math.round(b.revenue * 100) / 100,
          spend: Math.round(b.revenue * 100) / 100,
          units: b.units,
          orders: b.orderIds.size,
          pct: totalRevenue > 0 ? Math.round((b.revenue / totalRevenue) * 10000) / 100 : 0,
          avgOrderValue: b.orderIds.size > 0 ? Math.round(b.revenue / b.orderIds.size) : 0,
          topProducts: Object.values(b.products)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5)
            .map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 })),
          companiesBought,
          companiesNotBought,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const topBrand = brands[0]?.name || null;

    return NextResponse.json({
      scorecards: {
        totalBrands: brands.length,
        totalRevenue: Math.round(totalRevenue),
        totalUnits,
        topBrand,
        topBrandRevenue: brands[0]?.revenue || 0,
        topBrandPct: brands[0]?.pct || 0,
      },
      brands,
    });

  } catch (err) {
    console.error('Brand performance error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
