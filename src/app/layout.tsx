import type { Metadata } from "next";
import "./globals.css";
import { siteConfig } from "@/lib/site-config";


export const metadata: Metadata = {
  title: siteConfig.brandName,
  description: "Yoga, Pilates and fitness studio demo platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

