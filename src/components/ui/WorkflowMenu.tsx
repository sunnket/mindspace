'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { v4 as uuidv4 } from 'uuid';

interface TemplateNode {
  tempId: string;
  content: string;
  shape: 'circle' | 'square' | 'pill' | 'diamond';
  offsetX: number;
  offsetY: number;
}

interface TemplateConnection {
  fromTempId: string;
  toTempId: string;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: 'Business' | 'Academic' | 'Creative' | 'Productivity';
  icon: React.ReactNode;
  nodes: TemplateNode[];
  connections: TemplateConnection[];
}

const PRESET_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'startup-flow',
    name: 'Startup Flow',
    description: 'Pitch to MVP scale journey roadmap.',
    category: 'Business',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Idea Pitch', shape: 'pill', offsetX: -350, offsetY: 0 },
      { tempId: 'n2', content: 'Team Assembly', shape: 'square', offsetX: -180, offsetY: 0 },
      { tempId: 'n3', content: 'MVP Build', shape: 'square', offsetX: 0, offsetY: 0 },
      { tempId: 'n4', content: 'Beta Launch', shape: 'circle', offsetX: 180, offsetY: -80 },
      { tempId: 'n5', content: 'Feedback Loop', shape: 'diamond', offsetX: 180, offsetY: 80 },
      { tempId: 'n6', content: 'Pivot or Scale', shape: 'pill', offsetX: 350, offsetY: 0 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n3', toTempId: 'n5' },
      { fromTempId: 'n4', toTempId: 'n6' },
      { fromTempId: 'n5', toTempId: 'n6' }
    ]
  },
  {
    id: 'study-roadmap',
    name: 'Study Roadmap',
    description: 'Foundations to advanced mastery path.',
    category: 'Academic',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Goal Setup', shape: 'pill', offsetX: -300, offsetY: 0 },
      { tempId: 'n2', content: 'Foundations', shape: 'square', offsetX: -150, offsetY: 0 },
      { tempId: 'n3', content: 'Core Concepts', shape: 'square', offsetX: 0, offsetY: 0 },
      { tempId: 'n4', content: 'Projects', shape: 'square', offsetX: 150, offsetY: 0 },
      { tempId: 'n5', content: 'Advanced Topics', shape: 'square', offsetX: 300, offsetY: 0 },
      { tempId: 'n6', content: 'Mastery', shape: 'pill', offsetX: 450, offsetY: 0 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n4', toTempId: 'n5' },
      { fromTempId: 'n5', toTempId: 'n6' }
    ]
  },
  {
    id: 'design-process',
    name: 'Design Process',
    description: 'Double diamond product design sequence.',
    category: 'Creative',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><circle cx="8" cy="10" r="1" fill="currentColor" /><circle cx="12" cy="7.5" r="1" fill="currentColor" /><circle cx="16" cy="10" r="1" fill="currentColor" /><path d="M12 22a10 10 0 0 0 0-20" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Empathize', shape: 'circle', offsetX: -300, offsetY: 0 },
      { tempId: 'n2', content: 'Define', shape: 'diamond', offsetX: -150, offsetY: 0 },
      { tempId: 'n3', content: 'Ideate', shape: 'square', offsetX: 0, offsetY: 0 },
      { tempId: 'n4', content: 'Prototype', shape: 'square', offsetX: 150, offsetY: 0 },
      { tempId: 'n5', content: 'Test & Refine', shape: 'diamond', offsetX: 300, offsetY: 0 },
      { tempId: 'n6', content: 'Deploy UI', shape: 'pill', offsetX: 450, offsetY: 0 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n4', toTempId: 'n5' },
      { fromTempId: 'n5', toTempId: 'n6' },
      { fromTempId: 'n5', toTempId: 'n3' } // feedback cycle
    ]
  },
  {
    id: 'content-pipeline',
    name: 'Content Pipeline',
    description: 'Workflow for video, writing, or design.',
    category: 'Creative',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20M7 6l2 4M13 6l2 4" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Brainstorm Ideas', shape: 'pill', offsetX: -300, offsetY: -80 },
      { tempId: 'n2', content: 'Research / Outline', shape: 'square', offsetX: -150, offsetY: -80 },
      { tempId: 'n3', content: 'Draft / Script', shape: 'square', offsetX: 0, offsetY: -80 },
      { tempId: 'n4', content: 'Production', shape: 'circle', offsetX: 150, offsetY: -80 },
      { tempId: 'n5', content: 'Post Edit', shape: 'square', offsetX: 150, offsetY: 80 },
      { tempId: 'n6', content: 'QA Approval', shape: 'diamond', offsetX: 0, offsetY: 80 },
      { tempId: 'n7', content: 'Publish content', shape: 'pill', offsetX: -150, offsetY: 80 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n4', toTempId: 'n5' },
      { fromTempId: 'n5', toTempId: 'n6' },
      { fromTempId: 'n6', toTempId: 'n7' }
    ]
  },
  {
    id: 'product-launch',
    name: 'Product Launch Flow',
    description: 'Cross-functional dev & launch pipeline.',
    category: 'Productivity',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'PRD Drafted', shape: 'pill', offsetX: -300, offsetY: 0 },
      { tempId: 'n2', content: 'Specs Review', shape: 'diamond', offsetX: -150, offsetY: 0 },
      { tempId: 'n3', content: 'Core Development', shape: 'square', offsetX: 0, offsetY: 0 },
      { tempId: 'n4', content: 'Internal Beta', shape: 'circle', offsetX: 150, offsetY: 0 },
      { tempId: 'n5', content: 'Marketing Blitz', shape: 'square', offsetX: 150, offsetY: 100 },
      { tempId: 'n6', content: 'Public Launch', shape: 'pill', offsetX: 300, offsetY: 0 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n4', toTempId: 'n6' },
      { fromTempId: 'n4', toTempId: 'n5' },
      { fromTempId: 'n5', toTempId: 'n6' }
    ]
  },
  {
    id: 'brainstorm-net',
    name: 'Brainstorm Network',
    description: 'Creative hub-and-spoke thinking web.',
    category: 'Creative',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3v18M12 8c-2.5 0-4 1-4 4M12 8c2.5 0 4 1 4 4" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Core Concept', shape: 'circle', offsetX: 0, offsetY: 0 },
      { tempId: 'n2', content: 'Aesthetic / Visuals', shape: 'square', offsetX: -180, offsetY: -120 },
      { tempId: 'n3', content: 'Tech Stack', shape: 'square', offsetX: 180, offsetY: -120 },
      { tempId: 'n4', content: 'Market Size', shape: 'square', offsetX: -180, offsetY: 120 },
      { tempId: 'n5', content: 'Value Proposition', shape: 'square', offsetX: 180, offsetY: 120 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n1', toTempId: 'n3' },
      { fromTempId: 'n1', toTempId: 'n4' },
      { fromTempId: 'n1', toTempId: 'n5' }
    ]
  },
  {
    id: 'research-map',
    name: 'Research Mapping',
    description: 'Academics hypothesis experimental chart.',
    category: 'Academic',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 18h8M3 22h18M14 22a7 7 0 1 0 0-14h-1M9 14h2M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2zM12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Hypothesis Stated', shape: 'diamond', offsetX: -300, offsetY: 0 },
      { tempId: 'n2', content: 'Literature Review', shape: 'square', offsetX: -150, offsetY: -80 },
      { tempId: 'n3', content: 'Experiment Design', shape: 'square', offsetX: 0, offsetY: 0 },
      { tempId: 'n4', content: 'Data Collection', shape: 'square', offsetX: 150, offsetY: 80 },
      { tempId: 'n5', content: 'Thesis Published', shape: 'pill', offsetX: 300, offsetY: 0 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n1', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n4', toTempId: 'n5' }
    ]
  },
  {
    id: 'habit-tracker',
    name: 'Habit Tracker System',
    description: 'Weekly goal setting and feedback tracker.',
    category: 'Productivity',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Weekly Habit Target', shape: 'pill', offsetX: -240, offsetY: 0 },
      { tempId: 'n2', content: 'Daily Action Cue', shape: 'circle', offsetX: -80, offsetY: 0 },
      { tempId: 'n3', content: 'Streak Multiplier', shape: 'square', offsetX: 80, offsetY: 0 },
      { tempId: 'n4', content: 'Monthly Reward', shape: 'diamond', offsetX: 240, offsetY: 0 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' }
    ]
  },
  {
    id: 'mindmap-tree',
    name: 'Mindmap Tree',
    description: 'Classic hierarchical left-right tree structure.',
    category: 'Academic',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3v12a6 6 0 0 0 6 6h0" /><circle cx="6" cy="3" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 9c6 0 8 0 12 0" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Core Subject', shape: 'circle', offsetX: 0, offsetY: 0 },
      { tempId: 'n2', content: 'Subtopic Alpha', shape: 'square', offsetX: -180, offsetY: 0 },
      { tempId: 'n3', content: 'Subtopic Beta', shape: 'square', offsetX: 180, offsetY: 0 },
      { tempId: 'n4', content: 'Alpha Details 1', shape: 'pill', offsetX: -320, offsetY: -80 },
      { tempId: 'n5', content: 'Alpha Details 2', shape: 'pill', offsetX: -320, offsetY: 80 },
      { tempId: 'n6', content: 'Beta Details 1', shape: 'pill', offsetX: 320, offsetY: -80 },
      { tempId: 'n7', content: 'Beta Details 2', shape: 'pill', offsetX: 320, offsetY: 80 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n1', toTempId: 'n3' },
      { fromTempId: 'n2', toTempId: 'n4' },
      { fromTempId: 'n2', toTempId: 'n5' },
      { fromTempId: 'n3', toTempId: 'n6' },
      { fromTempId: 'n3', toTempId: 'n7' }
    ]
  },
  {
    id: 'daily-planning',
    name: 'Daily Planning Workflow',
    description: 'Sequenced daily planning checklist pipeline.',
    category: 'Productivity',
    icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>),
    nodes: [
      { tempId: 'n1', content: 'Morning Review', shape: 'pill', offsetX: 0, offsetY: -180 },
      { tempId: 'n2', content: 'Deep Work Block', shape: 'square', offsetX: 0, offsetY: -90 },
      { tempId: 'n3', content: 'Lunch Sync', shape: 'circle', offsetX: 0, offsetY: 0 },
      { tempId: 'n4', content: 'Admin & Email', shape: 'square', offsetX: 0, offsetY: 90 },
      { tempId: 'n5', content: 'Evening Planning', shape: 'pill', offsetX: 0, offsetY: 180 }
    ],
    connections: [
      { fromTempId: 'n1', toTempId: 'n2' },
      { fromTempId: 'n2', toTempId: 'n3' },
      { fromTempId: 'n3', toTempId: 'n4' },
      { fromTempId: 'n4', toTempId: 'n5' }
    ]
  }
];

