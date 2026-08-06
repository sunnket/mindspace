import type { Metadata } from 'next';
import { getShareMeta } from '@/lib/shareMeta';

/**
 * Why a layout exists for a route with one page in it.
 *
 * page.tsx here is `'use client'` — it has to be, since it loads the snapshot
 * in an effect and hands it to the canvas viewer. A Client Component cannot
 * export `generateMetadata`, so without this file a shared board inherited the
 * root layout's title and every link in the world read "canvabrains — Your
 * Infinite Thinking Space", regardless of which board it pointed at.
 *
 * A layout is a Server Component by default and wraps the page without altering
 * it, which makes it the natural (and non-invasive) place to answer "what is
 * this particular link?" — the browser tab, the bookmark, and the card that
 * appears when the link is pasted somewhere all read from here.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const meta = await getShareMeta(token);

  // No meta means the link is dead, or the metadata function isn't deployed on
  // this project yet. Both get the honest generic title rather than a guess.
  if (!meta) {
    return {
      title: 'Shared board — canvabrains',
      description: 'A board shared from canvabrains.',
    };
  }

  const description =
    meta.objectCount > 0
      ? `A read-only board with ${meta.objectCount} ${meta.objectCount === 1 ? 'item' : 'items'}, shared from canvabrains.`
      : 'A read-only board shared from canvabrains.';

  return {
    title: `${meta.title} — canvabrains`,
    description,
    openGraph: { title: meta.title, description, type: 'article' },
    twitter: { card: 'summary_large_image', title: meta.title, description },
    /* A share link is a private URL handed to specific people. It should not
       accumulate in search results — and `nocache` additionally asks engines
       not to keep a cached copy of a board the owner may later revoke. */
    robots: { index: false, follow: false, nocache: true },
  };
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
