/** @type {import('next').NextConfig} */
const distDir = process.env.NEXT_DIST_DIR || ".next";
const skipTypecheck = ["1", "true", "yes", "on"].includes(String(process.env.NEXT_IGNORE_TYPECHECK || "").toLowerCase());
const skipLint = ["1", "true", "yes", "on"].includes(String(process.env.NEXT_IGNORE_LINT || "").toLowerCase());
const buildCpus = Number.parseInt(String(process.env.NEXT_BUILD_CPUS || ""), 10);

const nextConfig = {
  typedRoutes: false,
  distDir,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  typescript: {
    ignoreBuildErrors: skipTypecheck,
  },
  eslint: {
    ignoreDuringBuilds: skipLint,
  },
  experimental: {
    serverMinification: false,
    ...(Number.isFinite(buildCpus) && buildCpus > 0 ? { cpus: buildCpus } : {}),
  },
};

module.exports = nextConfig;
