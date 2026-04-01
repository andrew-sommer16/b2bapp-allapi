import { NextResponse } from 'next/server';
import {
  fetchAllCompanies, fetchAllSalesReps,
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
    // Start catalog in parallel — independent of company IDs
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

      if (!brandMap[brandName]) {
        brandMap[brandName] = {
          name: brandName,
          revenue: 0,
          units: 0,
          orderIds: new Set(),
          products: {},
        };
      }

      brandMap[brandName].revenue += revenue;
      brandMap[brandName].units += units;
      brandMap[brandName].orderIds.add(item.bc_order_id);

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

    const brands = Object.values(brandMap)
      .map(b => ({
        name: b.name,
        revenue: Math.round(b.revenue * 100) / 100,
        spend: Math.round(b.revenue * 100) / 100, // alias for pie chart
        units: b.units,
        orders: b.orderIds.size,
        pct: totalRevenue > 0 ? Math.round((b.revenue / totalRevenue) * 10000) / 100 : 0,
        avgOrderValue: b.orderIds.size > 0 ? Math.round(b.revenue / b.orderIds.size) : 0,
        topProducts: Object.values(b.products)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5)
          .map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 })),
      }))
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
