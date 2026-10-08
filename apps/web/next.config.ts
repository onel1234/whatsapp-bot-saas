import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@saha/shared"],
  poweredByHeader: false,
};
export default config;
