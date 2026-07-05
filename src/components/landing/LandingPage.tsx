'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { 
  getAllCanvasStates, 
  updateCanvasTheme, 
  CanvasState, 
  seedDatabaseIfEmpty, 
  getAllObjects, 
  getAllStrokes, 
  getAllConnections, 
  saveCanvasState,
  getCanvasState
} from '@/lib/db';

// We import useRouter from 'next/navigation' as standard in Next.js App router
import { useRouter } from 'next/navigation';
import AuthButton from '@/components/ui/AuthButton';

function CanvasMiniPreview({ 
  objects = [], 
  connections = [], 
  width = 240, 
  height = 140 
}: { 
  objects?: any[]; 
  connections?: any[]; 
  width?: number; 
  height?: number; 
}) {
  if (objects.length === 0) {
    return (
      <div className="w-full h-full bg-[#FAF6F1]/60 flex items-center justify-center rounded-xl opacity-50 border border-[var(--border)]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#C4BDB5" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 17V9h6" />
        </svg>
      </div>
    );
  }

  // Calculate bounding box
  let minX = Math.min(...objects.map(o => o.x - o.width / 2));
  let maxX = Math.max(...objects.map(o => o.x + o.width / 2));
  let minY = Math.min(...objects.map(o => o.y - o.height / 2));
  let maxY = Math.max(...objects.map(o => o.y + o.height / 2));

  // Add padding
  const padding = 30;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  const boxW = Math.max(100, maxX - minX);
  const boxH = Math.max(100, maxY - minY);

  // Fit bounding box into width/height preserving aspect ratio
  const scaleX = width / boxW;
  const scaleY = height / boxH;
  const scale = Math.min(scaleX, scaleY, 0.45); // Limit max scale to keep elements nicely proportioned

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const getX = (canvasX: number) => (canvasX - centerX) * scale + width / 2;
  const getY = (canvasY: number) => (canvasY - centerY) * scale + height / 2;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
      {/* Connections */}
      {connections.map((conn: any) => {
        const fromNode = objects.find(o => o.id === conn.fromId);
        const toNode = objects.find(o => o.id === conn.toId);
        if (!fromNode || !toNode) return null;

        const fx = getX(fromNode.x);
        const fy = getY(fromNode.y);
        const tx = getX(toNode.x);
        const ty = getY(toNode.y);

        return (
          <path
            key={conn.id}
            d={`M ${fx} ${fy} Q ${(fx+tx)/2} ${(fy+ty)/2 - 10} ${tx} ${ty}`}
            stroke="var(--accent)"
            strokeWidth="1.2"
            fill="none"
            strokeDasharray="2 2"
            opacity="0.5"
          />
        );
      })}

      {/* Objects */}
      {objects.slice(0, 15).map((obj: any) => {
        const rx = getX(obj.x) - (obj.width * scale) / 2;
        const ry = getY(obj.y) - (obj.height * scale) / 2;
        const rw = obj.width * scale;
        const rh = obj.height * scale;

        let fill = "#FFFFFF";
        let stroke = "rgba(45, 42, 38, 0.08)";
        let radius = 4;

        if (obj.type === 'shape') {
          fill = obj.style?.color || 'var(--accent-light)';
          stroke = obj.style?.borderColor || 'var(--accent)';
          if (obj.style?.shapeType === 'pill') radius = rh / 2;
          else if (obj.style?.shapeType === 'oval') radius = Math.min(rw, rh) / 2;
        } else if (obj.type === 'sticky') {
          fill = obj.style?.color || 'var(--sticky-yellow)';
          stroke = "rgba(45, 42, 38, 0.04)";
          radius = 1;
        } else if (obj.type === 'workflow-node') {
          fill = "var(--bg-primary)";
          stroke = "var(--accent)";
          radius = 8;
        }

        return (
          <g key={obj.id}>
            <rect
              x={rx}
              y={ry}
              width={rw}
              height={rh}
              rx={radius}
              ry={radius}
              fill={fill}
              stroke={stroke}
              strokeWidth="0.8"
            />
            {rw > 35 && (
              <text
                x={rx + rw / 2}
                y={ry + rh / 2 + 1.5}
                fill={obj.type === 'shape' ? '#FFFFFF' : 'var(--text-primary)'}
                fontSize="4"
                fontWeight="500"
                textAnchor="middle"
                opacity="0.7"
                className="select-none pointer-events-none font-sans font-medium"
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
}

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const [workspaces, setWorkspaces] = useState<(CanvasState & { 
    objectCount: number; 
    strokeCount: number; 
    connectionCount: number;
    objects: any[];
    connections: any[];
  })[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'work' | 'personal' | 'study'>('all');
  const [activeSidebarTab, setActiveSidebarTab] = useState<'home' | 'favorites' | 'docs' | 'images' | 'dictionary' | 'checkpoints' | 'mentions' | 'archive' | 'deleted'>('home');
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list'>('grid');
  
  const [username, setUsername] = useState('Sanket');
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('Sanket');
  const [greeting, setGreeting] = useState('welcome');

  // Renaming canvas state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState('');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    const storedUsername = localStorage.getItem('username');
    if (storedUsername) {
      setUsername(storedUsername);
      setUsernameInput(storedUsername);
    }

    // Track visit count and select greeting
    const storedVisits = localStorage.getItem('mindspace_visit_count');
    const currentVisits = storedVisits ? parseInt(storedVisits, 10) + 1 : 1;
    localStorage.setItem('mindspace_visit_count', currentVisits.toString());

    // Generate dynamic greeting
    const hours = new Date().getHours();
    const greetingsPool: string[] = [];

    // 1. Time-of-day greeting pool
    if (hours >= 5 && hours < 12) {
      greetingsPool.push(
        'good morning',
        'rise and shine',
        'morning spark',
        'fresh start',
        'start creating'
      );
      if (currentVisits > 1) {
        greetingsPool.push('welcome back');
      }
    } else if (hours >= 12 && hours < 17) {
      greetingsPool.push(
        'good afternoon',
        'afternoon flow',
        'mid-day focus',
        'keep going',
        'mid-day spark'
      );
      if (currentVisits > 1) {
        greetingsPool.push('welcome back');
      }
    } else if (hours >= 17 && hours < 22) {
      greetingsPool.push(
        'good evening',
        'evening vibes',
        'winding down',
        'productive evening',
        'ideas never sleep'
      );
      if (currentVisits > 1) {
        greetingsPool.push('welcome back');
      }
    } else {
      // Late night (22:00 to 05:00)
      greetingsPool.push(
        'burning the midnight oil',
        'night owl mode',
        'late night thoughts',
        'midnight spark',
        'ideas in the dark',
        'quiet hours',
        'night mode'
      );
    }

    // 2. High frequency or visit count based general greetings
    if (currentVisits > 1) {
      greetingsPool.push(
        'welcome back',
        'great to see you again',
        'back to create',
        'ready to brain-dump',
        'your digital desk awaits'
      );
      
      // If visited many times
      if (currentVisits > 10) {
        greetingsPool.push(
          'welcome back, champion',
          'back at it',
          'ready for greatness',
          'make magic happen'
        );
      }
    } else {
      greetingsPool.push(
        'welcome to mindspace',
        'let\'s get started',
        'your canvas awaits'
      );
    }

    // Choose randomly from the pool
    const randomIndex = Math.floor(Math.random() * greetingsPool.length);
    setGreeting(greetingsPool[randomIndex]);

    async function loadData() {
      // Seed database if it is empty
      await seedDatabaseIfEmpty();
      const wsStates = await getAllCanvasStates();

      // Retrieve stats for all workspaces
      const wsWithStats = await Promise.all(
        wsStates.map(async (ws) => {
          const [objs, strokes, conns] = await Promise.all([
            getAllObjects(ws.id),
            getAllStrokes(ws.id),
            getAllConnections(ws.id)
          ]);
          return {
            ...ws,
            objectCount: objs.length,
            strokeCount: strokes.length,
            connectionCount: conns.length,
            objects: objs,
            connections: conns
          };
        })
      );

      setWorkspaces(wsWithStats);
    }

    loadData().catch(console.error);
  }, []);

  // Keyboard shortcut for Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!mounted) return null;

  const openNewCanvas = async () => {
    const newId = uuidv4();
    const newCanvas: CanvasState = {
      id: newId,
      title: 'untitled canvas',
      themeColor: '#FAF6F1',
      camera: { x: 0, y: 0, zoom: 1 },
      lastModified: Date.now(),
      category: activeCategory === 'all' ? 'personal' : activeCategory,
      isFavorite: false,
      deleted: false,
      archived: false
    };
    await saveCanvasState(newCanvas);
    router.push(`/canvas?id=${newId}`);
  };

  const handleUsernameSave = () => {
    const finalName = usernameInput.trim() || 'Sanket';
    setUsername(finalName);
    localStorage.setItem('username', finalName);
    setIsEditingUsername(false);
  };

  const handleColorCycle = async (e: React.MouseEvent, id: string, currentColor?: string) => {
    e.stopPropagation();
    const themeColors = ['#FAF6F1', '#FFF8DC', '#FFE4E6', '#E0F2FE', '#DCFCE7'];
    const current = currentColor || '#FAF6F1';
    const currentIndex = themeColors.indexOf(current) === -1 ? 0 : themeColors.indexOf(current);
    const nextIndex = (currentIndex + 1) % themeColors.length;
    const nextColor = themeColors[nextIndex];
    
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, themeColor: nextColor } : w));
    await updateCanvasTheme(id, nextColor);
  };

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const ws = workspaces.find(w => w.id === id);
    if (!ws) return;
    const nextFavorite = !ws.isFavorite;

    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, isFavorite: nextFavorite } : w));

    const state = await getCanvasState(id);
    if (state) {
      state.isFavorite = nextFavorite;
      await saveCanvasState(state);
    }
  };

  const toggleArchive = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const ws = workspaces.find(w => w.id === id);
    if (!ws) return;
    const nextArchived = !ws.archived;

    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, archived: nextArchived } : w));

    const state = await getCanvasState(id);
    if (state) {
      state.archived = nextArchived;
      await saveCanvasState(state);
    }
  };

  const toggleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const ws = workspaces.find(w => w.id === id);
    if (!ws) return;
    const nextDeleted = !ws.deleted;

    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, deleted: nextDeleted } : w));

    const state = await getCanvasState(id);
    if (state) {
      state.deleted = nextDeleted;
      await saveCanvasState(state);
    }
  };

  const startRenaming = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenamingTitle(currentTitle);
  };

  const saveRename = async (id: string) => {
    const finalTitle = renamingTitle.trim() || 'Untitled Space';
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, title: finalTitle } : w));
    setRenamingId(null);

    const state = await getCanvasState(id);
    if (state) {
      state.title = finalTitle;
      await saveCanvasState(state);
    }
  };

  // Helper date generators


  const getFormattedDate = () => {
    const date = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[date.getDay()]} · ${date.getDate()} ${months[date.getMonth()]}`;
  };

  const getRelativeTime = (time: number) => {
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
  };

  // 1. Filter out deleted or archived from counts
  const nonDeletedWorkspaces = workspaces.filter(w => !w.deleted && !w.archived);

  // Statistics
  const totalCanvasesCount = nonDeletedWorkspaces.length;
  const totalCardsCount = nonDeletedWorkspaces.reduce((sum, w) => sum + (w.objectCount || 0), 0);

  // Get continue where you left off
  const continueWorkspace = nonDeletedWorkspaces.length > 0 
    ? [...nonDeletedWorkspaces].sort((a, b) => b.lastModified - a.lastModified)[0] 
    : null;

  // Filter workspaces list for grid
  const getFilteredWorkspaces = () => {
    let list = [...workspaces];

    // Sidebar tab filters
    if (activeSidebarTab === 'favorites') {
      list = list.filter(w => w.isFavorite && !w.deleted && !w.archived);
    } else if (activeSidebarTab === 'archive') {
      list = list.filter(w => w.archived && !w.deleted);
    } else if (activeSidebarTab === 'deleted') {
      list = list.filter(w => w.deleted);
    } else {
      list = list.filter(w => !w.deleted && !w.archived);
      
      if (activeSidebarTab === 'docs') {
        list = list.filter(w => w.category === 'work' || w.category === 'study');
      } else if (activeSidebarTab === 'images') {
        list = list.filter(w => w.category === 'personal');
      }
    }

    // Category pills filter
    if (activeSidebarTab !== 'favorites' && activeSidebarTab !== 'archive' && activeSidebarTab !== 'deleted') {
      if (activeCategory !== 'all') {
        list = list.filter(w => w.category === activeCategory);
      }
    }

    // Search query filter
    if (searchQuery) {
      list = list.filter(w => 
        (w.title || 'untitled canvas').toLowerCase().includes(searchQuery.toLowerCase()) || 
        w.id.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return list;
  };

  const filteredList = getFilteredWorkspaces();

  // Dynamic filter counts
  const countAll = nonDeletedWorkspaces.length;
  const countWork = nonDeletedWorkspaces.filter(w => w.category === 'work').length;
  const countPersonal = nonDeletedWorkspaces.filter(w => w.category === 'personal').length;
  const countStudy = nonDeletedWorkspaces.filter(w => w.category === 'study').length;

  // Icons resolver helper
  const getCanvasIconDetails = (title: string, category: string) => {
    const t = (title || '').toLowerCase();
    if (t.includes('launch')) {
      return {
        bg: 'bg-orange-50 text-orange-500 border border-orange-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </svg>
        )
      };
    }
    if (t.includes('reading')) {
      return {
        bg: 'bg-green-50 text-green-600 border border-green-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.58 0 8a7 7 0 0 1-8 10z" />
            <path d="M19 2L11 10" />
          </svg>
        )
      };
    }
    if (t.includes('thesis') || t.includes('essay')) {
      return {
        bg: 'bg-yellow-50 text-amber-700 border border-yellow-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )
      };
    }
    if (t.includes('brand')) {
      return {
        bg: 'bg-teal-50 text-teal-600 border border-teal-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        )
      };
    }
    if (t.includes('trip') || t.includes('moodboard')) {
      return {
        bg: 'bg-red-50 text-red-500 border border-red-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
        )
      };
    }
    if (t.includes('lovely')) {
      return {
        bg: 'bg-pink-50 text-pink-500 border border-pink-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        )
      };
    }

    if (category === 'work') {
      return {
        bg: 'bg-blue-50 text-blue-500 border border-blue-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        )
      };
    }
    if (category === 'study') {
      return {
        bg: 'bg-purple-50 text-purple-500 border border-purple-100/50',
        icon: (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        )
      };
    }
    return {
      bg: 'bg-amber-50 text-amber-500 border border-amber-100/50',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      )
    };
  };

  return (
    <div className="min-h-screen bg-[#FAF6F1] text-[var(--text-primary)] flex overflow-x-hidden relative paper-texture">
      {/* Noise filter */}
      <div className="noise-overlay" />

      {/* Premium Thin Sidebar (80px) */}
      <aside className="w-20 bg-[#FAF6F1] border-r border-[var(--border)] flex flex-col justify-between items-center py-6 h-screen sticky top-0 z-[100]">
        <div className="flex flex-col items-center gap-6 w-full">
          {/* Logo / Brand container - orange tile with 4 squares */}
          <div 
            onClick={() => { setActiveSidebarTab('home'); setActiveCategory('all'); }}
            className="w-12 h-12 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-white shadow-md shadow-[var(--accent-subtle)] cursor-pointer hover:opacity-90 active:scale-95 transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" />
            </svg>
          </div>

          {/* Navigation Items */}
          <div className="flex flex-col items-center gap-3 w-full px-2">
            <SidebarButton 
              active={activeSidebarTab === 'home'} 
              onClick={() => setActiveSidebarTab('home')}
              title="Home"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'favorites'} 
              onClick={() => setActiveSidebarTab('favorites')}
              title="Favorites"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'docs'} 
              onClick={() => setActiveSidebarTab('docs')}
              title="Documents"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'images'} 
              onClick={() => setActiveSidebarTab('images')}
              title="Images"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'dictionary'} 
              onClick={() => setActiveSidebarTab('dictionary')}
              title="Dictionary"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>} 
            />

            {/* Subtle Divider */}
            <div className="w-8 h-px bg-[var(--border-strong)] opacity-40 my-3" />

            <SidebarButton 
              active={activeSidebarTab === 'checkpoints'} 
              onClick={() => setActiveSidebarTab('checkpoints')}
              title="Checkpoints"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'mentions'} 
              onClick={() => setActiveSidebarTab('mentions')}
              title="Mentions"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'archive'} 
              onClick={() => setActiveSidebarTab('archive')}
              title="Archived"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" /></svg>} 
            />
            <SidebarButton 
              active={activeSidebarTab === 'deleted'} 
              onClick={() => setActiveSidebarTab('deleted')}
              title="Deleted / Trash"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>} 
            />
          </div>
        </div>

        {/* Dynamic Theme indicator circle */}
        <div className="w-3 h-3 rounded-full bg-[var(--accent)] animate-pulse" />
      </aside>

      {/* Main Dashboard Space */}
      <main className="flex-1 min-h-screen px-12 py-10 flex flex-col items-center overflow-y-auto">
        <div className="w-full max-w-5xl flex flex-col gap-10">
          
          {/* Top Header Row */}
          <header className="flex justify-between items-center w-full">
            <div>
              {isEditingUsername ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    onBlur={handleUsernameSave}
                    onKeyDown={(e) => e.key === 'Enter' && handleUsernameSave()}
                    className="text-4xl italic font-serif bg-transparent border-b border-[var(--accent)] outline-none text-[var(--text-primary)] max-w-[240px]"
                    autoFocus
                  />
                  <button 
                    onClick={handleUsernameSave}
                    className="p-1 text-xs text-white bg-[var(--accent)] rounded hover:opacity-90"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <h1 
                  onClick={() => setIsEditingUsername(true)}
                  className="text-4xl italic font-serif font-light text-[var(--text-primary)] tracking-wide cursor-pointer hover:opacity-85 transition-opacity"
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                >
                  {greeting}, <span className="underline decoration-dotted decoration-[var(--border-strong)]">{username}</span>
                </h1>
              )}
              <p className="text-xs text-[var(--text-secondary)] font-medium mt-1 select-none">
                {getFormattedDate()} · <span className="text-[var(--accent)]">{totalCanvasesCount} canvases</span> · {totalCardsCount} cards
              </p>
            </div>

            <div className="flex items-center gap-4">
              {/* Pill Search Input */}
              <div className="relative flex items-center bg-white border border-[var(--border)] rounded-full px-4 py-2 w-72 focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] transition-all shadow-sm">
                <svg className="text-[var(--text-tertiary)] mr-2 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="search anything"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs w-full placeholder-[var(--text-muted)] text-[var(--text-primary)] font-medium"
                />
                <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[9px] font-semibold text-[var(--text-muted)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded border border-[var(--border)] select-none">
                  <span>⌘</span>K
                </kbd>
              </div>

              {/* Profile Avatar */}
              <AuthButton isInline={true} />
            </div>
          </header>

          {/* CONTINUE WHERE YOU LEFT OFF SECTION */}
          {activeSidebarTab === 'home' && continueWorkspace && !searchQuery && (
            <section className="w-full">
              <div className="bg-white border border-[var(--border)] rounded-[24px] p-8 flex flex-col md:flex-row justify-between items-center gap-8 shadow-sm relative overflow-hidden group">
                <div className="flex-1 flex flex-col items-start gap-4">
                  <span className="text-[10px] text-[var(--accent)] uppercase font-extrabold tracking-widest flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" />
                    Continue where you left off
                  </span>
                  
                  <div>
                    <h2 
                      onClick={() => router.push(`/canvas?id=${continueWorkspace.id}`)}
                      className="text-3xl font-serif text-[var(--text-primary)] hover:text-[var(--accent)] cursor-pointer transition-colors"
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                    >
                      {continueWorkspace.title || 'untitled canvas'}
                    </h2>
                    <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-1">
                      edited {getRelativeTime(continueWorkspace.lastModified)} · <span className="opacity-80 font-semibold">{continueWorkspace.id.substring(0, 8)}</span>
                    </p>
                  </div>

                  {/* Canvas Statistics Pills */}
                  <div className="flex flex-wrap gap-2 mt-2">
                    <StatPill label={`${continueWorkspace.objectCount} cards`} icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>} />
                    <StatPill label={`${continueWorkspace.strokeCount} sketches`} icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>} />
                    <StatPill label={`${continueWorkspace.connectionCount} threads`} icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="6" x2="18" y2="18" /><circle cx="6" cy="6" r="3" fill="currentColor" /><circle cx="18" cy="18" r="3" fill="currentColor" /></svg>} />
                    <StatPill label="3h 14m" icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
                  </div>
                </div>

                {/* Right Mini Preview Card */}
                <div 
                  onClick={() => router.push(`/canvas?id=${continueWorkspace.id}`)}
                  className="w-full md:w-80 h-44 bg-[#F5EFE7]/50 hover:bg-[#F5EFE7] rounded-xl overflow-hidden relative cursor-pointer border border-[var(--border)] transition-colors duration-300"
                >
                  <CanvasMiniPreview 
                    objects={continueWorkspace.objects} 
                    connections={continueWorkspace.connections} 
                    width={320} 
                    height={176} 
                  />
                </div>
              </div>
            </section>
          )}

          {/* RECENTLY VISITED SECTION */}
          {activeSidebarTab === 'home' && !searchQuery && nonDeletedWorkspaces.length > 0 && (
            <section className="w-full flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-[var(--text-secondary)]">Recently Visited</h3>
                <span 
                  onClick={() => { setActiveSidebarTab('home'); setActiveCategory('all'); }} 
                  className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline cursor-pointer flex items-center gap-1 transition-colors"
                >
                  see all <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                </span>
              </div>

              {/* Horizontal List: Top 4 workspaces */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6 w-full">
                {nonDeletedWorkspaces.slice(0, 4).map((ws, index) => {
                  // Predefined colors for relative dot indicators
                  const dotColors = ['bg-[#C97B4B]', 'bg-[#4B9C73]', 'bg-[#9E9790]', 'bg-[#C9904B]'];
                  const dotColor = dotColors[index % dotColors.length];

                  return (
                    <div 
                      key={ws.id}
                      onClick={() => router.push(`/canvas?id=${ws.id}`)}
                      className="bg-white border border-[var(--border)] rounded-2xl overflow-hidden p-3 flex flex-col gap-3 hover:shadow-md transition-shadow group cursor-pointer"
                    >
                      {/* Top Preview Block */}
                      <div className="h-28 bg-[#F5EFE7]/40 rounded-xl relative overflow-hidden">
                        <CanvasMiniPreview objects={ws.objects} connections={ws.connections} width={220} height={112} />
                      </div>

                      {/* Bottom Meta */}
                      <div className="px-1 flex justify-between items-center">
                        <div className="overflow-hidden pr-2">
                          <h4 className="text-xs font-bold text-[var(--text-primary)] truncate">{ws.title || 'untitled canvas'}</h4>
                          <p className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1.5 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                            {getRelativeTime(ws.lastModified)}
                          </p>
                        </div>
                        
                        {/* Hover Quick Actions */}
                        <button 
                          onClick={(e) => toggleFavorite(e, ws.id)}
                          className={`p-1.5 rounded-full hover:bg-[var(--bg-secondary)] ${ws.isFavorite ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'} transition-colors`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={ws.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ALL CANVASES SECTION */}
          <section className="w-full flex flex-col gap-6">
            <div className="flex justify-between items-center border-b border-[var(--border)] pb-4">
              <div>
                <h3 className="text-[10px] uppercase font-bold tracking-widest text-[var(--text-secondary)]">
                  {activeSidebarTab === 'favorites' ? 'Favorite Canvases' : 
                   activeSidebarTab === 'archive' ? 'Archived Canvases' :
                   activeSidebarTab === 'deleted' ? 'Deleted Canvases (Trash)' : 'All Canvases'}
                </h3>
              </div>

              {/* View layout modes & sorting */}
              <div className="flex items-center gap-4 text-xs font-semibold text-[var(--text-secondary)]">
                {/* Grid vs List view toggle */}
                <div className="flex bg-[var(--bg-secondary)] p-0.5 rounded-lg border border-[var(--border)]">
                  <button 
                    onClick={() => setLayoutMode('grid')}
                    className={`px-2.5 py-1 rounded-md transition-all ${layoutMode === 'grid' ? 'bg-white shadow-sm text-[var(--text-primary)] font-bold' : 'hover:text-[var(--text-primary)]'}`}
                  >
                    grid
                  </button>
                  <button 
                    onClick={() => setLayoutMode('list')}
                    className={`px-2.5 py-1 rounded-md transition-all ${layoutMode === 'list' ? 'bg-white shadow-sm text-[var(--text-primary)] font-bold' : 'hover:text-[var(--text-primary)]'}`}
                  >
                    list
                  </button>
                </div>
                
                <span className="text-[var(--text-muted)]">·</span>
                <span className="cursor-pointer hover:text-[var(--text-primary)]">sorted by recent</span>
              </div>
            </div>

            {/* Category pills filters (Only visible in standard sidebar modes) */}
            {activeSidebarTab !== 'favorites' && activeSidebarTab !== 'archive' && activeSidebarTab !== 'deleted' && (
              <div className="flex flex-wrap gap-2">
                <CategoryPill active={activeCategory === 'all'} count={countAll} label="all" onClick={() => setActiveCategory('all')} />
                <CategoryPill active={activeCategory === 'work'} count={countWork} label="work" onClick={() => setActiveCategory('work')} />
                <CategoryPill active={activeCategory === 'personal'} count={countPersonal} label="personal" onClick={() => setActiveCategory('personal')} />
                <CategoryPill active={activeCategory === 'study'} count={countStudy} label="study" onClick={() => setActiveCategory('study')} />
              </div>
            )}

            {/* Workspaces Display */}
            {filteredList.length > 0 ? (
              layoutMode === 'grid' ? (
                /* GRID VIEW */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
                  {filteredList.map((ws) => {
                    const iconDetails = getCanvasIconDetails(ws.title || '', ws.category || 'personal');
                    
                    return (
                      <div
                        key={ws.id}
                        onClick={() => router.push(`/canvas?id=${ws.id}`)}
                        className="bg-white border border-[var(--border)] rounded-2xl p-5 hover:shadow-md hover:border-[var(--border-strong)] transition-all flex items-center justify-between group cursor-pointer relative overflow-hidden"
                      >
                        <div className="flex items-center gap-4 min-w-0 flex-1 pr-4">
                          {/* Square Rounded Icon Frame */}
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconDetails.bg}`}>
                            {iconDetails.icon}
                          </div>

                          <div className="min-w-0 flex-1">
                            {renamingId === ws.id ? (
                              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                <input
                                  type="text"
                                  value={renamingTitle}
                                  onChange={(e) => setRenamingTitle(e.target.value)}
                                  onBlur={() => saveRename(ws.id)}
                                  onKeyDown={(e) => e.key === 'Enter' && saveRename(ws.id)}
                                  className="text-sm font-bold border-b border-[var(--accent)] outline-none bg-transparent w-full"
                                  autoFocus
                                />
                              </div>
                            ) : (
                              <h4 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                                {ws.title || 'untitled canvas'}
                              </h4>
                            )}
                            <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 truncate">
                              {ws.objectCount} cards · {getRelativeTime(ws.lastModified)}
                            </p>
                          </div>
                        </div>

                        {/* Hover settings / menu quick actions */}
                        <div 
                          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" 
                          onClick={e => e.stopPropagation()}
                        >
                          {/* Rename */}
                          <button 
                            onClick={(e) => startRenaming(e, ws.id, ws.title || '')}
                            title="Rename"
                            className="p-1.5 rounded-full hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                          </button>
                          
                          {/* Archive toggle */}
                          <button 
                            onClick={(e) => toggleArchive(e, ws.id)}
                            title={ws.archived ? "Unarchive" : "Archive"}
                            className={`p-1.5 rounded-full hover:bg-[var(--bg-secondary)] ${ws.archived ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /></svg>
                          </button>

                          {/* Delete toggle */}
                          <button 
                            onClick={(e) => toggleDelete(e, ws.id)}
                            title={ws.deleted ? "Restore" : "Move to Trash"}
                            className="p-1.5 rounded-full hover:bg-red-50 text-[var(--text-secondary)] hover:text-red-500"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                          </button>

                          {/* Cycle Color */}
                          <button 
                            onClick={(e) => handleColorCycle(e, ws.id, ws.themeColor)}
                            title="Cycle background color"
                            className="p-1.5 rounded-full hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /></svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add New Canvas card */}
                  {activeSidebarTab !== 'favorites' && activeSidebarTab !== 'archive' && activeSidebarTab !== 'deleted' && (
                    <div 
                      onClick={openNewCanvas}
                      className="border border-dashed border-[var(--border-strong)] bg-transparent hover:bg-white/50 rounded-2xl p-5 flex items-center justify-center gap-3 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all min-h-[85px] group"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:rotate-90 transition-transform duration-300">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span className="text-xs font-bold uppercase tracking-wider">new canvas</span>
                    </div>
                  )}
                </div>
              ) : (
                /* LIST VIEW */
                <div className="w-full bg-white border border-[var(--border)] rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[#FAF6F1]/50 text-[10px] uppercase font-bold tracking-widest text-[var(--text-secondary)] select-none">
                        <th className="py-4 px-6">Workspace Title</th>
                        <th className="py-4 px-6">Category</th>
                        <th className="py-4 px-6">Stats</th>
                        <th className="py-4 px-6">Last Edited</th>
                        <th className="py-4 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredList.map((ws) => (
                        <tr 
                          key={ws.id}
                          onClick={() => router.push(`/canvas?id=${ws.id}`)}
                          className="border-b border-[var(--border)] last:border-b-0 hover:bg-[#FAF6F1]/30 cursor-pointer transition-colors group"
                        >
                          <td className="py-4 px-6 font-bold text-sm text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                            {ws.title || 'untitled canvas'}
                          </td>
                          <td className="py-4 px-6">
                            <span className="px-2.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-extrabold bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
                              {ws.category || 'personal'}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-xs text-[var(--text-secondary)]">
                            {ws.objectCount} cards · {ws.strokeCount} sketches · {ws.connectionCount} threads
                          </td>
                          <td className="py-4 px-6 text-xs text-[var(--text-secondary)]">
                            {getRelativeTime(ws.lastModified)}
                          </td>
                          <td className="py-4 px-6 text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-end gap-1.5">
                              <button 
                                onClick={(e) => toggleFavorite(e, ws.id)}
                                className={`p-1.5 rounded-full hover:bg-[var(--bg-secondary)] ${ws.isFavorite ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill={ws.isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>
                              </button>
                              
                              <button 
                                onClick={(e) => toggleArchive(e, ws.id)}
                                className={`p-1.5 rounded-full hover:bg-[var(--bg-secondary)] ${ws.archived ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /></svg>
                              </button>

                              <button 
                                onClick={(e) => toggleDelete(e, ws.id)}
                                className="p-1.5 rounded-full hover:bg-red-50 text-[var(--text-secondary)] hover:text-red-500"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              /* EMPTY FILTER RESULTS */
              <div className="text-center py-16 border border-dashed border-[var(--border-strong)] rounded-2xl bg-white/40">
                <span className="text-3xl">🫙</span>
                <h4 className="text-sm font-bold text-[var(--text-primary)] mt-3">No workspaces found</h4>
                <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xs mx-auto">
                  {searchQuery ? `No matching workspaces for "${searchQuery}"` : 'This category or filter tab is currently empty.'}
                </p>
                {!searchQuery && activeSidebarTab === 'home' && (
                  <button 
                    onClick={openNewCanvas}
                    className="mt-4 px-4 py-2 bg-[var(--accent)] text-white text-xs font-semibold rounded-full hover:bg-[#B36738] shadow"
                  >
                    Create a Space
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Floating Orange Add Action Button */}
      <motion.button
        onClick={openNewCanvas}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-10 right-10 w-14 h-14 bg-[var(--accent)] hover:bg-[#B36738] text-white rounded-full flex items-center justify-center shadow-xl z-50 border border-[var(--accent-light)] transition-colors duration-200"
        title="Create New Canvas"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </motion.button>
    </div>
  );
}

// Sub-components
function SidebarButton({ 
  icon, 
  title, 
  active, 
  onClick 
}: { 
  icon: React.ReactNode; 
  title: string; 
  active: boolean; 
  onClick: () => void; 
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
        active 
          ? 'bg-[#F5EFE7] text-[var(--accent)] border border-[var(--border-strong)]' 
          : 'text-[var(--text-secondary)] hover:bg-[#FAF6F1]/80 hover:text-[var(--text-primary)] border border-transparent'
      }`}
    >
      <span className={active ? 'opacity-100 scale-105' : 'opacity-70 group-hover:opacity-100'}>
        {icon}
      </span>
    </button>
  );
}

function StatPill({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FAF6F1]/80 border border-[var(--border)] rounded-full text-[10px] text-[var(--text-secondary)] font-semibold select-none shadow-sm">
      <span className="opacity-70">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function CategoryPill({ 
  label, 
  count, 
  active, 
  onClick 
}: { 
  label: string; 
  count: number; 
  active: boolean; 
  onClick: () => void; 
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${
        active 
          ? 'bg-[#201E1C] border-[#201E1C] text-white shadow-sm' 
          : 'bg-[#F5EFE7]/50 hover:bg-[#F5EFE7] border-[var(--border)] text-[var(--text-secondary)]'
      }`}
    >
      <span className="uppercase tracking-wider">{label}</span>
      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-extrabold ${active ? 'bg-white/20 text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border)]'}`}>
        {count}
      </span>
    </button>
  );
}
