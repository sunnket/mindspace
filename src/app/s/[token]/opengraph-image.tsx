import { ImageResponse } from 'next/og';
import { OgShell, OgHeader, OG_SIZE, OG_COLORS } from '../../og-shell';
import { getShareMeta } from '@/lib/shareMeta';

/**
 * The card for one specific shared board.
 *
 * This is the highest-leverage image in the product. A share link is almost
 * never opened from a browser address bar — it is pasted into a chat, and what
 * the recipient sees before deciding whether to click is this. Naming the
 * actual board turns "some link" into "the Q3 planning board", which is the
 * difference between a link that gets opened and one that gets scrolled past.
 *
 * Falls back to the generic card when the board can't be read (revoked link,
 * or schema_share_meta.sql not yet deployed) — the card is always branded, it
 * just isn't always personal.
 */

export const alt = 'A board shared from canvabrains';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const meta = await getShareMeta(token);

  const title = meta?.title ?? 'A shared board';
  const count = meta?.objectCount ?? 0;

  return new ImageResponse(
    (
      <OgShell>
        <OgHeader caption="shared a board with you" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <span
            style={{
              // A board title is user-supplied and could be one word or forty.
              // Shrinking the type past a certain length keeps a long title on
              // three lines instead of letting it overflow the card entirely.
              fontSize: title.length > 46 ? 52 : 70,
              fontWeight: 700,
              color: OG_COLORS.INK,
              letterSpacing: '-0.035em',
              lineHeight: 1.08,
              maxWidth: 1000,
              // Satori honours line clamping, which is the only guard against a
              // pathological title pushing the footer off the bottom edge.
              display: 'block',
              lineClamp: 3,
            }}
          >
            {title}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '11px 22px',
              borderRadius: 999,
              fontSize: 21,
              color: OG_COLORS.ACCENT,
              background: 'rgba(201,123,75,0.13)',
              border: '1px solid rgba(201,123,75,0.28)',
            }}
          >
            Read-only
          </div>
          {count > 0 && (
            <div
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
              {count} {count === 1 ? 'item' : 'items'}
            </div>
          )}
        </div>
      </OgShell>
    ),
    size,
  );
}
