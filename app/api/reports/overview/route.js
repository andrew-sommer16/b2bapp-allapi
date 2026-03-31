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
  const dateField = searchParams.get('dateField') || 'created';
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
    // Fetch all companies live from BC API
    let allCompanies = await fetchAllCompanies();

    // Filter by status
    if (companyStatus === 'active') allCompanies = allCompanies.filter(c => c.status === '1');
    else if (companyStatus === 'inactive') allCompanies = allCompanies.filter(c => ['0', '2', '3'].includes(c.status));

    // Filter by customer group
    if (customerGroups.length > 0) {
      allCompanies = allCompanies.filter(c => customerGroups.includes(c.customer_group_id));
    }

    // Filter by sales rep
    if (salesReps.length > 0) {
      allCompanies = allCompanies.filter(c => c.sales_rep_id && salesReps.includes(c.sales_rep_id));
    }

    // Filter by selected company IDs
    if (companies.length > 0) {
      allCompanies = allCompanies.filter(c => companies.includes(c.bc_company_id));
    }

    // Apply custom field filters
    if (Object.keys(customFieldFilters).length > 0) {
      allCompanies = allCompanies.filter(c =>
        Object.entries(customFieldFilters).every(([fieldName, allowedValues]) =>
          allowedValues.includes(c.custom_fields?.[fieldName])
        )
      );
    }

    // Build company custom field options and customer group options
    const companyCustomFieldOptions = {};
    const customerGroupOptions = {};
    allCompanies.forEach(c => {
      if (c.customer_group_id && c.customer_group_name) {
        customerGroupOptions[c.customer_group_id] = c.customer_group_name;
      }
      Object.entries(c.custom_fields || {}).forEach(([key, value]) => {
        if (!companyCustomFieldOptions[key]) companyCustomFieldOptions[key] = new Set();
        if (value) companyCustomFieldOptions[key].add(value);
      });
    });
    Object.keys(companyCustomFieldOptions).forEach(k => {
      companyCustomFieldOptions[k] = [...companyCustomFieldOptions[k]].sort();
    });

    const totalAccounts = allCompanies.length;
    if (companyStatus !== 'all' && totalAccounts === 0) {
      return NextResponse.json({
        scorecards: { totalSpend: 0, orderCount: 0, avgOrderValue: 0, totalAccounts: 0 },
        categorySpend: [], brandSpend: [], companyCustomFieldOptions: {}, customerGroupOptions: {},
      });
    }

    const companyIds = allCompanies.map(c => c.bc_company_id);

    // Fetch B2B orders (date filter applied per-company via API)
    const dateParams = dateField === 'created' ? { dateFrom, dateTo } : {};
    let orders = await fetchB2BOrdersForCompanies(companyIds, dateParams);

    // Exclude payment/incomplete/cancelled orders
    orders = orders.filter(o =>
      o.custom_status !== 'Invoice Payment' &&
      o.custom_status !== 'Incomplete' &&
      o.custom_status !== 'Cancelled'
    );

    // For shipped date filtering, filter orders by date_shipped via BC REST API
    if (dateField === 'shipped' && (dateFrom || dateTo)) {
      const { fetchAllBC } = await import('@/lib/bcDirectAPI');
      const bcOrders = await fetchAllBC('/v2/orders', {
        min_date_modified: dateFrom || undefined,
        max_date_modified: dateTo ? dateTo + 'T23:59:59' : undefined,
        is_deleted: false,
      });
      const shippedIds = new Set(
        bcOrders.filter(o => o.date_shipped && o.date_shipped !== '0001-01-01T00:00:00+00:00')
          .map(o => String(o.id))
      );
      orders = orders.filter(o => shippedIds.has(o.bc_order_id));
    }

    const totalSpend = orders.reduce((s, o) => s + (o.total_inc_tax || 0), 0);
    const orderCount = orders.length;
    const avgOrderValue = orderCount > 0 ? totalSpend / orderCount : 0;

    // Fetch line items + product catalog for category/brand breakdown
    let categorySpend = [];
    let brandSpend = [];

    if (orders.length > 0) {
      const orderIds = orders.map(o => o.bc_order_id);
      const [lineItems, catalog] = await Promise.all([
        fetchLineItemsForOrders(orderIds),
        fetchProductCatalog(),
      ]);

      const catalogMap = {};
      catalog.forEach(p => { catalogMap[p.bc_product_id] = p; });

      const catMap = {};
      const brandMap = {};
      lineItems.forEach(item => {
        const prod = item.product_id ? catalogMap[item.product_id] : null;
        const cat = prod?.category || 'Uncategorized';
        const brand = prod?.brand || 'Unbranded';
        const revenue = item.line_total || 0;
        catMap[cat] = (catMap[cat] || 0) + revenue;
        brandMap[brand] = (brandMap[brand] || 0) + revenue;
      });

      const totalLineRevenue = Object.values(catMap).reduce((s, v) => s + v, 0);

      categorySpend = Object.entries(catMap)
        .map(([name, spend]) => ({ name, spend: Math.round(spend * 100) / 100, pct: totalLineRevenue > 0 ? Math.round((spend / totalLineRevenue) * 100) : 0 }))
        .sort((a, b) => b.spend - a.spend);

      brandSpend = Object.entries(brandMap)
        .map(([name, spend]) => ({ name, spend: Math.round(spend * 100) / 100, pct: totalLineRevenue > 0 ? Math.round((spend / totalLineRevenue) * 100) : 0 }))
        .sort((a, b) => b.spend - a.spend);
    }

    return NextResponse.json({
      scorecards: {
        totalSpend: Math.round(totalSpend),
        orderCount,
        avgOrderValue: Math.round(avgOrderValue),
        totalAccounts,
      },
      categorySpend,
      brandSpend,
      companyCustomFieldOptions,
      customerGroupOptions,
    });

  } catch (err) {
    console.error('Overview error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
