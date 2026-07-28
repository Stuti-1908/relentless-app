import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // Parse x-www-form-urlencoded body
  const text = await req.text();
  const params = new URLSearchParams(text);
  const message = params.get("Body") || "";

  let reply = "I am your AI strategist. How can I help you pressure-test your thinking today?";
  if (message.toUpperCase() === "WAR ROOM") {
    reply = "Welcome to the War Room strategy session. What is the single biggest bottleneck you are facing today?";
  } else if (message.toLowerCase().includes("hiring")) {
    reply = "Hiring is indeed a scaling bottleneck. Let's design a 24-hour action to delegate this: write a detailed job description.";
  }

  return NextResponse.json({ reply });
}
