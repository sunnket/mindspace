'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import {
  getTopLevelCanvasStates,
  CanvasState,
  CanvasObjectData,
  ConnectionData,
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
import { useAuthStore } from '@/store/authStore';
import { exportBoardById } from '@/lib/boardIO';
import { applyCanvasTheme, resetCanvasTheme, presetById, DEFAULT_BACKGROUND } from '@/lib/canvasTheme';
import { CanvasBlueprint, CanvasCardPreview, Highlight } from './CanvasPreview';
import { searchCanvases, type Scored } from '@/lib/canvasSearch';
import { toast } from '@/store/toastStore';
import { useCanvasStore } from '@/store/canvasStore';
import {
  CANVAS_TEMPLATES,
  TEMPLATE_CATEGORIES,
  buildTemplate,
  createCanvasFromTemplate,
  seedStarterCanvasesIfEmpty,
  removeLegacySeedCanvases,
  type CanvasTemplate,
  type TemplateCategory,
} from '@/lib/canvasTemplates';

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

type SidebarTab = 'home' | 'templates' | 'favorites' | 'images' | 'checkpoints' | 'chat' | 'archive' | 'deleted';

/**
 * How the gallery is ordered.
 *
 * `relevance` only exists while something is being searched for, and is the
 * default the moment you start typing — the whole point of scoring results is
 * that the best one is first. `oldest` is the odd one out and earns its place:
 * "what have I not touched in months" is a real question about your own boards
 * that no other ordering answers, and it is the one that finds the thing you
 * forgot you started.
 */
type SortMode = 'relevance' | 'recent' | 'oldest' | 'name' | 'cards';

const SORT_OPTIONS: { id: SortMode; label: string; hint: string; searchOnly?: boolean }[] = [
  { id: 'relevance', label: 'Best match', hint: 'Closest to what you typed', searchOnly: true },
  { id: 'recent', label: 'Recently edited', hint: 'What you touched last' },
  { id: 'oldest', label: 'Forgotten first', hint: 'Untouched the longest' },
  { id: 'name', label: 'Name A → Z', hint: 'Alphabetical by title' },
  { id: 'cards', label: 'Biggest boards', hint: 'Most cards first' },
];

const SORT_SHORT: Record<SortMode, string> = {
  relevance: 'best match',
  recent: 'recent',
  oldest: 'forgotten',
  name: 'a → z',
  cards: 'biggest',
};


const spring = { type: 'spring' as const, stiffness: 260, damping: 26 };

