import type { MetadataRoute } from "next";

// Kept as a route rather than a static public/manifest.json so Next
// injects <link rel="manifest"> itself and the shape stays type-checked.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ConstruSuite",
    short_name: "ConstruSuite",
    description: "Sistema de gestión integral",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: "#0A0A0A",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
