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
  // On Vercel the browser route runs as a Lambda, where the only Chromium that
  // exists is the one @sparticuz/chromium carries in its own bin/ folder. Nothing
  // imports those files statically, so file tracing drops them and the function
  // boots without a browser — pull them in explicitly.
  outputFileTracingIncludes: {
    '/api/browser': ['./node_modules/@sparticuz/chromium/bin/**/*'],
  },
};

export default nextConfig;
