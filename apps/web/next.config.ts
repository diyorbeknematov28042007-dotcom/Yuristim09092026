import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';

loadEnvConfig(resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/sign/profile-images/**',
        protocol: 'https',
      },
    ],
  },
  poweredByHeader: false,
  transpilePackages: ['@yuristim/ui'],
};

export default nextConfig;
