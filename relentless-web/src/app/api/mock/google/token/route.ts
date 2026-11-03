import { NextResponse } from "next/server";

export async function POST(_req: Request) {
  if (process.env.VERCEL_ENV === "production") return new Response(null, { status: 404 }); // test-only mock
  // Return a mock access token for the google api
  return NextResponse.json({
    access_token: "mock-google-access-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
}
