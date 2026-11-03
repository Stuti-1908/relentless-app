import { NextResponse } from "next/server";
import { db } from "../../db";

export async function GET(_req: Request) {
  if (process.env.VERCEL_ENV === "production") return new Response(null, { status: 404 }); // test-only mock
  // Return mock google calendar events
  return NextResponse.json({
    items: db.google.events,
  });
}
