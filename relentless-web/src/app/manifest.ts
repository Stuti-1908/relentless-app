import type { MetadataRoute } from "next";

// PWA manifest — makes "Add to Home Screen" use the branded icon + dark-red theme
// instead of a browser screenshot / plain letter.
//
// Icons point at the real brand mark in public/, NOT at the /icon and /apple-icon
// routes that icon.tsx and apple-icon.tsx generate. Those render a serif "R" at
// request time, which is a different mark from the actual logo and was what home
// screens had been showing.
//
// This file wins over public/manifest.webmanifest: a Next.js file convention takes
// precedence over a same-named static file, so the static one is never served.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relentless AI",
    short_name: "Relentless",
    description: "Your AI executive-coaching dashboard.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#4a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Maskable lets Android crop to its own shape without letterboxing the mark.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
