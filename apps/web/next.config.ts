import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'arielcharts\\.vercel\\.app',
          },
        ],
        destination: 'https://arielcharts.donovanyohan.com/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
