import type { Metadata } from "next";

import "pdfjs-dist/web/pdf_viewer.css";
import "react-pdf-highlighter-plus/style/style.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIReviewer",
  description: "Agentic paper-review workspace for academic submissions"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
