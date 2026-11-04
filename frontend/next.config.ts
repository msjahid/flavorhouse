import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    // Menu images come from the Django API (local /media/) or from S3 / a CDN.
    remotePatterns: [
      { protocol: "http", hostname: "localhost", port: "8000", pathname: "/media/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "8000", pathname: "/media/**" },
      { protocol: "http", hostname: "backend", port: "8000", pathname: "/media/**" },
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
