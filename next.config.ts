import type { NextConfig } from "next";

// Every page is live data keyed by an as-of date, so the app renders dynamically
// (cacheComponents / partial prefetching are intentionally off).
const nextConfig: NextConfig = {
  // postgres.js manages raw sockets and breaks when bundled; load it (and SheetJS) from node_modules.
  serverExternalPackages: ["postgres", "xlsx"],
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  outputFileTracingIncludes: {
    "/api/admin/**": ["./data/original/**"],
    "/data": ["./data/original/**"],
  },
};

export default nextConfig;
