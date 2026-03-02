import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    reactStrictMode: true,
    // We need to allow the existing Image domains if any
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev' }, // R2 bucket
            { protocol: 'https', hostname: 'lh3.googleusercontent.com' } // Google Auth
        ]
    },
    // Since we are using a custom server, we might want to disable some standalone output features or keep them default.
    // Standard config is fine.
};

export default nextConfig;
