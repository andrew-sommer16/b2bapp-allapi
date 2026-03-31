import { NextResponse } from 'next/server';
import { fetchAllCompanies, fetchAllSalesReps, fetchAllCustomerGroups } from '@/lib/bcDirectAPI';

export async function GET() {
  try {
    const [companies, reps, groups] = await Promise.all([
      fetchAllCompanies(),
      fetchAllSalesReps(),
      fetchAllCustomerGroups(),
    ]);

    return NextResponse.json({
      companies: companies.map(c => ({
        value: c.bc_company_id,
        label: c.company_name,
        customerGroupId: c.customer_group_id,
      })),
      salesReps: reps.map(r => ({
        value: r.bc_rep_id,
        label: `${r.first_name} ${r.last_name}`.trim(),
      })),
      customerGroups: groups.map(g => ({
        value: g.bc_group_id,
        label: g.group_name,
      })),
      quoteStatuses: [
        { value: '0', label: 'New' },
        { value: '2', label: 'In Process' },
        { value: '4', label: 'Ordered' },
        { value: '5', label: 'Expired' },
        { value: '6', label: 'Archived' },
      ],
      orderStatuses: [
        { value: 'Awaiting Payment', label: 'Awaiting Payment' },
        { value: 'Awaiting Fulfillment', label: 'Awaiting Fulfillment' },
        { value: 'Shipped', label: 'Shipped' },
        { value: 'Completed', label: 'Completed' },
        { value: 'Cancelled', label: 'Cancelled' },
      ],
      paymentStatuses: [
        { value: 'outstanding', label: 'Outstanding' },
        { value: 'paid', label: 'Paid' },
      ],
    });
  } catch (err) {
    console.error('Filter options error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
