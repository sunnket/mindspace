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

  // Brainstorm
  'lightbulb-spark': (fill, stroke) => (<g><path d="M50,15 C33,15 25,30 25,48 C25,60 36,68 40,76 L60,76 C64,68 75,60 75,48 C75,30 67,15 50,15 Z M42,88 L58,88 M45,76 L45,88 M55,76 L55,88" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="50" y1="5" x2="50" y2="10" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="20" y1="20" x2="25" y2="25" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="80" y1="20" x2="75" y2="25" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'compass': (fill, stroke) => (<g><circle cx="50" cy="50" r="40" fill={fill} stroke={stroke} strokeWidth="4" /><polygon points="50,20 62,50 50,80 38,50" fill={stroke} stroke={stroke} strokeWidth="2" /><circle cx="50" cy="50" r="5" fill={fill} /></g>),
  'rocket': (fill, stroke) => (<g><path d="M50,10 C65,25 70,55 70,75 L30,75 C30,55 35,25 50,10 Z M30,50 L15,65 L30,70 M70,50 L85,65 L70,70 M42,75 L42,90 L50,83 L58,90 L58,75" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><circle cx="50" cy="40" r="8" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'radar': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="28" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="14" fill="none" stroke={stroke} strokeWidth="4" /><line x1="50" y1="50" x2="80" y2="20" stroke={stroke} strokeWidth="4" /><circle cx="68" cy="32" r="4" fill={stroke} /></g>),
  'prism': (fill, stroke) => (<g><polygon points="50,12 90,82 10,82" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="10" y1="50" x2="30" y2="46" stroke={stroke} strokeWidth="4" /><line x1="65" y1="53" x2="90" y2="40" stroke={stroke} strokeWidth="4" /><line x1="68" y1="58" x2="90" y2="55" stroke={stroke} strokeWidth="4" /><line x1="70" y1="63" x2="90" y2="70" stroke={stroke} strokeWidth="4" /></g>),
  'light-beam': (fill, stroke) => (<g><polygon points="50,10 85,90 15,90" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="50" y1="10" x2="50" y2="90" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" /></g>),
  'telescope': (fill, stroke) => (<g><path d="M20,60 L75,25 L85,40 L30,75 Z M60,35 L40,75 M50,45 L50,85 M50,85 L30,95 M50,85 L70,95" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" /></g>),
  'magnifier': (fill, stroke) => (<g><circle cx="42" cy="42" r="30" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="64" y1="64" x2="90" y2="90" stroke={stroke} strokeWidth="8" strokeLinecap="round" /></g>),
  'atom-idea': (fill, stroke) => (<g><ellipse cx="50" cy="50" rx="42" ry="16" fill="none" stroke={stroke} strokeWidth="4" /><ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(60 50 50)" fill="none" stroke={stroke} strokeWidth="4" /><ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(-60 50 50)" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="8" fill={stroke} /></g>),
  'spark-cluster': (fill, stroke) => (<g><path d="M50,15 L53,35 L73,38 L55,50 L60,70 L45,55 L25,65 L35,48 L18,38 L38,35 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'anchor': (fill, stroke) => (<g><circle cx="50" cy="20" r="8" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="28" x2="50" y2="80" stroke={stroke} strokeWidth="4" /><line x1="30" y1="38" x2="70" y2="38" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><path d="M20,55 C20,80 80,80 80,55 M20,55 L12,48 M80,55 L88,48" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'bridge': (fill, stroke) => (<g><path d="M10,70 Q50,20 90,70 M10,70 L90,70 M30,55 L30,70 M50,45 L50,70 M70,55 L70,70" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),

  // Code (Tech)
  'cpu-chip': (fill, stroke) => (<g><rect x="25" y="25" width="50" height="50" rx="6" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="38" y="38" width="24" height="24" rx="3" fill="none" stroke={stroke} strokeWidth="4" /><line x1="35" y1="10" x2="35" y2="25" stroke={stroke} strokeWidth="4" /><line x1="50" y1="10" x2="50" y2="25" stroke={stroke} strokeWidth="4" /><line x1="65" y1="10" x2="65" y2="25" stroke={stroke} strokeWidth="4" /><line x1="35" y1="75" x2="35" y2="90" stroke={stroke} strokeWidth="4" /><line x1="50" y1="75" x2="50" y2="90" stroke={stroke} strokeWidth="4" /><line x1="65" y1="75" x2="65" y2="90" stroke={stroke} strokeWidth="4" /><line x1="10" y1="35" x2="25" y2="35" stroke={stroke} strokeWidth="4" /><line x1="10" y1="50" x2="25" y2="50" stroke={stroke} strokeWidth="4" /><line x1="10" y1="65" x2="25" y2="65" stroke={stroke} strokeWidth="4" /><line x1="75" y1="35" x2="90" y2="35" stroke={stroke} strokeWidth="4" /><line x1="75" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" /><line x1="75" y1="65" x2="90" y2="65" stroke={stroke} strokeWidth="4" /></g>),
  'cloud-download': (fill, stroke) => (<g><path d="M25,55 C25,40 40,30 55,30 C70,30 85,40 85,55 C92,55 98,61 98,68 C98,76 92,82 85,82 L25,82 C15,82 8,75 8,65 C8,56 16,50 25,55 Z" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M50,48 L50,72 M38,62 L50,74 L62,62" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'cloud-upload': (fill, stroke) => (<g><path d="M25,55 C25,40 40,30 55,30 C70,30 85,40 85,55 C92,55 98,61 98,68 C98,76 92,82 85,82 L25,82 C15,82 8,75 8,65 C8,56 16,50 25,55 Z" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M50,72 L50,48 M38,58 L50,46 L62,58" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'git-commit': (fill, stroke) => (<g><circle cx="50" cy="50" r="18" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="10" y1="50" x2="32" y2="50" stroke={stroke} strokeWidth="4" /><line x1="68" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" /></g>),
  'binary': (fill, stroke) => (<g><text x="20" y="42" fontSize="28" fontWeight="bold" fill={stroke}>10</text><text x="50" y="78" fontSize="28" fontWeight="bold" fill={stroke}>01</text></g>),
  'cube-stack': (fill, stroke) => (<g><polygon points="50,8 85,24 85,48 50,64 15,48 15,24" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="50" y1="8" x2="50" y2="64" stroke={stroke} strokeWidth="4" /><polygon points="50,40 85,56 85,80 50,96 15,80 15,56" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="50" y1="40" x2="50" y2="96" stroke={stroke} strokeWidth="4" /></g>),
  'stack': (fill, stroke) => (<g><polygon points="50,15 90,32 50,49 10,32" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><path d="M10,48 L50,65 L90,48 M10,64 L50,81 L90,64" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'network': (fill, stroke) => (<g><circle cx="50" cy="20" r="10" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="20" cy="75" r="10" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="80" cy="75" r="10" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="30" x2="20" y2="65" stroke={stroke} strokeWidth="4" /><line x1="50" y1="30" x2="80" y2="65" stroke={stroke} strokeWidth="4" /><line x1="30" y1="75" x2="70" y2="75" stroke={stroke} strokeWidth="4" /></g>),
  'data-flow': (fill, stroke) => (<g><rect x="10" y="20" width="22" height="60" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="68" y="20" width="22" height="60" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M32,35 C50,35 50,65 68,65" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" /></g>),
  'bug': (fill, stroke) => (<g><ellipse cx="50" cy="55" rx="22" ry="28" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="22" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="22" x2="50" y2="83" stroke={stroke} strokeWidth="4" /><line x1="15" y1="45" x2="30" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="85" y1="45" x2="70" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="12" y1="65" x2="30" y2="65" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="88" y1="65" x2="70" y2="65" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'terminal-box': (fill, stroke) => (<g><rect x="10" y="15" width="80" height="70" rx="8" fill={fill} stroke={stroke} strokeWidth="4" /><polyline points="25,35 40,48 25,61" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /><line x1="48" y1="61" x2="70" y2="61" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'fingerprint': (fill, stroke) => (<g><path d="M50,15 A35,35 0 0,1 85,50 M15,50 A35,35 0 0,1 50,15 M50,30 A20,20 0 0,1 70,50 M30,50 A20,20 0 0,1 50,30 M50,45 A5,5 0 0,1 55,50 M45,50 A5,5 0 0,1 50,45" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'wifi': (fill, stroke) => (<g><path d="M15,30 A50,50 0 0,1 85,30 M28,45 A32,32 0 0,1 72,45 M40,60 A16,16 0 0,1 60,60" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><circle cx="50" cy="75" r="6" fill={stroke} /></g>),
  'database-stack': (fill, stroke) => (<g><ellipse cx="50" cy="20" rx="35" ry="10" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M15,20 L15,45 C15,51 30,55 50,55 C70,55 85,51 85,45 L85,20" fill="none" stroke={stroke} strokeWidth="4" /><path d="M15,45 L15,70 C15,76 30,80 50,80 C70,80 85,76 85,70 L85,45" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'ai-spark': (fill, stroke) => (<g><path d="M50,10 L58,38 L86,46 L58,54 L50,82 L42,54 L14,46 L42,38 Z M78,14 L82,28 L96,32 L82,36 L78,50 L74,36 L60,32 L74,28 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),

  // Love (Expressive)
  'fire': (fill, stroke) => (<g><path d="M50,10 C50,10 65,30 65,50 C65,60 60,70 50,90 C40,70 35,60 35,50 C35,30 50,10 50,10 Z M50,45 C50,45 58,55 58,68 C58,74 54,80 50,85 C46,80 42,74 42,68 C42,55 50,45 50,45 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'star-burst': (fill, stroke) => (<g><polygon points="50,5 61,35 95,35 67,55 78,90 50,68 22,90 33,55 5,35 39,35" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'heart-pulse': (fill, stroke) => (<g><path d="M50,30 C35,10 10,10 10,40 C10,65 45,85 50,90 C55,85 90,65 90,40 C90,10 65,10 50,30 Z" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M20,45 L38,45 L45,30 L55,60 L62,40 L70,45 L80,45" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'crown': (fill, stroke) => (<g><polygon points="12,75 18,30 38,50 50,15 62,50 82,30 88,75" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><rect x="12" y="75" width="76" height="12" rx="3" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'gem': (fill, stroke) => (<g><polygon points="30,15 70,15 90,40 50,90 10,40" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="30" y1="15" x2="50" y2="40" stroke={stroke} strokeWidth="4" /><line x1="70" y1="15" x2="50" y2="40" stroke={stroke} strokeWidth="4" /><line x1="50" y1="40" x2="50" y2="90" stroke={stroke} strokeWidth="4" /><line x1="10" y1="40" x2="90" y2="40" stroke={stroke} strokeWidth="4" /></g>),
  'ribbon-award': (fill, stroke) => (<g><circle cx="50" cy="40" r="28" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="40" r="20" fill="none" stroke={stroke} strokeWidth="4" /><polygon points="36,62 30,92 50,80 70,92 64,62" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'peace': (fill, stroke) => (<g><circle cx="50" cy="50" r="42" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="8" x2="50" y2="92" stroke={stroke} strokeWidth="4" /><line x1="50" y1="50" x2="20" y2="80" stroke={stroke} strokeWidth="4" /><line x1="50" y1="50" x2="80" y2="80" stroke={stroke} strokeWidth="4" /></g>),
  'coffee-cup': (fill, stroke) => (<g><rect x="20" y="35" width="50" height="50" rx="10" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M70,42 C82,42 85,60 70,65" fill="none" stroke={stroke} strokeWidth="4" /><path d="M30,22 Q35,12 40,22 M50,22 Q55,12 60,22" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'music-note': (fill, stroke) => (<g><circle cx="30" cy="72" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="70" cy="58" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M42,72 L42,20 L82,10 L82,58" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'sunburst': (fill, stroke) => (<g><circle cx="50" cy="50" r="20" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="10" x2="50" y2="22" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="50" y1="78" x2="50" y2="90" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="50" x2="22" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="78" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="22" y1="22" x2="30" y2="30" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="70" y1="70" x2="78" y2="78" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="22" y1="78" x2="30" y2="70" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="70" y1="30" x2="78" y2="22" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'hand-shake': (fill, stroke) => (<g><path d="M10,50 L30,35 L50,50 L70,35 L90,50 M30,50 L45,65 M45,50 L60,65 M60,50 L75,65" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'party-popper': (fill, stroke) => (<g><polygon points="15,85 30,40 60,70" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><path d="M50,35 Q65,15 85,25 M65,45 Q80,40 90,55" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" /><circle cx="70" cy="20" r="3" fill={stroke} /><circle cx="85" cy="40" r="4" fill={stroke} /></g>),

  // Usecase (Actions)
  'arrow-up-right': (fill, stroke) => (<g><line x1="20" y1="80" x2="80" y2="20" stroke={stroke} strokeWidth="6" strokeLinecap="round" /><polyline points="40,20 80,20 80,60" fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'arrow-down-left': (fill, stroke) => (<g><line x1="80" y1="20" x2="20" y2="80" stroke={stroke} strokeWidth="6" strokeLinecap="round" /><polyline points="60,80 20,80 20,40" fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'rotate-cw': (fill, stroke) => (<g><path d="M50,15 A35,35 0 1,1 18,40" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="18,20 18,45 40,40" fill={stroke} stroke={stroke} strokeWidth="2" strokeLinejoin="round" /></g>),
  'rotate-ccw': (fill, stroke) => (<g><path d="M50,15 A35,35 0 1,0 82,40" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="82,20 82,45 60,40" fill={stroke} stroke={stroke} strokeWidth="2" strokeLinejoin="round" /></g>),
  'split': (fill, stroke) => (<g><line x1="50" y1="85" x2="50" y2="55" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><path d="M50,55 Q50,30 20,20 M50,55 Q50,30 80,20" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="15,30 20,15 32,22" fill={stroke} /><polygon points="85,30 80,15 68,22" fill={stroke} /></g>),
  'merge': (fill, stroke) => (<g><path d="M20,80 Q50,70 50,45 M80,80 Q50,70 50,45" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="50" y1="45" x2="50" y2="15" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="38,25 50,10 62,25" fill={stroke} /></g>),
  'filter-list': (fill, stroke) => (<g><line x1="15" y1="25" x2="85" y2="25" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="28" y1="45" x2="72" y2="45" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="40" y1="65" x2="60" y2="65" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'sort': (fill, stroke) => (<g><line x1="25" y1="20" x2="25" y2="80" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="15,32 25,18 35,32" fill={stroke} /><line x1="75" y1="20" x2="75" y2="80" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="65,68 75,82 85,68" fill={stroke} /></g>),
  'download': (fill, stroke) => (<g><rect x="15" y="75" width="70" height="12" rx="3" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="15" x2="50" y2="55" stroke={stroke} strokeWidth="6" strokeLinecap="round" /><polygon points="32,45 50,65 68,45" fill={stroke} /></g>),
  'upload': (fill, stroke) => (<g><rect x="15" y="75" width="70" height="12" rx="3" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="50" y1="65" x2="50" y2="25" stroke={stroke} strokeWidth="6" strokeLinecap="round" /><polygon points="32,35 50,15 68,35" fill={stroke} /></g>),
  'lock': (fill, stroke) => (<g><rect x="22" y="45" width="56" height="42" rx="8" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M32,45 L32,30 A18,18 0 0,1 68,30 L68,45" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><circle cx="50" cy="62" r="5" fill={stroke} /><line x1="50" y1="67" x2="50" y2="76" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'unlock': (fill, stroke) => (<g><rect x="22" y="45" width="56" height="42" rx="8" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M32,45 L32,30 A18,18 0 0,1 68,30" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><circle cx="50" cy="62" r="5" fill={stroke} /></g>),
  'eye': (fill, stroke) => (<g><path d="M10,50 C25,25 75,25 90,50 C75,75 25,75 10,50 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><circle cx="50" cy="50" r="14" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="6" fill={stroke} /></g>),
  'eye-off': (fill, stroke) => (<g><path d="M10,50 C25,25 75,25 90,50 C75,75 25,75 10,50 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="15" y1="15" x2="85" y2="85" stroke={stroke} strokeWidth="6" strokeLinecap="round" /></g>),
  'layers': (fill, stroke) => (<g><polygon points="50,15 90,32 50,49 10,32" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><path d="M10,48 L50,65 L90,48 M10,64 L50,81 L90,64" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),

  // Story
  'hero-cape': (fill, stroke) => (<g><path d="M30,25 L50,15 L70,25 L85,85 L50,70 L15,85 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><circle cx="50" cy="15" r="6" fill={stroke} /></g>),
  'villain-mask': (fill, stroke) => (<g><path d="M15,35 Q50,15 85,35 L75,75 Q50,90 25,75 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><polygon points="28,45 42,42 38,55" fill={stroke} /><polygon points="72,45 58,42 62,55" fill={stroke} /></g>),
  'climax-peak': (fill, stroke) => (<g><path d="M10,80 L40,40 L55,55 L75,15 L90,80 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="75" y1="15" x2="75" y2="80" stroke={stroke} strokeWidth="4" strokeDasharray="4,4" /></g>),
  'resolution': (fill, stroke) => (<g><path d="M15,50 C35,20 65,80 85,50" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><circle cx="85" cy="50" r="7" fill={stroke} /></g>),
  'sub-plot': (fill, stroke) => (<g><path d="M15,50 L40,50 C50,50 55,25 68,25 L85,25" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="40" y1="50" x2="85" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'theme-core': (fill, stroke) => (<g><circle cx="50" cy="50" r="38" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="22" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="4,3" /><circle cx="50" cy="50" r="8" fill={stroke} /></g>),
  'flashback': (fill, stroke) => (<g><path d="M50,15 A35,35 0 1,0 85,50" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="5,5" /><polygon points="50,5 50,25 32,15" fill={stroke} /></g>),
  'prop': (fill, stroke) => (<g><rect x="25" y="25" width="50" height="50" rx="8" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M25,25 L50,50 L75,25 M50,50 L50,75" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'dialogue-bubble': (fill, stroke) => (<g><path d="M15,20 L85,20 Q95,20 95,30 L95,60 Q95,70 85,70 L45,70 L25,88 L30,70 L15,70 Q5,70 5,60 L5,30 Q5,20 15,20 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'scroll-manuscript': (fill, stroke) => (<g><path d="M25,15 C15,15 15,30 25,30 L75,30 L75,85 C85,85 85,70 75,70 L25,70 L25,15 Z M25,15 L75,15 L75,30" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'hourglass': (fill, stroke) => (<g><path d="M25,15 L75,15 L55,50 L75,85 L25,85 L45,50 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="20" y1="15" x2="80" y2="15" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="20" y1="85" x2="80" y2="85" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'keyhole': (fill, stroke) => (<g><circle cx="50" cy="50" r="40" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="42" r="10" fill={stroke} /><polygon points="44,48 56,48 60,70 40,70" fill={stroke} /></g>),
  'map-location': (fill, stroke) => (<g><path d="M50,15 C32,15 20,30 20,48 C20,70 50,90 50,90 C50,90 80,70 80,48 C80,30 68,15 50,15 Z M50,42 A8,8 0 1,1 50,41.9 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'sword-shield': (fill, stroke) => (<g><path d="M25,20 L50,12 L75,20 C75,50 65,75 50,90 C35,75 25,50 25,20 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="20" y1="20" x2="80" y2="80" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="80" y1="20" x2="20" y2="80" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'portal': (fill, stroke) => (<g><ellipse cx="50" cy="50" rx="38" ry="42" fill={fill} stroke={stroke} strokeWidth="4" strokeDasharray="6,4" /><ellipse cx="50" cy="50" rx="24" ry="28" fill="none" stroke={stroke} strokeWidth="3" strokeDasharray="4,3" /><circle cx="50" cy="50" r="8" fill={stroke} /></g>),

  // System
  'feedback-loop': (fill, stroke) => (<g><path d="M50,15 A35,35 0 1,1 20,40" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="12,42 28,42 20,25" fill={stroke} /><path d="M50,85 A35,35 0 1,1 80,60" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="88,58 72,58 80,75" fill={stroke} /></g>),
  'balancing-loop': (fill, stroke) => (<g><circle cx="50" cy="50" r="38" fill={fill} stroke={stroke} strokeWidth="4" /><text x="50" y="60" fontSize="32" textAnchor="middle" fontWeight="bold" fill={stroke}>B</text></g>),
  'reinforcing-loop': (fill, stroke) => (<g><circle cx="50" cy="50" r="38" fill={fill} stroke={stroke} strokeWidth="4" /><text x="50" y="60" fontSize="32" textAnchor="middle" fontWeight="bold" fill={stroke}>R</text></g>),
  'tipping-point': (fill, stroke) => (<g><polygon points="20,80 50,30 80,80" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><rect x="15" y="25" width="70" height="10" rx="2" transform="rotate(15 50 30)" fill={stroke} /></g>),
  'domino': (fill, stroke) => (<g><rect x="15" y="10" width="30" height="80" rx="4" transform="rotate(-15 30 50)" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="55" y="10" width="30" height="80" rx="4" transform="rotate(25 70 50)" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'equilibrium': (fill, stroke) => (<g><line x1="15" y1="50" x2="85" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="50,50 62,80 38,80" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><circle cx="25" cy="38" r="10" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="75" cy="38" r="10" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'entropy': (fill, stroke) => (<g><circle cx="25" cy="30" r="5" fill={stroke} /><circle cx="70" cy="20" r="7" fill={stroke} /><circle cx="45" cy="60" r="6" fill={stroke} /><circle cx="80" cy="75" r="4" fill={stroke} /><circle cx="20" cy="80" r="8" fill={stroke} /><path d="M25,30 L45,60 M45,60 L70,20 M45,60 L80,75" stroke={stroke} strokeWidth="3" strokeDasharray="3,3" /></g>),
  'synergy': (fill, stroke) => (<g><circle cx="38" cy="42" r="28" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="62" cy="42" r="28" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="50" cy="66" r="28" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'black-box': (fill, stroke) => (<g><rect x="15" y="15" width="70" height="70" rx="10" fill={stroke} opacity="0.85" /><line x1="5" y1="50" x2="15" y2="50" stroke={stroke} strokeWidth="5" /><line x1="85" y1="50" x2="95" y2="50" stroke={stroke} strokeWidth="5" /></g>),
  'flywheel': (fill, stroke) => (<g><circle cx="50" cy="50" r="40" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="15" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M50,10 L50,35 M50,65 L50,90 M10,50 L35,50 M65,50 L90,50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'funnel-filter': (fill, stroke) => (<g><polygon points="10,15 90,15 65,55 65,85 35,85 35,55" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="25" y1="35" x2="75" y2="35" stroke={stroke} strokeWidth="4" strokeDasharray="4,3" /></g>),
  'friction': (fill, stroke) => (<g><line x1="10" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polyline points="15,40 25,60 35,40 45,60 55,40 65,60 75,40 85,60" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'oscillation': (fill, stroke) => (<g><path d="M10,50 Q30,15 50,50 T90,50" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="3" strokeDasharray="4,4" /></g>),
  'bottleneck-pipe': (fill, stroke) => (<g><path d="M10,30 L40,30 L40,42 L60,42 L60,30 L90,30 M10,70 L40,70 L40,58 L60,58 L60,70 L90,70" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" /></g>),
  'attractor': (fill, stroke) => (<g><path d="M50,50 Q85,15 85,50 T50,50 T15,50 T50,50" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><circle cx="50" cy="50" r="6" fill={stroke} /></g>),

  // Science
  'dna': (fill, stroke) => (<g><path d="M20,15 C50,35 50,65 20,85 M80,15 C50,35 50,65 80,85" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="30" y1="28" x2="70" y2="28" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="42" y1="50" x2="58" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="30" y1="72" x2="70" y2="72" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'atom-core': (fill, stroke) => (<g><ellipse cx="50" cy="50" rx="42" ry="16" fill="none" stroke={stroke} strokeWidth="4" /><ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(60 50 50)" fill="none" stroke={stroke} strokeWidth="4" /><ellipse cx="50" cy="50" rx="42" ry="16" transform="rotate(-60 50 50)" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="8" fill={stroke} /></g>),
  'flask': (fill, stroke) => (<g><path d="M40,15 L60,15 M46,15 L46,38 L80,80 Q85,88 75,88 L25,88 Q15,88 20,80 L54,38 L54,15" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" /><line x1="30" y1="70" x2="70" y2="70" stroke={stroke} strokeWidth="3" strokeDasharray="4,4" /></g>),
  'molecule': (fill, stroke) => (<g><circle cx="50" cy="25" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="25" cy="70" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="75" cy="70" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="42" y1="34" x2="31" y2="60" stroke={stroke} strokeWidth="4" /><line x1="58" y1="34" x2="69" y2="60" stroke={stroke} strokeWidth="4" /><line x1="37" y1="70" x2="63" y2="70" stroke={stroke} strokeWidth="4" /></g>),
  'infinity-loop': (fill, stroke) => (<g><path d="M30,30 C10,30 10,70 30,70 C45,70 55,30 70,30 C90,30 90,70 70,70 C55,70 45,30 30,30 Z" fill="none" stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'pi': (fill, stroke) => (<g><line x1="15" y1="25" x2="85" y2="25" stroke={stroke} strokeWidth="6" strokeLinecap="round" /><path d="M35,25 L35,80 M65,25 L65,75 Q65,85 75,85" fill="none" stroke={stroke} strokeWidth="5" strokeLinecap="round" /></g>),
  'wave-sine': (fill, stroke) => (<g><path d="M10,50 Q30,15 50,50 T90,50" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="3" strokeDasharray="4,4" /></g>),
  'delta': (fill, stroke) => (<g><polygon points="50,15 90,82 10,82" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'scale-balance': (fill, stroke) => (<g><line x1="15" y1="30" x2="85" y2="30" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="50" y1="15" x2="50" y2="85" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><polygon points="40,85 60,85 50,75" fill={stroke} /><path d="M15,30 L25,58 L35,58 Z M65,58 L75,58 L85,30 Z" fill={fill} stroke={stroke} strokeWidth="3" strokeLinejoin="round" /></g>),
  'magnet-field': (fill, stroke) => (<g><path d="M25,35 Q50,10 75,35 M20,50 Q50,20 80,50 M25,65 Q50,90 75,65" fill="none" stroke={stroke} strokeWidth="4" strokeDasharray="4,3" /><rect x="42" y="30" width="16" height="40" rx="3" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'orbit': (fill, stroke) => (<g><ellipse cx="50" cy="50" rx="42" ry="20" transform="rotate(-25 50 50)" fill="none" stroke={stroke} strokeWidth="4" /><circle cx="50" cy="50" r="12" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="82" cy="35" r="5" fill={stroke} /></g>),
  'sigma': (fill, stroke) => (<g><path d="M80,20 L25,20 L50,50 L25,80 L80,80" fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></g>),

  // Nature
  'leaf': (fill, stroke) => (<g><path d="M20,80 C20,80 20,30 65,15 C65,15 85,50 45,75 Z M20,80 L45,45 M35,55 L55,50 M30,65 L42,65" fill={fill} stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'tree': (fill, stroke) => (<g><path d="M50,15 C30,15 20,35 30,50 C20,60 30,75 50,75 C70,75 80,60 70,50 C80,35 70,15 50,15 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><rect x="44" y="75" width="12" height="18" rx="2" fill={stroke} /></g>),
  'mountain': (fill, stroke) => (<g><polygon points="35,30 75,85 5,85" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><polygon points="65,15 95,85 35,85" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><polyline points="23,48 35,55 45,46" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" /></g>),
  'water-drop': (fill, stroke) => (<g><path d="M50,12 C50,12 82,50 82,68 C82,84 68,92 50,92 C32,92 18,84 18,68 C18,50 50,12 50,12 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'sun-rays': (fill, stroke) => (<g><circle cx="50" cy="50" r="22" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M50,8 L50,20 M50,80 L50,92 M8,50 L20,50 M80,50 L92,50 M21,21 L30,30 M70,70 L79,79 M21,79 L30,70 M70,30 L79,21" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'snowflake': (fill, stroke) => (<g><line x1="50" y1="10" x2="50" y2="90" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="10" y1="50" x2="90" y2="50" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="22" y1="22" x2="78" y2="78" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="22" y1="78" x2="78" y2="22" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><path d="M42,22 L50,30 L58,22 M42,78 L50,70 L58,78 M22,42 L30,50 L22,58 M78,42 L70,50 L78,58" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></g>),
  'planet-ring': (fill, stroke) => (<g><circle cx="50" cy="50" r="25" fill={fill} stroke={stroke} strokeWidth="4" /><ellipse cx="50" cy="50" rx="46" ry="14" transform="rotate(-20 50 50)" fill="none" stroke={stroke} strokeWidth="4" /></g>),
  'galaxy': (fill, stroke) => (<g><path d="M50,50 Q85,15 85,50 Q85,85 50,50 Q15,85 15,50 Q15,15 50,50" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><circle cx="50" cy="50" r="7" fill={stroke} /></g>),
  'comet': (fill, stroke) => (<g><circle cx="75" cy="25" r="14" fill={fill} stroke={stroke} strokeWidth="4" /><path d="M65,33 L15,75 M70,38 L25,85 M60,23 L10,65" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'volcano': (fill, stroke) => (<g><polygon points="25,35 75,35 90,85 10,85" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><path d="M35,35 Q50,50 65,35" stroke={stroke} strokeWidth="3" fill="none" /><path d="M40,25 Q35,10 30,5 M50,25 Q50,10 50,2 M60,25 Q65,10 70,5" stroke={stroke} strokeWidth="4" strokeLinecap="round" fill="none" /></g>),
  'sprout': (fill, stroke) => (<g><path d="M50,90 L50,45 M50,45 C50,25 25,20 20,35 C20,50 45,45 50,45 Z M50,45 C50,25 75,20 80,35 C80,50 55,45 50,45 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" /></g>),
  'feather': (fill, stroke) => (<g><path d="M85,15 C50,30 25,60 15,90 M85,15 C60,40 50,70 15,90" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /><line x1="85" y1="15" x2="10" y2="95" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),

  // UI
  'layout-grid': (fill, stroke) => (<g><rect x="12" y="12" width="34" height="34" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="54" y="12" width="34" height="34" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="12" y="54" width="34" height="34" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="54" y="54" width="34" height="34" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'layout-columns': (fill, stroke) => (<g><rect x="10" y="15" width="22" height="70" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="39" y="15" width="22" height="70" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="68" y="15" width="22" height="70" rx="4" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'layout-sidebar': (fill, stroke) => (<g><rect x="10" y="15" width="80" height="70" rx="6" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="35" y1="15" x2="35" y2="85" stroke={stroke} strokeWidth="4" /></g>),
  'modal-box': (fill, stroke) => (<g><rect x="10" y="10" width="80" height="80" rx="8" fill="none" stroke={stroke} strokeWidth="3" opacity="0.4" /><rect x="25" y="25" width="50" height="50" rx="6" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="60" y1="35" x2="68" y2="35" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'card-view': (fill, stroke) => (<g><rect x="12" y="15" width="76" height="70" rx="8" fill={fill} stroke={stroke} strokeWidth="4" /><rect x="22" y="25" width="56" height="28" rx="4" fill="none" stroke={stroke} strokeWidth="3" /><line x1="22" y1="63" x2="60" y2="63" stroke={stroke} strokeWidth="4" strokeLinecap="round" /><line x1="22" y1="73" x2="45" y2="73" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'button-primary': (fill, stroke) => (<g><rect x="12" y="30" width="76" height="40" rx="10" fill={fill} stroke={stroke} strokeWidth="4" /><line x1="35" y1="50" x2="65" y2="50" stroke={stroke} strokeWidth="5" strokeLinecap="round" /></g>),
  'toggle-switch': (fill, stroke) => (<g><rect x="12" y="30" width="76" height="40" rx="20" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="68" cy="50" r="14" fill={stroke} /></g>),
  'slider-control': (fill, stroke) => (<g><line x1="15" y1="50" x2="85" y2="50" stroke={stroke} strokeWidth="5" strokeLinecap="round" /><circle cx="60" cy="50" r="12" fill={fill} stroke={stroke} strokeWidth="4" /></g>),
  'tab-bar': (fill, stroke) => (<g><path d="M10,25 L35,25 L42,40 L90,40 L90,85 L10,85 Z" fill={fill} stroke={stroke} strokeWidth="4" strokeLinejoin="round" /></g>),
  'search-bar': (fill, stroke) => (<g><rect x="10" y="30" width="80" height="40" rx="20" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="32" cy="50" r="8" fill="none" stroke={stroke} strokeWidth="3" /><line x1="38" y1="56" x2="45" y2="63" stroke={stroke} strokeWidth="4" strokeLinecap="round" /></g>),
  'avatar-circle': (fill, stroke) => (<g><circle cx="50" cy="50" r="40" fill={fill} stroke={stroke} strokeWidth="4" /><circle cx="50" cy="38" r="12" fill="none" stroke={stroke} strokeWidth="3" /><path d="M26,75 C26,60 36,56 50,56 C64,56 74,60 74,75" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" /></g>),
  'image-placeholder': (fill, stroke) => (<g><rect x="10" y="15" width="80" height="70" rx="6" fill={fill} stroke={stroke} strokeWidth="4" /><polygon points="20,72 40,45 60,72" fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" /><polygon points="50,72 68,52 82,72" fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" /><circle cx="70" cy="32" r="6" fill="none" stroke={stroke} strokeWidth="3" /></g>),
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
