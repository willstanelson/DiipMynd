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
              "connect-src 'self' https://accounts.google.com https://*.supabase.co https://*.fal.run wss://*.fal.run https://api.paystack.co",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https://*.googleusercontent.com",
              "media-src 'self' blob: https://*.fal.run",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
