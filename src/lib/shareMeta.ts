/**
 * Server-side peek at a shared board, for the <title> and the social card.
 *
 * SERVER ONLY — imported exclusively from `generateMetadata` and the
 * `opengraph-image` route, both of which never run in the browser. (There is no
 * `import 'server-only'` guard here because that is a separate package this
 * project does not depend on, and adding a dependency to enforce a rule that
 * two call sites already follow is not a trade worth making.)
 *
 * Deliberately a RAW `fetch` against Supabase's REST endpoint rather than the
 * `supabase` client from lib/supabaseClient. That client is built for the
 * browser — it persists sessions, auto-refreshes tokens and watches for auth
 * callbacks in the URL — none of which means anything in a metadata request,
 * and all of which is state a build-time render should not be creating. One
 * anonymous POST is the whole requirement.
 */

export interface ShareMeta {
  title: string;
  objectCount: number;
  updatedAt?: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function getShareMeta(token: string): Promise<ShareMeta | null> {
  if (!SUPABASE_URL || !ANON_KEY || !token) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_shared_board_meta`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ share_token: token }),
      /* A preview is worth a few seconds of staleness and never worth a slow
         page, so the answer is cached. Five minutes is short enough that
         renaming a board updates its link preview within one coffee. */
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(6000),
    });

    /* 404 here means the metadata function has not been deployed to this
       project yet (supabase/schema_share_meta.sql). That is an EXPECTED state,
       not a bug: the caller falls back to a generic branded preview, so a
       missing migration costs a board title — never a broken page. */
    if (!res.ok) return null;

    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    return {
      title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Untitled board',
      objectCount: Number(data.objectCount) || 0,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
    };
  } catch {
    // Unreachable project, timeout, malformed body — a link preview is never
    // worth failing a page render over.
    return null;
  }
}
