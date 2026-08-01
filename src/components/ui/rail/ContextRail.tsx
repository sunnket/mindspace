'use client';

import React from 'react';
import { AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import SelectionRail from './SelectionRail';
import DrawRail from './DrawRail';
import ShapeRail from './ShapeRail';
import FrameRail from './FrameRail';
import BrainstormRail from './BrainstormRail';
import WorkflowRail from './WorkflowRail';

/**
 * One panel, on the right, for whatever you are doing.
 *
 * Every tool used to carry its own flyout above the toolbar — the brush had an
 * 840px one with a "simple/advanced" switch, shapes had a tabbed grid, frames
 * and the corkboard had their own, and selection properties had a strip. Each
 * appeared in a different place, at a different size, in a slightly different
 * dialect of the same design system, and every one of them covered the board.
 *
 * They are all this rail now. It only ever shows ONE thing, which is what makes
 * a single dock possible: the arbitration below is the whole feature. A tool
 * you have deliberately picked up outranks a lingering selection — if you press
 * D while a card is selected, you want the brush, not the card.
 */
export default function ContextRail() {
  const mode = useCanvasStore((s) => s.mode);
  const isTouring = useCanvasStore((s) => s.isTouring);
  const workflowOpen = useCanvasStore((s) => s.workflowOpen);
  const selectedId = useCanvasStore((s) => s.selectedId);

  /* A tour is a presentation — chrome gets out of the way entirely. */
  const context = isTouring ? null
    : workflowOpen ? 'workflow'
    : mode === 'draw' ? 'draw'
    : mode === 'shape' ? 'shape'
    : mode === 'frame' ? 'frame'
    : mode === 'brainstorm' ? 'brainstorm'
    : (selectedId || mode === 'text' || mode === 'arrow') ? 'selection'
    : null;

  return (
    <AnimatePresence mode="wait">
      {context === 'workflow' && <WorkflowRail key="workflow" />}
      {context === 'draw' && <DrawRail key="draw" />}
      {context === 'shape' && <ShapeRail key="shape" />}
      {context === 'frame' && <FrameRail key="frame" />}
      {context === 'brainstorm' && <BrainstormRail key="brainstorm" />}
      {context === 'selection' && <SelectionRail key="selection" />}
    </AnimatePresence>
  );
}
