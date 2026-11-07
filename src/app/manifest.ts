import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Table",
    short_name: "Table",
    description: "Table (backgammon) în doi, pe telefon, cu prietenii. Încă doi pot privi.",
    id: "/backgammon/",
    start_url: "/backgammon/",
    // "/" on purpose: leaving the game for the hub (same origin) stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/backgammon/pwa-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/backgammon/pwa-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/backgammon/pwa-icon/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
