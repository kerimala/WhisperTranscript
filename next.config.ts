import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    turbopack: {
        root: __dirname,
    },
    // Allow large audio files to be uploaded through the API route
    experimental: {
        serverActions: {
            bodySizeLimit: '500mb',
        },
    },
};

export default nextConfig;
