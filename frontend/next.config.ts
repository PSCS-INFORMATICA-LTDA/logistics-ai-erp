import type { NextConfig } from "next";

/** Prevent Vercel CDN from serving stale HTML that references outdated /_next/static chunks. */
const noStoreHtmlHeaders = [
  { key: "Cache-Control", value: "no-store, must-revalidate" },
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Vercel-CDN-Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
        headers: noStoreHtmlHeaders,
      },
    ];
  },
};

export default nextConfig;
