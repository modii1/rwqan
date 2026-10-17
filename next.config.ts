import type { NextConfig } from "next";

// The flag is defined only in ignored .env.local for this workstation. Cloud
// builds do not receive it, so the root override remains local-only.
const useLocalTurbopackRoot = process.env.RWQAN_LOCAL_TURBOPACK_ROOT === "1";

const nextConfig: NextConfig = {
    /* config options here */
    reactStrictMode: true,
    ...(useLocalTurbopackRoot
        ? { turbopack: { root: process.cwd() } }
        : {}),
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
