import { NextResponse } from 'next/server';
import { verifyToken, getUsers } from '@/lib/auth';

export async function GET(request) {
  const token = request.cookies.get('sb-token')?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const users = getUsers().map(u => ({
    id: u.id,
    email: u.email,
    role: u.role,
    first_name: u.first_name,
    last_name: u.last_name,
    store_hash: u.store_hash,
  }));

  return NextResponse.json({ users });
}
