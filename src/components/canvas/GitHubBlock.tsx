'use client';

import React, { useState, useEffect } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { getPluginCred } from '@/lib/plugins';

/**
 * A GitHub card driven entirely by GitHub's PUBLIC REST API — no OAuth, no
 * token, no server. api.github.com is CORS-open, so a repo / issue / PR / gist /
 * user URL resolves to a rich card straight from the browser. (Unauthenticated
 * calls are rate-limited to 60/hr per IP, handled gracefully below.)
 */

type GhKind = 'repo' | 'issue' | 'user' | 'gist';

interface Parsed { kind: GhKind; api: string; ref: string; }

function parseGitHubUrl(raw: string): Parsed | null {
  let s = (raw || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'gist.github.com') {
    const id = parts[parts.length - 1];
    if (id) return { kind: 'gist', api: `https://api.github.com/gists/${id}`, ref: id };
    return null;
  }
  if (host !== 'github.com') return null;
  if (parts.length === 0) return null;

  const [owner, repo, section, number] = parts;
  if ((section === 'issues' || section === 'pull') && number) {
    // The issues endpoint serves both issues and PRs and returns a pull_request marker.
    return { kind: 'issue', api: `https://api.github.com/repos/${owner}/${repo}/issues/${number}`, ref: `${owner}/${repo}#${number}` };
  }
  if (repo) {
    return { kind: 'repo', api: `https://api.github.com/repos/${owner}/${repo}`, ref: `${owner}/${repo}` };
  }
  return { kind: 'user', api: `https://api.github.com/users/${owner}`, ref: owner };
}

const inFlight = new Set<string>();

async function hydrate(id: string, url: string, updateObject: (id: string, u: Partial<CanvasObjectData>) => void) {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  const current = () => useCanvasStore.getState().objects.find((o) => o.id === id);
  const parsed = parseGitHubUrl(url);

  const fail = (reason: string) => {
    const cur = current();
    if (cur) updateObject(id, { style: { ...cur.style, ghLoading: false, ghError: true, ghErrorReason: reason, ghResolved: true } });
  };

  if (!parsed) { fail("That isn't a GitHub URL"); inFlight.delete(id); return; }

  try {
    // A user-supplied token (Plugins → GitHub) lifts the 60/hr anonymous limit
    // to 5,000/hr and unlocks private repos. Everything works without one too.
    const token = getPluginCred('github');
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(parsed.api, { headers });
    if (res.status === 401) { fail('GitHub rejected the token — check it in Plugins'); return; }
    if (res.status === 403) { fail('GitHub rate limit reached — add a token in Plugins to raise it'); return; }
    if (res.status === 404) { fail('Not found (is it a public repo?)'); return; }
    if (!res.ok) { fail(`GitHub error (${res.status})`); return; }
    const d = await res.json();
    const cur = current();
    if (!cur) return;

    const data: Record<string, unknown> = { ghKind: parsed.kind, ghRef: parsed.ref };
    if (parsed.kind === 'repo') {
      data.ghTitle = d.full_name;
      data.ghDesc = d.description || '';
      data.ghStars = d.stargazers_count ?? 0;
      data.ghForks = d.forks_count ?? 0;
      data.ghLang = d.language || '';
      data.ghAvatar = d.owner?.avatar_url || '';
      data.ghTopics = Array.isArray(d.topics) ? d.topics.slice(0, 4) : [];
    } else if (parsed.kind === 'issue') {
      const isPr = Boolean(d.pull_request);
      data.ghTitle = d.title;
      data.ghState = d.pull_request?.merged_at ? 'merged' : d.state; // open | closed | merged
      data.ghIsPr = isPr;
      data.ghNumber = d.number;
      data.ghUser = d.user?.login || '';
      data.ghAvatar = d.user?.avatar_url || '';
      data.ghDesc = (d.body || '').slice(0, 240);
      data.ghComments = d.comments ?? 0;
      data.ghLabels = Array.isArray(d.labels) ? d.labels.map((l: { name?: string }) => l.name).filter(Boolean).slice(0, 4) : [];
    } else if (parsed.kind === 'gist') {
      const files = d.files ? Object.keys(d.files) : [];
      data.ghTitle = d.description || files[0] || 'Gist';
      data.ghUser = d.owner?.login || '';
      data.ghAvatar = d.owner?.avatar_url || '';
      data.ghFiles = files.slice(0, 6);
    } else {
      data.ghTitle = d.name || d.login;
      data.ghUser = d.login;
      data.ghDesc = d.bio || '';
      data.ghAvatar = d.avatar_url || '';
      data.ghRepos = d.public_repos ?? 0;
      data.ghFollowers = d.followers ?? 0;
    }

    updateObject(id, { style: { ...cur.style, ghLoading: false, ghError: false, ghResolved: true, ...data } });
  } catch {
    fail('Network error');
  } finally {
    inFlight.delete(id);
  }
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    open: '#22C55E', closed: '#EF4444', merged: '#8B5CF6',
  };
  const color = map[state] || 'var(--text-tertiary)';
  return (
    <span className="text-[9px] font-bold uppercase tracking-wide rounded-full text-white select-none" style={{ background: color, padding: '2px 8px' }}>
      {state}
    </span>
  );
}

