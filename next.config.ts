import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the Docker image can run without node_modules.
  output: "standalone",
  // Large CJS SDKs that Next doesn't auto-externalize and that break when
  // bundled into the server build.
  serverExternalPackages: [
    "googleapis",
    "oci-common",
    "oci-usageapi",
    "oci-resourcesearch",
    "oci-budget",
  ],
};

export default nextConfig;
