import type { Metadata, Viewport } from "next";
import "./globals.css";

// The manifest link is injected automatically from app/manifest.ts, so it is not
// declared here — a second declaration would only be somewhere for the two to drift.
export const metadata: Metadata = {
  title: "Relentless AI",
  description: "Your AI executive-coaching dashboard.",
  appleWebApp: { capable: true, title: "Relentless", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
