import type { NextConfig } from "next";

const basePath =
  process.env.NODE_ENV === "development"
    ? ""
    : process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  basePath,
  output: "standalone",
  typescript: { ignoreBuildErrors: false },
} satisfies NextConfig;

export default nextConfig;
