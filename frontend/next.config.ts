import type { NextConfig } from "next";

const basePath = "/fg-yard";

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
