import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    root: process.cwd(),
  },
  // File parsers use Node.js-specific features (streams, workers, fs). Keep them
  // out of the Server Components bundle and load them via native require at
  // runtime so the /api/file-extract route works reliably.
  serverExternalPackages: ['pdf-parse', 'mammoth', 'jszip', 'word-extractor', '@napi-rs/canvas'],
  // pdf-parse loads its pdf.js worker via a runtime dynamic import(), which the
  // serverless file tracer can't follow — so the .mjs worker was missing from
  // the deployed bundle ("Cannot find module …/pdf.worker.mjs"). Force-include
  // the worker (and @napi-rs/canvas's native .node binaries) for the extract route.
  outputFileTracingIncludes: {
    '/api/file-extract': [
      './node_modules/pdf-parse/dist/**/*.mjs',
      './node_modules/@napi-rs/canvas/**/*.node',
    ],
  },
};

export default nextConfig;
