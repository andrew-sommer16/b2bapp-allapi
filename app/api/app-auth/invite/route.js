import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({ error: 'User management is done via environment variables. Add USER_N_EMAIL and USER_N_PASSWORD to your .env.local file.' }, { status: 400 });
}
