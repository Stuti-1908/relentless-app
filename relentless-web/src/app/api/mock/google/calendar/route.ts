import { NextResponse } from "next/server";
import { db } from "../../db";

export async function GET(_req: Request) {
  // Return mock google calendar events
  return NextResponse.json({
    items: db.google.events,
  });
}
