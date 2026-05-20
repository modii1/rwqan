import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    reactStrictMode: true,
    experimental: {
        scrollRestoration: true,
    },
    // Image optimization
    images: {
        unoptimized: true,
        remotePatterns: [
            { protocol: 'https', hostname: 'pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev' }, // R2 bucket
            { protocol: 'https', hostname: 'lh3.googleusercontent.com' } // Google Auth
        ]
    },
};

export default nextConfig;
