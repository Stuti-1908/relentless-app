import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relentless AI",
  description: "Your AI executive-coaching dashboard.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Relentless", statusBarStyle: "black-translucent" },
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
