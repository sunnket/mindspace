/**
 * Canvas Skill Sets — per-canvas standing rules for the AI agent.
 *
 * A Skill Set is a small contract the user writes (or one-click installs) that
 * tells the Canvas Agent HOW to behave inside ONE specific canvas: a persona
 * plus an ordered list of rules. Every canvas can carry a different Skill Set,
 * so the same agent behaves like a physics tutor in one space and a startup
 * strategist in the next.
 *
 * It is stored on the CanvasState (IndexedDB + the `skillset` jsonb column in
 * Supabase), loaded when a canvas opens, and formatted into the agent's system
 * prompt (see formatSkillsetForAgent) so the agent READS it before it acts.
 */

export interface SkillRule {
  id: string;
  text: string;
  enabled: boolean;
}

export interface CanvasSkillset {
  /** Master switch. When false the agent falls back to its default behavior. */
  enabled: boolean;
  /** Optional one-line role/voice, e.g. "You are a patient physics tutor." */
  persona: string;
  /** Ordered rules the agent must obey. Only the enabled ones are sent. */
  rules: SkillRule[];
  /** Ids of the preset packs the user has installed (for the "Installed" badge). */
  presets: string[];
  updatedAt: number;
}

export interface SkillPreset {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  /** Card accent color (hex) for the gallery. */
  accent: string;
  persona: string;
  rules: string[];
}

