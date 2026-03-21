import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CMG Telematics",
  description: "Plataforma de telemática industrial — CMG Metalhidráulica S.L.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1D9E75" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="CMG Telematics" />
      </head>
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
