'use client';

import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/store/canvasStore';
import SelectionRail from './SelectionRail';
import DrawRail from './DrawRail';
import ShapeRail from './ShapeRail';
import FrameRail from './FrameRail';
import BrainstormRail from './BrainstormRail';
import WorkflowRail from './WorkflowRail';
import TextPathRail from './TextPathRail';

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
 *
 * ---- Why the rail STAYS ----
 *
 * It used to vanish the instant you clicked the board, because it was tied
 * directly to `selectedId` and clicking empty space clears that. In practice
 * you deselect constantly — to pan, to reach past a block, to check something —
 * and each time, the panel you were working in disappeared and you had to
 * re-select to get it back. So the rail now REMEMBERS its subject: nothing but
 * the ✕ closes it, and selecting something else simply re-points it. The
 * subject still has to exist (`stickyAlive`), and a deliberately-chosen tool
 * still outranks it.
 */
export default function ContextRail() {
  const mode = useCanvasStore((s) => s.mode);
  const isTouring = useCanvasStore((s) => s.isTouring);
  const workflowOpen = useCanvasStore((s) => s.workflowOpen);
  const selectedId = useCanvasStore((s) => s.selectedId);

  const [sticky, setSticky] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);

  /* Whatever was last selected is what the rail keeps pointing at. Selecting
     anything at all also un-dismisses it — you asked for this block's
     properties, so the panel you closed a minute ago is wanted again.

     Adjusted during render rather than in an effect: this is derived state, and
     an effect would render one frame of the rail still describing the block you
     just stopped looking at. React re-runs this component immediately and
     nothing downstream ever sees the stale pair. */
  if (selectedId !== seen) {
    setSeen(selectedId);
    if (selectedId) {
      setSticky(selectedId);
      setDismissed(false);
    }
  }

  /* A primitive selector, not a subscription to the whole object array: this
     component re-renders on nothing but "does my subject still exist". */
  const stickyAlive = useCanvasStore((s) => !!sticky && s.objects.some((o) => o.id === sticky));

  const toolDefaults = !selectedId && (mode === 'text' || mode === 'arrow');
  const held = !selectedId && !toolDefaults && !dismissed && stickyAlive ? sticky : null;

  /* A tour is a presentation — chrome gets out of the way entirely. */
  const context = isTouring ? null
    : workflowOpen ? 'workflow'
    : mode === 'draw' ? 'draw'
    : mode === 'shape' ? 'shape'
    : mode === 'frame' ? 'frame'
    : mode === 'textpath' ? 'textpath'
    : mode === 'brainstorm' ? 'brainstorm'
    : (selectedId || toolDefaults || held) ? 'selection'
    : null;

  return (
    <AnimatePresence mode="wait">
      {context === 'workflow' && <WorkflowRail key="workflow" />}
      {context === 'draw' && <DrawRail key="draw" />}
      {context === 'shape' && <ShapeRail key="shape" />}
      {context === 'frame' && <FrameRail key="frame" />}
      {context === 'textpath' && <TextPathRail key="textpath" />}
      {context === 'brainstorm' && <BrainstormRail key="brainstorm" />}
      {context === 'selection' && (
        <SelectionRail
          key="selection"
          heldId={held}
          onDismiss={() => { setDismissed(true); setSticky(null); }}
        />
      )}
    </AnimatePresence>
  );
}
