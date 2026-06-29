/* eslint-disable @next/next/no-page-custom-font */
// ============================================================================
// DiipMynd — Root Layout
// Sets up fonts, metadata, SEO tags, and the global HTML structure.
// ============================================================================

import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";


// ── SEO Metadata ──────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: "DiipMynd — Real-Time AI Video Transformation",
  description:
    "Transform your live webcam feed in real time with AI. Become a 3D character, enter a cyberpunk world, or turn into an oil painting — powered by Fal.ai and WebRTC.",
  keywords: ["AI", "video transformation", "real-time", "WebRTC", "Fal.ai", "live avatar"],
  authors: [{ name: "DiipMynd" }],
  openGraph: {
    title: "DiipMynd — Real-Time AI Video Transformation",
    description: "Transform your live webcam feed in real time with AI.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
  width: "device-width",
  initialScale: 1,
};

// ── Layout ────────────────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Geist:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
