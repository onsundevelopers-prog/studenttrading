import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/overlays";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-src",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PaperDesk — Classroom Trading Simulator",
    template: "%s · PaperDesk",
  },
  description:
    "A classroom stock and cryptocurrency trading simulator that uses virtual money only. No real funds, orders, or custody.",
};

export const viewport: Viewport = {
  themeColor: "#010102",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        {/* Radix tooltips are unusable without a provider above them. The price
            freshness indicator in the top bar is a tooltip, so it sits on every
            authenticated page — without this the whole shell throws. */}
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          {children}
        </TooltipProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#141516",
              border: "1px solid #23252a",
              color: "#f7f8f8",
              borderRadius: "8px",
            },
          }}
        />
      </body>
    </html>
  );
}
