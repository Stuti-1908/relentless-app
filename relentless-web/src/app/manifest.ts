import type { MetadataRoute } from "next";

// PWA manifest — makes "Add to Home Screen" use the branded icon + dark-red theme
// instead of a browser screenshot / plain letter.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Relentless AI",
    short_name: "Relentless",
    description: "Your AI executive-coaching dashboard.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#1a0303",
    theme_color: "#4a0a0a",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
