// ============================================================================
// DiipMynd — Root Layout
// Sets up fonts, metadata, SEO tags, and the global HTML structure.
// ============================================================================

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

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
      <body className={`${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  );
}