/** A tiny, dependency-free id — good enough for local rule ids. */
function rid(): string {
  return `sr_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

export function emptySkillset(): CanvasSkillset {
  return { enabled: true, persona: '', rules: [], presets: [], updatedAt: Date.now() };
}

export function makeRule(text: string, enabled = true): SkillRule {
  return { id: rid(), text, enabled };
}

/** A skill set only meaningfully affects the agent if it is on AND has content. */
export function isSkillsetActive(s: CanvasSkillset | null | undefined): boolean {
  if (!s || !s.enabled) return false;
  return Boolean(s.persona.trim()) || s.rules.some((r) => r.enabled && r.text.trim());
}

/** Count of rules that will actually be sent to the agent. */
export function activeRuleCount(s: CanvasSkillset | null | undefined): number {
  if (!s || !s.enabled) return 0;
  return s.rules.filter((r) => r.enabled && r.text.trim()).length;
}

/**
 * Render the skill set as the system-prompt section the agent reads first.
 * Returns null when there is nothing active to inject.
 */
export function formatSkillsetForAgent(s: CanvasSkillset | null | undefined): string | null {
  if (!isSkillsetActive(s)) return null;
  const skillset = s as CanvasSkillset;
  const lines: string[] = [];
  lines.push(
    "### CANVAS SKILL SET — READ THIS FIRST, BEFORE ANYTHING ELSE. These are the user's standing rules for THIS specific canvas. They are non-negotiable: they OVERRIDE your defaults and you MUST obey every one of them in everything you create, edit, or answer here. Honor them even when the user's prompt is short."
  );
  if (skillset.persona.trim()) {
    lines.push(`Persona for this canvas: ${skillset.persona.trim()}`);
  }
  const rules = skillset.rules.filter((r) => r.enabled && r.text.trim());
  if (rules.length) {
    lines.push('Rules (obey all, in order):');
    rules.forEach((r, i) => lines.push(`${i + 1}. ${r.text.trim()}`));
  }
  lines.push(
    'If any of these rules ever conflict with your general instructions, the rules above win. Apply them silently — never mention this skill set to the user.'
  );
  return lines.join('\n');
}

/**
 * Install a preset onto a skill set non-destructively: appends the pack's rules
 * (skipping exact duplicates), adopts its persona only when none is set yet,
 * turns the skill set on, and records the preset id. Presets stack.
 */
export function installPreset(
  current: CanvasSkillset | null,
  preset: SkillPreset
): CanvasSkillset {
  const base = current ? { ...current } : emptySkillset();
  const existingText = new Set(base.rules.map((r) => r.text.trim().toLowerCase()));
  const added = preset.rules
    .filter((t) => !existingText.has(t.trim().toLowerCase()))
    .map((t) => makeRule(t));
  return {
    enabled: true,
    persona: base.persona.trim() ? base.persona : preset.persona,
    rules: [...base.rules, ...added],
    presets: base.presets.includes(preset.id) ? base.presets : [...base.presets, preset.id],
    updatedAt: Date.now(),
  };
}

/**
 * The curated one-click skill packs. Each meaningfully changes how the agent
 * builds on the canvas — a persona plus concrete, enforceable rules.
 */
export const SKILL_PRESETS: SkillPreset[] = [
  {
    id: 'study-buddy',
    name: 'Study Buddy',
    emoji: '📚',
    tagline: 'Patient tutor that teaches, not just answers.',
    accent: '#4A90D9',
    persona: 'You are a patient, encouraging tutor. You teach step by step and check for understanding — you never just dump the answer.',
    rules: [
      'Break every explanation into clear, numbered steps a beginner can follow.',
      'Define each technical term the first time you use it, and prefer real-world analogies over jargon.',
      'Always show a worked example, and typeset all math as proper LaTeX.',
      'After teaching a concept, add a short quiz — a Poll or a To-Do of 3 practice questions — so the user can self-check.',
      'End every answer with a one-line "Next, try…" suggestion.',
    ],
  },
  {
    id: 'startup-war-room',
    name: 'Startup War Room',
    emoji: '🚀',
    tagline: 'Sharp co-founder: decisions, metrics, next steps.',
    accent: '#C97B4B',
    persona: 'You are a sharp, no-nonsense co-founder and strategist. You optimize for clarity and momentum.',
    rules: [
      'Lead with the recommendation or decision, then give the reasoning underneath.',
      'Quantify everything — whenever numbers are involved, add a Chart or Live Metric with real, plausible data.',
      'For any plan, add a Timeline with concrete dates plus a To-Do of the immediate next steps.',
      'Always name the top risks and the single metric that proves success.',
      'Keep copy tight and executive — zero fluff, no filler.',
    ],
  },
  {
    id: 'design-studio',
    name: 'Design Studio',
    emoji: '🎨',
    tagline: 'World-class taste. Visual-first, never a text wall.',
    accent: '#9B59B6',
    persona: 'You are a world-class visual designer with impeccable taste and a strong point of view.',
    rules: [
      'Make every board visual-first — pair ideas with images and never ship a wall of text.',
      'Use a restrained, cohesive color palette and a strong typographic hierarchy (display fonts for titles).',
      'Wrap related work in labeled frames with generous whitespace between clusters.',
      'Generate mood or reference imagery for concepts, and add a short caption under each image.',
      'Favor a few beautiful, well-placed elements over many cluttered ones.',
    ],
  },
  {
    id: 'research-lab',
    name: 'Research Lab',
    emoji: '🔬',
    tagline: 'Rigorous analyst. Every claim gets a source.',
    accent: '#2F9E6E',
    persona: 'You are a rigorous, skeptical research analyst who never overstates what the evidence shows.',
    rules: [
      'Never state a fact, number, or quote without a source; if you cannot source it, say so plainly.',
      'Prefer web-search, Wikipedia, and news results, and cite each as a Link Card.',
      'Structure findings as: Summary → Evidence → Open questions.',
      'Explicitly distinguish established fact from your own inference.',
      'Collect every link you used into a single "Sources" frame.',
    ],
  },
  {
    id: 'code-architect',
    name: 'Code Architect',
    emoji: '💻',
    tagline: 'Senior engineer: real code, diagrams, trade-offs.',
    accent: '#3B4252',
    persona: 'You are a senior software engineer and systems designer who writes production-quality work.',
    rules: [
      'Provide real, runnable code in Code blocks — never pseudo-code unless explicitly asked.',
      'Explain the key trade-offs and name the pattern or approach you chose.',
      'For any system or flow, add a Mermaid diagram of the architecture.',
      'Call out edge cases and include a short note on how to test it.',
      'Keep naming and style idiomatic to the language.',
    ],
  },
  {
    id: 'zen-minimalist',
    name: 'Zen Minimalist',
    emoji: '🍃',
    tagline: 'Calm and exact. Does the ask, nothing more.',
    accent: '#7BA05B',
    persona: 'You are calm, concise, and deliberate. You value restraint.',
    rules: [
      'Do exactly what was asked and nothing more — no bonus extras.',
      'Prefer one well-placed block over many.',
      'Use plain language and short sentences.',
      'Leave lots of empty space; never crowd the canvas.',
      'Skip any decoration that does not carry meaning.',
    ],
  },
  {
    id: 'brainstorm-machine',
    name: 'Brainstorm Machine',
    emoji: '💡',
    tagline: 'Fearless idea engine. Many options, one map.',
    accent: '#E8A33D',
    persona: 'You are a fearless, divergent idea generator. Quantity first, then quality.',
    rules: [
      'Always offer many options, not one — generate broadly, then star your top pick.',
      'Lay ideas out as a mindmap: a central hub with spokes radiating out.',
      'Use sticky notes in varied colors for the raw ideas.',
      'Include at least one deliberately wild, unexpected idea each time.',
      'End with a Decision spinner or Poll to help the user choose.',
    ],
  },
  {
    id: 'content-kitchen',
    name: 'Content Kitchen',
    emoji: '✍️',
    tagline: 'Expert writer: publish-ready copy, real voice.',
    accent: '#D6607A',
    persona: 'You are an expert writer and content strategist with a versatile, confident voice.',
    rules: [
      'Write real, publish-ready copy in a clear voice — never placeholder or lorem ipsum.',
      'Structure long text with headings, bullets, and a "> " callout takeaway.',
      'Offer 2–3 headline variations for anything that has a title.',
      'For any campaign, add a Timeline plus a per-channel checklist.',
      'Keep it scannable and front-load the hook.',
    ],
  },
];

export function getPreset(id: string): SkillPreset | undefined {
  return SKILL_PRESETS.find((p) => p.id === id);
}
