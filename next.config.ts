import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bible text and section headings are read from disk at runtime; make sure they ship with the
  // server bundle.
  outputFileTracingIncludes: {
    "/*": ["./data/bsb/**/*", "./data/sections/**/*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