// The global `* { padding:0 }` reset is unlayered, so Tailwind's `p-*`/`px-*`
// utilities are dead — text ends up flush against a card's rounded corner and
// the curve clips the first/last glyphs. Inline padding is the one thing that
// still wins (see the marginTop:'2cm' workaround below), so the card surfaces
// that were relying on dead padding classes get their spacing set inline.
const CARD_TEXT_PAD: React.CSSProperties = { paddingLeft: 14, paddingRight: 12, paddingBottom: 8 };
const GRID_CARD_PAD: React.CSSProperties = { padding: 20 };
const TABLE_CELL_PAD: React.CSSProperties = { padding: '16px 24px' };
const CONTINUE_CARD_PAD: React.CSSProperties = { padding: 32 };
const SEARCH_BAR_PAD: React.CSSProperties = { paddingLeft: 16, paddingRight: 8, paddingTop: 10, paddingBottom: 10 };
// The "All canvases" control strip — sort button, grid/list segmented toggle,
// category pills, count badges — all leaned on dead px-*/py-* utilities, so they
// collapsed and jammed together ("gridlist"). Restore their spacing inline.
const CONTROL_PAD: React.CSSProperties = { padding: '8px 16px' };   // pill / dropdown buttons
const BADGE_PAD: React.CSSProperties = { padding: '2px 7px' };      // count badges
const SEG_TRAY_PAD: React.CSSProperties = { padding: 4 };           // segmented toggle tray
const SEG_BTN_PAD: React.CSSProperties = { padding: '6px 18px' };   // grid / list buttons
const MENU_PAD: React.CSSProperties = { padding: 6 };               // sort dropdown container
const MENU_ITEM_PAD: React.CSSProperties = { padding: '8px 12px' }; // sort dropdown items

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
  templates: <Icon><rect x="3" y="3" width="7.5" height="10" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="6" rx="1.6" /><rect x="3" y="16" width="7.5" height="5" rx="1.6" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.6" /></Icon>,
  sparkle: <Icon size={14}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" /></Icon>,
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
   Canvas preview

   The hand-rolled `CanvasMiniPreview` that used to live here — a scaled-down
   wireframe with every block's label drawn into it as 3–8px SVG text — has
   moved to ./CanvasPreview.tsx and been rebuilt. At thumbnail scale that text
   was not small type, it was texture: the preview showed you rectangles and
   answered "what is in this board?" with "open it and see". See the note at
   the top of that file for what replaced it and why.
   ============================================================ */

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

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState('');
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [armedEmptyTrash, setArmedEmptyTrash] = useState(false);

  // Lazy-loaded gallery data for images / checkpoints tabs
  const [galleryObjects, setGalleryObjects] = useState<CanvasObjectData[] | null>(null);

  // Templates
  const [templateCategory, setTemplateCategory] = useState<TemplateCategory | 'All'>('All');
  const [openingTemplate, setOpeningTemplate] = useState<string | null>(null);
  /* Templates are a first-run aid, not permanent furniture. Once you're signed
     in you have boards of your own, and "start from a template" was pushing them
     down the page every single visit — so for a signed-in user templates live in
     the Templates tab only, which is exactly where you'd go looking for one. */
  const signedIn = !!useAuthStore((s) => s.user);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  /* ---------- data ---------- */

  const refresh = useCallback(async () => {
    const wsStates = await getTopLevelCanvasStates();
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

    const storedCategories = localStorage.getItem('mindspace_categories');
    if (storedCategories) {
      try {
        setCategories(JSON.parse(storedCategories));
      } catch {
        // default
      }
    }

    // Retire the old filler demo boards (only the untouched ones — see
    // removeLegacySeedCanvases), then seed real template canvases if this is a
    // first run. Either way the gallery refreshes once, at the end.
    removeLegacySeedCanvases()
      .then(seedStarterCanvasesIfEmpty)
      .then(refresh)
      .catch(console.error);
  }, [refresh]);

  // The gallery ships on true black. Restore the default palette on unmount so
  // an opened canvas starts from its own theme.
  useEffect(() => {
    applyCanvasTheme(presetById('ink') || DEFAULT_BACKGROUND);
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

  /**
   * Instantiate a template into a brand new canvas and go there.
   * The copy is fully independent — nothing is shared with the template
   * definition, so editing a board can never damage the library.
   */
  const startFromTemplate = async (template: CanvasTemplate) => {
    if (openingTemplate) return;
    setOpeningTemplate(template.id);
    try {
      const newId = await createCanvasFromTemplate(template.id, {
        category: activeCategory === 'all' ? categories[0] || 'personal' : activeCategory,
      });
      if (newId) router.push(`/canvas?id=${newId}`);
      else setOpeningTemplate(null);
    } catch (err) {
      console.error('Failed to create canvas from template:', err);
      setOpeningTemplate(null);
    }
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
      /* Was `alert()` — a modal browser dialog that freezes the page, cannot be
         styled, and lands like a system error on top of a hand-tuned interface,
         for what is merely a naming collision. The rename is abandoned either
         way; the user just needs to know why. */
      toast.error(`There's already a category called "${finalNewName}"`);
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
    try {
      await deleteCanvasPermanently(ws.id);
      /* The card vanishing is ambiguous — it looks the same as a card being
         filtered out of the current view. This is the one action in the app
         with no undo, so it is the one that most needs an explicit receipt
         naming exactly what went. */
      toast.success(`Deleted “${ws.title || 'Untitled canvas'}”`, { detail: 'This one could not be undone.' });
    } catch (err) {
      /* The row was already removed from the list optimistically, so a failure
         here means the screen and the database now disagree — the user has to
         be told, or they will believe a board is gone that is about to
         reappear on the next load. */
      setWorkspaces((prev) => [...prev, ws]);
      toast.error("Couldn't delete that board", {
        detail: err instanceof Error ? err.message : 'It has been put back.',
      });
    }
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
    // Emptying the trash removes several boards at once from a list the user
    // may not have been reading closely. Saying how many landed is the
    // difference between "did that work?" and a completed action.
    if (doomed.length) {
      toast.success(`Trash emptied — ${doomed.length} ${doomed.length === 1 ? 'board' : 'boards'} deleted`);
    }
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

  const continueWorkspace = nonDeleted.length > 0
    ? [...nonDeleted].sort((a, b) => b.lastModified - a.lastModified)[0]
    : null;

  /* Which canvases this tab is about, before any category pill or query. */
  const tabList = useMemo(() => {
    if (activeSidebarTab === 'favorites') return workspaces.filter((w) => w.isFavorite && !w.deleted && !w.archived);
    if (activeSidebarTab === 'archive') return workspaces.filter((w) => w.archived && !w.deleted);
    if (activeSidebarTab === 'deleted') return workspaces.filter((w) => w.deleted);
    return workspaces.filter((w) => !w.deleted && !w.archived);
  }, [workspaces, activeSidebarTab]);

  const scopedList = useMemo(() => {
    if (activeSidebarTab === 'home' && activeCategory !== 'all') {
      return tabList.filter((w) => w.category === activeCategory);
    }
    return tabList;
  }, [tabList, activeSidebarTab, activeCategory]);

  /* The search, scored (lib/canvasSearch.ts). This used to be a `.filter()`
     that returned a boolean, so a canvas came back with no indication of what
     in it had matched — the single worst thing about the old gallery. Now each
     result carries its score, the ranges that matched in its title, and the
     blocks that matched with a snippet apiece. */
  const results = useMemo(
    () => (searchQuery.trim() ? searchCanvases(scopedList, searchQuery) : []),
    [scopedList, searchQuery]
  );

  /** Result metadata by canvas id — the cards read their own hits out of this. */
  const resultById = useMemo(() => {
    const map = new Map<string, Scored<WorkspaceWithStats>>();
    results.forEach((r) => map.set(r.item.id, r));
    return map;
  }, [results]);

  const isSearching = searchQuery.trim().length > 0;

  /* "Best match" cannot mean anything without a query, so when the box empties
     it quietly reads as "recent" instead of leaving the control labelled with
     an ordering that is no longer being applied. One derived value, used by the
     list, the button and the menu alike, so the three can never disagree. */
  const effectiveSort: SortMode = !isSearching && sortMode === 'relevance' ? 'recent' : sortMode;

  const filteredList = useMemo(() => {
    const list = isSearching ? results.map((r) => r.item) : [...scopedList];
    // `relevance` is already the order `searchCanvases` returned, so leave it.
    if (effectiveSort === 'relevance') return list;
    const sorted = [...list];
    if (effectiveSort === 'recent') sorted.sort((a, b) => b.lastModified - a.lastModified);
    else if (effectiveSort === 'oldest') sorted.sort((a, b) => a.lastModified - b.lastModified);
    else if (effectiveSort === 'name') sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    else sorted.sort((a, b) => b.objectCount - a.objectCount);
    return sorted;
  }, [scopedList, results, isSearching, effectiveSort]);

  /** One place a sort is chosen, however it was chosen. */
  const chooseSort = useCallback((mode: SortMode) => {
    sortTouched.current = true;
    setSortMode(mode);
  }, []);

  /** Matching cards across everything, for the "N cards in M boards" read-out. */
  const totalCardHits = useMemo(
    () => results.reduce((n, r) => n + r.totalHits, 0),
    [results]
  );

  /* A category pill and a search box are two filters, and when they disagree
     the box silently loses: sitting on "work" and searching for something you
     filed under "personal" returns nothing, with no hint that the thing you
     wanted is one click away. So we also run the query across the whole tab and
     offer the difference — a search should never dead-end on a filter the user
     set ten minutes ago and forgot about. */
  const hiddenByCategory = useMemo(() => {
    if (!isSearching || activeSidebarTab !== 'home' || activeCategory === 'all') return 0;
    return Math.max(0, searchCanvases(tabList, searchQuery).length - results.length);
  }, [isSearching, activeSidebarTab, activeCategory, tabList, searchQuery, results.length]);

  /* Typing a query switches to Best match, and clearing it switches back — but
     only ever OVER the mode the search itself imposed. Pick "Biggest boards"
     by hand and it survives both, because an explicit choice outranks a
     default; that's what `sortTouched` records. */
  const sortTouched = useRef(false);
  useEffect(() => {
    if (sortTouched.current) return;
    setSortMode(isSearching ? 'relevance' : 'recent');
  }, [isSearching]);

  /** Open a canvas at a specific block: the board flies to it and pulses. */
  const openAtBlock = useCallback((canvasId: string, objectId: string) => {
    useCanvasStore.getState().setPendingFocusId(objectId);
    router.push(`/canvas?id=${canvasId}`);
  }, [router]);

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

  /*
   * Template thumbnails are the real thing: each template is materialised once
   * and drawn with the same CanvasMiniPreview the gallery uses for saved
   * canvases. Nobody hand-draws a preview that can drift from the board it
   * promises. ~60 objects × 6 templates is trivial, and it happens once.
   */
  const builtTemplates = useMemo(
    () => CANVAS_TEMPLATES.map((t) => ({ template: t, build: buildTemplate(t, `preview-${t.id}`) })),
    []
  );

  const visibleTemplates = useMemo(() => {
    let list = builtTemplates;
    if (templateCategory !== 'All') list = list.filter((t) => t.template.category === templateCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(({ template: t }) =>
        `${t.name} ${t.tagline} ${t.blurb} ${t.category} ${t.highlights.join(' ')}`.toLowerCase().includes(q)
      );
    }
    return list;
  }, [builtTemplates, templateCategory, searchQuery]);

  const imageObjects = useMemo(
    () => (galleryObjects || []).filter((o) => o.type === 'image' && o.content?.startsWith('data:')),
    [galleryObjects]
  );
  const checkpointObjects = useMemo(
    () => (galleryObjects || []).filter((o) => o.style?.isCheckpoint),
    [galleryObjects]
  );

  if (!mounted) return null;

  const isCollectionTab =
    activeSidebarTab !== 'images' &&
    activeSidebarTab !== 'checkpoints' &&
    activeSidebarTab !== 'chat' &&
    activeSidebarTab !== 'templates';
  const sectionTitles: Record<SidebarTab, string> = {
    home: 'all canvases',
    templates: 'templates',
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
    <div
      className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex overflow-x-hidden relative paper-texture"
      /* Soften the orange for the whole landing: the default terracotta read as
         a heavy, dark orange on the cream — everything accent-tinted (text,
         pills, hovers like the Continue card) inherits this lighter, airier tone
         instead. Scoped here so the canvas keeps the deeper brand accent. */
      style={{
        ['--accent' as string]: '#D89A6E',
        ['--accent-rgb' as string]: '216, 154, 110',
        ['--accent-light' as string]: '#E9BE9B',
        ['--accent-subtle' as string]: 'rgba(216, 154, 110, 0.12)',
      }}
    >
      <div className="noise-overlay" />

      {/* ---------- Floating clay dock ---------- */}
      {/* The dock was rendering flush against x=0 — `ml-4` never did anything
          (one more casualty of the unlayered `* { margin:0 }` reset in
          globals.css; see mindspace-tailwind-margin-reset memory), so the
          44px-square icon buttons' clickable area started right at the true
          edge of the browser, easy to fat-finger. Nudged 24px in via inline
          marginLeft (the one thing that beats the reset) — comfortably inside
          the aside's existing 92px lane (nav itself is only ~46px wide), so
          nothing else in the layout needs to move. */}
      <aside className="landing-rail w-[92px] h-screen sticky top-0 z-40 flex items-center shrink-0">
        <nav
          aria-label="Main navigation"
          style={{ marginLeft: 24 }}
          className="clay-card rounded-[26px] py-5 px-2.5 flex flex-col items-center gap-1.5 max-h-[calc(100vh-48px)]"
        >
          <DockButton label="Home" active={activeSidebarTab === 'home'} onClick={() => setActiveSidebarTab('home')} icon={ICONS.home} />
          <DockButton label="Templates" active={activeSidebarTab === 'templates'} onClick={() => setActiveSidebarTab('templates')} icon={ICONS.templates} />
          <DockButton label="Favorites" active={activeSidebarTab === 'favorites'} onClick={() => setActiveSidebarTab('favorites')} icon={ICONS.heart} />
          <DockButton label="Images" active={activeSidebarTab === 'images'} onClick={() => setActiveSidebarTab('images')} icon={ICONS.image} />
          <DockButton label="Checkpoints" active={activeSidebarTab === 'checkpoints'} onClick={() => setActiveSidebarTab('checkpoints')} icon={ICONS.flag} />
          <DockButton label="Chat" active={activeSidebarTab === 'chat'} onClick={() => setActiveSidebarTab('chat')} icon={ICONS.chat} badge={chatUnread || undefined} />

          <div className="landing-rail-sep w-8 h-px bg-[var(--border-strong)] opacity-50 my-2" />

          <DockButton label="Archive" active={activeSidebarTab === 'archive'} onClick={() => setActiveSidebarTab('archive')} icon={ICONS.archive} />
          <DockButton label="Trash" active={activeSidebarTab === 'deleted'} onClick={() => setActiveSidebarTab('deleted')} icon={ICONS.trash} badge={trashCount || undefined} />
        </nav>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="landing-main flex-1 min-h-screen h-screen overflow-y-auto">
        <div className="w-full max-w-[1380px] mx-auto pl-6 md:pl-16 pr-6 md:pr-24 pt-10 pb-28 flex flex-col gap-12">

          {/* Header */}
          <header className="landing-header flex flex-col lg:flex-row lg:justify-between lg:items-end gap-6 w-full">
            <div className="min-w-0 flex items-center gap-3.5">
              {/* Wordmark — Bebas Neue, settled on after trying the font list. */}
              <div className="w-12 h-12 rounded-2xl clay-inset flex items-center justify-center shrink-0" aria-hidden="true">
                <span className="text-[var(--accent)] text-[26px] leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  c
                </span>
              </div>
              <div className="min-w-0 flex flex-col gap-1.5">
                <h1
                  className="text-3xl md:text-[2.6rem] font-light tracking-tight leading-none"
                  style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                >
                  canvabrains
                </h1>
                <p className="text-[11px] font-semibold text-[var(--text-tertiary)] tabular-nums tracking-wide select-none">
                  {getFormattedDate()}
                </p>
              </div>
            </div>

            <div className="landing-header-actions flex items-center gap-3 shrink-0">
              {/* Recessed clay well — matches the sort button / layout toggle /
                  category pills right below it. glass-bar's dark-theme tint
                  (5% white) was nearly invisible against this page's default
                  dark background, reading as flat/plain next to everything
                  else's visible depth. */}
              <div className="clay-inset relative flex items-center gap-2.5 rounded-full w-full sm:w-80 focus-within:ring-2 focus-within:ring-[var(--accent)]/35 transition-shadow" style={SEARCH_BAR_PAD}>
                <span className="text-[var(--text-tertiary)] shrink-0">{ICONS.search}</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="search every board and card"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search canvases and card contents"
                  className="bg-transparent border-none outline-none text-[13px] w-full placeholder-[var(--text-muted)] text-[var(--text-primary)] font-medium"
                />
                {searchQuery ? (
                  <>
                    {/* The count, live, in the box you are typing into. Waiting
                        for your eye to travel to the section heading below is a
                        beat too slow when you are refining a query. */}
                    <span
                      aria-live="polite"
                      className="shrink-0 rounded-full text-[9.5px] font-extrabold tabular-nums whitespace-nowrap select-none"
                      style={{
                        padding: '3px 8px',
                        background: filteredList.length ? 'rgba(var(--accent-rgb),0.14)' : 'var(--well)',
                        color: filteredList.length ? 'var(--accent)' : 'var(--text-tertiary)',
                      }}
                    >
                      {filteredList.length === 0
                        ? 'no match'
                        : `${filteredList.length} board${filteredList.length === 1 ? '' : 's'}${totalCardHits ? ` · ${totalCardHits} card${totalCardHits === 1 ? '' : 's'}` : ''}`}
                    </span>
                    <button
                      onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                      aria-label="Clear search"
                      className="p-1.5 rounded-full text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-black/5 transition-colors cursor-pointer shrink-0"
                    >
                      <Icon size={13}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Icon>
                    </button>
                  </>
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
                <div className="clay-card rounded-[28px] grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-8 items-center relative overflow-hidden group" style={CONTINUE_CARD_PAD}>
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
                        className="landing-hero-title text-4xl md:text-5xl leading-[1.02] font-normal tracking-[0.01em] text-[var(--text-primary)] hover:text-[var(--accent)] cursor-pointer transition-colors truncate"
                        style={{ fontFamily: "'Bebas Neue', sans-serif" }}
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
                      className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)]/12 text-[var(--accent)] hover:bg-[var(--accent)]/20 border border-[var(--accent)]/15 text-xs font-extrabold tracking-wide cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 shadow-sm"
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
                    <CanvasCardPreview
                      objects={continueWorkspace.objects}
                      connections={continueWorkspace.connections}
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
                      <CanvasCardPreview objects={ws.objects} connections={ws.connections} height={128} compact />
                    </div>
                    <div className="flex justify-between items-center gap-2" style={CARD_TEXT_PAD}>
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

          {/* ---------- HOME: Start from a template (guests only) ----------
              Signed in, this section is gone: templates live in the Templates
              tab, reachable from the dock at any time. */}
          {!isLoading && activeSidebarTab === 'home' && !searchQuery && !signedIn && (
            <section className="w-full flex flex-col gap-4">
              <div className="flex justify-between items-baseline gap-4">
                <SectionHeading title="start from a template" sub="finished canvases, not empty shapes" />
                <button
                  onClick={() => setActiveSidebarTab('templates')}
                  className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--accent)] hover:opacity-70 transition-opacity cursor-pointer shrink-0"
                >
                  browse all {CANVAS_TEMPLATES.length} →
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                {builtTemplates.slice(0, 3).map(({ template, build }) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    build={build}
                    busy={openingTemplate === template.id}
                    disabled={openingTemplate !== null}
                    onUse={() => startFromTemplate(template)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ---------- TEMPLATES TAB ---------- */}
          {!isLoading && activeSidebarTab === 'templates' && (
            <section className="w-full flex flex-col gap-6">
              <div className="clay-card rounded-[28px] relative overflow-hidden" style={CONTINUE_CARD_PAD}>
                <div className="absolute -top-24 -right-20 w-72 h-72 rounded-full bg-[radial-gradient(circle,rgba(var(--accent-rgb),0.12),transparent_65%)] pointer-events-none" />
                <div className="flex flex-col gap-3 max-w-[720px]">
                  <span className="inline-flex items-center gap-2 text-[10px] text-[var(--accent)] uppercase font-extrabold tracking-[0.18em]">
                    {ICONS.sparkle} Templates
                  </span>
                  <h2
                    className="landing-hero-title text-4xl md:text-5xl leading-[1.02] font-normal tracking-[0.01em] text-[var(--text-primary)]"
                    style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                  >
                    Whole canvases, already made
                  </h2>
                  <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                    Each of these is a finished board — framed sections, live charts, timelines, tables, diagrams
                    and real writing, arranged the way somebody would actually work. Open one, read it, then make it
                    yours. Nothing is a placeholder.
                  </p>
                </div>
              </div>

              {/* Category filter */}
              <div className="flex flex-wrap gap-2">
                {(['All', ...TEMPLATE_CATEGORIES] as Array<TemplateCategory | 'All'>).map((cat) => {
                  const active = templateCategory === cat;
                  const n = cat === 'All'
                    ? CANVAS_TEMPLATES.length
                    : CANVAS_TEMPLATES.filter((t) => t.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setTemplateCategory(cat)}
                      style={CONTROL_PAD}
                      className={`rounded-full text-[11px] font-extrabold tracking-wide transition-colors cursor-pointer flex items-center gap-2 ${
                        active
                          ? 'bg-[var(--accent)]/15 text-[var(--accent)] clay-inset'
                          : 'clay-card text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {cat.toLowerCase()}
                      <span style={BADGE_PAD} className="rounded-full bg-black/10 dark:bg-white/10 text-[9px] tabular-nums">
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>

              {visibleTemplates.length === 0 ? (
                <EmptyState
                  icon={ICONS.templates}
                  title="Nothing matches that"
                  body="Try another category, or clear the search to see every template."
                  action={{ label: 'show all', onClick: () => { setTemplateCategory('All'); setSearchQuery(''); } }}
                />
              ) : (
                <motion.div
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: reducedMotion ? 0 : 0.05 } } }}
                  className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 w-full"
                >
                  {visibleTemplates.map(({ template, build }) => (
                    <motion.div
                      key={template.id}
                      variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: spring } }}
                    >
                      <TemplateCard
                        template={template}
                        build={build}
                        expanded
                        busy={openingTemplate === template.id}
                        disabled={openingTemplate !== null}
                        onUse={() => startFromTemplate(template)}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )}
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
          {/* The parent already spaces sections with gap-12 (48px); the old 2cm
              inline shift stacked on top of that and left an awkward void above
              this section, so it's dropped in favour of the uniform gap. */}
          {!isLoading && isCollectionTab && (
            <section className="w-full flex flex-col gap-6">
              <div className="flex flex-wrap justify-between items-center gap-x-6 gap-y-4 border-b border-[var(--border)] pb-5">
                <SectionHeading
                  title={sectionTitles[activeSidebarTab]}
                  count={filteredList.length}
                  /* Say what was actually found, not just that a filter ran.
                     "4 · 12 cards matching pricing" tells you whether to keep
                     typing; "matching pricing" told you nothing you didn't
                     already know, because you typed it. */
                  sub={
                    isSearching
                      ? `${totalCardHits > 0 ? `${totalCardHits} card${totalCardHits === 1 ? '' : 's'} ` : ''}matching “${searchQuery.trim()}”`
                      : undefined
                  }
                />

                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {/* Trash: empty-trash action */}
                  {activeSidebarTab === 'deleted' && trashCount > 0 && (
                    <button
                      onClick={handleEmptyTrash}
                      style={CONTROL_PAD}
                      className={`rounded-full text-[11px] font-bold tracking-wide transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 ${
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
                      style={CONTROL_PAD}
                      className="clay-inset flex items-center gap-1.5 rounded-full text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                    >
                      {SORT_SHORT[effectiveSort]}
                      {ICONS.chevron}
                    </button>
                    <AnimatePresence>
                      {sortMenuOpen && (
                        <motion.ul
                          role="listbox"
                          aria-label="Sort canvases"
                          initial={{ opacity: 0, y: -6, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.96 }}
                          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                          style={{ ...MENU_PAD, marginTop: 8 }}
                          className="glass-bar absolute right-0 top-full rounded-2xl flex flex-col w-[212px] z-30"
                        >
                          {/* Every option says what it DOES underneath its name.
                              "Most cards" and "a → z" were guessable; "Forgotten
                              first" is not, and an ordering nobody understands
                              is an ordering nobody uses. */}
                          {SORT_OPTIONS.filter((o) => !o.searchOnly || isSearching).map((opt) => (
                            <li key={opt.id}>
                              <button
                                role="option"
                                aria-selected={effectiveSort === opt.id}
                                onClick={() => { chooseSort(opt.id); setSortMenuOpen(false); }}
                                style={MENU_ITEM_PAD}
                                className={`w-full text-left rounded-xl transition-colors cursor-pointer flex flex-col ${
                                  effectiveSort === opt.id ? 'bg-[var(--accent)]/15' : 'hover:bg-black/5 dark:hover:bg-white/5'
                                }`}
                              >
                                <span className={`text-[11.5px] leading-tight ${
                                  effectiveSort === opt.id ? 'text-[var(--accent)] font-extrabold' : 'text-[var(--text-primary)] font-bold'
                                }`}>
                                  {opt.label}
                                </span>
                                <span className="text-[9.5px] font-semibold text-[var(--text-tertiary)] leading-tight" style={{ marginTop: 2 }}>
                                  {opt.hint}
                                </span>
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
                  <div className="clay-inset flex rounded-full" role="tablist" aria-label="Layout mode" style={SEG_TRAY_PAD}>
                    {(['grid', 'list'] as const).map((mode) => (
                      <button
                        key={mode}
                        role="tab"
                        aria-selected={layoutMode === mode}
                        onClick={() => setLayoutMode(mode)}
                        style={SEG_BTN_PAD}
                        className={`relative rounded-full text-[11px] font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${
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

              {/* A search that dead-ends on a filter you set earlier is the
                  most frustrating kind of empty result, because the thing you
                  asked for IS there. One click puts it back. */}
              <AnimatePresence>
                {hiddenByCategory > 0 && (
                  <motion.button
                    key="cat-escape"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={spring}
                    onClick={() => setActiveCategory('all')}
                    className="self-start inline-flex items-center gap-2 rounded-full cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
                    style={{
                      padding: '7px 14px',
                      background: 'rgba(var(--accent-rgb),0.1)',
                      border: '1px solid rgba(var(--accent-rgb),0.2)',
                    }}
                  >
                    <span className="text-[var(--accent)]" aria-hidden="true">
                      <Icon size={13}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Icon>
                    </span>
                    <span className="text-[11px] font-bold text-[var(--text-primary)]">
                      {hiddenByCategory} more {hiddenByCategory === 1 ? 'board matches' : 'boards match'} outside “{activeCategory}”
                    </span>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--accent)]">
                      search all
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>

              {/* Category pills (home only) */}
              {activeSidebarTab === 'home' && (
                <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Category filter">
                  {/* ALL button */}
                  <button
                    role="tab"
                    aria-selected={activeCategory === 'all'}
                    onClick={() => setActiveCategory('all')}
                    style={CONTROL_PAD}
                    className={`relative inline-flex items-center gap-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
                      activeCategory === 'all' ? 'text-[var(--accent)] font-extrabold' : 'clay-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {activeCategory === 'all' && (
                      <motion.span
                        layoutId="category-thumb"
                        transition={spring}
                        className="absolute inset-0 bg-[var(--accent)]/12 border border-[var(--accent)]/20 rounded-full"
                      />
                    )}
                    <span className="relative">all</span>
                    <span style={BADGE_PAD} className={`relative text-[9px] rounded-full font-extrabold tabular-nums ${activeCategory === 'all' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-white/70 dark:bg-white/10 border border-[var(--border)]'}`}>
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
                      style={CONTROL_PAD}
                      className={`relative inline-flex items-center gap-2 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 ${
                        activeCategory === cat ? 'text-[var(--accent)] font-extrabold' : 'clay-inset text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {activeCategory === cat && (
                        <motion.span
                          layoutId="category-thumb"
                          transition={spring}
                          className="absolute inset-0 bg-[var(--accent)]/12 border border-[var(--accent)]/20 rounded-full"
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
                          className="bg-transparent text-[var(--accent)] font-bold outline-none border-b border-[var(--accent)]/50 w-24 text-[11px] uppercase tracking-wider relative z-10"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="relative">{cat}</span>
                      )}
                      <span style={BADGE_PAD} className={`relative text-[9px] rounded-full font-extrabold tabular-nums ${activeCategory === cat ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-white/70 dark:bg-white/10 border border-[var(--border)]'}`}>
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
                          className="clay-card rounded-3xl flex flex-col group cursor-pointer relative"
                          style={GRID_CARD_PAD}
                        >
                         <div className="flex items-center justify-between w-full">
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
                                  <span className="truncate">
                                    <Highlight text={ws.title || 'untitled canvas'} ranges={resultById.get(ws.id)?.titleRanges} />
                                  </span>
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
                         </div>

                          {/* WHY this canvas is in the results — and a way in. */}
                          <SearchHits result={resultById.get(ws.id)} onOpen={openAtBlock} />
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
                            {/* The headings sort. A table that shows a column
                                and then hides its ordering behind a dropdown
                                somewhere else is asking you to learn two
                                controls for one idea — and every spreadsheet
                                anyone has ever used has taught the other one.
                                Edited toggles direction, because "newest" and
                                "what have I abandoned" are the same column read
                                from opposite ends. */}
                            <SortableTh label="Title" active={effectiveSort === 'name'} onClick={() => chooseSort('name')} />
                            <th className="text-left" style={TABLE_CELL_PAD}>Category</th>
                            <SortableTh label="Contents" active={effectiveSort === 'cards'} onClick={() => chooseSort('cards')} />
                            <SortableTh
                              label="Edited"
                              active={effectiveSort === 'recent' || effectiveSort === 'oldest'}
                              flipped={effectiveSort === 'oldest'}
                              onClick={() => chooseSort(effectiveSort === 'recent' ? 'oldest' : 'recent')}
                            />
                            <th className="text-right" style={TABLE_CELL_PAD}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredList.map((ws) => {
                            const res = resultById.get(ws.id);
                            return (
                            <React.Fragment key={ws.id}>
                            <tr
                              onClick={() => router.push(`/canvas?id=${ws.id}`)}
                              className={`hover:bg-[#FAF6F1]/50 dark:hover:bg-white/5 cursor-pointer transition-colors group ${
                                res && res.hits.length ? '' : 'border-b border-[var(--border)] last:border-b-0'
                              }`}
                            >
                              <td className="font-semibold text-[16px] tracking-tight group-hover:text-[var(--accent)] transition-colors" style={{ ...TABLE_CELL_PAD, fontFamily: "'Playfair Display', serif" }}>
                                <span className="flex items-center gap-1.5">
                                  <Highlight text={ws.title || 'untitled canvas'} ranges={res?.titleRanges} />
                                  {ws.isFavorite && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent)" aria-label="Favorite">
                                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                                    </svg>
                                  )}
                                </span>
                              </td>
                              <td style={TABLE_CELL_PAD}>
                                <span className="px-2.5 py-1 rounded-full text-[9px] uppercase tracking-wider font-extrabold clay-inset text-[var(--text-secondary)]">
                                  {ws.category || 'personal'}
                                </span>
                              </td>
                              <td className="text-xs text-[var(--text-secondary)] tabular-nums" style={TABLE_CELL_PAD}>
                                {res && res.totalHits > 0 ? (
                                  <span className="font-bold text-[var(--accent)]">
                                    {res.totalHits} matching card{res.totalHits === 1 ? '' : 's'}
                                  </span>
                                ) : (
                                  <>{ws.objectCount} cards · {ws.strokeCount} sketches · {ws.connectionCount} threads</>
                                )}
                              </td>
                              <td className="text-xs text-[var(--text-secondary)] tabular-nums" style={TABLE_CELL_PAD}>{getRelativeTime(ws.lastModified)}</td>
                              <td className="text-right" style={TABLE_CELL_PAD} onClick={(e) => e.stopPropagation()}>
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
                            {res && res.hits.length > 0 && (
                              <tr className="border-b border-[var(--border)] last:border-b-0">
                                {/* The matches, spanning the whole row: a table
                                    column is the wrong shape for a sentence. */}
                                <td colSpan={5} style={{ padding: '0 24px 14px' }}>
                                  <SearchHits result={res} onOpen={openAtBlock} bare />
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                            );
                          })}
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
              everything saves on this device
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

/**
 * The cards inside a canvas that actually matched — the part the old gallery
 * never showed.
 *
 * Search used to end at "this board contains your word somewhere". Four boards
 * would come back looking exactly as they always do, and the only way to find
 * out which one you wanted was to open all four and search again inside each.
 * Every row here is the block itself: what kind it is, the sentence it sits in
 * with the query marked up, and — because knowing where it is only helps if you
 * can get there — a click that opens the canvas already flown to it.
 *
 * Renders nothing at all when there is no query, so the card is byte-identical
 * to how it looks the rest of the time.
 */
function SearchHits({
  result,
  onOpen,
  bare = false,
}: {
  result?: Scored<WorkspaceWithStats>;
  onOpen: (canvasId: string, objectId: string) => void;
  /** Inside a table row the surrounding cell already provides the separation. */
  bare?: boolean;
}) {
  if (!result || result.hits.length === 0) return null;
  const more = result.totalHits - result.hits.length;

  return (
    <div
      className="w-full flex flex-col"
      style={
        bare
          ? { gap: 4 }
          : { marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border-strong)', gap: 4 }
      }
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-tertiary)]" style={{ marginBottom: 2 }}>
        {result.totalHits === 1 ? '1 matching card' : `${result.totalHits} matching cards`}
      </p>

      {result.hits.map((hit) => (
        <button
          key={hit.objectId}
          onClick={() => onOpen(result.item.id, hit.objectId)}
          title="Open this canvas at this card"
          className="group/hit w-full text-left rounded-xl flex items-start gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40"
          style={{ padding: '6px 8px' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--well)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span
            className="shrink-0 rounded-md text-[8px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-tertiary)] bg-[var(--well)] group-hover/hit:text-[var(--accent)] transition-colors"
            style={{ padding: '3px 5px', marginTop: 1 }}
          >
            {hit.kind}
          </span>
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--text-secondary)] line-clamp-2">
            <Highlight text={hit.snippet} ranges={hit.ranges} />
          </span>
          <span
            className="shrink-0 text-[var(--text-muted)] opacity-0 group-hover/hit:opacity-100 transition-opacity"
            style={{ marginTop: 2 }}
            aria-hidden="true"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      ))}

      {more > 0 && (
        <p className="text-[9.5px] font-bold text-[var(--text-muted)]" style={{ paddingLeft: 8, marginTop: 1 }}>
          +{more} more inside
        </p>
      )}
    </div>
  );
}

/** A list-view column heading that sorts by its own column. */
function SortableTh({
  label, active, flipped = false, onClick,
}: {
  label: string;
  active: boolean;
  /** Ascending rather than descending — flips the arrow. */
  flipped?: boolean;
  onClick: () => void;
}) {
  return (
    <th className="text-left" style={TABLE_CELL_PAD} aria-sort={active ? (flipped ? 'ascending' : 'descending') : 'none'}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 uppercase tracking-[0.15em] font-extrabold text-[10px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 rounded ${
          active ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        {label}
        <svg
          width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{
            opacity: active ? 1 : 0.28,
            transform: flipped ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease, opacity 160ms ease',
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </th>
  );
}

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

/* ============================================================
   Template card
   ============================================================ */

/**
 * A template card shows the board itself, not an illustration of one — the
 * thumbnail is the real materialised template run through the same preview
 * renderer the gallery uses for saved canvases, so what you see is literally
 * what gets created.
 */
function TemplateCard({
  template,
  build,
  onUse,
  busy = false,
  disabled = false,
  expanded = false,
}: {
  template: CanvasTemplate;
  build: { objects: CanvasObjectData[]; connections: ConnectionData[]; scenes: unknown[] };
  onUse: () => void;
  busy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const frames = build.objects.filter((o) => o.type === 'frame').length;

  return (
    <motion.div
      whileHover={disabled ? undefined : { y: -5 }}
      transition={spring}
      onClick={disabled ? undefined : onUse}
      className={`clay-card rounded-3xl overflow-hidden flex flex-col group ${
        disabled && !busy ? 'opacity-60 cursor-wait' : 'cursor-pointer'
      }`}
      style={{ padding: 12 }}
    >
      {/* Preview */}
      <div
        className="clay-inset rounded-2xl relative overflow-hidden shrink-0"
        style={{
          height: expanded ? 188 : 152,
          background: `linear-gradient(150deg, ${template.accent}18, transparent 62%)`,
        }}
      >
        {/* The blueprint alone here, with no text laid over it: a template
            card already prints the template's name, tagline and highlights
            directly beneath, so a readable overlay would just say the same
            thing twice. What the picture is for is the SHAPE of the board. */}
        <CanvasBlueprint
          objects={build.objects}
          connections={build.connections}
          width={expanded ? 420 : 340}
          height={expanded ? 188 : 152}
          limit={90}
        />
        <span
          className="absolute top-2.5 left-2.5 rounded-full text-[9px] font-extrabold uppercase tracking-[0.14em] select-none"
          style={{ padding: '4px 9px', background: `${template.accent}26`, color: template.accent }}
        >
          {template.category}
        </span>
        {/* The emoji that used to sit in this corner is gone — a 19px cartoon
            glyph on top of a real board preview cheapened the card and said
            nothing the category chip and the preview don't already say. */}
        <div
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.24)' }}
        >
          <span className="glass-bar rounded-full text-[10px] font-extrabold uppercase tracking-[0.16em] text-[var(--text-primary)]" style={{ padding: '8px 16px' }}>
            {busy ? 'building…' : 'use this template'}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2.5 min-w-0" style={{ padding: '14px 6px 4px' }}>
        <div className="min-w-0">
          <h4
            className="text-[17px] font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors tracking-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {template.name}
          </h4>
          <p className="text-[11px] text-[var(--text-secondary)] leading-snug" style={{ marginTop: 3 }}>
            {template.tagline}
          </p>
        </div>

        {expanded && (
          <p className="text-[11.5px] text-[var(--text-tertiary)] leading-relaxed">{template.blurb}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {(expanded ? template.highlights : template.highlights.slice(0, 3)).map((h) => (
            <span
              key={h}
              className="rounded-full text-[9.5px] font-bold text-[var(--text-secondary)] clay-inset select-none"
              style={{ padding: '4px 9px' }}
            >
              {h}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3" style={{ paddingTop: 4 }}>
          <span className="text-[10px] text-[var(--text-muted)] font-bold tabular-nums select-none">
            {build.objects.length} blocks · {frames} frames · {build.scenes.length} slides
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full text-[10px] font-extrabold tracking-wide shrink-0 transition-colors"
            style={{
              padding: '7px 13px',
              background: `${template.accent}1F`,
              color: template.accent,
            }}
          >
            {busy ? 'building…' : 'open'} {!busy && ICONS.arrowRight}
          </span>
        </div>
      </div>
    </motion.div>
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
          className="mt-5 px-5 py-2.5 bg-[var(--accent)]/12 text-[var(--accent)] hover:bg-[var(--accent)]/20 border border-[var(--accent)]/15 text-xs font-extrabold rounded-full cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 shadow-sm"
        >
          {action.label}
        </motion.button>
      )}
    </motion.div>
  );
}
