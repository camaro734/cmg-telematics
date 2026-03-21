// @ts-check

const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      urlPattern: /^https?.*\/api\/v1\/dashboard\/fleet/,
      handler: "NetworkFirst",
      options: {
        cacheName: "fleet-cache",
        expiration: { maxEntries: 10, maxAgeSeconds: 60 },
        networkTimeoutSeconds: 5,
      },
    },
    {
      urlPattern: /^https?.*\/api\/v1\/vehicles\/.*\/last/,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "telemetry-last-cache",
        expiration: { maxEntries: 50, maxAgeSeconds: 300 },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8010/api/:path*",
      },
      {
        source: "/health",
        destination: "http://localhost:8010/health",
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
