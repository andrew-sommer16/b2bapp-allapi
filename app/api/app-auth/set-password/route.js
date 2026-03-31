import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({ error: 'Password management is done via environment variables.' }, { status: 400 });
}