const PRESET_PALETTES = [
  {
    name: 'Creamy Sand',
    shapeBg: '#FAF6F1',
    borderColor: '#C97B4B',
    textColor: '#2D2A26',
    branchColor: '#C97B4B',
    preview: 'bg-[#FAF6F1] border-[#C97B4B]'
  },
  {
    name: 'Sunset Peach',
    shapeBg: '#FFF5F0',
    borderColor: '#E07A5F',
    textColor: '#3D405B',
    branchColor: '#E07A5F',
    preview: 'bg-[#FFF5F0] border-[#E07A5F]'
  },
  {
    name: 'Sage Mint',
    shapeBg: '#F4F9F4',
    borderColor: '#81B29A',
    textColor: '#2F3E46',
    branchColor: '#81B29A',
    preview: 'bg-[#F4F9F4] border-[#81B29A]'
  },
  {
    name: 'Terracotta Earth',
    shapeBg: '#FDF2E9',
    borderColor: '#D35400',
    textColor: '#5E2C00',
    branchColor: '#D35400',
    preview: 'bg-[#FDF2E9] border-[#D35400]'
  },
  {
    name: 'Sky Breeze',
    shapeBg: '#F0F8FF',
    borderColor: '#4A90E2',
    textColor: '#1A365D',
    branchColor: '#4A90E2',
    preview: 'bg-[#F0F8FF] border-[#4A90E2]'
  }
];

