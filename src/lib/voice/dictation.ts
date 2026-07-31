'use client';

import { useCanvasStore } from '@/store/canvasStore';
import { useVoiceStore } from '@/store/voiceStore';
import { Occupancy } from '@/lib/canvasLayout';
import { cleanUtterance, insertionFor } from './cleanTranscript';

/**
 * Where the words go.
 *
 * Dictation used to hold a snapshot of a block's content and REWRITE the whole
 * block on every result — which is why it doubled text, fought the caret, and
 * couldn't dictate into anything that wasn't a canvas block. This types instead:
 * a finished phrase is inserted at the caret exactly as if it had been typed, so
 * everything downstream (the block's auto-grow, ink capture, undo, autosave) runs
 * the same code it runs for the keyboard.
 *
 * Target is chosen once, when the mic opens, in this order:
 *   1. WHATEVER HAS THE CARET — a note being edited, the agent chat box, a
 *      search field. Dictation follows the cursor, the way typing does.
 *   2. The selected block, if words belong in it. It's opened for editing so
 *      you can see the caret the words are arriving at.
 *   3. Nothing selected? A text block appears in the middle of the view, clear
 *      of whatever is already there, already focused. You press the mic and
 *      talk — there is never a step where you have to go click somewhere first.
 */

type Target =
  | { kind: 'dom'; el: HTMLElement }
  | { kind: 'canvas'; id: string };

let target: Target | null = null;

/** Block types where a spoken sentence is the content, not a setting. */
const DICTATABLE = new Set(['text', 'heading', 'sticky', 'callout']);

function isTypable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.disabled && !el.readOnly && /^(text|search|url|email|tel|)$/i.test(el.type);
  }
  return el.isContentEditable;
}

function editableFor(id: string): HTMLElement | null {
  const el = document.querySelector(`[data-object-id="${id}"] .text-block-editable`);
  return el instanceof HTMLElement && document.contains(el) ? el : null;
}

function valueOf(el: HTMLElement): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.innerText;
}

/** The text between the start of the field and the caret — everything the new
 *  words have to read on from. */
function caretPrefix(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.slice(0, el.selectionStart ?? el.value.length);
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const caret = sel.getRangeAt(0);
    if (el.contains(caret.startContainer)) {
      const upTo = document.createRange();
      upTo.selectNodeContents(el);
      upTo.setEnd(caret.startContainer, caret.startOffset);
      return upTo.toString();
    }
  }
  return el.innerText;
}

function caretToEnd(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
    return;
  }
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Re-aim at the field if the caret has wandered off it — clicking the canvas
 *  mid-sentence must not send the rest of the sentence nowhere. */
function focusForTyping(el: HTMLElement): void {
  if (document.activeElement === el) {
    const sel = window.getSelection();
    const inside =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? true
        : Boolean(sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer));
    if (inside) return;
  }
  el.focus({ preventScroll: true });
  caretToEnd(el);
}

/**
 * Insert at the caret. `execCommand` is deprecated and still the only call that
 * types into a field the way a keystroke does — native undo, native input
 * events, React controlled inputs included. The manual path is there for the
 * browser that finally drops it.
 */
