import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Table",
    short_name: "Table",
    description: "Table (backgammon) în doi, pe telefon, cu prietenii. Încă doi pot privi.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/pwa-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
