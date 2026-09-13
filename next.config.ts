import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

/**
 * The parent directory (`C:\Users\Ose`) contains an unrelated
 * `package-lock.json`, which makes Turbopack guess the wrong workspace root and
 * warn on every build. Pin the root to this project.
 */
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },

  // Market data is read through /src/lib/market. Keep the upstream key and any
  // server-only code out of the client bundle.
  serverExternalPackages: [],

  experimental: {
    // Server Actions receive the trade payloads; Zod validates them but keep the
    // default body limit explicit so a malformed client can't post a huge body.
    serverActions: { bodySizeLimit: "256kb" },
  },
};

export default nextConfig;
