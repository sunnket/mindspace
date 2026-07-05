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
              M
            </div>
            <Link href="/" className="text-base font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
              Mindspace
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
          Welcome to the Mindspace documentation. Learn how to navigate your infinite thinking space, use keyboard shortcuts, and organize your creative worlds.
        </p>

        <section className="mb-16">
          <h2 className="text-3xl font-medium mb-8" style={{ fontFamily: "'Instrument Serif', serif" }}>Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="text-2xl mb-4">✎</div>
              <h3 className="text-lg font-medium mb-2">Draw Anywhere</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Hold D and start drawing. Natural, pressure-sensitive strokes with beautiful ink rendering.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="text-2xl mb-4">∞</div>
              <h3 className="text-lg font-medium mb-2">Infinite Canvas</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Zoom infinitely. Pan endlessly. Your thoughts have no boundaries in this spatial workspace.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="text-2xl mb-4">📝</div>
              <h3 className="text-lg font-medium mb-2">Type Anywhere</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Click any empty space and start writing. Headings, paragraphs, lists — all lightweight and fluid.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="text-2xl mb-4">🔍</div>
              <h3 className="text-lg font-medium mb-2">Spatial Search</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Search and fly to your thoughts. The camera animates cinematically to the result.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="text-2xl mb-4">🌀</div>
              <h3 className="text-lg font-medium mb-2">Nested Spaces</h3>
              <p className="text-sm text-[var(--text-secondary)] font-light">Double-click any heading to zoom into a sub-space. Create infinite nested creative worlds.</p>
            </div>
            <div className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
              <div className="text-2xl mb-4">💾</div>
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
