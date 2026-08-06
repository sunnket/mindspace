'use client';

/**
 * The floor beneath error.tsx.
 *
 * This only renders when the ROOT LAYOUT itself fails — so it replaces that
 * layout entirely and must therefore ship its own <html> and <body>. That also
 * means it cannot rely on anything the layout provides: no globals.css custom
 * properties, no Google Fonts link, no providers. Every value below is
 * therefore a literal, and the font stack falls back to system faces.
 *
 * Nothing here should ever need to change; if it renders at all, something is
 * very wrong upstream. It exists so that "very wrong" still looks like this
 * product rather than a browser error page.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000',
            padding: 24,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          <div style={{ maxWidth: 380, textAlign: 'center' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                margin: '0 auto 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(201, 123, 75, 0.14)',
                color: '#C97B4B',
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              c
            </div>

            <h1 style={{ fontSize: 19, fontWeight: 600, color: 'rgba(255, 253, 250, 0.92)', margin: 0 }}>
              canvabrains couldn&apos;t start
            </h1>

            <p
              style={{
                fontSize: 13.5,
                lineHeight: 1.55,
                color: 'rgba(255, 253, 250, 0.6)',
                marginTop: 10,
              }}
            >
              Your boards are stored on this device and are not affected. Try
              loading the app again.
            </p>

            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                marginTop: 22,
                padding: '9px 18px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                color: '#1A1613',
                background: '#C97B4B',
                border: 'none',
              }}
            >
              Try again
            </button>

            {error.digest && (
              <p style={{ marginTop: 20, fontSize: 10, color: 'rgba(255, 253, 250, 0.26)' }}>
                ref {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
