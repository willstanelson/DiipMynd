import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' ${isDev ? "'unsafe-eval' " : ""}'unsafe-inline' https://accounts.google.com https://apis.google.com`,
              "frame-src 'self' https://accounts.google.com",
              "connect-src 'self' https://accounts.google.com https://*.supabase.co https://*.fal.run wss://*.fal.run https://api.paystack.co https://api.telegram.org http://localhost:8000 https://api.decart.ai https://api3.decart.ai wss://api3.decart.ai https://platform.decart.ai wss://*.lkc.decart.ai https://*.lkc.decart.ai wss://*.nlbs.lkc.decart.ai https://*.nlbs.lkc.decart.ai wss://*.livekit.cloud https://*.livekit.cloud https://*.runwayml.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://*.googleusercontent.com https://*.supabase.co https://*.fal.run https://*.fal.media",
              "media-src 'self' blob: https://*.fal.run https://*.fal.media https://api.telegram.org",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
