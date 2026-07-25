import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  // Migrations are read from disk at runtime by drizzle's migrator, so nothing
  // in the module graph references them and file tracing cannot infer them.
  // Without this the standalone server starts against an empty data dir and
  // fails on the first query.
  outputFileTracingIncludes: {
    "/*": ["./src/db/migrations/**/*"],
    "/**": ["./src/db/migrations/**/*"],
  },
};

export default nextConfig;
