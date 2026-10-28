import { createSerwistRoute } from "@serwist/turbopack";

// New per build, so a deploy installs a fresh shell (and the "Update" banner appears).
const revision = crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "sw/sw.ts",
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: "/field", revision }],
  globPatterns: [".next/static/**/*.{js,css,woff,woff2,png,svg,ico,json}", "public/**/*"],
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
});
