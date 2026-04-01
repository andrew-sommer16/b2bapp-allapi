import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import {
  fetchAllCompanies,
  fetchAllSalesReps,
  fetchAllCustomerGroups,
  fetchProductCatalog,
} from '@/lib/bcDirectAPI';

// Called right after login to pre-populate the cache so the first
// report load is fast. Runs all independent fetches in parallel.
export async function POST(request) {
  try {
    const token = request.cookies.get('app_token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await verifyToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fire all fetches in parallel — don't await individual results so
  // we return immediately and warming continues in the background.
  Promise.all([
    fetchAllCompanies(),
    fetchAllSalesReps(),
    fetchAllCustomerGroups(),
    fetchProductCatalog(),
  ]).catch(err => console.error('Cache warm error:', err));

  return NextResponse.json({ ok: true });
}
