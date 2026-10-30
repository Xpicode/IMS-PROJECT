import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy (§16). Same-origin only. 'unsafe-inline' scripts are
 * still needed for Next's inline bootstrap (nonces would need middleware on
 * every page; logged as a known limitation). 'wasm-unsafe-eval' lets the barcode
 * scanner's WebAssembly run; 'unsafe-eval' only in development (React refresh).
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Cache Components stays off: every IMS page is per-user and authenticated
  // (see tracker, Decisions, 2026-10-28).
  // Self-contained server for the production image (Dockerfile): node server.js.
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  // Dev only: other hosts (a phone on the LAN) allowed to load dev assets.
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(",").filter(Boolean),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: CSP },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// withSerwist keeps esbuild out of the server bundle (it builds the service worker).
export default withSerwist(nextConfig);
