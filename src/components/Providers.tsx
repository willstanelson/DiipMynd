"use client";

import React from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";

export default function Providers({ children }: { children: React.ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Providers] NEXT_PUBLIC_GOOGLE_CLIENT_ID not set — Google login disabled");
    }
    return <>{children}</>;
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {children}
    </GoogleOAuthProvider>
  );
}
