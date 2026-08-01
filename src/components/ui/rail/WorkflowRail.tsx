'use client';

import React from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import WorkflowMenu from '../WorkflowMenu';
import RailShell from './RailShell';
import { Icon } from './RailKit';

/**
 * Workflows — the AI generator and the preset library — docked like everything
 * else. It's the one rail context that isn't a canvas mode: you stay in select
 * while you browse, so the toolbar and the rail agree through `workflowOpen`.
 */
export default function WorkflowRail() {
  const setWorkflowOpen = useCanvasStore((s) => s.setWorkflowOpen);

  return (
    <RailShell
      railKey="workflow"
      icon={
        <Icon size={14}>
          <rect x="3" y="3" width="5" height="5" rx="1" />
          <rect x="16" y="9" width="5" height="5" rx="1" />
          <rect x="3" y="16" width="5" height="5" rx="1" />
          <path d="M8 5.5h5a3 3 0 0 1 3 3v0.5" />
          <path d="M16 11.5v2a3 3 0 0 1-3 3H8" />
        </Icon>
      }
      title="Workflow"
      subtitle="Describe one, or start from a preset"
      onClose={() => setWorkflowOpen(false)}
      closeTitle="Close workflows"
    >
      <div style={{ paddingTop: 8 }}>
        <WorkflowMenu variant="rail" onClose={() => setWorkflowOpen(false)} />
      </div>
    </RailShell>
  );
}
