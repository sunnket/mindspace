import { ImageResponse } from 'next/og';
import { OgShell, OgHeader, OG_SIZE, OG_COLORS } from './og-shell';

/**
 * The card people actually see first.
 *
 * Until this existed, canvabrains pasted into Slack, iMessage, WhatsApp,
 * Discord or a tweet rendered as a bare grey rectangle with a URL under it —
 * which reads, fairly, as an unfinished side project. For a tool whose whole
 * distribution model is someone sending a link to someone else, the preview IS
 * the landing page for most of the people who ever encounter it.
 *
 * Generated at build time and cached, so it costs a request to nobody.
 */

export const alt = 'canvabrains — an infinite canvas for thinking';
export const size = OG_SIZE;
export const contentType = 'image/png';

const FEATURES = ['Infinite canvas', 'AI agent', 'Live collaboration', 'PDF reading rooms'];

export default function Image() {
  return new ImageResponse(
    (
      <OgShell>
        <OgHeader />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <span
            style={{
              fontSize: 68,
              fontWeight: 700,
              color: OG_COLORS.INK,
              letterSpacing: '-0.035em',
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            Your infinite thinking space
          </span>
          <span
            style={{
              fontSize: 27,
              color: 'rgba(255,253,250,0.55)',
              letterSpacing: '-0.01em',
              maxWidth: 780,
              lineHeight: 1.4,
            }}
          >
            Draw, write and connect your thoughts on a canvas that never runs out of room.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {FEATURES.map((f) => (
            <div
              key={f}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '11px 22px',
                borderRadius: 999,
                fontSize: 21,
                color: 'rgba(255,253,250,0.72)',
                background: 'rgba(255,253,250,0.06)',
                border: '1px solid rgba(255,253,250,0.11)',
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </OgShell>
    ),
    size,
  );
}
