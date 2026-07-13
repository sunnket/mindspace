import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    root: process.cwd(),
  },
  // File parsers use Node.js-specific features (streams, workers, fs). Keep them
  // out of the Server Components bundle and load them via native require at
  // runtime so the /api/file-extract route works reliably.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'jszip', 'word-extractor'],
};

export default nextConfig;
