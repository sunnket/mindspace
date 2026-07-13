'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllCanvasStates,
  CanvasState,
  CanvasObjectData,
  ConnectionData,
  seedDatabaseIfEmpty,
  getAllObjects,
  getAllStrokes,
  getAllConnections,
  getAbsoluteAllObjects,
  saveCanvasState,
  updateCanvasMeta,
  updateCanvasTheme,
  duplicateCanvas,
  deleteCanvasPermanently,
} from '@/lib/db';
import { useRouter } from 'next/navigation';
import AuthButton from '@/components/ui/AuthButton';
import ChatPanel from '@/components/chat/ChatPanel';
import { useChatUnreadTotal } from '@/store/chatStore';
import { exportBoardById } from '@/lib/boardIO';
import { applyCanvasTheme, resetCanvasTheme, presetById, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';

/* ============================================================
   Types
   ============================================================ */

type WorkspaceWithStats = CanvasState & {
  objectCount: number;
  strokeCount: number;
  connectionCount: number;
  objects: CanvasObjectData[];
  connections: ConnectionData[];
};

type SidebarTab = 'home' | 'favorites' | 'images' | 'checkpoints' | 'chat' | 'archive' | 'deleted';
type SortMode = 'recent' | 'name' | 'cards';


const spring = { type: 'spring' as const, stiffness: 260, damping: 26 };

/* ============================================================
   Small helpers
   ============================================================ */

function getRelativeTime(time: number) {
  const diff = Date.now() - time;
  if (diff < 1000) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function getFormattedDate() {
  const date = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]} · ${date.getDate()} ${months[date.getMonth()]}`;
}

function pickGreeting(visits: number) {
  const hours = new Date().getHours();
  const pool: string[] = [];
  if (hours >= 5 && hours < 12) {
    pool.push('good morning', 'rise and shine', 'morning spark', 'fresh start', 'start creating');
  } else if (hours >= 12 && hours < 17) {
    pool.push('good afternoon', 'afternoon flow', 'mid-day focus', 'keep going', 'mid-day spark');
  } else if (hours >= 17 && hours < 22) {
    pool.push('good evening', 'evening vibes', 'winding down', 'productive evening', 'ideas never sleep');
  } else {
    pool.push('burning the midnight oil', 'night owl mode', 'late night thoughts', 'midnight spark', 'ideas in the dark', 'quiet hours');
  }
  if (visits > 1) {
    pool.push('welcome back', 'back to create', 'your digital desk awaits');
    if (visits > 10) pool.push('back at it', 'make magic happen');
  } else {
    pool.push('welcome to mindspace', "let's get started", 'your canvas awaits');
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ============================================================
   Icons — one consistent 1.75-stroke outline family
   ============================================================ */

function Icon({ d, size = 18, filled = false, children }: { d?: string; size?: number; filled?: boolean; children?: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

const ICONS = {
  home: <Icon><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></Icon>,
  heart: <Icon d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  image: <Icon><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></Icon>,
  flag: <Icon><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></Icon>,
  docs: <Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></Icon>,
  archive: <Icon><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></Icon>,
  trash: <Icon><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>,
  search: <Icon size={16}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Icon>,
  plus: <Icon><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>,
  pencil: <Icon size={14} d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  copy: <Icon size={14}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>,
  download: <Icon size={14}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Icon>,
  restore: <Icon size={14}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></Icon>,
  cards: <Icon size={12}><rect x="3" y="3" width="18" height="18" rx="2" /></Icon>,
  sketch: <Icon size={12} d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  thread: <Icon size={12}><line x1="6" y1="6" x2="18" y2="18" /><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /></Icon>,
  chevron: <Icon size={13}><polyline points="6 9 12 15 18 9" /></Icon>,
  arrowRight: <Icon size={14}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></Icon>,
  palette: <Icon size={14}><circle cx="12" cy="12" r="10" /><circle cx="8" cy="10" r="1" fill="currentColor" /><circle cx="12" cy="7.5" r="1" fill="currentColor" /><circle cx="16" cy="10" r="1" fill="currentColor" /></Icon>,
  tag: <Icon size={14}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>,
  chat: (
    <Icon>
      <defs>
        <mask id="landing-chat-double-bubble-mask">
          <rect x="0" y="0" width="24" height="24" fill="white" />
          <path 
            d="M19.4003 18C19.7837 17.2499 20 16.4002 20 15.5C20 12.4624 17.5376 10 14.5 10C11.4624 10 9 12.4624 9 15.5C9 18.5376 11.4624 21 14.5 21L21 21C21 21 20 20 19.4143 18.0292" 
            fill="black" 
            stroke="black" 
            strokeWidth="3.5" 
          />
        </mask>
      </defs>
      <path 
        d="M18.85 12C18.9484 11.5153 19 11.0137 19 10.5C19 6.35786 15.6421 3 11.5 3C7.35786 3 4 6.35786 4 10.5C4 11.3766 4.15039 12.2181 4.42676 13C5.50098 16.0117 3 18 3 18H9.5" 
        mask="url(#landing-chat-double-bubble-mask)" 
      />
      <path 
        d="M19.4003 18C19.7837 17.2499 20 16.4002 20 15.5C20 12.4624 17.5376 10 14.5 10C11.4624 10 9 12.4624 9 15.5C9 18.5376 11.4624 21 14.5 21L21 21C21 21 20 20 19.4143 18.0292" 
      />
    </Icon>
  ),
};

/* ============================================================
   Canvas mini preview (memoized — renders tiny abstract map)
   ============================================================ */

const CanvasMiniPreview = React.memo(function CanvasMiniPreview({
  objects = [],
  connections = [],
  width = 240,
  height = 140,
}: {
  objects?: CanvasObjectData[];
  connections?: ConnectionData[];
  width?: number;
  height?: number;
}) {
  if (objects.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center opacity-40">
        <Icon size={22}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 17V9h6" /></Icon>
      </div>
    );
  }

  let minX = Math.min(...objects.map((o) => o.x - o.width / 2));
  let maxX = Math.max(...objects.map((o) => o.x + o.width / 2));
  let minY = Math.min(...objects.map((o) => o.y - o.height / 2));
  let maxY = Math.max(...objects.map((o) => o.y + o.height / 2));
  const pad = 30;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;

  const boxW = Math.max(100, maxX - minX);
  const boxH = Math.max(100, maxY - minY);
  const scale = Math.min(width / boxW, height / boxH, 0.45);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const getX = (cx: number) => (cx - centerX) * scale + width / 2;
  const getY = (cy: number) => (cy - centerY) * scale + height / 2;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
      {connections.map((conn) => {
        const from = objects.find((o) => o.id === conn.fromId);
        const to = objects.find((o) => o.id === conn.toId);
        if (!from || !to) return null;
        const fx = getX(from.x); const fy = getY(from.y);
        const tx = getX(to.x); const ty = getY(to.y);
        return (
          <path
            key={conn.id}
            d={`M ${fx} ${fy} Q ${(fx + tx) / 2} ${(fy + ty) / 2 - 10} ${tx} ${ty}`}
            stroke="var(--accent)"
            strokeWidth="1.2"
            fill="none"
            strokeDasharray="2 2"
            opacity="0.5"
          />
        );
      })}
      {objects.slice(0, 15).map((obj) => {
        const rw = obj.width * scale;
        const rh = obj.height * scale;
        const rx = getX(obj.x) - rw / 2;
        const ry = getY(obj.y) - rh / 2;
        let fill = '#FFFFFF';
        let stroke = 'rgba(45,42,38,0.08)';
        let radius = 4;
        if (obj.type === 'shape') {
          fill = (obj.style?.color as string) || 'var(--accent-light)';
          stroke = (obj.style?.borderColor as string) || 'var(--accent)';
          if (obj.style?.shapeType === 'pill') radius = rh / 2;
          else if (obj.style?.shapeType === 'oval') radius = Math.min(rw, rh) / 2;
        } else if (obj.type === 'sticky') {
          fill = (obj.style?.color as string) || 'var(--sticky-yellow)';
          radius = 1;
        } else if (obj.type === 'workflow-node') {
          fill = 'var(--bg-primary)';
          stroke = 'var(--accent)';
          radius = 8;
        }
        return (
          <g key={obj.id}>
            <rect x={rx} y={ry} width={rw} height={rh} rx={radius} ry={radius} fill={fill} stroke={stroke} strokeWidth="0.8" />
            {rw > 35 && (
              <text
                x={rx + rw / 2}
                y={ry + rh / 2 + 1.5}
                fill={obj.type === 'shape' ? '#FFFFFF' : 'var(--text-primary)'}
                fontWeight="500"
                textAnchor="middle"
                opacity="0.7"
                className="select-none pointer-events-none"
                style={{ fontSize: Math.max(3, Math.min(5, rw / 9)) + 'px' }}
              >
                {obj.content.split('\n')[0].substring(0, 10)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});

/* ============================================================
   Main component
   ============================================================ */

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithStats[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [categories, setCategories] = useState<string[]>(['personal', 'work', 'study']);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('home');
  const chatUnread = useChatUnreadTotal();
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const [username, setUsername] = useState('Sanket');
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('Sanket');
  const [greeting, setGreeting] = useState('welcome');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState('');
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [armedEmptyTrash, setArmedEmptyTrash] = useState(false);

  // Lazy-loaded gallery data for images / checkpoints tabs
  const [galleryObjects, setGalleryObjects] = useState<CanvasObjectData[] | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  /* ---------- data ---------- */

  const refresh = useCallback(async () => {
    const wsStates = await getAllCanvasStates();
    const wsWithStats = await Promise.all(
      wsStates.map(async (ws) => {
        const [objs, strokes, conns] = await Promise.all([
          getAllObjects(ws.id),
          getAllStrokes(ws.id),
          getAllConnections(ws.id),
        ]);
        return {
          ...ws,
          objectCount: objs.length,
          strokeCount: strokes.length,
          connectionCount: conns.length,
          objects: objs,
          connections: conns,
        };
      })
    );
    setWorkspaces(wsWithStats);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const storedUsername = localStorage.getItem('username');
    if (storedUsername) {
      setUsername(storedUsername);
      setUsernameInput(storedUsername);
    }
    const storedVisits = localStorage.getItem('mindspace_visit_count');
    const visits = storedVisits ? parseInt(storedVisits, 10) + 1 : 1;
    localStorage.setItem('mindspace_visit_count', visits.toString());
    setGreeting(pickGreeting(visits));

    const storedCategories = localStorage.getItem('mindspace_categories');
    if (storedCategories) {
      try {
        setCategories(JSON.parse(storedCategories));
      } catch {
        // default
      }
    }

    seedDatabaseIfEmpty().then(refresh).catch(console.error);
  }, [refresh]);

  // The canvas gallery ships in a warm dark theme by default. Restore the light
  // default palette on unmount so an opened canvas starts from its own theme.
  useEffect(() => {
    applyCanvasTheme(presetById('graphite') || DEFAULT_BACKGROUND);
    return () => resetCanvasTheme();
  }, []);

  // Lazy-load all objects the first time images/checkpoints tab is opened
  useEffect(() => {
    if ((activeSidebarTab === 'images' || activeSidebarTab === 'checkpoints') && galleryObjects === null) {
      getAbsoluteAllObjects().then(setGalleryObjects).catch(console.error);
    }
  }, [activeSidebarTab, galleryObjects]);

  // Keyboard: Ctrl+K focuses search, Escape clears it
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close sort menu on outside click
  useEffect(() => {
    if (!sortMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setSortMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sortMenuOpen]);

  /* ---------- actions ---------- */

  const openNewCanvas = async () => {
    const newId = uuidv4();
    const newCanvas: CanvasState = {
      id: newId,
      title: 'untitled canvas',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: Date.now(),
      category: activeCategory === 'all' ? (categories[0] || 'personal') : activeCategory,
      isFavorite: false,
      deleted: false,
      archived: false,
    };
    await saveCanvasState(newCanvas);
    router.push(`/canvas?id=${newId}`);
  };

  const saveCategories = (newCats: string[]) => {
    setCategories(newCats);
    localStorage.setItem('mindspace_categories', JSON.stringify(newCats));
  };

  const addCategory = () => {
    const baseName = 'new category';
    let newName = baseName;
    let counter = 1;
    while (categories.includes(newName)) {
      newName = `${baseName} ${counter}`;
      counter++;
    }
    const newCats = [...categories, newName];
    saveCategories(newCats);
    setActiveCategory(newName);
    setEditingCategory(newName);
    setEditingCategoryValue(newName);
  };

  const handleRenameCategory = async (oldName: string, newName: string) => {
    const finalNewName = newName.trim().toLowerCase();
    if (!finalNewName || finalNewName === 'all' || finalNewName === oldName) {
      setEditingCategory(null);
      return;
    }
    if (categories.includes(finalNewName)) {
      alert('Category name already exists!');
      setEditingCategory(null);
      return;
    }

    const newCats = categories.map(c => c === oldName ? finalNewName : c);
    saveCategories(newCats);

    if (activeCategory === oldName) {
      setActiveCategory(finalNewName);
    }

    const updatedWorkspaces: WorkspaceWithStats[] = workspaces.map(ws => {
      if (ws.category === oldName) {
        updateCanvasMeta(ws.id, { category: finalNewName });
        return { ...ws, category: finalNewName };
      }
      return ws;
    });
    setWorkspaces(updatedWorkspaces);
    setEditingCategory(null);
  };

  const handleUsernameSave = () => {
    const finalName = usernameInput.trim() || 'Sanket';
    setUsername(finalName);
    localStorage.setItem('username', finalName);
    setIsEditingUsername(false);
  };

  const patchWorkspace = async (id: string, patch: Partial<CanvasState>) => {
    setWorkspaces((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    await updateCanvasMeta(id, patch);
  };

  const toggleFavorite = (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    patchWorkspace(ws.id, { isFavorite: !ws.isFavorite });
  };
  const toggleArchive = (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    patchWorkspace(ws.id, { archived: !ws.archived });
  };
  const toggleDelete = (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    patchWorkspace(ws.id, { deleted: !ws.deleted });
  };
  const cycleCategory = (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    if (categories.length === 0) return;
    const current = ws.category || categories[0];
    const idx = categories.indexOf(current);
    const next = categories[idx === -1 ? 0 : (idx + 1) % categories.length];
    patchWorkspace(ws.id, { category: next });
  };
  const handleColorCycle = async (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    const themeColors = ['#FAF6F1', '#FFF8DC', '#FFE4E6', '#E0F2FE', '#DCFCE7'];
    const idx = themeColors.indexOf(ws.themeColor || '#FAF6F1');
    const next = themeColors[(idx === -1 ? 0 : idx + 1) % themeColors.length];
    setWorkspaces((prev) => prev.map((w) => (w.id === ws.id ? { ...w, themeColor: next } : w)));
    await updateCanvasTheme(ws.id, next);
  };

  const handleDuplicate = async (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    await duplicateCanvas(ws.id);
    await refresh();
  };

  const handleDownload = (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    exportBoardById(ws.id, ws.title || 'untitled canvas');
  };

  const handleDeleteForever = async (e: React.MouseEvent, ws: WorkspaceWithStats) => {
    e.stopPropagation();
    if (armedDeleteId !== ws.id) {
      setArmedDeleteId(ws.id);
      setTimeout(() => setArmedDeleteId((cur) => (cur === ws.id ? null : cur)), 4000);
      return;
    }
    setArmedDeleteId(null);
    setWorkspaces((prev) => prev.filter((w) => w.id !== ws.id));
    await deleteCanvasPermanently(ws.id);
  };

  const trashCount = workspaces.filter((w) => w.deleted).length;

  const handleEmptyTrash = async () => {
    if (!armedEmptyTrash) {
      setArmedEmptyTrash(true);
      setTimeout(() => setArmedEmptyTrash(false), 4000);
      return;
    }
    setArmedEmptyTrash(false);
    const doomed = workspaces.filter((w) => w.deleted);
    setWorkspaces((prev) => prev.filter((w) => !w.deleted));
    for (const ws of doomed) await deleteCanvasPermanently(ws.id);
  };

  const startRenaming = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenamingTitle(currentTitle);
  };
  const saveRename = async (id: string) => {
    const finalTitle = renamingTitle.trim() || 'untitled canvas';
    setRenamingId(null);
    await patchWorkspace(id, { title: finalTitle });
  };

  /* ---------- derived data ---------- */

  const nonDeleted = workspaces.filter((w) => !w.deleted && !w.archived);
  const totalCanvases = nonDeleted.length;
  const totalCards = nonDeleted.reduce((s, w) => s + w.objectCount, 0);
  const totalSketches = nonDeleted.reduce((s, w) => s + w.strokeCount, 0);
  const totalThreads = nonDeleted.reduce((s, w) => s + w.connectionCount, 0);

  const continueWorkspace = nonDeleted.length > 0
    ? [...nonDeleted].sort((a, b) => b.lastModified - a.lastModified)[0]
    : null;

  const filteredList = useMemo(() => {
    let list = [...workspaces];
    if (activeSidebarTab === 'favorites') list = list.filter((w) => w.isFavorite && !w.deleted && !w.archived);
    else if (activeSidebarTab === 'archive') list = list.filter((w) => w.archived && !w.deleted);
    else if (activeSidebarTab === 'deleted') list = list.filter((w) => w.deleted);
    else list = list.filter((w) => !w.deleted && !w.archived);

    if (activeSidebarTab === 'home' && activeCategory !== 'all') {
      list = list.filter((w) => w.category === activeCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (w) =>
          (w.title || 'untitled canvas').toLowerCase().includes(q) ||
          (w.category || '').toLowerCase().includes(q) ||
          w.objects.some((o) => o.content.toLowerCase().includes(q))
      );
    }

    if (sortMode === 'recent') list.sort((a, b) => b.lastModified - a.lastModified);
    else if (sortMode === 'name') list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else list.sort((a, b) => b.objectCount - a.objectCount);

    return list;
  }, [workspaces, activeSidebarTab, activeCategory, searchQuery, sortMode]);

  const counts = useMemo(() => {
    const activeCanvases = workspaces.filter((w) => !w.deleted && !w.archived);
    const obj: Record<string, number> = {
      all: activeCanvases.length,
    };
    categories.forEach((cat) => {
      obj[cat] = activeCanvases.filter((w) => w.category === cat).length;
    });
    return obj;
  }, [workspaces, categories]);

  const canvasTitleById = useMemo(() => {
    const map = new Map<string, string>();
    workspaces.forEach((w) => map.set(w.id, w.title || 'untitled canvas'));
    return map;
  }, [workspaces]);

  const imageObjects = useMemo(
    () => (galleryObjects || []).filter((o) => o.type === 'image' && o.content?.startsWith('data:')),
    [galleryObjects]
  );
  const checkpointObjects = useMemo(
    () => (galleryObjects || []).filter((o) => o.style?.isCheckpoint),
    [galleryObjects]
  );

  if (!mounted) return null;

  const isCollectionTab = activeSidebarTab !== 'images' && activeSidebarTab !== 'checkpoints' && activeSidebarTab !== 'chat';
  const sectionTitles: Record<SidebarTab, string> = {
    home: 'all canvases',
    favorites: 'favorite canvases',
    images: 'image library',
    checkpoints: 'checkpoints',
    chat: 'chat',
    archive: 'archived',
    deleted: 'trash',
  };

  /* ============================================================
     Render
     ============================================================ */

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex overflow-x-hidden relative paper-texture">
      <div className="noise-overlay" />

      {/* ---------- Floating clay dock ---------- */}
      <aside className="w-[92px] h-screen sticky top-0 z-40 flex items-center shrink-0">
        <nav
          aria-label="Main navigation"
          className="clay-card ml-4 rounded-[26px] py-5 px-2.5 flex flex-col items-center gap-1.5 max-h-[calc(100vh-48px)]"
        >
          <DockButton label="Home" active={activeSidebarTab === 'home'} onClick={() => setActiveSidebarTab('home')} icon={ICONS.home} />
          <DockButton label="Favorites" active={activeSidebarTab === 'favorites'} onClick={() => setActiveSidebarTab('favorites')} icon={ICONS.heart} />
          <DockButton label="Images" active={activeSidebarTab === 'images'} onClick={() => setActiveSidebarTab('images')} icon={ICONS.image} />
          <DockButton label="Checkpoints" active={activeSidebarTab === 'checkpoints'} onClick={() => setActiveSidebarTab('checkpoints')} icon={ICONS.flag} />
          <DockButton label="Chat" active={activeSidebarTab === 'chat'} onClick={() => setActiveSidebarTab('chat')} icon={ICONS.chat} badge={chatUnread || undefined} />

          <div className="w-8 h-px bg-[var(--border-strong)] opacity-50 my-2" />

          <DockButton label="Archive" active={activeSidebarTab === 'archive'} onClick={() => setActiveSidebarTab('archive')} icon={ICONS.archive} />
          <DockButton label="Trash" active={activeSidebarTab === 'deleted'} onClick={() => setActiveSidebarTab('deleted')} icon={ICONS.trash} badge={trashCount || undefined} />
        </nav>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="flex-1 min-h-screen h-screen overflow-y-auto">
        <div className="w-full max-w-6xl mx-auto px-6 md:px-10 pt-10 pb-28 flex flex-col gap-12">

          {/* Header */}
          <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end gap-6 w-full">
            <div className="min-w-0">
              {isEditingUsername ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    onBlur={handleUsernameSave}
                    onKeyDown={(e) => e.key === 'Enter' && handleUsernameSave()}
                    aria-label="Your name"
                    className="text-4xl md:text-5xl italic bg-transparent border-b-2 border-[var(--accent)] outline-none text-[var(--text-primary)] max-w-[300px]"
                    style={{ fontFamily: "'Instrument Serif', serif" }}
                    autoFocus
                  />
                </div>
              ) : (
                <h1
                  onClick={() => setIsEditingUsername(true)}
                  title="Click to edit your name"
                  className="text-4xl md:text-5xl italic font-light tracking-tight cursor-pointer leading-none group"
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                >
                  {greeting},{' '}
                  <span className="text-[var(--accent)] underline decoration-dotted decoration-2 decoration-[var(--accent)]/30 underline-offset-4 group-hover:decoration-[var(--accent)]/70 transition-all">
                    {username}
                  </span>
                </h1>
              )}

              {/* Honest live stats strip */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] font-medium text-[var(--text-secondary)] select-none tabular-nums">
                <span>{getFormattedDate()}</span>
                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
                <span><strong className="text-[var(--accent)] font-bold">{totalCanvases}</strong> canvases</span>
                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
                <span><strong className="text-[var(--text-primary)] font-bold">{totalCards}</strong> cards</span>
                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
                <span><strong className="text-[var(--text-primary)] font-bold">{totalSketches}</strong> sketches</span>
                <span className="w-1 h-1 rounded-full bg-[var(--text-muted)]" />
                <span><strong className="text-[var(--text-primary)] font-bold">{totalThreads}</strong> threads</span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {/* Liquid-glass search */}
              <div className="glass-bar relative flex items-center rounded-full pl-4 pr-2 py-2.5 w-full sm:w-80 focus-within:ring-2 focus-within:ring-[var(--accent)]/35 transition-shadow">
                <span className="text-[var(--text-tertiary)] mr-2.5 shrink-0">{ICONS.search}</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="search titles & card contents"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search canvases and card contents"
                  className="bg-transparent border-none outline-none text-[13px] w-full placeholder-[var(--text-muted)] text-[var(--text-primary)] font-medium"
                />
                {searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5 transition-colors cursor-pointer"
                  >
                    <Icon size={13}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
                  </button>
                ) : (
                  <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-bold text-[var(--text-tertiary)] bg-white/70 dark:bg-white/10 px-2 py-1 rounded-full border border-[var(--border)] select-none shrink-0">
                    ⌘K
                  </kbd>
                )}
              </div>
              <AuthButton isInline={true} />
            </div>
          </header>

          {/* ---------- Loading skeleton ---------- */}
          {isLoading && (
            <div className="flex flex-col gap-12" aria-hidden="true">
              <div className="clay-skeleton rounded-[28px] h-56 w-full" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {[0, 1, 2, 3].map((i) => <div key={i} className="clay-skeleton rounded-3xl h-44" />)}
              </div>
            </div>
          )}

          {/* ---------- HOME: Continue card ---------- */}
          <AnimatePresence mode="popLayout">
            {!isLoading && activeSidebarTab === 'home' && continueWorkspace && !searchQuery && (
              <motion.section
                key="continue"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={spring}
                className="w-full"
              >
                <div className="clay-card rounded-[28px] p-7 md:p-9 grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-8 items-center relative overflow-hidden group">
                  {/* soft accent bloom */}
                  <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[radial-gradient(circle,rgba(var(--accent-rgb),0.10),transparent_65%)] pointer-events-none" />

                  <div className="flex flex-col items-start gap-5 min-w-0">
                    <span className="inline-flex items-center gap-2 text-[10px] text-[var(--accent)] uppercase font-extrabold tracking-[0.18em]">
                      <span className="relative flex w-2 h-2">
                        {!reducedMotion && <span className="absolute inline-flex w-full h-full rounded-full bg-[var(--accent)] opacity-60 animate-ping" />}
                        <span className="relative inline-flex w-2 h-2 rounded-full bg-[var(--accent)]" />
                      </span>
                      Continue where you left off
                    </span>

                    <div className="min-w-0">
                      <h2
                        onClick={() => router.push(`/canvas?id=${continueWorkspace.id}`)}
                        className="text-3xl md:text-[2.6rem] leading-[1.05] italic text-[var(--text-primary)] hover:text-[var(--accent)] cursor-pointer transition-colors truncate"
                        style={{ fontFamily: "'Instrument Serif', serif" }}
                      >
                        {continueWorkspace.title || 'untitled canvas'}
                      </h2>
                      <p className="text-[11px] text-[var(--text-tertiary)] mt-2 font-medium tabular-nums">
                        edited {getRelativeTime(continueWorkspace.lastModified)} · {continueWorkspace.category || 'personal'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatChip icon={ICONS.cards} label={`${continueWorkspace.objectCount} cards`} />
                      <StatChip icon={ICONS.sketch} label={`${continueWorkspace.strokeCount} sketches`} />
                      <StatChip icon={ICONS.thread} label={`${continueWorkspace.connectionCount} threads`} />
                    </div>

                    <motion.button
                      onClick={() => router.push(`/canvas?id=${continueWorkspace.id}`)}
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.97 }}
                      transition={spring}
                      className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-white text-xs font-bold tracking-wide shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
                    >
                      Open canvas {ICONS.arrowRight}
                    </motion.button>
                  </div>

                  {/* Preview recess */}
                  <motion.div
                    onClick={() => router.push(`/canvas?id=${continueWorkspace.id}`)}
                    whileHover={{ scale: 1.015 }}
                    transition={spring}
                    className="clay-inset w-full h-48 md:h-56 rounded-2xl overflow-hidden relative cursor-pointer"
                  >
                    <CanvasMiniPreview
                      objects={continueWorkspace.objects}
                      connections={continueWorkspace.connections}
                      width={380}
                      height={220}
                    />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-[rgba(90,62,40,0.12)] to-transparent flex items-end justify-end p-3 pointer-events-none">
                      <span className="glass-bar text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full text-[var(--text-primary)]">
                        open
                      </span>
                    </div>
                  </motion.div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ---------- HOME: Recently visited ---------- */}
          {!isLoading && activeSidebarTab === 'home' && !searchQuery && nonDeleted.length > 0 && (
            <section className="w-full flex flex-col gap-4">
              <div className="flex justify-between items-baseline">
                <h3 className="text-[11px] uppercase font-extrabold tracking-[0.18em] text-[var(--text-secondary)]">Recently visited</h3>
              </div>

              <motion.div
                initial="hidden"
                animate="show"
                variants={{ hidden: {}, show: { transition: { staggerChildren: reducedMotion ? 0 : 0.06 } } }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full"
              >
                {[...nonDeleted].sort((a, b) => b.lastModified - a.lastModified).slice(0, 4).map((ws) => (
                  <motion.div
                    key={ws.id}
                    variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: spring } }}
                    whileHover={{ y: -5 }}
                    onClick={() => router.push(`/canvas?id=${ws.id}`)}
                    className="clay-card rounded-3xl overflow-hidden p-3 flex flex-col gap-3 group cursor-pointer"
                  >
                    <div className="clay-inset h-32 rounded-2xl relative overflow-hidden">
                      <CanvasMiniPreview objects={ws.objects} connections={ws.connections} width={220} height={128} />
                    </div>
                    <div className="px-1.5 pb-1 flex justify-between items-center gap-2">
                      <div className="min-w-0">
                        <h4 className="text-[15px] font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                          {ws.title || 'untitled canvas'}
                        </h4>
                        <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 tabular-nums">
                          {getRelativeTime(ws.lastModified)} · {ws.objectCount} cards
                        </p>
                      </div>
                      <motion.button
                        onClick={(e) => toggleFavorite(e, ws)}
                        whileTap={{ scale: 1.35 }}
                        transition={spring}
                        aria-label={ws.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        className={`p-2 rounded-full shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
                          ws.isFavorite ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--accent)]'
                        }`}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill={ws.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      </motion.button>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </section>
          )}

          {/* ---------- IMAGES TAB ---------- */}
          {!isLoading && activeSidebarTab === 'images' && (
            <section className="w-full flex flex-col gap-5">
              <SectionHeading title={sectionTitles.images} count={imageObjects.length} />
              {galleryObjects === null ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="clay-skeleton rounded-3xl h-40" />)}
                </div>
              ) : imageObjects.length === 0 ? (
                <EmptyState
                  icon={ICONS.image}
                  title="No images yet"
                  body="Drop or paste an image onto any canvas and it will appear here."
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                  {imageObjects.map((img) => (
                    <motion.button
                      key={img.id}
                      whileHover={{ y: -4 }}
                      transition={spring}
                      onClick={() => router.push(`/canvas?id=${img.parentId || 'root'}`)}
                      className="clay-card rounded-3xl overflow-hidden p-2 group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                    >
                      <div className="clay-inset rounded-2xl overflow-hidden aspect-[4/3]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.content} alt="Canvas image" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      </div>
                      <p className="text-[10px] font-semibold text-[var(--text-secondary)] px-2 py-2 truncate">
                        in {canvasTitleById.get(img.parentId || '') || 'home workspace'}
                      </p>
                    </motion.button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ---------- CHECKPOINTS TAB ---------- */}
          {!isLoading && activeSidebarTab === 'checkpoints' && (
            <section className="w-full flex flex-col gap-5">
              <SectionHeading title={sectionTitles.checkpoints} count={checkpointObjects.length} />
              {galleryObjects === null ? (
                <div className="flex flex-col gap-3">
                  {[0, 1, 2].map((i) => <div key={i} className="clay-skeleton rounded-2xl h-16" />)}
                </div>
              ) : checkpointObjects.length === 0 ? (
                <EmptyState
                  icon={ICONS.flag}
                  title="No checkpoints planted"
                  body="Plant a checkpoint flag on a canvas to bookmark a spot — they all gather here."
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {checkpointObjects.map((cp) => (
                    <motion.button
                      key={cp.id}
                      whileHover={{ x: 4 }}
                      transition={spring}
                      onClick={() => router.push(`/canvas?id=${cp.parentId || 'root'}`)}
                      className="clay-card rounded-2xl px-5 py-4 flex items-center gap-4 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                    >
                      <span className="w-9 h-9 rounded-xl clay-inset flex items-center justify-center text-[var(--accent)] shrink-0">
                        {ICONS.flag}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[13px] font-bold truncate">{cp.content || 'Unnamed checkpoint'}</h4>
                        <p className="text-[10px] text-[var(--text-tertiary)] truncate">
                          in {canvasTitleById.get(cp.parentId || '') || 'home workspace'}
                        </p>
                      </div>
                      <span className="text-[var(--text-muted)]">{ICONS.arrowRight}</span>
                    </motion.button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ---------- CHAT TAB ---------- */}
          {!isLoading && activeSidebarTab === 'chat' && (
            <section className="w-full flex flex-col gap-5 h-[calc(100vh-180px)]">
              <SectionHeading title={sectionTitles.chat} />
              <ChatPanel mode="embedded" />
            </section>
          )}

          {/* ---------- COLLECTION SECTIONS (home / favorites / archive / trash) ---------- */}
          {!isLoading && isCollectionTab && (
            <section className="w-full flex flex-col gap-6">
              <div className="flex flex-wrap justify-between items-center gap-x-6 gap-y-4 border-b border-[var(--border)] pb-5">
                <SectionHeading
                  title={sectionTitles[activeSidebarTab]}
                  count={filteredList.length}
                  sub={searchQuery ? `matching "${searchQuery}"` : undefined}
                />

                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {/* Trash: empty-trash action */}
                  {activeSidebarTab === 'deleted' && trashCount > 0 && (
                    <button
                      onClick={handleEmptyTrash}
                      className={`px-4 py-2 rounded-full text-[11px] font-bold tracking-wide transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 ${
                        armedEmptyTrash
                          ? 'bg-red-500 text-white shadow-[0_8px_18px_-6px_rgba(239,68,68,0.6)]'
                          : 'clay-inset text-red-600/80 hover:text-red-600'
                      }`}
                    >
                      {armedEmptyTrash ? `Confirm — erase ${trashCount} forever` : 'Empty trash'}
                    </button>
                  )}

                  {/* Sort menu */}
                  <div className="relative" ref={sortMenuRef}>
                    <button
                      onClick={() => setSortMenuOpen((o) => !o)}
                      aria-haspopup="listbox"
                      aria-expanded={sortMenuOpen}
                      className="clay-inset flex items-center gap-1.5 px-4 py-2 rounded-full text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                    >
                      {sortMode === 'recent' ? 'recent' : sortMode === 'name' ? 'a → z' : 'most cards'}
                      {ICONS.chevron}
                    </button>
                    <AnimatePresence>
                      {sortMenuOpen && (
                        <motion.ul
                          role="listbox"
                          initial={{ opacity: 0, y: -6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.96 }}
                          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                          className="glass-bar absolute right-0 top-full mt-2 rounded-2xl p-1.5 flex flex-col w-36 z-30"
                        >
                          {(['recent', 'name', 'cards'] as SortMode[]).map((mode) => (
                            <li key={mode}>
                              <button
                                role="option"
                                aria-selected={sortMode === mode}
                                onClick={() => { setSortMode(mode); setSortMenuOpen(false); }}
                                className={`w-full text-left px-3 py-2 rounded-xl text-[11px] font-bold transition-colors cursor-pointer ${
                                  sortMode === mode ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'
                                }`}
                              >
                                {mode === 'recent' ? 'Most recent' : mode === 'name' ? 'Name a → z' : 'Most cards'}
                              </button>
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* divider between control groups */}
                  <span className="w-px h-6 bg-[var(--border)] mx-0.5" aria-hidden="true" />

                  {/* Grid / list segmented toggle with sliding thumb */}
                  <div className="clay-inset flex p-1 rounded-full" role="tablist" aria-label="Layout mode">
                    {(['grid', 'list'] as const).map((mode) => (
                      <button
                        key={mode}
                        role="tab"
                        aria-selected={layoutMode === mode}
                        onClick={() => setLayoutMode(mode)}
                        className={`relative px-4 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${
                          layoutMode === mode ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                        }`}
                      >
                        {layoutMode === mode && (
                          <motion.span
                            layoutId="layout-thumb"
                            transition={spring}
                            className="absolute inset-0 bg-white dark:bg-white/15 rounded-full shadow-[0_2px_6px_rgba(90,62,40,0.15),inset_0_1px_0_rgba(255,255,255,1)] dark:shadow-none"
                          />
                        )}
                        <span className="relative">{mode}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Category pills (home only) */}
              {activeSidebarTab === 'home' && (
                <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Category filter">
                  {/* ALL button */}
                  <button
                    role="tab"
                    aria-selected={activeCategory === 'all'}
                    onClick={() => setActiveCategory('all')}
                    className={`relative inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
                      activeCategory === 'all' ? 'text-white' : 'clay-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {activeCategory === 'all' && (
                      <motion.span
                        layoutId="category-thumb"
                        transition={spring}
                        className="absolute inset-0 bg-[#2D2A26] dark:bg-[var(--accent)] rounded-full shadow-[0_8px_16px_-6px_rgba(45,42,38,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]"
                      />
                    )}
                    <span className="relative">all</span>
                    <span className={`relative text-[9px] px-1.5 py-0.5 rounded-full font-extrabold tabular-nums ${activeCategory === 'all' ? 'bg-white/20' : 'bg-white/70 dark:bg-white/10 border border-[var(--border)]'}`}>
                      {counts.all}
                    </span>
                  </button>

                  {/* Dynamic Category Pills */}
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      role="tab"
                      aria-selected={activeCategory === cat}
                      onClick={() => {
                        if (activeCategory === cat) {
                          setEditingCategory(cat);
                          setEditingCategoryValue(cat);
                        } else {
                          setActiveCategory(cat);
                        }
                      }}
                      className={`relative inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
                        activeCategory === cat ? 'text-white' : 'clay-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {activeCategory === cat && (
                        <motion.span
                          layoutId="category-thumb"
                          transition={spring}
                          className="absolute inset-0 bg-[#2D2A26] dark:bg-[var(--accent)] rounded-full shadow-[0_8px_16px_-6px_rgba(45,42,38,0.5),inset_0_1px_0_rgba(255,255,255,0.15)]"
                        />
                      )}
                      {editingCategory === cat ? (
                        <input
                          type="text"
                          value={editingCategoryValue}
                          onChange={(e) => setEditingCategoryValue(e.target.value)}
                          onBlur={() => handleRenameCategory(cat, editingCategoryValue)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameCategory(cat, editingCategoryValue);
                            if (e.key === 'Escape') setEditingCategory(null);
                          }}
                          className="bg-transparent text-white font-bold outline-none border-b border-white/50 w-24 text-[11px] uppercase tracking-wider relative z-10"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="relative">{cat}</span>
                      )}
                      <span className={`relative text-[9px] px-1.5 py-0.5 rounded-full font-extrabold tabular-nums ${activeCategory === cat ? 'bg-white/20' : 'bg-white/70 dark:bg-white/10 border border-[var(--border)]'}`}>
                        {counts[cat] || 0}
                      </span>
                    </button>
                  ))}

                  {/* Add Custom Category button */}
                  <button
                    onClick={addCategory}
                    title="Add Category"
                    className="w-7 h-7 rounded-full bg-[rgba(var(--accent-rgb),0.08)] hover:bg-[rgba(var(--accent-rgb),0.13)] border border-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ml-1 shrink-0"
                  >
                    {ICONS.plus}
                  </button>
                </div>
              )}

              {/* Cards */}
              {filteredList.length > 0 ? (
                layoutMode === 'grid' ? (
                  <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                    <AnimatePresence mode="popLayout">
                      {filteredList.map((ws) => (
                        <motion.div
                          key={ws.id}
                          layout
                          initial={{ opacity: 0, scale: 0.94 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.94 }}
                          transition={spring}
                          whileHover={{ y: -4 }}
                          onClick={() => router.push(`/canvas?id=${ws.id}`)}
                          className="clay-card rounded-3xl p-5 flex items-center justify-between group cursor-pointer relative"
                        >
                          <div className="flex items-center gap-4 min-w-0 flex-1 pr-2">
                            <button
                              onClick={(e) => cycleCategory(e, ws)}
                              title={`Category: ${ws.category || 'personal'} — click to change`}
                              aria-label={`Change category, currently ${ws.category || 'personal'}`}
                              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 cursor-pointer transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
                                ws.category === 'work'
                                  ? 'bg-[#E0F2FE] text-[#3B7DA8]'
                                  : ws.category === 'study'
                                  ? 'bg-[#F3E8FF] text-[#8B5FBF]'
                                  : ws.category === 'personal'
                                  ? 'bg-[#FDEBD8] text-[var(--accent)]'
                                  : 'bg-[#DCFCE7] text-[#15803D]'
                              } shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_4px_10px_-4px_rgba(90,62,40,0.2)]`}
                            >
                              {ws.category === 'work' ? (
                                <Icon><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></Icon>
                              ) : ws.category === 'study' ? (
                                <Icon><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></Icon>
                              ) : ws.category === 'personal' ? (
                                <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              ) : (
                                <Icon><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z" /><line x1="7" y1="7" x2="7.01" y2="7" /></Icon>
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              {renamingId === ws.id ? (
                                <input
                                  type="text"
                                  value={renamingTitle}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setRenamingTitle(e.target.value)}
                                  onBlur={() => saveRename(ws.id)}
                                  onKeyDown={(e) => e.key === 'Enter' && saveRename(ws.id)}
                                  aria-label="Canvas title"
                                  className="text-sm font-bold border-b-2 border-[var(--accent)] outline-none bg-transparent w-full"
                                  autoFocus
                                />
                              ) : (
                                <h4 className="text-[16px] font-semibold truncate group-hover:text-[var(--accent)] transition-colors flex items-center gap-1.5 tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
                                  {ws.title || 'untitled canvas'}
                                  {ws.isFavorite && (
                                    <span className="text-[var(--accent)] shrink-0" aria-label="Favorite">
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                      </svg>
                                    </span>
                                  )}
                                </h4>
                              )}
                              <p className="text-[10px] text-[var(--text-secondary)] mt-1 truncate tabular-nums">
                                {ws.objectCount} cards · {getRelativeTime(ws.lastModified)}
                              </p>
                            </div>
                          </div>

                          {/* Hover actions */}
                          <div
                            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {activeSidebarTab === 'deleted' ? (
                              <>
                                <CardAction label="Restore" onClick={(e) => toggleDelete(e, ws)} icon={ICONS.restore} />
                                <button
                                  onClick={(e) => handleDeleteForever(e, ws)}
                                  aria-label={armedDeleteId === ws.id ? 'Confirm permanent delete' : 'Delete forever'}
                                  className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 ${
                                    armedDeleteId === ws.id ? 'bg-red-500 text-white' : 'text-red-500/70 hover:text-red-500 hover:bg-red-50'
                                  }`}
                                >
                                  {armedDeleteId === ws.id ? 'sure?' : ICONS.trash}
                                </button>
                              </>
                            ) : (
                              <>
                                <CardAction
                                  label={ws.isFavorite ? 'Unfavorite' : 'Favorite'}
                                  onClick={(e) => toggleFavorite(e, ws)}
                                  active={!!ws.isFavorite}
                                  icon={
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill={ws.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                    </svg>
                                  }
                                />
                                <CardAction label="Rename" onClick={(e) => startRenaming(e, ws.id, ws.title || '')} icon={ICONS.pencil} />
                                <CardAction label="Duplicate" onClick={(e) => handleDuplicate(e, ws)} icon={ICONS.copy} />
                                <CardAction label="Download (.json)" onClick={(e) => handleDownload(e, ws)} icon={ICONS.download} />
                                <CardAction label="Cycle color" onClick={(e) => handleColorCycle(e, ws)} icon={ICONS.palette} />
                                <CardAction label={ws.archived ? 'Unarchive' : 'Archive'} onClick={(e) => toggleArchive(e, ws)} active={!!ws.archived} icon={<Icon size={14}><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /></Icon>} />
                                <CardAction label="Move to trash" onClick={(e) => toggleDelete(e, ws)} danger icon={<Icon size={14}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></Icon>} />
                              </>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {activeSidebarTab === 'home' && !searchQuery && (
                      <motion.button
                        layout
                        onClick={openNewCanvas}
                        whileHover={{ y: -4 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring}
                        className="border-2 border-dashed border-[var(--border-strong)] hover:border-[var(--accent)]/50 rounded-3xl p-5 flex items-center justify-center gap-3 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors min-h-[92px] group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                      >
                        <span className="group-hover:rotate-90 transition-transform duration-300">{ICONS.plus}</span>
                        <span className="text-[11px] font-extrabold uppercase tracking-widest">new canvas</span>
                      </motion.button>
                    )}
                  </motion.div>
                ) : (
                  /* LIST VIEW */
                  <div className="clay-card w-full rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left min-w-[640px]">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[#FAF6F1]/60 dark:bg-white/5 text-[10px] uppercase font-extrabold tracking-[0.15em] text-[var(--text-secondary)] select-none">
                            <th className="py-4 px-6">Title</th>
                            <th className="py-4 px-6">Category</th>
                            <th className="py-4 px-6">Contents</th>
                            <th className="py-4 px-6">Edited</th>
                            <th className="py-4 px-6 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredList.map((ws) => (
                            <tr
                              key={ws.id}
                              onClick={() => router.push(`/canvas?id=${ws.id}`)}
                              className="border-b border-[var(--border)] last:border-b-0 hover:bg-[#FAF6F1]/50 dark:hover:bg-white/5 cursor-pointer transition-colors group"
                            >
                              <td className="py-4 px-6 font-semibold text-[16px] tracking-tight group-hover:text-[var(--accent)] transition-colors" style={{ fontFamily: "'Playfair Display', serif" }}>
                                <span className="flex items-center gap-1.5">
                                  {ws.title || 'untitled canvas'}
                                  {ws.isFavorite && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent)" aria-label="Favorite">
                                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                    </svg>
                                  )}
                                </span>
                              </td>
                              <td className="py-4 px-6">
                                <span className="px-2.5 py-1 rounded-full text-[9px] uppercase tracking-wider font-extrabold clay-inset text-[var(--text-secondary)]">
                                  {ws.category || 'personal'}
                                </span>
                              </td>
                              <td className="py-4 px-6 text-xs text-[var(--text-secondary)] tabular-nums">
                                {ws.objectCount} cards · {ws.strokeCount} sketches · {ws.connectionCount} threads
                              </td>
                              <td className="py-4 px-6 text-xs text-[var(--text-secondary)] tabular-nums">{getRelativeTime(ws.lastModified)}</td>
                              <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex justify-end gap-0.5">
                                  {activeSidebarTab === 'deleted' ? (
                                    <>
                                      <CardAction label="Restore" onClick={(e) => toggleDelete(e, ws)} icon={ICONS.restore} />
                                      <button
                                        onClick={(e) => handleDeleteForever(e, ws)}
                                        aria-label="Delete forever"
                                        className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold transition-all cursor-pointer ${
                                          armedDeleteId === ws.id ? 'bg-red-500 text-white' : 'text-red-500/70 hover:text-red-500 hover:bg-red-50'
                                        }`}
                                      >
                                        {armedDeleteId === ws.id ? 'sure?' : ICONS.trash}
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <CardAction
                                        label={ws.isFavorite ? 'Unfavorite' : 'Favorite'}
                                        onClick={(e) => toggleFavorite(e, ws)}
                                        active={!!ws.isFavorite}
                                        icon={
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill={ws.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                          </svg>
                                        }
                                      />
                                      <CardAction label="Duplicate" onClick={(e) => handleDuplicate(e, ws)} icon={ICONS.copy} />
                                      <CardAction label="Download (.json)" onClick={(e) => handleDownload(e, ws)} icon={ICONS.download} />
                                      <CardAction label={ws.archived ? 'Unarchive' : 'Archive'} onClick={(e) => toggleArchive(e, ws)} active={!!ws.archived} icon={<Icon size={14}><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /></Icon>} />
                                      <CardAction label="Move to trash" onClick={(e) => toggleDelete(e, ws)} danger icon={<Icon size={14}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></Icon>} />
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ) : (
                <EmptyState
                  icon={
                    activeSidebarTab === 'deleted' ? ICONS.trash :
                    activeSidebarTab === 'archive' ? ICONS.archive :
                    activeSidebarTab === 'favorites' ? ICONS.heart :
                    ICONS.search
                  }
                  title={
                    searchQuery ? 'Nothing matches' :
                    activeSidebarTab === 'deleted' ? 'Trash is empty' :
                    activeSidebarTab === 'archive' ? 'Nothing archived' :
                    activeSidebarTab === 'favorites' ? 'No favorites yet' :
                    'No canvases here'
                  }
                  body={
                    searchQuery ? `No canvas or card matches "${searchQuery}". Try a different word.` :
                    activeSidebarTab === 'deleted' ? 'Canvases you trash land here for safekeeping until you erase them.' :
                    activeSidebarTab === 'archive' ? 'Archive canvases you want out of the way but not gone.' :
                    activeSidebarTab === 'favorites' ? 'Tap the heart on any canvas to pin it here.' :
                    'Create your first canvas to get started.'
                  }
                  action={
                    !searchQuery && activeSidebarTab === 'home'
                      ? { label: 'Create a canvas', onClick: openNewCanvas }
                      : undefined
                  }
                />
              )}
            </section>
          )}

          {/* Footer hint */}
          <footer className="flex justify-center pt-4 select-none">
            <p className="text-[10px] font-medium text-[var(--text-muted)] tracking-wide">
              <kbd className="px-1.5 py-0.5 rounded bg-white/70 dark:bg-white/10 border border-[var(--border)] font-mono text-[9px]">⌘K</kbd> search
              <span className="mx-2">·</span>
              click your name to edit it
              <span className="mx-2">·</span>
              everything saves on this device
            </p>
          </footer>
        </div>
      </main>

      {/* ---------- FAB ---------- */}
      <motion.button
        onClick={openNewCanvas}
        whileHover={{ scale: 1.06, y: -2 }}
        whileTap={{ scale: 0.94 }}
        transition={spring}
        aria-label="Create new canvas"
        className="fixed bottom-8 right-8 h-14 pl-4 pr-5 bg-[var(--accent)] text-white rounded-full flex items-center gap-2 z-50 cursor-pointer shadow-[0_16px_32px_-10px_rgba(var(--accent-rgb),0.65),inset_0_1.5px_0_rgba(255,255,255,0.35)] hover:brightness-105 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span className="text-xs font-extrabold uppercase tracking-widest max-w-0 overflow-hidden group-hover:max-w-[110px] transition-[max-width] duration-300 whitespace-nowrap">
          new canvas
        </span>
      </motion.button>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function DockButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`relative w-11 h-11 rounded-2xl flex items-center justify-center transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
        active ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {active && (
        <motion.span
          layoutId="dock-active"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="absolute inset-0 rounded-2xl clay-inset"
        />
      )}
      <span className="relative">{icon}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[var(--accent)] text-white text-[9px] font-extrabold flex items-center justify-center tabular-nums shadow-sm">
          {badge}
        </span>
      )}
      {/* Tooltip */}
      <span className="absolute left-full ml-3 px-2.5 py-1.5 rounded-xl glass-bar text-[10px] font-bold text-[var(--text-primary)] whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all pointer-events-none z-50">
        {label}
      </span>
    </button>
  );
}

function SectionHeading({ title, count, sub }: { title: string; count?: number; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3 min-w-0">
      <h3 className="text-[11px] uppercase font-extrabold tracking-[0.18em] text-[var(--text-secondary)]">{title}</h3>
      {count !== undefined && (
        <span className="text-[10px] font-extrabold text-[var(--text-muted)] tabular-nums">{count}</span>
      )}
      {sub && <span className="text-[10px] text-[var(--text-tertiary)] italic truncate">{sub}</span>}
    </div>
  );
}

function StatChip({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 clay-inset rounded-full text-[10px] text-[var(--text-secondary)] font-bold select-none tabular-nums">
      <span className="opacity-70">{icon}</span>
      {label}
    </span>
  );
}

function CardAction({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`p-2 rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
        danger
          ? 'text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-50'
          : active
          ? 'text-[var(--accent)] hover:bg-[var(--accent-subtle)]'
          : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5'
      }`}
    >
      {icon}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="clay-card text-center py-14 px-6 rounded-[28px] flex flex-col items-center"
    >
      <span className="w-14 h-14 rounded-3xl clay-inset flex items-center justify-center text-[var(--text-tertiary)] mb-4">
        {icon}
      </span>
      <h4 className="text-sm font-bold text-[var(--text-primary)]">{title}</h4>
      <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-xs mx-auto leading-relaxed">{body}</p>
      {action && (
        <motion.button
          onClick={action.onClick}
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          transition={spring}
          className="mt-5 px-5 py-2.5 bg-[var(--accent)] text-white text-xs font-bold rounded-full cursor-pointer shadow-[0_10px_22px_-8px_rgba(var(--accent-rgb),0.6),inset_0_1px_0_rgba(255,255,255,0.3)] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
