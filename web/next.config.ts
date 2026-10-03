import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * The browser only ever talks to the Next.js origin; /api/* is proxied to the Fastify API.
 * Same origin means the httpOnly session cookie just works and no CORS configuration is needed.
 */
const nextConfig: NextConfig = {
  compress: false, // do not buffer the Server-Sent Events stream
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
