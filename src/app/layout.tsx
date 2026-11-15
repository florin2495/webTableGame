import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "Table",
  applicationName: "Table",
  // Explicit + base-path-prefixed: metadata icon URLs are not prefixed automatically, and setting
  // `icons` replaces the app/icon.svg link, so it is listed here too.
  icons: {
    icon: [{ url: `${BASE}/icon.svg`, type: "image/svg+xml" }],
    apple: [{ url: `${BASE}/pwa-icon/apple-180.png`, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Table", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  description: "Table (backgammon) în doi, pe telefon, cu prietenii, care pot privi.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // iOS: without a max scale Safari keeps a stale zoom after landscape -> portrait.
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
