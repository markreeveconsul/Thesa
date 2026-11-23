import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  serverExternalPackages: ["pdfjs-dist"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: {
      allowedOrigins: [
        "*.asia-northeast1.run.app",
        "*.run.app",
        "localhost:3000",
      ],
    },
  },
  env: {
    ALLOW_BROWSER_DRAFTS: process.env.ALLOW_BROWSER_DRAFTS ?? "true",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
