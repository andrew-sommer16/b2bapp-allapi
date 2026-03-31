import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({ status: 'live', message: 'Data is queried live from BigCommerce API' });
}
