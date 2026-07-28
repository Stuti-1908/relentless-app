import { NextResponse } from "next/server";

export async function POST(_req: Request) {
  // Return a mock access token for the google api
  return NextResponse.json({
    access_token: "mock-google-access-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
}
