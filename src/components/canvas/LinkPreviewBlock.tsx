'use client';

import React, { useState, useRef } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';
import { motion } from 'framer-motion';

export default function LinkPreviewBlock({ obj }: { obj: CanvasObjectData }) {
  const { style } = obj;
  const isLinkLoading = style?.linkLoading ?? false;
  const isLinkError = style?.linkError ?? false;
  const title = (style?.linkTitle as string) || obj.content || 'Link Preview';
  const description = (style?.linkDescription as string) || '';
  const image = (style?.linkImage as string) || '';
  const favicon = (style?.linkFavicon as string) || '';
  const domain = (style?.linkDomain as string) || '';
  const platform = (style?.linkPlatform as string) || '';
  const embedUrl = (style?.linkEmbedUrl as string) || '';
  const url = (style?.linkUrl as string) || obj.content || '';

  const [isPlaying, setIsPlaying] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  // Magnetic 3D Tilt Effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    
    // Smooth angle computation
    const tiltX = (y / (rect.height / 2)) * -6; // max 6 deg
    const tiltY = (x / (rect.width / 2)) * 6;  // max 6 deg
    
    setTilt({ x: tiltX, y: tiltY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  // Shimmer Loader Component
  if (isLinkLoading) {
    return (
      <div 
        className="w-full h-full p-4 rounded-2xl bg-white/20 dark:bg-black/10 backdrop-blur-xl border border-white/20 flex flex-col justify-between select-none"
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        {/* Shimmer Header */}
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-white/30 dark:bg-white/10 animate-pulse shrink-0" />
          <div className="h-3 w-24 bg-white/30 dark:bg-white/10 rounded animate-pulse" />
        </div>

        {/* Shimmer Body */}
        <div className="flex gap-4 items-center my-3">
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-4 w-full bg-white/30 dark:bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-white/30 dark:bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-4/6 bg-white/30 dark:bg-white/10 rounded animate-pulse" />
          </div>
          <div className="w-20 h-20 rounded-xl bg-white/30 dark:bg-white/10 animate-pulse shrink-0" />
        </div>

        {/* Shimmer Footer */}
        <div className="h-8 w-28 bg-white/30 dark:bg-white/10 rounded-full animate-pulse self-start" />
      </div>
    );
  }

  // Fallback Error Component
  if (isLinkError) {
    return (
      <div 
        className="w-full h-full p-4 rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-red-500/20 flex flex-col justify-between"
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-red-500/80 flex items-center">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <span className="text-xs font-mono opacity-60 truncate">{domain || 'invalid link'}</span>
        </div>
        <div className="my-2">
          <h4 className="text-xs font-semibold truncate text-[var(--text-primary)]">{title}</h4>
          <p className="text-[10px] text-red-500/80 mt-1">Failed to resolve web page metadata</p>
        </div>
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="self-start px-3.5 py-1.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold tracking-wider uppercase hover:opacity-90 active:scale-95 transition-all shadow-md pointer-events-auto"
        >
          Open URL
        </a>
      </div>
    );
  }

  // Render Rich Embed Players
  if (embedUrl && isPlaying) {
    return (
      <div 
        className="w-full h-full p-1.5 rounded-2xl bg-white/20 dark:bg-black/20 backdrop-blur-2xl border border-white/25 flex flex-col pointer-events-auto"
        style={{ fontFamily: "'Outfit', sans-serif" }}
      >
        {/* Compact Close Player Header */}
        <div className="flex items-center justify-between px-2 py-1 mb-1 select-none">
          <div className="flex items-center gap-1.5">
            {favicon && <img src={favicon} alt="Favicon" className="w-3.5 h-3.5 object-contain shrink-0" />}
            <span className="text-[10px] font-medium text-[var(--text-secondary)]">{domain}</span>
          </div>
          <button 
            onClick={() => setIsPlaying(false)}
            className="text-[10px] font-bold text-red-500 hover:text-red-600 bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
          >
            Close Embed
          </button>
        </div>

        {/* Embedded Iframe Player */}
        <div className="flex-1 w-full rounded-xl overflow-hidden bg-black/5 shadow-inner relative">
          <iframe 
            src={embedUrl}
            className="w-full h-full border-none"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: 'transform 0.15s cubic-bezier(0.25, 1, 0.5, 1)',
        transformStyle: 'preserve-3d',
      }}
      className="w-full h-full p-4 rounded-2xl bg-[rgba(255,252,248,0.35)] dark:bg-black/15 backdrop-blur-2xl border border-white/20 dark:border-white/5 flex flex-col justify-between hover:shadow-[0_20px_50px_rgba(201,123,75,0.15)] transition-shadow select-none group relative overflow-hidden"
    >
      {/* Background Soft Glow Pattern */}
      <div className="absolute -inset-10 bg-[radial-gradient(circle_at_top_right,rgba(201,123,75,0.06),transparent_60%)] pointer-events-none" />

      {/* Header Info */}
      <div className="flex items-center justify-between select-none">
        <div className="flex items-center gap-2 overflow-hidden">
          {favicon ? (
            <img src={favicon} alt="Favicon" className="w-4 h-4 object-contain shrink-0 rounded-sm" />
          ) : (
            <span className="text-[var(--text-tertiary)] flex items-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
          )}
          <span 
            className="text-[10px] font-semibold text-[var(--text-secondary)] tracking-wider uppercase truncate"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            {domain}
          </span>
        </div>

        {/* Premium Platform Badge (e.g. YouTube, Spotify) */}
        {platform && (
          <span className="text-[9px] font-bold font-mono tracking-widest text-[var(--accent)] bg-[var(--accent-subtle)] px-2 py-0.5 rounded-full select-none shrink-0 capitalize">
            {platform}
          </span>
        )}
      </div>

      {/* Main Content Row */}
      <div className="flex gap-4 my-2.5 items-start flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <h3 
            className="text-xs font-bold text-[var(--text-primary)] leading-snug line-clamp-2 select-text group-hover:text-[var(--accent)] transition-colors"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            {title}
          </h3>
          {description && (
            <p 
              className="text-[10px] text-[var(--text-secondary)] leading-relaxed mt-1 line-clamp-3 select-text"
              style={{ fontFamily: "'Outfit', sans-serif" }}
            >
              {description}
            </p>
          )}
        </div>

        {/* High-Resolution Thumbnail Image */}
        {image && !isPlaying && (
          <div className="w-[84px] h-[84px] rounded-xl overflow-hidden bg-black/5 border border-white/20 dark:border-white/5 shrink-0 relative self-center group-hover:scale-103 transition-transform">
            <img 
              src={image} 
              alt="Thumbnail" 
              className="w-full h-full object-cover" 
              draggable={false}
            />
          </div>
        )}
      </div>

      {/* Footer Navigation CTAs */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* Open Direct Link */}
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="px-3.5 py-1.5 rounded-full bg-white/60 dark:bg-white/5 border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent-light)] hover:bg-white/90 text-[10px] font-bold tracking-wider uppercase transition-all shadow-sm active:scale-95 flex items-center gap-1 cursor-pointer"
          style={{ fontFamily: "'Outfit', sans-serif" }}
        >
          Visit
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>

        {/* Play Embed Player Option (YouTube, Spotify, Figma etc.) */}
        {embedUrl && (
          <button 
            onClick={() => setIsPlaying(true)}
            className="px-3.5 py-1.5 rounded-full bg-[var(--accent)] text-white hover:bg-[var(--accent-light)] text-[10px] font-bold tracking-wider uppercase transition-all shadow-md active:scale-95 flex items-center gap-1 cursor-pointer"
            style={{ fontFamily: "'Outfit', sans-serif" }}
          >
            Play Embed
            <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        )}
      </div>
    </motion.div>
  );
}
