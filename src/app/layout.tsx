// ============================================================================
// DiipMynd — Root Layout
// Sets up fonts, metadata, SEO tags, and the global HTML structure.
// ============================================================================

import type { Metadata, Viewport } from "next";
import "./globals.css";

// ── SEO Metadata ──────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title: "DiipMynd — Real-Time AI Video Transformation",
  description:
    "Transform your live webcam feed in real time with AI. Become a 3D character, enter a cyberpunk world, or turn into an oil painting — powered by Decart AI and WebRTC.",
  keywords: ["AI", "video transformation", "real-time", "WebRTC", "Decart", "live avatar"],
  authors: [{ name: "DiipMynd" }],
  openGraph: {
    title: "DiipMynd — Real-Time AI Video Transformation",
    description: "Transform your live webcam feed in real time with AI.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090d",
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
    <html lang="en" className="dark">
      <head>
        {/* Google Fonts — Inter (variable weight) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
