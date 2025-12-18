/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Turbopack config (Next.js 16+ uses Turbopack by default)
  // Node.js polyfills (fs, net, tls) are automatically stubbed in browser builds
  turbopack: {},
};

module.exports = nextConfig;
