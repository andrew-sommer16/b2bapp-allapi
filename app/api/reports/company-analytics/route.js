import { NextResponse } from 'next/server';
import { fetchAllCompanies, fetchAllSalesReps, fetchB2BOrdersForCompanies, parseList } from '@/lib/bcDirectAPI';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const dateField = searchParams.get('dateField') || 'created';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '25');
  const search = searchParams.get('search') || '';
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
    const [allCompaniesRaw, repsList] = await Promise.all([
      fetchAllCompanies(),
      fetchAllSalesReps(),
    ]);

    const repMap = {};
    repsList.forEach(r => { repMap[r.bc_rep_id] = `${r.first_name} ${r.last_name}`.trim(); });

    // Apply filters
    let allCompanies = allCompaniesRaw;
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
    if (search) {
      const s = search.toLowerCase();
      allCompanies = allCompanies.filter(c =>
        c.company_name?.toLowerCase().includes(s) || c.primary_email?.toLowerCase().includes(s)
      );
    }

    // Build filter option metadata
    const extraFieldOptions = {};
    const customerGroupOptions = {};
    allCompaniesRaw.forEach(c => {
      if (c.customer_group_id && c.customer_group_name) customerGroupOptions[c.customer_group_id] = c.customer_group_name;
      Object.entries(c.custom_fields || {}).forEach(([k, v]) => {
        if (!extraFieldOptions[k]) extraFieldOptions[k] = new Set();
        if (v) extraFieldOptions[k].add(v);
      });
    });
    Object.keys(extraFieldOptions).forEach(k => { extraFieldOptions[k] = [...extraFieldOptions[k]].sort(); });

    const companyIds = allCompanies.map(c => c.bc_company_id);

    if (companyStatus !== 'all' && companyIds.length === 0) {
      return NextResponse.json({
        scorecards: { totalAccounts: 0, totalRevenue: 0, totalOrders: 0, avgOrderValue: 0, excellent: 0, good: 0, fair: 0, atRisk: 0 },
        companies: [], extraFieldOptions, customerGroupOptions,
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const dateParams = dateField === 'created' ? { dateFrom, dateTo } : {};
    let orders = await fetchB2BOrdersForCompanies(companyIds, dateParams);
    orders = orders.filter(o =>
      o.custom_status !== 'Invoice Payment' &&
      o.custom_status !== 'Incomplete' &&
      o.custom_status !== 'Cancelled' &&
      o.created_at_bc
    );

    const ordersByCompany = {};
    orders.forEach(o => {
      if (!ordersByCompany[o.company_id]) ordersByCompany[o.company_id] = [];
      ordersByCompany[o.company_id].push(o);
    });

    const today = new Date();

    const rows = allCompanies.map(company => {
      const companyOrders = (ordersByCompany[company.bc_company_id] || [])
        .sort((a, b) => new Date(a.created_at_bc) - new Date(b.created_at_bc));

      const accountAge = company.created_at_bc
        ? Math.floor((today - new Date(company.created_at_bc)) / 86400000)
        : null;

      const firstOrder = companyOrders[0]?.created_at_bc || null;
      const lastOrder = companyOrders[companyOrders.length - 1]?.created_at_bc || null;
      const daysSinceLastOrder = lastOrder ? Math.floor((today - new Date(lastOrder)) / 86400000) : null;

      let avgDaysBetweenOrders = null;
      if (companyOrders.length >= 2) {
        const gaps = [];
        for (let i = 1; i < companyOrders.length; i++) {
          const gap = Math.floor((new Date(companyOrders[i].created_at_bc) - new Date(companyOrders[i - 1].created_at_bc)) / 86400000);
          if (gap > 0) gaps.push(gap);
        }
        if (gaps.length > 0) avgDaysBetweenOrders = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }

      const totalRevenue = companyOrders.reduce((s, o) => s + (o.total_inc_tax || 0), 0);
      const orderCount = companyOrders.length;
      const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

      const statusDist = {};
      companyOrders.forEach(o => {
        const s = o.custom_status || 'Unknown';
        if (!statusDist[s]) statusDist[s] = { count: 0, total: 0 };
        statusDist[s].count++;
        statusDist[s].total += o.total_inc_tax || 0;
      });

      // Health score
      let healthScore = 0;
      if (daysSinceLastOrder !== null) {
        if (daysSinceLastOrder <= 30) healthScore += 30;
        else if (daysSinceLastOrder <= 60) healthScore += 20;
        else if (daysSinceLastOrder <= 90) healthScore += 10;
      }
      if (avgDaysBetweenOrders !== null) {
        if (avgDaysBetweenOrders <= 30) healthScore += 25;
        else if (avgDaysBetweenOrders <= 60) healthScore += 18;
        else if (avgDaysBetweenOrders <= 90) healthScore += 10;
        else healthScore += 5;
      }
      if (orderCount >= 20) healthScore += 25;
      else if (orderCount >= 10) healthScore += 18;
      else if (orderCount >= 5) healthScore += 12;
      else if (orderCount >= 1) healthScore += 6;
      if (accountAge !== null) {
        if (accountAge >= 365) healthScore += 20;
        else if (accountAge >= 180) healthScore += 15;
        else if (accountAge >= 90) healthScore += 10;
        else healthScore += 5;
      }

      let tier;
      if (healthScore >= 80) tier = 'Excellent';
      else if (healthScore >= 60) tier = 'Good';
      else if (healthScore >= 40) tier = 'Fair';
      else tier = 'At Risk';

      return {
        company_id: company.bc_company_id,
        company_name: company.company_name,
        primary_email: company.primary_email || null,
        parent_company_name: company.parent_company_name || null,
        customer_group_name: company.customer_group_name || null,
        sales_rep_name: company.sales_rep_id ? (repMap[company.sales_rep_id] || null) : null,
        custom_fields: company.custom_fields || {},
        health_score: healthScore,
        tier,
        account_age_days: accountAge,
        total_orders: orderCount,
        total_revenue: Math.round(totalRevenue),
        avg_order_value: Math.round(avgOrderValue),
        first_order_date: firstOrder,
        last_order_date: lastOrder,
        days_since_last_order: daysSinceLastOrder,
        avg_days_between_orders: avgDaysBetweenOrders,
        status_distribution: statusDist,
      };
    });

    const total = rows.length;
    const paginated = rows.slice((page - 1) * limit, page * limit);
    const totalRevenue = rows.reduce((s, r) => s + r.total_revenue, 0);
    const totalOrders = rows.reduce((s, r) => s + r.total_orders, 0);

    return NextResponse.json({
      scorecards: {
        totalAccounts: total,
        totalRevenue: Math.round(totalRevenue),
        totalOrders,
        avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
        excellent: rows.filter(r => r.tier === 'Excellent').length,
        good: rows.filter(r => r.tier === 'Good').length,
        fair: rows.filter(r => r.tier === 'Fair').length,
        atRisk: rows.filter(r => r.tier === 'At Risk').length,
      },
      companies: paginated,
      extraFieldOptions,
      customerGroupOptions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });

  } catch (err) {
    console.error('Company analytics error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