function typeAtCaret(el: HTMLElement, piece: string): void {
  let done = false;
  try {
    done = document.execCommand('insertText', false, piece);
  } catch {
    done = false;
  }
  if (done) return;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const at = el.selectionStart ?? el.value.length;
    const to = el.selectionEnd ?? at;
    const next = el.value.slice(0, at) + piece + el.value.slice(to);
    // Through the prototype setter, or React's own value tracker swallows the
    // change and the field snaps back to its last rendered value.
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.setSelectionRange(at + piece.length, at + piece.length);
  } else {
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const node = document.createTextNode(piece);
    if (range && el.contains(range.startContainer)) {
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else {
      el.appendChild(node);
      caretToEnd(el);
    }
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A fresh text block in the middle of the view, clear of what's already there. */
function createBlock(): string {
  const canvas = useCanvasStore.getState();
  const { camera } = canvas;
  const width = 420;
  const height = 60;
  const x = (-camera.x + window.innerWidth / 2) / camera.zoom - width / 2;
  const y = (-camera.y + window.innerHeight / 2) / camera.zoom - height / 2;

  // Dropping it dead centre lands it on top of whatever you were looking at.
  const spot = new Occupancy(canvas.objects).place({ x, y, width, height, type: 'text' });

  const block = canvas.addObject({ type: 'text', x: spot.x, y: spot.y, width, height, content: '' });
  canvas.setSelectedId(block.id);
  canvas.setEditingId(block.id);
  return block.id;
}

/**
 * Pick where this session's words land, and make sure that place exists and is
 * ready to receive them. Returns the canvas block id if the target is one, so
 * the session can be tied to it.
 */
export function openDictation(): string | null {
  const canvas = useCanvasStore.getState();

  const active = document.activeElement;
  if (isTypable(active)) {
    const host = active.closest('[data-object-id]');
    const id = host instanceof HTMLElement ? host.dataset.objectId : undefined;
    if (id && canvas.objects.some((o) => o.id === id)) {
      target = { kind: 'canvas', id };
      return id;
    }
    target = { kind: 'dom', el: active };
    return null;
  }

  const selected = canvas.selectedId ? canvas.objects.find((o) => o.id === canvas.selectedId) : undefined;
  if (selected && DICTATABLE.has(selected.type)) {
    // Open it: the caret has to be visible in the block the words are joining,
    // or dictation looks like it's typing into a void.
    if (canvas.editingId !== selected.id) canvas.setEditingId(selected.id);
    target = { kind: 'canvas', id: selected.id };
    return selected.id;
  }

  const id = createBlock();
  target = { kind: 'canvas', id };
  return id;
}

/** Let go of the target. Called once the last utterance has actually landed. */
export function closeDictation(): void {
  target = null;
}

export function dictationTargetId(): string | null {
  return target?.kind === 'canvas' ? target.id : null;
}

function writeToCanvas(id: string, spoken: string): void {
  const canvas = useCanvasStore.getState();
  const obj = canvas.objects.find((o) => o.id === id);
  if (!obj) {
    // The block was deleted mid-sentence. Don't drop what was said — put it
    // somewhere it can be seen.
    const fresh = createBlock();
    target = { kind: 'canvas', id: fresh };
    writeToCanvas(fresh, spoken);
    useVoiceStore.getState().setTargetId(fresh);
    return;
  }

  const el = editableFor(id);
  if (el && canvas.editingId === id) {
    focusForTyping(el);
    const piece = insertionFor(caretPrefix(el), spoken);
    if (!piece) return;
    typeAtCaret(el, piece);
    // The block's own input handler keeps the DOM sized; the store still needs
    // the text, or a reload/collab peer sees a block that never heard anything.
    canvas.updateObject(id, { content: valueOf(el) });
    return;
  }

  // Not open for editing — the store IS the block. Append there.
  const base = obj.content || '';
  const piece = insertionFor(base, spoken);
  if (piece) canvas.updateObject(id, { content: base + piece });
}

/**
 * One finished utterance from either engine. Cleaned first — if nothing survives
 * the filter, nothing is written and nothing is shown: that is the whole point.
 */
export function commitSpoken(raw: string, opts: { strict?: boolean } = {}): void {
  const text = cleanUtterance(raw, opts);
  if (!text) return;

  if (!target) {
    // Stopped, or never opened. Better a block than a lost sentence.
    const id = createBlock();
    target = { kind: 'canvas', id };
    useVoiceStore.getState().setTargetId(id);
  }

  if (target.kind === 'dom') {
    if (!document.contains(target.el)) {
      const id = createBlock();
      target = { kind: 'canvas', id };
      useVoiceStore.getState().setTargetId(id);
      writeToCanvas(id, text);
    } else {
      focusForTyping(target.el);
      const piece = insertionFor(caretPrefix(target.el), text);
      if (piece) typeAtCaret(target.el, piece);
    }
  } else {
    writeToCanvas(target.id, text);
  }

  // The HUD's record of the session — never the source of what's on the canvas.
  useVoiceStore.getState().appendTranscript(text);
}
