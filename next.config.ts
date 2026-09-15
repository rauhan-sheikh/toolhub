import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone so the Docker image can run without node_modules.
  output: "standalone",
  // googleapis is not in Next's auto-externalized list and breaks when bundled.
  serverExternalPackages: ["googleapis"],
};

export default nextConfig;
