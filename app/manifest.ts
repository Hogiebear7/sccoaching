import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "S&C Performance Coaching",
    short_name: "S&C",
    description: "Science-backed training, nutrition and recovery in one place.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1c1d22",
    theme_color: "#1c1d22",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
