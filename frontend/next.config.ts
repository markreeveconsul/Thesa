import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { NextConfig } from "next";
const workspaceId =
  process.env.NEXT_THESA_WORKSPACE_MARKER ||
  createHash("sha256")
    .update(resolve(process.cwd(), "..").toLowerCase())
    .digest("hex");
const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Thesa-Workspace", value: workspaceId },
        ],
      },
    ];
  },
};
export default nextConfig;
