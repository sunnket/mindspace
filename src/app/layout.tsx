import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/providers/AuthProvider";
import DeferredFonts from "@/components/providers/DeferredFonts";

export const metadata: Metadata = {
  title: "Canvabrains — Your Infinite Thinking Space",
  description: "An infinite canvas for creative thinking. Draw, write, and organize your thoughts in a beautiful spatial mind space. No sign up required.",
  keywords: ["infinite canvas", "thinking space", "creative tool", "drawing", "notes", "spatial thinking"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* ONLY the faces the interface itself is built from: Outfit (chrome and
            headings), Inter (body), JetBrains Mono (code), Instrument Serif
            (the landing wordmark). Four families is a small, fast request that
            is worth waiting on. The other 62 are decorative faces a user may
            pick for a text block — they load after paint, from DeferredFonts. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <DeferredFonts />
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}

