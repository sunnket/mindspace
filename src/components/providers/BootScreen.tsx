/**
 * The first frame.
 *
 * Both routes mount through `dynamic(..., { ssr: false })`, so the server sends
 * a shell and nothing real exists until the client chunk has downloaded, parsed
 * and rendered. What filled that gap was `<div style={{ background: '#000' }}/>`
 * — and a solid-colour div is not *contentful*, so the browser recorded no
 * First Contentful Paint at all until the entire app was ready. Measured cold
 * on a throttled connection that was 2.0s on the landing page and 4.4s on the
 * canvas: four and a half seconds of a black rectangle.
 *
 * This is the same gap, with something in it. It is pure server-rendered
 * markup — no JavaScript, no client component, no state — so it paints on the
 * first frame after HTML arrives, which both gives the browser a real FCP and,
 * more to the point, tells a person the application is loading rather than
 * broken. The mark then fades under the real UI as it mounts over the top.
 *
 * Deliberately NOT a spinner: a spinner says "waiting", a wordmark says
 * "arriving", and on a warm cache this is on screen for a single frame.
 */
export default function BootScreen({ label = 'canvabrains' }: { label?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        // Below every real layer, so the app simply covers it when it mounts.
        zIndex: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: 0.82 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
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
        <span
          style={{
            fontFamily: "'Bebas Neue', 'Outfit', sans-serif",
            fontSize: 30,
            letterSpacing: '-0.01em',
            color: 'rgba(255, 253, 250, 0.72)',
            lineHeight: 1,
          }}
        >
          {label}
        </span>
      </div>

      {/* A hairline that fills while the chunk lands. Pure CSS, so it runs
          without waiting for React — and it is honest about being indeterminate
          rather than faking a percentage. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '38%',
          transform: 'translateX(-50%)',
          width: 132,
          height: 2,
          borderRadius: 2,
          overflow: 'hidden',
          background: 'rgba(255, 253, 250, 0.10)',
        }}
      >
        <div className="boot-sweep" style={{ height: '100%', width: '40%', background: '#C97B4B', borderRadius: 2 }} />
      </div>
    </div>
  );
}
