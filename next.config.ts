import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  async redirects() {
    return [{ source: "/admin", destination: "/admin/review", permanent: false }];
  },
  partialPrefetching: true,
  turbopack: {
    // A lockfile further up the tree would otherwise be taken as the workspace root.
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
