import React from 'react';
import Link from 'next/link';

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] overflow-y-auto">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-5 bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-[var(--border)]">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-light)] flex items-center justify-center text-white text-sm font-semibold shadow-md">
              C
            </div>
            <Link href="/" className="text-base font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
              Canvabrains
            </Link>
          </div>
          <Link href="/docs" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            Docs
          </Link>
        </div>
        <Link href="/canvas">
          <button className="px-5 py-2 rounded-xl bg-[var(--text-primary)] text-[var(--bg-primary)] text-sm font-medium shadow-md hover:shadow-lg transition-shadow">
            Open Canvas
          </button>
        </Link>
      </nav>

      <main className="pt-32 pb-24 px-6 max-w-4xl mx-auto">
        <h1 className="text-5xl font-medium mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>
          Documentation
        </h1>
        <p className="text-lg text-[var(--text-secondary)] font-light mb-16 leading-relaxed">
          Welcome to the Canvabrains documentation. Learn how to navigate your infinite thinking space, use keyboard shortcuts, and organize your creative worlds.
        </p>

        <section className="mb-16">
          <h2 className="text-3xl font-medium mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="mb-4 text-[var(--accent)]"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg></div>
              <h3 className="text-lg font-medium mb-2">Draw Anywhere</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Hold D and start drawing. Natural, pressure-sensitive strokes with beautiful ink rendering.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="mb-4 text-[var(--accent)]"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4zm0 0c2 2.67 4 4 6 4a4 4 0 1 0 0-8c-2 0-4 1.33-6 4z" /></svg></div>
              <h3 className="text-lg font-medium mb-2">Infinite Canvas</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Zoom infinitely. Pan endlessly. Your thoughts have no boundaries in this spatial workspace.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="mb-4 text-[var(--accent)]"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z" /><path d="M15 3v6h6" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg></div>
              <h3 className="text-lg font-medium mb-2">Type Anywhere</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Click any empty space and start writing. Headings, paragraphs, lists — all lightweight and fluid.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="mb-4 text-[var(--accent)]"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg></div>
              <h3 className="text-lg font-medium mb-2">Spatial Search</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Search and fly to your thoughts. The camera animates cinematically to the result.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="mb-4 text-[var(--accent)]"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M17 12a5 5 0 1 1-5-5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg></div>
              <h3 className="text-lg font-medium mb-2">Nested Spaces</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Double-click any heading to zoom into a sub-space. Create infinite nested creative worlds.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="mb-4 text-[var(--accent)]"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg></div>
              <h3 className="text-lg font-medium mb-2">Offline First</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Everything saves automatically to your device. No accounts. No servers. Just your thoughts.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-3xl font-medium mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>Built for Speed</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { keys: 'Space', label: 'Pan' },
              { keys: 'D', label: 'Draw' },
              { keys: 'T', label: 'Text' },
              { keys: '⌘ F', label: 'Search' },
              { keys: '⌘ K', label: 'Commands' },
              { keys: '⌘ Z', label: 'Undo' },
              { keys: 'Del', label: 'Delete' },
              { keys: 'Esc', label: 'Exit' },
              { keys: 'Scroll', label: 'Zoom' },
            ].map((shortcut) => (
              <div key={shortcut.keys} className="flex items-center gap-3 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
                <kbd className="inline-block px-2.5 py-1 rounded-lg text-xs font-mono bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border)] shadow-sm">{shortcut.keys}</kbd>
                <span className="text-sm text-[var(--text-secondary)] font-light">{shortcut.label}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
