import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import { resolve } from 'node:path';

loadEnvConfig(resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@yuristim/ui'],
};

export default nextConfig;
