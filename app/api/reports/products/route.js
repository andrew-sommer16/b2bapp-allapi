import { NextResponse } from 'next/server';
import { fetchAllCompanies, fetchB2BOrdersForCompanies, fetchLineItemsForOrders, fetchProductCatalog, parseList } from '@/lib/bcDirectAPI';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const limit = parseInt(searchParams.get('limit') || '25');
  const groupBy = searchParams.get('groupBy') || 'sku';
  let companies = parseList(searchParams.get('companies'));
  const salesReps = parseList(searchParams.get('salesReps'));
  const companyStatus = searchParams.get('companyStatus') || 'all';

  const customFieldFilters = {};
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('cf_')) {
      customFieldFilters[decodeURIComponent(key.slice(3))] = value.split(',').filter(Boolean);
    }
  }

  try {
    let allCompanies = await fetchAllCompanies();

    if (companyStatus === 'active') allCompanies = allCompanies.filter(c => c.status === '1');
    else if (companyStatus === 'inactive') allCompanies = allCompanies.filter(c => ['0', '2', '3'].includes(c.status));
    if (salesReps.length > 0) allCompanies = allCompanies.filter(c => c.sales_rep_id && salesReps.includes(c.sales_rep_id));
    if (companies.length > 0) allCompanies = allCompanies.filter(c => companies.includes(c.bc_company_id));

    if (companyStatus !== 'all' && allCompanies.length === 0) {
      return NextResponse.json({ scorecards: { totalSkus: 0, totalRevenue: 0, totalQuantity: 0 }, products: [], customFieldOptions: {} });
    }

    const companyIds = allCompanies.map(c => c.bc_company_id);
    let orders = await fetchB2BOrdersForCompanies(companyIds, { dateFrom, dateTo });
    orders = orders.filter(o =>
      o.custom_status !== 'Invoice Payment' &&
      o.custom_status !== 'Incomplete' &&
      o.custom_status !== 'Cancelled'
    );

    if (orders.length === 0) {
      return NextResponse.json({ scorecards: { totalSkus: 0, totalRevenue: 0, totalQuantity: 0 }, products: [], customFieldOptions: {} });
    }

    const orderIds = orders.map(o => o.bc_order_id);
    const orderDateMap = {};
    orders.forEach(o => { orderDateMap[o.bc_order_id] = o.created_at_bc; });

    const [lineItems, catalog] = await Promise.all([
      fetchLineItemsForOrders(orderIds),
      fetchProductCatalog(),
    ]);

    const catalogMap = {};
    catalog.forEach(p => { catalogMap[p.bc_product_id] = p; });

    // Build dynamic custom field options from ALL catalog products
    const customFieldOptions = {};
    catalog.forEach(p => {
      Object.entries(p.custom_fields || {}).forEach(([k, v]) => {
        if (!customFieldOptions[k]) customFieldOptions[k] = new Set();
        if (v) customFieldOptions[k].add(v);
      });
    });
    Object.keys(customFieldOptions).forEach(k => { customFieldOptions[k] = [...customFieldOptions[k]].sort(); });

    // Filter by product custom fields if needed
    const hasCustomFieldFilters = Object.keys(customFieldFilters).length > 0;
    const allowedProductIds = hasCustomFieldFilters
      ? new Set(catalog.filter(p => Object.entries(customFieldFilters).every(([f, vals]) => vals.includes(p.custom_fields?.[f]))).map(p => p.bc_product_id))
      : null;

    const groupMap = {};
    lineItems.forEach(item => {
      if (allowedProductIds && item.product_id && !allowedProductIds.has(item.product_id)) return;
      const prod = item.product_id ? catalogMap[item.product_id] : null;
      const groupKey = groupBy === 'product'
        ? (item.product_id || item.sku || 'Unknown')
        : (item.sku || item.product_name || 'Unknown');

      if (!groupMap[groupKey]) {
        groupMap[groupKey] = {
          sku: groupBy === 'product' ? (prod?.sku || item.sku || '—') : (item.sku || '—'),
          product_name: groupBy === 'product' ? (prod?.name || item.product_name || groupKey) : (item.product_name || item.sku),
          product_id: item.product_id,
          brand: prod?.brand || null,
          category: prod?.category || null,
          custom_fields: prod?.custom_fields || {},
          total_quantity: 0,
          total_revenue: 0,
          order_count: new Set(),
          last_order_date: null,
          variant_skus: new Set(),
        };
      }

      groupMap[groupKey].total_quantity += item.quantity || 0;
      groupMap[groupKey].total_revenue += item.line_total || 0;
      groupMap[groupKey].order_count.add(item.bc_order_id);
      if (item.sku) groupMap[groupKey].variant_skus.add(item.sku);
      const orderDate = orderDateMap[item.bc_order_id];
      if (orderDate && (!groupMap[groupKey].last_order_date || orderDate > groupMap[groupKey].last_order_date)) {
        groupMap[groupKey].last_order_date = orderDate;
      }
    });

    const products = Object.values(groupMap)
      .map(p => ({
        ...p,
        order_count: p.order_count.size,
        variant_skus: [...p.variant_skus],
        total_revenue: Math.round(p.total_revenue * 100) / 100,
        avg_order_value: p.order_count.size > 0 ? Math.round((p.total_revenue / p.order_count.size) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.total_revenue - a.total_revenue)
      .slice(0, limit);

    const totalRevenue = Object.values(groupMap).reduce((s, p) => s + p.total_revenue, 0);
    const totalQuantity = Object.values(groupMap).reduce((s, p) => s + p.total_quantity, 0);

    return NextResponse.json({
      scorecards: {
        totalSkus: Object.keys(groupMap).length,
        totalRevenue: Math.round(totalRevenue),
        totalQuantity,
        topSku: products[0]?.sku || null,
        topSkuRevenue: products[0]?.total_revenue || 0,
      },
      products,
      customFieldOptions,
    });

  } catch (err) {
    console.error('Products report error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
