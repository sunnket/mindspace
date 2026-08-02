import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "@/components/providers/AuthProvider";
import DeferredFonts from "@/components/providers/DeferredFonts";

export const metadata: Metadata = {
  title: "Canvabrains — Your Infinite Thinking Space",
  description: "An infinite canvas for creative thinking. Draw, write, and organize your thoughts in a beautiful spatial mind space. No sign up required.",
  keywords: ["infinite canvas", "thinking space", "creative tool", "drawing", "notes", "spatial thinking"],
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Canvabrains" },
};

/**
 * THE PHONE CONTRACT.
 *
 * Next's default viewport is `width=device-width, initial-scale=1` and nothing
 * else, which is wrong for this app in two specific ways:
 *
 *  · `maximumScale: 1` / `userScalable: false`. The board has its own pinch
 *    zoom. Without this the browser's page zoom fires on the SAME gesture, so a
 *    pinch scaled the canvas and the whole UI at once and left the page zoomed
 *    with no way back — plus iOS Safari's double-tap-to-zoom stole every
 *    double-tap the canvas wanted. This is an infinite canvas, not a document:
 *    magnification is a first-class control inside the app, so nothing is lost.
 *  · `viewportFit: 'cover'`. Lets the board paint under the notch and the home
 *    indicator, and turns on the `env(safe-area-inset-*)` values that every
 *    piece of chrome below is inset by.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
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

