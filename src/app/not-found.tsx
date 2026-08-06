import Link from 'next/link';

/**
 * 404.
 *
 * A Server Component on purpose — there is nothing interactive here, so it
 * renders instantly with the HTML rather than waiting on a client chunk, which
 * is the whole point on a page whose only job is to redirect a lost person.
 *
 * Painted on the app's black paper rather than the light `--bg-primary`: this
 * route mounts none of the providers that set the canvas theme, so a
 * theme-variable background would render in whichever mode happened to be
 * default and flash against the boot colour.
 */
export default function NotFound() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
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
            fontFamily: "'Bebas Neue', 'Outfit', sans-serif",
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          c
        </div>

        <h1
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'rgba(255, 253, 250, 0.92)',
          }}
        >
          Nothing here
        </h1>

        {/* A joke that is also true: on an infinite canvas, empty space is the
            normal condition, so the 404 is the one page that can be honest and
            on-brand at the same time. */}
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'rgba(255, 253, 250, 0.55)', marginTop: 10 }}>
          This corner of the canvas is empty. Your boards are where you left them.
        </p>

        <Link
          href="/"
          style={{
            display: 'inline-block',
            marginTop: 22,
            padding: '9px 18px',
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            color: '#1A1613',
            background: '#C97B4B',
          }}
        >
          Back to your boards
        </Link>
      </div>
    </div>
  );
}