const renderTemplateIcon = (id: string) => {
  const props = {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    // Neutral outline like the Plus menu — inherits the row's text colour and
    // warms to the accent on hover, instead of being a permanently orange icon.
    className: "text-[var(--text-secondary)] group-hover:text-[var(--accent)] transition-colors shrink-0"
  } as const;

  switch (id) {
    case 'startup-flow':
      return (
        <svg {...props}>
          <path d="M4.5 16.5c-1.5 1.26-2.5 3.19-2.5 3.5s2.24 1 3.5-1" />
          <path d="M12 2C7.5 2 4 5.5 4 10c0 2.5 1.5 4.5 3.5 5.5" />
          <path d="M12 2c4.5 0 8 3.5 8 8 0 2.5-1.5 4.5-3.5 5.5" />
          <path d="M12 22v-3" />
        </svg>
      );
    case 'study-roadmap':
      return (
        <svg {...props}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'design-process':
      return (
        <svg {...props}>
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10c1.378 0 2.5-1.122 2.5-2.5 0-.584-.202-1.123-.539-1.55-.3-.38-.461-.85-.461-1.341 0-1.103.897-2 2-2H18c2.206 0 4-1.794 4-4a8 8 0 0 0-10-6.5Z" />
        </svg>
      );
    case 'content-pipeline':
      return (
        <svg {...props}>
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
          <line x1="7" y1="2" x2="7" y2="22" />
          <line x1="17" y1="2" x2="17" y2="22" />
          <line x1="2" y1="12" x2="22" y2="12" />
        </svg>
      );
    case 'product-launch':
      return (
        <svg {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'brainstorm-net':
      return (
        <svg {...props}>
          <rect x="3" y="11" width="4" height="4" rx="1" />
          <rect x="17" y="11" width="4" height="4" rx="1" />
          <rect x="10" y="3" width="4" height="4" rx="1" />
          <rect x="10" y="17" width="4" height="4" rx="1" />
          <line x1="7" y1="13" x2="10" y2="5" />
          <line x1="7" y1="13" x2="10" y2="19" />
          <line x1="17" y1="13" x2="14" y2="5" />
          <line x1="17" y1="13" x2="14" y2="19" />
        </svg>
      );
    case 'research-map':
      return (
        <svg {...props}>
          <path d="M4.5 22h15" />
          <path d="M6 2h12" />
          <path d="M8 2v7.586a1 1 0 0 1-.293.707l-2.414 2.414a2 2 0 0 0-.586 1.414V20a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.88a2 2 0 0 0-.586-1.414L16.29 9.29A1 1 0 0 1 16 8.586V2" />
        </svg>
      );
    case 'habit-tracker':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case 'mindmap-tree':
      return (
        <svg {...props}>
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 0 8.5a7 7 0 0 1-8 9.5Z" />
        </svg>
      );
    case 'daily-planning':
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
};

export default function WorkflowMenu({ onClose }: { onClose: () => void }) {
  const {
    addObject,
    addConnection,
    connections,
    objects,
    camera,
    activeWorkflowId,
    setActiveWorkflowId,
    layoutWorkflow,
    recolorWorkflowGroup
  } = useCanvasStore();

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');

  // AI Workflow: hand the prompt to the streaming canvas agent in "workflow"
  // mode. It builds a full, end-to-end, richly-styled workflow live on the
  // canvas (varied fonts/colors, phases, connections, widgets), so we close the
  // menu and let the user watch it come together.
  const handleGenerateAI = () => {
    const text = aiPrompt.trim();
    if (!text) return;
    const cx = (window.innerWidth / 2 - camera.x) / camera.zoom;
    const cy = (window.innerHeight / 2 - camera.y) / camera.zoom;
    window.dispatchEvent(
      new CustomEvent('run-agent', { detail: { prompt: text, mode: 'workflow', x: cx, y: cy } })
    );
    setAiPrompt('');
    onClose();
  };

  // Load favorites & recents from localStorage
  useEffect(() => {
    const favs = localStorage.getItem('workflow-favorites');
    if (favs) setFavorites(JSON.parse(favs));
    
    const recs = localStorage.getItem('workflow-recents');
    if (recs) setRecents(JSON.parse(recs));
  }, []);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = favorites.includes(id)
      ? favorites.filter(x => x !== id)
      : [...favorites, id];
    setFavorites(updated);
    localStorage.setItem('workflow-favorites', JSON.stringify(updated));
  };

  const handleSpawn = (template: WorkflowTemplate) => {
    const newWorkflowId = uuidv4();

    // Center viewport in canvas coords
    const cx = (window.innerWidth / 2 - camera.x) / camera.zoom;
    const cy = (window.innerHeight / 2 - camera.y) / camera.zoom;

    const tempIdMap = new Map<string, string>();
    const defaultPalette = PRESET_PALETTES[0];

    const defaultStyle = {
      workflowId: newWorkflowId,
      isWorkflowNode: true,
      nodeShape: 'pill',
      color: defaultPalette.shapeBg,
      borderColor: defaultPalette.borderColor,
      textColor: defaultPalette.textColor,
      branchColor: defaultPalette.branchColor,
      fontSize: 14,
      fontFamily: "'Inter', sans-serif"
    };

    template.nodes.forEach(n => {
      const spawnedObj = addObject({
        type: 'workflow-node',
        x: cx + n.offsetX - 80,
        y: cy + n.offsetY - 30,
        width: 160,
        height: 60,
        content: n.content,
        style: {
          ...defaultStyle,
          nodeShape: n.shape
        }
      });
      tempIdMap.set(n.tempId, spawnedObj.id);
    });

    template.connections.forEach(c => {
      const fromId = tempIdMap.get(c.fromTempId);
      const toId = tempIdMap.get(c.toTempId);
      if (fromId && toId) {
        addConnection(fromId, toId, {
          isWorkflowConnection: true,
          workflowId: newWorkflowId,
          color: defaultStyle.branchColor
        });
      }
    });

    setActiveWorkflowId(newWorkflowId);

    // Save to recents
    const updatedRecents = [template.id, ...recents.filter(x => x !== template.id)].slice(0, 5);
    setRecents(updatedRecents);
    localStorage.setItem('workflow-recents', JSON.stringify(updatedRecents));
  };

  // Find spawned workflows currently on the canvas
  const spawnedWorkflowsOnCanvas = useMemo(() => {
    const spawnedIds = new Set<string>();
    objects.forEach(o => {
      if (o.type === 'workflow-node' && o.style?.workflowId) {
        spawnedIds.add(o.style.workflowId as string);
      }
    });
    return Array.from(spawnedIds);
  }, [objects]);

  const activeWorkflowLabel = useMemo(() => {
    if (!activeWorkflowId) return null;
    // Find any node in the active workflow to display its content/context
    const node = objects.find(o => o.type === 'workflow-node' && o.style?.workflowId === activeWorkflowId);
    if (!node) return 'Active Flow';
    return `Active Flow (${node.content || 'Untitled'})`;
  }, [activeWorkflowId, objects]);

  // Filtered presets list
  const filteredTemplates = useMemo(() => {
    return PRESET_TEMPLATES.filter(t => {
      if (selectedCategory === 'All') return true;
      if (selectedCategory === 'Favorites') return favorites.includes(t.id);
      return t.category === selectedCategory;
    });
  }, [selectedCategory, favorites]);

  return (
    <div style={{ padding: 20 }} className="workflow-menu glass-panel max-w-[420px] w-full text-sm font-sans flex flex-col gap-4 max-h-[82vh] overflow-y-auto select-none pointer-events-auto border border-[var(--border)] shadow-xl bg-[var(--bg-glass)]">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-[var(--border)] shrink-0" style={{ paddingBottom: 10 }}>
        <div>
          <h3 className="font-semibold text-base text-[var(--text-primary)] flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]">
              <rect x="3" y="3" width="5" height="5" rx="1" />
              <rect x="16" y="9" width="5" height="5" rx="1" />
              <rect x="3" y="16" width="5" height="5" rx="1" />
              <path d="M8 5.5h5a3 3 0 0 1 3 3v0.5" />
              <path d="M16 11.5v2a3 3 0 0 1-3 3H8" />
            </svg>
            Workflow Engine
          </h3>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[var(--bg-tertiary)] transition text-[var(--text-secondary)] cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* AI Workflow generator — describe anything, get a full end-to-end build.
          shrink-0 (and no overflow-hidden) so the tall menu's flex column can't
          compress this box and clip its own textarea/button — that was the
          "compacted" bug. Tint is a faint accent wash, not a loud orange fill. */}
      <div className="shrink-0 rounded-xl border flex flex-col gap-2"
        style={{
          padding: 12,
          borderColor: 'rgba(var(--accent-rgb), 0.14)',
          background: 'rgba(var(--accent-rgb), 0.04)',
        }}>
        {/* Compact one-line header: simple sparkle + title + inline hint */}
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--accent)]" aria-hidden="true">
            <path d="M12 3l1.7 5.3L19 11l-5.3 1.7L12 18l-1.7-5.3L5 11l5.3-1.7z" />
          </svg>
          <h4 className="text-xs font-bold text-[var(--text-primary)] shrink-0">AI Workflow</h4>
          <p className="text-[10px] text-[var(--text-tertiary)] leading-snug truncate">— describe it, get a full styled build</p>
        </div>

        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleGenerateAI();
            }
          }}
          rows={2}
          placeholder="e.g. A go-to-market plan for a B2B SaaS launch — research, build, beta, launch…"
          style={{ padding: '9px 11px' }}
          className="w-full resize-none text-xs leading-relaxed rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)] transition"
        />

        <button
          onClick={handleGenerateAI}
          disabled={!aiPrompt.trim()}
          style={{ padding: '8px 0' }}
          className={`w-full rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
            aiPrompt.trim()
              ? 'bg-[var(--accent)] text-white shadow-sm hover:shadow-md hover:brightness-105 cursor-pointer'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-not-allowed'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.7 5.3L19 11l-5.3 1.7L12 18l-1.7-5.3L5 11l5.3-1.7z" />
          </svg>
          Generate workflow
        </button>
      </div>

      {/* Blueprint library divider */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[9px] uppercase tracking-widest font-semibold text-[var(--text-tertiary)]">Or start from a blueprint</span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {/* Categories */}
      <div className="flex flex-wrap gap-1.5 shrink-0">
        {['All', 'Favorites', 'Business', 'Academic', 'Creative', 'Productivity'].map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            style={{ padding: '5px 11px' }}
            className={`rounded-full text-[10px] uppercase tracking-wider font-semibold transition border cursor-pointer ${
              selectedCategory === cat
                ? 'bg-[var(--accent)]/70 border-[var(--accent)]/75 text-white/90 shadow-sm'
                : 'bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Presets List */}
      <div className="flex flex-col gap-2 max-h-[260px] overflow-y-auto pr-1">
        {filteredTemplates.length === 0 ? (
          <div className="text-center text-xs text-[var(--text-tertiary)] italic bg-[var(--bg-card)] rounded-lg border border-[var(--border)]" style={{ padding: '28px 12px' }}>
            No workflow templates found
          </div>
        ) : (
          filteredTemplates.map(template => {
            const isFav = favorites.includes(template.id);
            return (
              <div
                key={template.id}
                onClick={() => handleSpawn(template)}
                style={{ padding: '10px 12px' }}
                className="group rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent-light)] hover:bg-[var(--bg-tertiary)] transition-all flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--bg-secondary)] group-hover:bg-[var(--accent)]/10 transition-colors">
                    {renderTemplateIcon(template.id)}
                  </span>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-xs text-[var(--text-primary)] truncate">{template.name}</h4>
                    <p className="text-[10px] text-[var(--text-tertiary)] leading-tight truncate">{template.description}</p>
                  </div>
                </div>
                <button
                  onClick={(e) => toggleFavorite(template.id, e)}
                  style={{ padding: 4 }}
                  className="shrink-0 hover:scale-110 transition cursor-pointer"
                >
                  {isFav ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-red-500">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-tertiary)] hover:text-red-500">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Spelled out Canvas Selection context */}
      {spawnedWorkflowsOnCanvas.length > 0 && (
        <div className="flex flex-col gap-2 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]" style={{ padding: 12 }}>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Active Workflow Target
          </label>
          <select
            value={activeWorkflowId || ''}
            onChange={(e) => setActiveWorkflowId(e.target.value || null)}
            style={{ padding: '7px 8px' }}
            className="w-full text-xs rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="">-- No Active Workflow Selected --</option>
            {spawnedWorkflowsOnCanvas.map((id, index) => {
              const rootNode = objects.find(o => o.type === 'workflow-node' && o.style?.workflowId === id);
              const labelText = rootNode ? `Flow: ${rootNode.content || `Untitled (${index + 1})`}` : `Workflow ${index + 1}`;
              return (
                <option key={id} value={id}>
                  {labelText}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Active layout switcher & coloring (only shows if activeWorkflowId is set) */}
      {activeWorkflowId ? (
        <div className="flex flex-col gap-3 bg-[rgba(var(--accent-rgb),0.04)] rounded-xl border border-[rgba(var(--accent-rgb),0.15)] animate-fade-in" style={{ padding: 12 }}>
          {/* Section: Layout Switcher */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {activeWorkflowLabel}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold uppercase tracking-wide">
                Linked Layout
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {[
                { 
                  mode: 'horizontal', 
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <polyline points="8 8 4 12 8 16" />
                      <polyline points="16 8 20 12 16 16" />
                    </svg>
                  ), 
                  label: 'Horiz' 
                },
                { 
                  mode: 'vertical', 
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="4" x2="12" y2="20" />
                      <polyline points="8 8 12 4 16 8" />
                      <polyline points="8 16 12 20 16 16" />
                    </svg>
                  ), 
                  label: 'Vert' 
                },
                { 
                  mode: 'radial', 
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                  ), 
                  label: 'Radial' 
                },
                { 
                  mode: 'mindmap', 
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <path d="M9 12h3c1.5 0 3-1 3-3V8" />
                      <path d="M9 12h3c1.5 0 3 1 3 3v3" />
                    </svg>
                  ), 
                  label: 'Mindmap' 
                },
                { 
                  mode: 'freeform', 
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="1" />
                      <path d="M16.24 7.76a6 6 0 1 0 0 8.49" />
                      <path d="M19.07 4.93a10 10 0 1 0 0 14.14" />
                    </svg>
                  ), 
                  label: 'Free' 
                }
              ].map(item => (
                <button
                  key={item.mode}
                  onClick={() => layoutWorkflow(activeWorkflowId, item.mode as any)}
                  style={{ padding: '7px 4px' }}
                  className="flex flex-col items-center gap-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent-light)] transition hover:bg-[var(--bg-primary)] cursor-pointer"
                  title={`${item.label} Layout`}
                >
                  <span className="flex items-center justify-center text-xs h-4">{item.icon}</span>
                  <span className="text-[8px] font-medium tracking-tight text-[var(--text-secondary)]">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section: Recolor System */}
          <div className="border-t border-[var(--border)]" style={{ paddingTop: 10 }}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] block mb-2">
              Recolor Group Scheme
            </span>
            <div className="flex flex-col gap-2">
              {/* Palette swatches */}
              <div className="flex gap-2">
                {PRESET_PALETTES.map(p => (
                  <button
                    key={p.name}
                    onClick={() => recolorWorkflowGroup(activeWorkflowId, {
                      color: p.shapeBg,
                      borderColor: p.borderColor,
                      textColor: p.textColor,
                      branchColor: p.branchColor
                    })}
                    className={`w-6 h-6 rounded-full border-2 cursor-pointer shadow-sm hover:scale-115 transition ${p.preview}`}
                    title={p.name}
                  />
                ))}
              </div>
              
              {/* Custom sub-recoloring toggles */}
              <div className="flex flex-wrap gap-1.5 mt-1">
                <button
                  onClick={() => recolorWorkflowGroup(activeWorkflowId, { color: 'rgba(255,255,255,0.05)', borderColor: 'rgba(45,42,38,0.15)' })}
                  style={{ padding: '4px 9px' }}
                  className="rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition text-[9px] uppercase font-bold text-[var(--text-secondary)] cursor-pointer"
                >
                  Transparent Glass
                </button>
                <button
                  onClick={() => recolorWorkflowGroup(activeWorkflowId, { branchColor: '#E07A5F' })}
                  style={{ padding: '4px 9px' }}
                  className="rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition text-[9px] uppercase font-bold text-[var(--text-secondary)] cursor-pointer"
                >
                  Orange Branches
                </button>
                <button
                  onClick={() => recolorWorkflowGroup(activeWorkflowId, { branchColor: '#81B29A' })}
                  style={{ padding: '4px 9px' }}
                  className="rounded-md bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition text-[9px] uppercase font-bold text-[var(--text-secondary)] cursor-pointer"
                >
                  Sage Branches
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-center italic text-[var(--text-tertiary)] bg-[var(--bg-card)] rounded-md border border-[var(--border)]" style={{ padding: '8px 12px' }}>
          Spawn a blueprint or select a workflow node to open layouts/coloring
        </div>
      )}
    </div>
  );
}
