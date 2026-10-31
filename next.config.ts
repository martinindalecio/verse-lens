import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bible text is read from disk at runtime; make sure it ships with the server bundle.
  outputFileTracingIncludes: {
    "/*": ["./data/bsb/**/*"],
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
