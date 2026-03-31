import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ settings: {} }); }
export async function POST() { return NextResponse.json({ success: true }); }
