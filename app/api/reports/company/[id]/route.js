import { NextResponse } from 'next/server';
import { fetchCompanyDetail, fetchAllSalesReps, fetchB2BOrdersForCompanies, fetchLineItemsForOrders } from '@/lib/bcDirectAPI';

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const dateField = searchParams.get('dateField') || 'created';

  try {
    const [company, reps] = await Promise.all([
      fetchCompanyDetail(id),
      fetchAllSalesReps(),
    ]);

    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    const repMap = {};
    reps.forEach(r => { repMap[r.bc_rep_id] = `${r.first_name} ${r.last_name}`.trim(); });

    const dateParams = dateField === 'created' ? { dateFrom, dateTo } : {};
    let orders = await fetchB2BOrdersForCompanies([id], dateParams);

    orders = orders
      .filter(o => o.custom_status !== 'Invoice Payment' && o.custom_status !== 'Incomplete')
      .sort((a, b) => new Date(b.created_at_bc) - new Date(a.created_at_bc));

    const orderIds = orders.map(o => o.bc_order_id);
    const lineItems = orderIds.length > 0 ? await fetchLineItemsForOrders(orderIds) : [];

    const lineItemsByOrder = {};
    lineItems.forEach(item => {
      if (!lineItemsByOrder[item.bc_order_id]) lineItemsByOrder[item.bc_order_id] = [];
      lineItemsByOrder[item.bc_order_id].push(item);
    });

    const totalRevenue = orders.reduce((s, o) => s + (o.total_inc_tax || 0), 0);
    const orderCount = orders.length;
    const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
    const lastOrder = orders[0]?.created_at_bc;
    const daysSinceLastOrder = lastOrder
      ? Math.floor((new Date() - new Date(lastOrder)) / 86400000)
      : null;

    return NextResponse.json({
      company: {
        ...company,
        sales_rep_name: company.sales_rep_id ? (repMap[company.sales_rep_id] || null) : null,
      },
      scorecards: {
        totalRevenue: Math.round(totalRevenue),
        orderCount,
        avgOrderValue: Math.round(avgOrderValue),
        daysSinceLastOrder,
      },
      orders: orders.map(o => ({
        ...o,
        line_items: lineItemsByOrder[o.bc_order_id] || [],
      })),
    });

  } catch (err) {
    console.error('Company detail error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
