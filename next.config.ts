import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    root: process.cwd(),
  },
  // File parsers use Node.js-specific features (streams, workers, fs). Keep them
  // out of the Server Components bundle and load them via native require at
  // runtime so the /api/file-extract route works reliably. Puppeteer is here for
  // the same reason: bundling it breaks how it resolves the Chrome binary.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'jszip', 'puppeteer'],
};

export default nextConfig;
