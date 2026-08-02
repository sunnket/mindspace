<div align="center">

<img src="public/icon-192.png" width="72" height="72" alt="canvabrains" />

# canvabrains

**An infinite canvas for thinking.**
Draw, write, read and connect ideas in a space that never runs out of room.

</div>

---

> **Note on naming.** The product is called **canvabrains**. The repository,
> package, IndexedDB stores and Supabase tables still say `mindspace` — that is
> deliberate, not leftover: renaming the storage keys would orphan every board
> already saved on every device. The rename is a UI-layer change only.

---

## What it is

A local-first spatial workspace. Every edit is written to IndexedDB before
anything else happens, so the board keeps working with no network at all; the
cloud is a self-healing mirror that converges in the background.

| | |
|---|---|
| **Infinite board** | Pan, zoom, frames, connectors, stacks, nested sub-spaces, semantic zoom |
| **Blocks** | Text, sticky notes, drawings, shapes, images, tables, charts, roadmaps, maps, code, mermaid, embeds, repo trees, PDFs, webcam mirrors, and more |
| **Writing** | Rich text with marks, callouts, @-mentions, KaTeX math, 60+ typefaces, kinetic text animation, typing-as-ink |
| **Reading** | Full-screen PDF reading rooms — reflowed typesetting, 40 layered scenes, 11 reading lights, flipbook page turns, read-aloud, tap-to-define |
| **AI** | Per-canvas agent that builds on the board, canvas-scoped skill sets, vision, braindump-to-structure |
| **Together** | Live collaboration with cursors, presence, follow/present mode, WebRTC voice, and view-only share links |
| **Focus** | Flow Mode, lock-in view, Constellation view, Stress Reliever effects |

## Running it

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:3005
```

The app boots and is fully usable with **no configuration at all** — boards live
in IndexedDB. The environment below only unlocks the networked features.

### Environment

Create `.env.local`:

```ini
# Cloud sync, accounts, collaboration, share links.
# Without these the app runs entirely on-device.
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>

# The AI agent + chat. Extra keys are optional: the model layer races a lead
# request against a second-key rescue to bound tail latency (lib/nim/hedge.ts).
NVIDIA_API_KEY=<key>
NVIDIA_API_KEY_2=<key>

# Canonical origin. Only needed so Open Graph cards resolve to absolute URLs
# outside Vercel — on Vercel this is derived automatically.
NEXT_PUBLIC_SITE_URL=https://your-domain.com

# Optional TURN relay, for collaborators behind strict NATs.
NEXT_PUBLIC_TURN_URL=
NEXT_PUBLIC_TURN_USER=
NEXT_PUBLIC_TURN_CRED=
```

### Database

Run the files in [`supabase/`](supabase/) against your project's SQL editor.
`schema.sql` first; the rest are independent feature migrations and each one is
safe to skip if you don't want that feature.

| File | Feature |
|---|---|
| `schema.sql` | Core — canvases, objects, strokes, connections |
| `schema_access_control.sql` | Invite-only access: allowlist, keys, `/admin` queue |
| `schema_chat.sql` · `schema_chat_profiles.sql` | Direct messages, peer names and avatars |
| `schema_agent_chat.sql` · `schema_agent_memory.sql` | Per-canvas AI chat and agent memory |
| `schema_shares.sql` | View-only share links (`/s/<token>`) |
| `schema_share_meta.sql` | Cheap title read for share-link previews — optional; without it a shared link still previews, just without the board's name |
| `schema_skillset.sql` | Per-canvas agent rules |
| `schema_stroke_brush.sql` | Brush metadata on strokes |

## Scripts

```bash
npm run dev      # dev server on :3005
npm run build    # production build (also typechecks)
npm run start    # serve the build
npm run lint     # eslint
```

## Architecture notes

Worth reading before changing anything in these areas — each is a decision that
looks arbitrary until you know what it was fixing. The reasoning lives in the
source, next to the code it governs.

| Where | What it explains |
|---|---|
| `src/components/canvas/InfiniteCanvas.tsx` | **The camera pipeline** — the board is panned by painting a transform onto a node directly, never through React state |
| `src/app/layout.tsx` | **The phone contract** — why page zoom, double-tap zoom and the safe-area insets are configured the way they are |
| `src/lib/syncService.ts` | **Cloud persistence discipline** — local is truth, the cloud self-heals, and the final state always lands |
| `src/app/globals.css` | The clay/glass material system, why menus are *not* glass, and the properties-rail geometry negotiation |
| `src/store/toastStore.ts` | Why notices are keyed and deduped rather than stacked |
| `src/components/canvas/BlockErrorBoundary.tsx` | Why one broken block can't take the board down |

> **Framework caveat.** This runs on a Next.js version whose APIs differ from
> widely-published examples — error boundaries use `unstable_retry` rather than
> `reset`, and component-level boundaries use `unstable_catchError` from
> `next/error`. See [`AGENTS.md`](AGENTS.md): read `node_modules/next/dist/docs/`
> before writing framework-level code.

## License

Private project. All rights reserved.
