// AUTO-GENERATED from CanvasObject.tsx shape renderer — geometry is identical
// to what appears on the canvas. Regenerate with scripts in scratchpad if the
// renderer's shapes change. Div-based shapes (circle/square) are hand-coded.
'use client';

import React from 'react';

type GeoFn = (fill: string, stroke: string) => React.ReactElement;

const GEOMETRY: Record<string, GeoFn> = {
  // Hand-coded equivalents of the renderer's div-based shapes
  'circle': (fill, stroke) => (<g><circle cx="50" cy="50" r="46" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'square': (fill, stroke) => (<g><rect x="6" y="6" width="88" height="88" rx="14" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'triangle': (fill, stroke) => (<g><polygon 
                      points="50,2 98,96 2,96" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'diamond': (fill, stroke) => (<g><polygon 
                      points="50,2 98,50 50,98 2,50" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'pentagon': (fill, stroke) => (<g><polygon 
                      points="50,4 96,37 78,92 22,92 4,37" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'hexagon': (fill, stroke) => (<g><polygon 
                      points="50,2 94,27 94,73 50,98 6,73 6,27" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'star': (fill, stroke) => (<g><polygon 
                      points="50,2 63,35 98,35 70,57 81,91 50,70 19,91 30,57 2,35 37,35" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'heart': (fill, stroke) => (<g><path 
                      d="M50,25 C35,5 5,5 5,42 C5,68 45,90 50,95 C55,90 95,68 95,42 C95,5 65,5 50,25 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'cloud': (fill, stroke) => (<g><path 
                      d="M25,50 C25,35 40,25 55,25 C70,25 85,35 85,50 C92,50 98,56 98,63 C98,71 92,77 85,77 L25,77 C15,77 8,70 8,60 C8,51 16,45 25,50 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'database': (fill, stroke) => (<g><path 
                      d="M10,25 C10,15 28,10 50,10 C72,10 90,15 90,25 L90,75 C90,85 72,90 50,90 C28,90 10,85 10,75 Z M10,25 C10,35 28,40 50,40 C72,40 90,35 90,25" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'document': (fill, stroke) => (<g><path 
                      d="M15,10 L65,10 L85,30 L85,90 L15,90 Z M65,10 L65,30 L85,30" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'speech': (fill, stroke) => (<g><path 
                      d="M10,15 C10,7 20,7 30,7 L80,7 C90,7 90,15 90,25 L90,65 C90,75 80,75 70,75 L45,75 L20,93 L25,75 C10,75 10,65 10,55 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'message': (fill, stroke) => (<g><path 
                      d="M10,20 L90,20 L90,80 L10,80 Z M10,20 L50,55 L90,20" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'cross': (fill, stroke) => (<g><polygon 
                      points="35,10 65,10 65,35 90,35 90,65 65,65 65,90 35,90 35,65 10,65 10,35 35,35" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'lightning': (fill, stroke) => (<g><polygon 
                      points="60,2 15,55 48,55 35,98 85,42 50,42" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'shield': (fill, stroke) => (<g><path 
                      d="M15,10 L50,5 L85,10 C85,45 75,75 50,95 C25,75 15,45 15,10 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'arrow-left': (fill, stroke) => (<g><polygon 
                      points="45,10 10,50 45,90 45,65 90,65 90,35 45,35" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'arrow-right': (fill, stroke) => (<g><polygon 
                      points="55,10 90,50 55,90 55,65 10,65 10,35 55,35" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'tag': (fill, stroke) => (<g><path 
                      d="M10,25 L65,25 L90,50 L65,75 L10,75 Z M25,50 A5,5 0 1,1 25,49.9 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'banner': (fill, stroke) => (<g><polygon 
                      points="10,20 90,20 75,50 90,80 10,80 25,50" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'octagon': (fill, stroke) => (<g><polygon 
                      points="29,5 71,5 95,29 95,71 71,95 29,95 5,71 5,29" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                    /></g>),
  'folder': (fill, stroke) => (<g><path 
                      d="M10,15 L35,15 L45,28 L90,28 L90,85 L10,85 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'sun': (fill, stroke) => (<g><circle cx="50" cy="50" r="22" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path 
                      d="M50,8 L50,18 M50,82 L50,92 M8,50 L18,50 M82,50 L92,50 M20,20 L27,27 M73,73 L80,80 M20,80 L27,73 M73,27 L80,20" 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinecap="round" 
                    /></g>),
  'moon': (fill, stroke) => (<g><path 
                      d="M75,15 C45,15 25,35 25,60 C25,75 35,90 55,95 C30,90 15,70 15,50 C15,25 35,10 65,10 C70,10 73,12 75,15 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4"
                      strokeLinejoin="round"
                    /></g>),
  'lightbulb': (fill, stroke) => (<g><path 
                      d="M50,10 C28,10 25,35 32,50 C37,60 40,65 40,75 L60,75 C60,65 63,60 68,50 C75,35 72,10 50,10 Z M38,82 L62,82 M42,90 L58,90" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinejoin="round" 
                    /></g>),
  'sticky': (fill, stroke) => (<g><path 
                      d="M10,10 L70,10 L90,30 L90,90 L10,90 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinejoin="round" 
                    />
                    <path 
                      d="M70,10 L70,30 L90,30 Z" 
                      fill={stroke} 
                      opacity="0.25"
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinejoin="round" 
                    /></g>),
  'target': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="50" r="28" fill="none" stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="50" r="14" fill="none" stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="50" r="4" fill={stroke} /></g>),
  'funnel': (fill, stroke) => (<g><polygon 
                      points="10,10 90,10 60,45 60,85 40,95 40,45" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinejoin="round" 
                    /></g>),
  'magnet': (fill, stroke) => (<g><path 
                      d="M20,40 C20,15 80,15 80,40 L80,75 L62,75 L62,40 C62,28 38,28 38,40 L38,75 L20,75 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinejoin="round" 
                    />
                    <rect x="20" y="70" width="18" height="10" fill={stroke} stroke={stroke} strokeWidth="4" />
                    <rect x="62" y="70" width="18" height="10" fill={stroke} stroke={stroke} strokeWidth="4" /></g>),
  'puzzle': (fill, stroke) => (<g><path 
                      d="M20,20 L40,20 C40,10 60,10 60,20 L80,20 L80,40 C90,40 90,60 80,60 L80,80 L60,80 C60,70 40,70 40,80 L20,80 L20,60 C30,60 30,40 20,40 Z" 
                      fill={fill} 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinejoin="round" 
                    /></g>),
  'gear': (fill, stroke) => (<g><circle cx="50" cy="50" r="22" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path 
                      d="M50,15 L50,5 M50,95 L50,85 M15,50 L5,50 M95,50 L85,50 M25,25 L18,18 M75,75 L82,82 M25,80 L18,82 M75,25 L82,18" 
                      stroke={stroke} 
                      strokeWidth="4" 
                      strokeLinecap="round" 
                    />
                    <circle cx="50" cy="50" r="8" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'terminal': (fill, stroke) => (<g><rect x="5" y="15" width="90" height="70" rx="6" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="5" y1="35" x2="95" y2="35" stroke={stroke} strokeWidth="4" />
                    <circle cx="15" cy="25" r="3" fill={stroke} />
                    <circle cx="25" cy="25" r="3" fill={stroke} />
                    <circle cx="35" cy="25" r="3" fill={stroke} />
                    <path d="M15,47 L25,55 L15,63 M30,63 L45,63" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'brackets': (fill, stroke) => (<g><rect x="5" y="10" width="90" height="80" rx="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M30,30 C20,30 20,40 20,50 C20,60 20,70 30,70 M70,30 C80,30 80,40 80,50 C80,60 80,70 70,70" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'api': (fill, stroke) => (<g><rect x="10" y="35" width="80" height="30" rx="15" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="30" cy="50" r="6" fill={stroke} />
                    <circle cx="50" cy="50" r="6" fill={stroke} />
                    <circle cx="70" cy="50" r="6" fill={stroke} />
                    <line x1="36" y1="50" x2="44" y2="50" stroke={stroke} strokeWidth="4" />
                    <line x1="56" y1="50" x2="64" y2="50" stroke={stroke} strokeWidth="4" /></g>),
  'server': (fill, stroke) => (<g><rect x="15" y="10" width="70" height="22" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="15" y="38" width="70" height="22" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="15" y="66" width="70" height="22" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="28" cy="21" r="2" fill={stroke} />
                    <circle cx="28" cy="49" r="2" fill={stroke} />
                    <circle cx="28" cy="77" r="2" fill={stroke} /></g>),
  'cube': (fill, stroke) => (<g><polygon points="50,5 92,26 92,74 50,95 8,74 8,26" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="5" x2="50" y2="95" stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="48" x2="92" y2="26" stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="48" x2="8" y2="26" stroke={stroke} strokeWidth="4" /></g>),
  'branch': (fill, stroke) => (<g><path d="M30,85 L30,15 M30,50 Q60,50 70,30 L70,15" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="30" cy="15" r="7" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="30" cy="85" r="7" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="70" cy="15" r="7" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'terminal-prompt': (fill, stroke) => (<g><path d="M20,30 L45,50 L20,70 M50,70 L80,70" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'cpu': (fill, stroke) => (<g><rect x="20" y="20" width="60" height="60" rx="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="35" y="35" width="30" height="30" rx="4" fill="none" stroke={stroke} strokeWidth="4" />
                    <path d="M35,20 L35,10 M50,20 L50,10 M65,20 L65,10 M35,80 L35,90 M50,80 L50,90 M65,80 L65,90 M20,35 L10,35 M20,50 L10,50 M20,65 L10,65 M80,35 L90,35 M80,50 L90,50 M80,65 L90,65" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'globe': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" />
                    <ellipse cx="50" cy="50" rx="20" ry="42" fill="none" stroke={stroke} strokeWidth="4" />
                    <ellipse cx="50" cy="50" rx="42" ry="15" fill="none" stroke={stroke} strokeWidth="4" />
                    <line x1="8" y1="50" x2="92" y2="50" stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="8" x2="50" y2="92" stroke={stroke} strokeWidth="4" /></g>),
  'key': (fill, stroke) => (<g><path d="M35,50 A15,15 0 1,1 35,49.9 L75,50 L75,65 L85,65 L85,50 L90,50 L90,35 L35,35 Z M25,50 A4,4 0 1,0 25,49.9 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'smile': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="35" cy="40" r="5" fill={stroke} />
                    <circle cx="65" cy="40" r="5" fill={stroke} />
                    <path d="M30,60 C38,72 62,72 70,60" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'thumbs-up': (fill, stroke) => (<g><path d="M15,50 L15,85 L28,85 L28,50 Z M28,85 L65,85 C72,85 75,80 75,70 L80,45 C80,38 75,35 68,35 L50,35 L53,15 C53,10 47,5 40,8 L28,30 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'thumbs-down': (fill, stroke) => (<g><path d="M15,50 L15,15 L28,15 L28,50 Z M28,15 L65,15 C72,15 75,20 75,30 L80,55 C80,62 75,65 68,65 L50,65 L53,85 C53,90 47,95 40,92 L28,70 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'flower': (fill, stroke) => (<g><path d="M50,28 C50,15 65,15 65,28 C65,40 50,40 50,28 Z M50,72 C50,85 35,85 35,72 C35,60 50,60 50,72 Z M28,50 C15,50 15,35 28,35 C40,35 40,50 28,50 Z M72,50 C85,50 85,65 72,65 C60,65 60,50 72,50 Z" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="50" r="14" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'sparkles': (fill, stroke) => (<g><path d="M50,10 Q50,40 80,40 Q50,40 50,70 Q50,40 20,40 Q50,40 50,10 Z M75,65 Q75,80 90,80 Q75,80 75,95 Q75,80 60,80 Q75,80 75,65 Z M25,70 Q25,80 35,80 Q25,80 25,90 Q25,80 15,80 Q25,80 25,70 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'trophy': (fill, stroke) => (<g><path d="M25,15 L75,15 L70,55 C65,68 55,70 50,70 C45,70 35,68 30,55 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <path d="M25,25 C15,25 15,40 25,40 M75,25 C85,25 85,40 75,40" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <path d="M50,70 L50,85 M35,85 L65,85" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'medal': (fill, stroke) => (<g><polygon points="35,5 50,35 65,5 45,5" fill={stroke} opacity="0.3" stroke={stroke} strokeWidth="4" />
                    <polygon points="50,35 30,5 38,5" fill={stroke} opacity="0.5" stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="60" r="28" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="60" r="18" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'gift': (fill, stroke) => (<g><rect x="15" y="30" width="70" height="60" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="10" y="20" width="80" height="15" rx="2" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="20" x2="50" y2="90" stroke={stroke} strokeWidth="4" />
                    <path d="M50,20 C40,5 30,15 50,20 C60,5 70,15 50,20" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'balloon': (fill, stroke) => (<g><path d="M50,5 C25,5 25,45 50,65 C75,45 75,5 50,5 Z M47,65 L53,65 L50,70 Z" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M50,70 Q45,80 52,90 T48,100" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'clapping': (fill, stroke) => (<g><path d="M30,60 L20,45 C15,38 25,30 32,37 L40,47 M55,30 L65,15 C70,8 80,18 73,25 L60,40 M45,45 C50,38 60,45 55,55 L35,80 L20,70 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'coffee': (fill, stroke) => (<g><path d="M20,30 L80,30 C80,65 65,80 45,80 L35,80 C20,80 20,65 20,30 Z M80,40 C90,40 90,55 80,55" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <path d="M35,10 Q35,20 40,20 M50,10 Q50,20 55,20 M65,10 Q65,20 70,20" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="15" y1="88" x2="85" y2="88" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'check-circle': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M32,50 L44,62 L68,36" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'cross-circle': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M35,35 L65,65 M65,35 L35,65" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'arrow-up': (fill, stroke) => (<g><polygon points="50,10 90,45 65,45 65,90 35,90 35,45 10,45" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'arrow-down': (fill, stroke) => (<g><polygon points="50,90 90,55 65,55 65,10 35,10 35,55 10,55" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'user': (fill, stroke) => (<g><circle cx="50" cy="30" r="18" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M15,85 C15,65 30,55 50,55 C70,55 85,65 85,85 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'clock': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M50,20 L50,50 L70,50" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'calendar': (fill, stroke) => (<g><rect x="15" y="20" width="70" height="70" rx="6" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="15" y1="40" x2="85" y2="40" stroke={stroke} strokeWidth="4" />
                    <line x1="30" y1="12" x2="30" y2="24" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="70" y1="12" x2="70" y2="24" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="30" cy="55" r="3" fill={stroke} />
                    <circle cx="50" cy="55" r="3" fill={stroke} />
                    <circle cx="70" cy="55" r="3" fill={stroke} />
                    <circle cx="30" cy="75" r="3" fill={stroke} />
                    <circle cx="50" cy="75" r="3" fill={stroke} />
                    <circle cx="70" cy="75" r="3" fill={stroke} /></g>),
  'card': (fill, stroke) => (<g><rect x="10" y="20" width="80" height="60" rx="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="10" y="32" width="80" height="15" fill={stroke} />
                    <rect x="20" y="58" width="16" height="10" rx="2" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'chart': (fill, stroke) => (<g><rect x="10" y="10" width="80" height="80" rx="6" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M20,70 L35,50 L55,60 L75,30" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="75" cy="30" r="3.5" fill={stroke} /></g>),
  'cart': (fill, stroke) => (<g><path d="M10,15 L25,15 L40,60 L80,60 L90,28 L30,28" fill={fill} stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="45" cy="78" r="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="75" cy="78" r="8" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'play': (fill, stroke) => (<g><polygon points="25,15 85,50 25,85" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'pause': (fill, stroke) => (<g><rect x="22" y="15" width="16" height="70" rx="3" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="62" y="15" width="16" height="70" rx="3" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'stop': (fill, stroke) => (<g><rect x="15" y="15" width="70" height="70" rx="6" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'infinity': (fill, stroke) => (<g><path d="M28,32 C12,32 12,68 28,68 C38,68 45,56 50,50 C55,44 62,32 72,32 C88,32 88,68 72,68 C62,68 55,56 50,50 C45,44 38,32 28,32 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'beat': (fill, stroke) => (<g><path d="M 10,65 C 30,65 35,35 55,35 C 70,35 75,55 90,55" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="10" cy="65" r="4.5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="55" cy="35" r="5.5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="90" cy="55" r="4.5" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'scene': (fill, stroke) => (<g><rect x="10" y="15" width="80" height="70" rx="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M 10,32 L 90,32" stroke={stroke} strokeWidth="4" />
                    <path d="M 10,23 C 10,18 14,15 18,15 L 82,15 C 86,15 90,18 90,23 L 90,32 L 10,32 Z" fill={stroke} opacity="0.12" /></g>),
  'arc': (fill, stroke) => (<g><path d="M 10,85 C 10,20 90,20 90,85 Z" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M 10,85 C 10,20 90,20 90,85" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'twist': (fill, stroke) => (<g><rect x="5" y="5" width="90" height="90" rx="10" fill={fill} stroke="none" opacity="0.1" />
                    <path d="M 10,65 L 40,65 L 50,20 L 60,65 L 90,65" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="50" cy="20" r="4.5" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'stakes': (fill, stroke) => (<g><polygon points="50,10 90,50 65,50 65,85 35,85 35,50 10,50" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <line x1="15" y1="85" x2="85" y2="85" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'character': (fill, stroke) => (<g><circle cx="50" cy="30" r="16" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M 20,80 C 20,62 32,58 50,58 C 68,58 80,62 80,80 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'whisper': (fill, stroke) => (<g><rect x="5" y="5" width="90" height="90" rx="10" fill={fill} stroke="none" opacity="0.1" />
                    <path d="M 15,30 C 35,15 45,85 65,70 C 75,60 80,40 90,30" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="6,6" strokeLinecap="round" /></g>),
  'foreshadow': (fill, stroke) => (<g><circle cx="22" cy="50" r="10" fill={fill} stroke={stroke} strokeWidth="4" strokeDasharray="3,3" opacity="0.6" />
                    <line x1="32" y1="50" x2="68" y2="50" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" strokeLinecap="round" />
                    <circle cx="78" cy="50" r="10" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="78" cy="50" r="4" fill={stroke} /></g>),
  'world': (fill, stroke) => (<g><circle cx="50" cy="50" r="40" fill={fill} stroke={stroke} strokeWidth="4" />
                    <ellipse cx="50" cy="50" rx="40" ry="16" fill="none" stroke={stroke} strokeWidth="4" />
                    <line x1="10" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" />
                    <ellipse cx="50" cy="50" rx="16" ry="40" fill="none" stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="10" x2="50" y2="90" stroke={stroke} strokeWidth="4" /></g>),
  'voice': (fill, stroke) => (<g><path d="M 18,40 L 38,40 L 58,20 L 58,80 L 38,60 L 18,60 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <path d="M 70,32 C 76,40 76,60 70,68" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <path d="M 80,20 C 90,32 90,68 80,80" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'queue': (fill, stroke) => (<g><rect x="10" y="38" width="80" height="24" rx="12" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="26" cy="50" r="5" fill={stroke} />
                    <circle cx="42" cy="50" r="5" fill={stroke} />
                    <circle cx="58" cy="50" r="5" fill={stroke} />
                    <circle cx="74" cy="50" r="7" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'webhook': (fill, stroke) => (<g><path d="M 25,20 C 25,60 75,25 75,60" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" />
                    <circle cx="25" cy="20" r="5" fill={stroke} />
                    <circle cx="75" cy="65" r="10" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="75" cy="65" r="4" fill={stroke} /></g>),
  'cache': (fill, stroke) => (<g><rect x="15" y="20" width="70" height="15" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="15" y="42" width="70" height="15" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="15" y="65" width="70" height="15" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="25" y1="27.5" x2="35" y2="27.5" stroke={stroke} strokeWidth="4" />
                    <line x1="25" y1="49.5" x2="35" y2="49.5" stroke={stroke} strokeWidth="4" />
                    <line x1="25" y1="72.5" x2="35" y2="72.5" stroke={stroke} strokeWidth="4" /></g>),
  'event': (fill, stroke) => (<g><polygon points="50,12 62,38 90,38 68,54 76,82 50,65 24,82 32,54 10,38 38,38" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'pipeline': (fill, stroke) => (<g><line x1="20" y1="50" x2="80" y2="50" stroke={stroke} strokeWidth="4" />
                    <rect x="12" y="38" width="18" height="24" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="41" y="38" width="18" height="24" rx="4" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="70" y="38" width="18" height="24" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'auth': (fill, stroke) => (<g><path d="M 30,45 L 30,30 C 30,18 40,15 50,15 C 60,15 70,18 70,30 L 70,45" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <rect x="22" y="42" width="56" height="42" rx="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="58" r="4.5" fill={stroke} />
                    <line x1="50" y1="62" x2="50" y2="70" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'diff': (fill, stroke) => (<g><rect x="10" y="15" width="80" height="70" rx="8" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="15" x2="50" y2="85" stroke={stroke} strokeWidth="4" />
                    <line x1="20" y1="30" x2="40" y2="30" stroke={stroke} strokeWidth="4" opacity="0.6" strokeLinecap="round" />
                    <line x1="20" y1="45" x2="35" y2="45" stroke={stroke} strokeWidth="4" opacity="0.6" strokeLinecap="round" />
                    <line x1="60" y1="30" x2="80" y2="30" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="60" y1="55" x2="75" y2="55" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'hash': (fill, stroke) => (<g><line x1="38" y1="12" x2="38" y2="88" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="62" y1="12" x2="62" y2="88" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="12" y1="38" x2="88" y2="38" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="12" y1="62" x2="88" y2="62" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'branch-merge': (fill, stroke) => (<g><line x1="25" y1="80" x2="25" y2="20" stroke={stroke} strokeWidth="4" />
                    <path d="M 25,65 Q 65,65 65,50 Q 65,35 25,35" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="25" cy="75" r="5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="65" cy="50" r="5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="25" cy="25" r="5" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'token': (fill, stroke) => (<g><circle cx="50" cy="50" r="38" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="50" cy="50" r="28" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="3,3" />
                    <path d="M 40,42 L 50,36 L 60,42 L 60,52 C 60,60 50,65 50,65 C 50,65 40,60 40,52 Z" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'feedback': (fill, stroke) => (<g><path d="M 30,50 C 15,32 15,68 30,50 C 45,32 55,68 70,50 C 85,32 85,68 70,50 C 55,32 45,68 30,50 Z" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <polygon points="34,42 36,49 29,48" fill={stroke} />
                    <polygon points="66,58 64,51 71,52" fill={stroke} /></g>),
  'bottleneck': (fill, stroke) => (<g><path d="M 15,20 L 85,20 L 58,55 L 58,80 L 42,80 L 42,55 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <line x1="50" y1="28" x2="50" y2="45" stroke={stroke} strokeWidth="4" strokeDasharray="3,3" />
                    <line x1="50" y1="60" x2="50" y2="76" stroke={stroke} strokeWidth="4" /></g>),
  'cascade': (fill, stroke) => (<g><path d="M 15,22 Q 40,25 45,50 T 85,78" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="15" cy="22" r="5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="45" cy="50" r="5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <circle cx="85" cy="78" r="5" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'threshold': (fill, stroke) => (<g><line x1="10" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" />
                    <path d="M 15,80 C 35,80 40,20 85,20" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="50" cy="50" r="6" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'trade-off': (fill, stroke) => (<g><line x1="20" y1="80" x2="20" y2="15" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="20" y1="80" x2="85" y2="80" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <path d="M 14,24 L 20,15 L 26,24" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M 76,74 L 85,80 L 76,86" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M 25,75 L 75,25" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="3,3" />
                    <circle cx="50" cy="50" r="4.5" fill={stroke} /></g>),
  'pareto': (fill, stroke) => (<g><rect x="15" y="25" width="12" height="55" rx="2" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="35" y="45" width="12" height="35" rx="2" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="55" y="60" width="12" height="20" rx="2" fill={fill} stroke={stroke} strokeWidth="4" />
                    <rect x="75" y="70" width="12" height="10" rx="2" fill={fill} stroke={stroke} strokeWidth="4" />
                    <path d="M 21,25 Q 50,22 81,68" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="2,2" /></g>),
  'pivot': (fill, stroke) => (<g><path d="M 20,75 L 50,40 L 80,75" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="50" cy="40" r="5" fill={fill} stroke={stroke} strokeWidth="4" />
                    <line x1="50" y1="28" x2="50" y2="22" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="38" y1="32" x2="32" y2="28" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="62" y1="32" x2="68" y2="28" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'lever': (fill, stroke) => (<g><polygon points="50,55 60,75 40,75" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <line x1="15" y1="70" x2="85" y2="40" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="85" cy="40" r="6" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'compound': (fill, stroke) => (<g><path d="M 15,80 C 45,80 60,65 85,15" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="10" y1="80" x2="90" y2="80" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <line x1="15" y1="85" x2="15" y2="10" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="85" cy="15" r="4.5" fill={stroke} /></g>),
  'risk': (fill, stroke) => (<g><polygon points="50,15 90,82 10,82" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" />
                    <line x1="50" y1="42" x2="50" y2="60" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
                    <circle cx="50" cy="71" r="3.5" fill={stroke} /></g>),
};

export const SHAPE_PREVIEW_IDS = Object.keys(GEOMETRY);

export default function ShapePreview({
  type,
  size = 26,
  fill = 'rgba(255, 252, 248, 0.9)',
  stroke = 'var(--accent)',
}: {
  type: string;
  size?: number;
  fill?: string;
  stroke?: string;
}) {
  const geo = GEOMETRY[type] || GEOMETRY['square'];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      {geo(fill, stroke)}
    </svg>
  );
}