export default function GitHubBlock({ obj }: { obj: CanvasObjectData }) {
  const { style } = obj;
  const updateObject = useCanvasStore((s) => s.updateObject);
  const url = (obj.content || '').trim();
  const [draft, setDraft] = useState('');

  const resolved = (style?.ghResolved as boolean) ?? false;
  const loading = (style?.ghLoading as boolean) ?? false;
  const error = (style?.ghError as boolean) ?? false;

  useEffect(() => {
    if (!url || resolved || error) return;
    void hydrate(obj.id, url, updateObject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.id, url, resolved, error]);

  const submit = (v: string) => {
    const val = (v || '').trim();
    if (!val) return;
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    updateObject(obj.id, { content: val, style: { ...cur?.style, isGithub: true, ghLoading: true, ghError: false, ghResolved: false } });
  };
  const reset = () => {
    const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
    // Drop every gh* field so a new URL starts clean.
    const kept: Record<string, unknown> = {};
    Object.entries(cur?.style || {}).forEach(([k, v]) => { if (!k.startsWith('gh')) kept[k] = v; });
    updateObject(obj.id, { content: '', style: { ...kept, isGithub: true } });
  };

  const surface = 'w-full h-full rounded-2xl bg-[var(--bg-card)] border border-[var(--border-strong)] shadow-[var(--shadow-md)]';
  const octicon = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );

  /* --- Awaiting a URL --- */
  if (!url) {
    return (
      <div className={`${surface} flex flex-col justify-center gap-3 pointer-events-auto`} style={{ padding: 16, fontFamily: "'Outfit', sans-serif" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          {octicon}
          <span className="text-[11px] font-bold tracking-wider uppercase">GitHub</span>
        </div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(draft); } }}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); setDraft(t); submit(t); } }}
          placeholder="Repo, issue, PR, gist or user URL"
          className="w-full rounded-xl bg-white/70 dark:bg-white/5 border border-[var(--border)] outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-light)] transition-colors"
          style={{ padding: '8px 12px' }}
        />
        <button onClick={() => submit(draft)} disabled={!draft.trim()} className="self-start rounded-full bg-[var(--accent)] text-white text-[10px] font-bold tracking-wider uppercase hover:opacity-90 active:scale-95 transition-all shadow-md disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer" style={{ padding: '6px 14px' }}>
          Fetch
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${surface} flex flex-col justify-center items-center gap-2 select-none`} style={{ padding: 16 }}>
        <span className="text-[var(--text-tertiary)] animate-pulse">{octicon}</span>
        <span className="text-[10px] text-[var(--text-tertiary)] tracking-wide">Loading from GitHub…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`w-full h-full rounded-2xl bg-[var(--bg-card)] border border-red-500/40 shadow-[var(--shadow-md)] flex flex-col justify-center gap-2`} style={{ padding: 16 }}>
        <span className="text-[10px] text-red-500/90">{(style?.ghErrorReason as string) || 'Failed to load'}</span>
        <div className="flex gap-2">
          <a href={url} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()} className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] cursor-pointer">Open ↗</a>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={reset} className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--accent)] cursor-pointer">Change</button>
        </div>
      </div>
    );
  }

  const kind = style?.ghKind as GhKind;
  const title = (style?.ghTitle as string) || '';
  const desc = (style?.ghDesc as string) || '';
  const avatar = (style?.ghAvatar as string) || '';
  const user = (style?.ghUser as string) || '';

  return (
    <div className={`${surface} flex flex-col overflow-hidden pointer-events-auto`} style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="flex items-center justify-between gap-2 select-none shrink-0 border-b border-[var(--border)]" style={{ padding: '7px 12px' }}>
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)] min-w-0">
          {octicon}
          <span className="text-[10px] font-bold uppercase tracking-wider truncate">{kind === 'issue' ? (style?.ghIsPr ? 'Pull request' : 'Issue') : kind}</span>
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <a href={url} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()} className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer">Open ↗</a>
          <button onMouseDown={(e) => e.stopPropagation()} onClick={reset} className="text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--accent)] cursor-pointer">Change</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 12 }}>
        <div className="flex items-start gap-3">
          {avatar && <img src={avatar} alt="" className="w-9 h-9 rounded-lg shrink-0" draggable={false} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {kind === 'issue' && <StateBadge state={(style?.ghState as string) || 'open'} />}
              <h3 className="text-[13px] font-bold text-[var(--text-primary)] leading-snug min-w-0">
                {kind === 'issue' ? `#${style?.ghNumber} ` : ''}{title}
              </h3>
            </div>
            {desc && <p className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed line-clamp-4">{desc}</p>}
            {user && <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">@{user}</p>}
          </div>
        </div>

        {/* Repo stats */}
        {kind === 'repo' && (
          <div className="flex items-center gap-3 flex-wrap mt-3 text-[10px] text-[var(--text-secondary)]">
            {Boolean(style?.ghLang) && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--accent)]" />{style?.ghLang as string}</span>}
            <span>★ {style?.ghStars as number}</span>
            <span>⑂ {style?.ghForks as number}</span>
            {Array.isArray(style?.ghTopics) && (style?.ghTopics as string[]).map((t) => (
              <span key={t} className="rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold" style={{ padding: '1px 7px' }}>{t}</span>
            ))}
          </div>
        )}

        {/* Issue/PR labels + comments */}
        {kind === 'issue' && (
          <div className="flex items-center gap-2 flex-wrap mt-3 text-[10px] text-[var(--text-secondary)]">
            {Array.isArray(style?.ghLabels) && (style?.ghLabels as string[]).map((l) => (
              <span key={l} className="rounded-full bg-[var(--bg-tertiary)] font-semibold" style={{ padding: '1px 7px' }}>{l}</span>
            ))}
            <span>💬 {style?.ghComments as number}</span>
          </div>
        )}

        {/* Gist files */}
        {kind === 'gist' && Array.isArray(style?.ghFiles) && (
          <div className="mt-3 flex flex-col gap-1">
            {(style?.ghFiles as string[]).map((f) => (
              <span key={f} className="text-[10px] font-mono text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded truncate" style={{ padding: '2px 7px' }}>{f}</span>
            ))}
          </div>
        )}

        {/* User stats */}
        {kind === 'user' && (
          <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--text-secondary)]">
            <span>{style?.ghRepos as number} repos</span>
            <span>{style?.ghFollowers as number} followers</span>
          </div>
        )}
      </div>
    </div>
  );
}
