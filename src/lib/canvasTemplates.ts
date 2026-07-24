import { v4 as uuidv4 } from 'uuid';
import type {
  CanvasObjectData,
  ConnectionData,
  DrawingStroke,
  Scene,
  CanvasState,
} from './db';
import { saveCanvasState, getDB, deleteCanvasPermanently, LEGACY_SEED_CANVASES } from './db';
import { cameraForRect, type Rect } from './frames';
import { presetById } from './canvasTheme';
import { getPreset, installPreset, type CanvasSkillset } from './skillset';
import { toISODate, addDays, TIMELINE_COLORS, type TimelineItem } from './timeline';

/**
 * Canvas templates — whole, finished boards, not starter shapes.
 *
 * The old starter content was a pile of cards reading "Brainstorm Idea #7".
 * It answered "does the canvas store objects?" and nothing else. A template
 * here has a different job: it has to be a canvas somebody would actually
 * be pleased to have made, so that opening one teaches the product. That
 * means real copy (a risk register with real risks in it), and it means
 * reaching for the blocks a new user would never find on their own —
 * timelines, charts, tables, mermaid, polls, binders, maps, scenes.
 *
 * Authoring rules that keep this file sane:
 *   • A template never positions a frame. It places blocks with a cursor and
 *     calls `wrap()`, which measures what was added and draws the frame
 *     around it. Frames therefore always fit their contents.
 *   • Sections live on a coarse grid — columns 1720 apart, bands ~960 apart —
 *     so two frames can never fight over the same block (frames capture by
 *     centre-in-rect; see lib/frames.ts).
 *   • Every block's data lives where its renderer looks for it. Charts want
 *     `chartReady`, metrics want no `metricSetup`, todos keep JSON in
 *     `content`. Getting this wrong yields a block stuck on its setup screen.
 */

/* ============================================================
   Builder
   ============================================================ */

export interface TemplateBuild {
  objects: CanvasObjectData[];
  connections: ConnectionData[];
  strokes: DrawingStroke[];
  scenes: Scene[];
}

type Style = Record<string, unknown>;

/** Viewport the scene cameras are derived against — refined at playback time. */
const SCENE_VIEWPORT = { w: 1600, h: 900 };

class Board {
  objects: CanvasObjectData[] = [];
  connections: ConnectionData[] = [];
  strokes: DrawingStroke[] = [];
  scenes: Scene[] = [];

  private z = 1;
  private mark = 0;
  private now = Date.now();

  constructor(private parentId: string) {}

  /* ---------- core ---------- */

  private put(
    type: CanvasObjectData['type'],
    x: number,
    y: number,
    width: number,
    height: number,
    content = '',
    style?: Style,
    parentId?: string,
  ): string {
    const id = uuidv4();
    this.objects.push({
      id,
      parentId: parentId ?? this.parentId,
      type,
      x,
      y,
      width,
      height,
      content,
      style,
      zIndex: this.z++,
      createdAt: this.now,
      updatedAt: this.now,
    });
    return id;
  }

  /** Start a section. Everything added until `wrap()` gets framed together. */
  begin() {
    this.mark = this.objects.length;
  }

  /**
   * Draw a frame around everything added since `begin()`.
   * The frame is measured, never guessed — so a section can grow during
   * authoring without anyone re-deriving a rectangle by hand.
   */
  wrap(title: string, opts: { color?: string; kind?: string; pad?: number } = {}): string {
    const members = this.objects.slice(this.mark);
    if (members.length === 0) return '';
    const pad = opts.pad ?? 44;
    const minX = Math.min(...members.map((o) => o.x)) - pad;
    const minY = Math.min(...members.map((o) => o.y)) - pad;
    const maxX = Math.max(...members.map((o) => o.x + o.width)) + pad;
    const maxY = Math.max(...members.map((o) => o.y + o.height)) + pad;

    const id = uuidv4();
    this.objects.push({
      id,
      parentId: this.parentId,
      type: 'frame',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      content: title,
      style: { frameColor: opts.color || '#C97B4B', ...(opts.kind ? { frameKind: opts.kind } : {}) },
      zIndex: 0,
      createdAt: this.now,
      updatedAt: this.now,
    });
    return id;
  }

  /** Frame the last section AND make it a stop on the present-mode tour. */
  wrapScene(title: string, notes: string, opts: { color?: string; kind?: string } = {}): string {
    const frameId = this.wrap(title, opts);
    const frame = this.objects.find((o) => o.id === frameId);
    if (frame) {
      const rect: Rect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
      this.scenes.push({
        id: uuidv4(),
        name: title,
        rect,
        camera: cameraForRect(rect, SCENE_VIEWPORT.w, SCENE_VIEWPORT.h),
        order: this.scenes.length,
        durationMs: 6000,
        notes,
      });
    }
    return frameId;
  }

  link(fromId: string, toId: string, style?: Style) {
    this.connections.push({
      id: uuidv4(),
      fromId,
      toId,
      parentId: this.parentId,
      createdAt: this.now,
      style,
    });
  }

  /** A hand-drawn accent — the thing that makes a board look lived in. */
  ink(points: number[][], color = '#C97B4B', size = 3, opacity = 0.85) {
    this.strokes.push({
      id: uuidv4(),
      points,
      color,
      size,
      parentId: this.parentId,
      createdAt: this.now,
      opacity,
    });
  }

  /** A loose underline swept beneath a title. */
  underline(x: number, y: number, w: number, color = '#C97B4B') {
    const pts: number[][] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push([x + t * w, y + Math.sin(t * Math.PI * 1.6) * 4]);
    }
    this.ink(pts, color, 3, 0.6);
  }

  /* ---------- text ---------- */

  heading(x: number, y: number, w: number, text: string, style?: Style, h = 62): string {
    return this.put('heading', x, y, w, h, text, { fontSize: 34, fontFamily: "'Outfit', sans-serif", ...style });
  }

  /* Display type auto-grows to fit once it renders, and a two-line title at
     62px clears 145px — so the authored box has to leave room for the wrap, or
     the hero heading lands on top of its own subtitle. */
  display(x: number, y: number, w: number, text: string, style?: Style, h = 140): string {
    return this.put('heading', x, y, w, h, text, {
      fontSize: 62,
      fontFamily: "'Bebas Neue', sans-serif",
      ...style,
    });
  }

  /**
   * A free text block normally HUGS its content and grows its own width up to
   * the wrap column (see `autoWidth` in CanvasObject) — which means an authored
   * width is only a floor, and a long line silently pushes the block sideways
   * into its neighbour. A template has already chosen its column, so
   * `isResized` pins the width and leaves only the height free to grow.
   */
  text(x: number, y: number, w: number, h: number, content: string, style?: Style): string {
    return this.put('text', x, y, w, h, content, { fontSize: 15, isResized: true, ...style });
  }

  /** Handwriting — margin notes, arrows' captions, the "human" layer. */
  scrawl(x: number, y: number, w: number, h: number, content: string, color = '#C97B4B'): string {
    return this.put('text', x, y, w, h, content, {
      fontSize: 22,
      fontFamily: "'Caveat', cursive",
      textColor: color,
      isResized: true,
    });
  }

  sticky(x: number, y: number, w: number, h: number, content: string, color: string): string {
    return this.put('sticky', x, y, w, h, content, { color, fontSize: 14 });
  }

  card(x: number, y: number, w: number, h: number, content: string, style?: Style): string {
    return this.put('card', x, y, w, h, content, style);
  }

  callout(
    x: number,
    y: number,
    w: number,
    h: number,
    kind: 'note' | 'warning' | 'idea' | 'question' | 'success',
    content: string,
  ): string {
    return this.put('card', x, y, w, h, content, { isCallout: true, calloutKind: kind });
  }

  quote(x: number, y: number, w: number, h: number, text: string, style?: Style): string {
    return this.put('card', x, y, w, h, text, { isQuote: true, fontSize: 21, ...style });
  }

  /* ---------- plan & track ---------- */

  todo(x: number, y: number, w: number, h: number, title: string, items: Array<[string, boolean]>): string {
    const payload = items.map(([text, done]) => ({ id: uuidv4(), text, done }));
    return this.put('card', x, y, w, h, JSON.stringify(payload), { isTodo: true, todoTitle: title });
  }

  timeline(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    items: Array<{ label: string; from: number; to: number; done?: boolean }>,
  ): string {
    const today = new Date();
    const rows: TimelineItem[] = items.map((it, i) => ({
      id: uuidv4(),
      label: it.label,
      start: toISODate(addDays(today, it.from)),
      end: toISODate(addDays(today, it.to)),
      color: TIMELINE_COLORS[i % TIMELINE_COLORS.length],
      done: it.done,
    }));
    return this.put('card', x, y, w, h, '', { isTimeline: true, timelineTitle: title, timelineItems: rows });
  }

  progress(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    opts: { value?: number; current?: number; target?: number; unit?: string; view?: 'bar' | 'ring' },
  ): string {
    return this.put('card', x, y, w, h, '', {
      isProgress: true,
      progressLabel: label,
      progressView: opts.view || 'bar',
      ...(opts.target !== undefined
        ? { progressTarget: opts.target, progressCurrent: opts.current ?? 0, progressUnit: opts.unit || '' }
        : { progressValue: opts.value ?? 0 }),
    });
  }

  countdown(x: number, y: number, w: number, h: number, title: string, daysOut: number): string {
    const target = addDays(new Date(), daysOut);
    target.setHours(9, 0, 0, 0);
    return this.put('card', x, y, w, h, '', {
      isCountdown: true,
      countdownTitle: title,
      countdownDate: target.toISOString(),
    });
  }

  timer(x: number, y: number, w: number, h: number, label: string): string {
    return this.put('card', x, y, w, h, '', { isTimer: true, timerLabel: label });
  }

  /* ---------- data & insight ---------- */

  table(x: number, y: number, w: number, h: number, title: string, cols: string[], rows: string[][]): string {
    return this.put('card', x, y, w, h, '', { isTable: true, tableTitle: title, tableCols: cols, tableRows: rows });
  }

  chart(
    x: number,
    y: number,
    w: number,
    h: number,
    type: 'bar' | 'hbar' | 'line' | 'area' | 'donut' | 'pie' | 'number',
    title: string,
    data: Array<[string, number]>,
  ): string {
    return this.put('card', x, y, w, h, '', {
      isChart: true,
      chartType: type,
      chartTitle: title,
      chartData: data.map(([label, value]) => ({ label, value })),
      chartReady: true,
    });
  }

  metric(
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    value: string,
    trend: string,
    series: number[],
  ): string {
    return this.put('card', x, y, w, h, '', {
      isLiveMetric: true,
      metricTitle: title,
      metricValue: value,
      metricTrend: trend,
      metricChartData: series,
    });
  }

  quickData(x: number, y: number, w: number, h: number, rows: Array<[string, string]>): string {
    return this.put('card', x, y, w, h, '', {
      isQuickData: true,
      quickDataRows: rows.map(([key, value]) => ({ key, value })),
    });
  }

  poll(x: number, y: number, w: number, h: number, question: string, options: Array<[string, number]>): string {
    return this.put('card', x, y, w, h, '', {
      isPoll: true,
      pollQuestion: question,
      pollOptions: options.map(([text, votes], i) => ({ id: String(i + 1), text, votes })),
    });
  }

  decision(x: number, y: number, w: number, h: number, title: string, options: string[]): string {
    return this.put('card', x, y, w, h, '', { isDecision: true, decisionTitle: title, decisionOptions: options });
  }

  /* ---------- media & tools ---------- */

  mermaid(x: number, y: number, w: number, h: number, code: string): string {
    return this.put('card', x, y, w, h, code, { isMermaid: true });
  }

  code(x: number, y: number, w: number, h: number, lang: string, src: string): string {
    return this.put('card', x, y, w, h, src, { isCode: true, codeLang: lang });
  }

  map(x: number, y: number, w: number, h: number, name: string, label: string, lat: number, lng: number): string {
    return this.put('card', x, y, w, h, name, {
      isMap: true,
      mapLat: lat,
      mapLng: lng,
      mapName: name,
      mapLabel: label,
      mapKind: 'place',
      mapBbox: null,
    });
  }

  whiteboard(x: number, y: number, w: number, h: number, title: string): string {
    return this.put('card', x, y, w, h, title, {
      isWhiteboard: true,
      whiteboardBg: '#ffffff',
      whiteboardStrokes: [],
    });
  }

  /** A binder is a canvas inside a canvas — children are parented to its id. */
  binder(x: number, y: number, w: number, h: number, title: string): string {
    return this.put('card', x, y, w, h, title, { isBinder: true });
  }

  /** Place a block on a binder's nested sub-canvas. */
  inside(
    binderId: string,
    type: CanvasObjectData['type'],
    x: number,
    y: number,
    w: number,
    h: number,
    content: string,
    style?: Style,
  ): string {
    return this.put(type, x, y, w, h, content, style, binderId);
  }

  shape(
    x: number,
    y: number,
    w: number,
    h: number,
    shapeType: string,
    text: string,
    colors: { fill?: string; border?: string; ink?: string } = {},
  ): string {
    return this.put('shape', x, y, w, h, text, {
      shapeType,
      color: colors.fill || '#E8A97B',
      borderColor: colors.border || '#C97B4B',
      textColor: colors.ink || '#FFFFFF',
      fontSize: 14,
    });
  }

  node(
    x: number,
    y: number,
    text: string,
    workflowId: string,
    shape: 'pill' | 'square' | 'circle' | 'diamond' = 'pill',
    palette: { bg: string; border: string; ink: string } = { bg: '#FAF6F1', border: '#C97B4B', ink: '#2D2A26' },
  ): string {
    return this.put('workflow-node', x, y, 172, 62, text, {
      isWorkflowNode: true,
      workflowId,
      nodeShape: shape,
      color: palette.bg,
      borderColor: palette.border,
      textColor: palette.ink,
      branchColor: palette.border,
      fontSize: 13,
      fontFamily: "'Inter', sans-serif",
    });
  }
}

/* ============================================================
   Template shape
   ============================================================ */

export type TemplateCategory =
  | 'Business'
  | 'Design'
  | 'Academic'
  | 'Creative'
  | 'Personal'
  | 'Engineering';

export interface CanvasTemplate {
  id: string;
  /** The canvas title a fresh copy is created with. */
  title: string;
  /** Display name in the gallery. */
  name: string;
  tagline: string;
  blurb: string;
  category: TemplateCategory;
  accent: string;
  emoji: string;
  /** id of a canvasTheme preset — the paper this board is designed on. */
  backgroundId: string;
  /** id of a SKILL_PRESETS pack installed into the copy's Skill Set. */
  skillPresetId?: string;
  /** The features a browser should know they're getting. */
  highlights: string[];
  build: (b: Board) => void;
}

/* Palettes reused across templates */
const STICKY = {
  amber: '#FDE9B8',
  peach: '#FBD9C4',
  rose: '#F8D2DA',
  mint: '#CDE9D8',
  sky: '#CFE2F6',
  lilac: '#DED6F5',
  sand: '#EFE3CE',
  sage: '#DCE7D2',
};

/* ============================================================
   1 · Startup War Room
   ============================================================ */

const startupWarRoom: CanvasTemplate = {
  id: 'startup-war-room',
  title: 'startup war room',
  name: 'Startup War Room',
  tagline: 'Everything a founding team argues about, on one wall.',
  blurb:
    'North star, market map, 90-day roadmap, live metrics, GTM funnel and a risk register — the whole company state in a single board you can walk a room through.',
  category: 'Business',
  accent: '#C97B4B',
  emoji: '🚀',
  backgroundId: 'cream',
  skillPresetId: 'startup-war-room',
  highlights: ['6 framed sections', 'Timeline + countdown', 'Live metrics & charts', 'Risk register table', 'Present-mode tour'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1320;
    const B3 = 2300;

    /* ---------- hero ---------- */
    b.display(0, 0, 1080, 'NORTHWIND — SEED TO SERIES A');
    b.text(
      0,
      170,
      1040,
      120,
      "**One wall, one truth.** Everything below is live: the metrics update where the team edits them, the roadmap moves when a date slips, and the risk register is the same one we read in the board meeting.\n\n> Walk it top-left to bottom-right, or hit ▶ present and let it walk you.",
    );
    b.quote(
      1180,
      12,
      460,
      190,
      'If you are not embarrassed by the first version of your product, you have launched too late.',
    );
    b.underline(0, 152, 620);

    /* ---------- 01 north star ---------- */
    b.begin();
    b.heading(0, B1, 620, '01 · North Star');
    b.callout(
      0,
      B1 + 78,
      700,
      178,
      'idea',
      '**Mission** — give small logistics teams the routing brain that only enterprise fleets can afford.\n\n**Wedge** — regional 3PLs running 5–40 trucks. Priced per truck, live in a day, no integration project.',
    );
    b.quickData(740, B1 + 78, 340, 286, [
      ['Stage', 'Seed, closing'],
      ['Committed', '$1.65M / $2.5M'],
      ['Runway', '14 months'],
      ['Net burn', '$96k / mo'],
      ['Team', '7 (4 eng)'],
      ['Next gate', '$40k MRR'],
    ]);
    b.progress(1120, B1 + 78, 330, 286, 'Seed round committed', {
      current: 1650000,
      target: 2500000,
      unit: '$',
      view: 'ring',
    });
    const s1 = b.sticky(0, B1 + 292, 216, 172, 'Why now?\n\nFuel + driver cost finally make routing software cheaper than the waste it removes.', STICKY.amber);
    const s2 = b.sticky(238, B1 + 292, 216, 172, 'Unfair advantage\n\nTwo years of real dispatch logs nobody else can buy.', STICKY.mint);
    const s3 = b.sticky(476, B1 + 292, 216, 172, 'What kills us\n\nA free-ish incumbent bundles routing into their TMS.', STICKY.rose);
    b.link(s1, s2, { color: '#C97B4B' });
    b.link(s2, s3, { color: '#C97B4B' });
    b.wrapScene('01 · North Star', 'Who we are, what we are betting on, and the two facts that decide it.', { color: '#C97B4B' });

    /* ---------- 02 market ---------- */
    b.begin();
    b.heading(COL2, B1, 620, '02 · The market & the people in it');
    b.table(
      COL2,
      B1 + 78,
      680,
      300,
      'Who else is in the ring',
      ['Player', 'Their wedge', 'Price', 'Where they break'],
      [
        ['Routific', 'SMB last-mile', '$49/veh', 'No multi-day planning'],
        ['Onfleet', 'Delivery ops', '$500+/mo', 'Routing is an add-on'],
        ['Legacy TMS', 'Enterprise', '$60k/yr', '9-month rollouts'],
        ['Spreadsheets', 'Free', '$0', 'Breaks past ~12 trucks'],
      ],
    );
    b.chart(COL2 + 720, B1 + 78, 400, 300, 'hbar', 'Where the money is (TAM, $M)', [
      ['Regional 3PL', 480],
      ['Private fleet', 1200],
      ['Freight broker', 260],
      ['Last-mile', 640],
    ]);
    b.metric(COL2 + 1160, B1 + 78, 290, 186, 'Design partners', '14', '+6 this month', [4, 5, 7, 8, 8, 11, 14]);
    b.callout(COL2 + 1160, B1 + 288, 290, 90, 'question', 'Do 3PLs churn when diesel drops? Nobody has asked yet.');
    b.sticky(COL2, B1 + 412, 216, 168, '“I plan Monday routes on Sunday night. On paper.”\n— Dana, 22 trucks', STICKY.sand);
    b.sticky(COL2 + 238, B1 + 412, 216, 168, '“I don’t want AI. I want to stop calling drivers.”\n— Marcus, dispatch', STICKY.sand);
    b.poll(COL2 + 500, B1 + 412, 300, 250, 'Which segment do we own first?', [
      ['Regional 3PL', 6],
      ['Private fleet', 3],
      ['Last-mile', 2],
    ]);
    b.text(
      COL2 + 840,
      B1 + 412,
      610,
      250,
      '### What 30 interviews actually said\n- [x] Route planning is a **person**, not a tool — usually the owner\n- [x] They pay for *fewer phone calls*, not for optimality\n- [ ] Nobody could name their cost-per-stop\n- [ ] Two asked for driver pay reconciliation — out of scope, for now',
    );
    b.wrapScene('02 · Market & users', 'The competitive ring, the size of the prize, and what thirty interviews actually said.', {
      color: '#3E63DD',
    });

    /* ---------- 03 roadmap ---------- */
    b.begin();
    b.heading(0, B2, 620, '03 · The next 90 days');
    b.timeline(0, B2 + 78, 620, 330, 'Road to pilot', [
      { label: 'Design-partner interviews', from: -12, to: -2, done: true },
      { label: 'Routing engine v2', from: -4, to: 14 },
      { label: 'Dispatcher web app', from: 6, to: 28 },
      { label: 'Pilot with 3 fleets', from: 26, to: 48 },
      { label: 'Public beta', from: 50, to: 62 },
    ]);
    b.todo(660, B2 + 78, 330, 330, 'Ship checklist', [
      ['Freeze the pilot scope', true],
      ['SOC2 questionnaire answered', true],
      ['Driver app offline mode', false],
      ['Onboarding: CSV → routes in 10 min', false],
      ['Pricing page + Stripe', false],
      ['Status page & on-call rota', false],
    ]);
    b.countdown(1030, B2 + 78, 250, 250, 'Pilot go-live', 26);
    b.progress(1310, B2 + 78, 250, 250, 'Pilot scope locked', { value: 72, view: 'ring' });
    b.mermaid(
      0,
      B2 + 436,
      640,
      340,
      'graph LR;\n  A[CSV / TMS import] --> B[Constraint model];\n  B --> C{Feasible?};\n  C -- yes --> D[Route plan];\n  C -- no --> E[Relax windows];\n  E --> B;\n  D --> F[Driver app];\n  D --> G[Dispatcher board];',
    );
    b.scrawl(680, B2 + 450, 380, 60, 'the whole product is this diagram →', '#C97B4B');
    b.table(
      680,
      B2 + 520,
      880,
      256,
      'Who owns what',
      ['Workstream', 'Owner', 'Status', 'Risk'],
      [
        ['Routing engine', 'Ana', 'On track', 'Low'],
        ['Dispatcher app', 'Kofi', 'At risk', 'Design debt'],
        ['Driver app', 'Ren', 'On track', 'Low'],
        ['Pilot onboarding', 'Sam', 'Not started', 'Needs Ana'],
      ],
    );
    b.wrapScene('03 · The next 90 days', 'Dates, owners, and the one diagram the whole product collapses into.', {
      color: '#2F9E6E',
    });

    /* ---------- 04 metrics ---------- */
    b.begin();
    b.heading(COL2, B2, 620, '04 · Numbers we defend');
    b.metric(COL2, B2 + 78, 290, 186, 'MRR', '$28.4k', '+19% MoM', [9, 12, 14, 18, 21, 24, 28.4]);
    b.metric(COL2 + 310, B2 + 78, 290, 186, 'Weekly active dispatchers', '61', '+11 wk/wk', [18, 24, 29, 38, 44, 52, 61]);
    b.chart(COL2 + 620, B2 + 78, 420, 300, 'area', 'MRR run-rate ($k)', [
      ['Feb', 9],
      ['Mar', 12],
      ['Apr', 14],
      ['May', 18],
      ['Jun', 21],
      ['Jul', 24],
      ['Aug', 28.4],
    ]);
    b.chart(COL2 + 1060, B2 + 78, 390, 300, 'donut', 'Where signups come from', [
      ['Founder outbound', 44],
      ['Referral', 26],
      ['Content / SEO', 18],
      ['Marketplace', 12],
    ]);
    b.table(
      COL2,
      B2 + 288,
      590,
      264,
      'Unit economics',
      ['Metric', 'Today', 'Target'],
      [
        ['CAC', '$1,940', '$1,200'],
        ['ACV', '$3,300', '$4,800'],
        ['Gross margin', '71%', '80%'],
        ['Payback', '7.4 mo', '< 6 mo'],
        ['Logo churn', '2.1% / mo', '< 1%'],
      ],
    );
    b.callout(
      COL2 + 620,
      B2 + 400,
      830,
      152,
      'success',
      '**Payback fell to 7.4 months** after we stopped doing bespoke onboarding. The next lever is self-serve import — Sam owns it, and it is the only thing standing between us and a sub-6-month payback.',
    );
    b.wrapScene('04 · Numbers we defend', 'The five numbers the next round is priced on, and the one lever that moves them.', {
      color: '#8B5FBF',
    });

    /* ---------- 05 GTM ---------- */
    b.begin();
    b.heading(0, B3, 620, '05 · Go-to-market motion');
    const wf = uuidv4();
    const n1 = b.node(0, B3 + 96, 'List of 400 fleets', wf, 'pill');
    const n2 = b.node(210, B3 + 96, 'Cold call, not email', wf, 'square');
    const n3 = b.node(420, B3 + 96, '20-min ride-along', wf, 'square');
    const n4 = b.node(630, B3 + 96, 'Free 2-week plan', wf, 'diamond');
    const n5 = b.node(840, B3 + 96, 'Paid pilot', wf, 'pill');
    b.link(n1, n2, { isWorkflowConnection: true, workflowId: wf, color: '#C97B4B' });
    b.link(n2, n3, { isWorkflowConnection: true, workflowId: wf, color: '#C97B4B' });
    b.link(n3, n4, { isWorkflowConnection: true, workflowId: wf, color: '#C97B4B' });
    b.link(n4, n5, { isWorkflowConnection: true, workflowId: wf, color: '#C97B4B' });
    b.chart(0, B3 + 200, 500, 300, 'bar', 'Funnel this quarter', [
      ['Called', 400],
      ['Answered', 152],
      ['Ride-along', 61],
      ['Free plan', 29],
      ['Paid', 14],
    ]);
    b.text(
      540,
      B3 + 200,
      520,
      300,
      "### The motion, in one paragraph\nWe do not run ads. One founder calls a list of fleets nobody has bothered to call, asks to ride along for a morning, and leaves behind a route plan built from **their** stops. The plan sells itself; the call just buys the morning.\n\n---\n\n`conversion: 3.5% call → paid`  ·  `cycle: 19 days`",
    );
    b.quote(1100, B3 + 200, 460, 200, 'Sell the ride-along. The software is what they keep afterwards.');
    b.wrapScene('05 · Go-to-market', 'One motion, five steps, and the conversion rate at every joint.', { color: '#C9904B' });

    /* ---------- 06 risks ---------- */
    b.begin();
    b.heading(COL2, B3, 620, '06 · Risks & open decisions');
    b.table(
      COL2,
      B3 + 78,
      760,
      290,
      'Risk register',
      ['Risk', 'Likelihood', 'Impact', 'Owner', 'Mitigation'],
      [
        ['Incumbent bundles routing', 'Med', 'Fatal', 'Ana', 'Own the data moat, not the feature'],
        ['Pilot slips past Q4', 'High', 'High', 'Kofi', 'Cut driver offline mode'],
        ['Key hire says no', 'Med', 'Med', 'Sam', 'Two candidates in parallel'],
        ['Diesel price collapse', 'Low', 'High', 'Ana', 'Reframe ROI on driver hours'],
      ],
    );
    b.decision(COL2 + 800, B3 + 78, 300, 340, 'Friday call', [
      'Cut driver offline mode',
      'Slip the pilot 2 weeks',
      'Hire a contractor',
    ]);
    b.callout(
      COL2 + 1120,
      B3 + 78,
      330,
      160,
      'warning',
      '**Decide by Friday.** Every week we hold this open costs a week of pilot runway.',
    );
    const binder = b.binder(COL2 + 1120, B3 + 258, 330, 160, 'Board deck & data room');
    b.inside(binder, 'heading', 0, 0, 620, 70, 'Board deck — Q3', { fontSize: 34, fontFamily: "'Outfit', sans-serif" });
    b.inside(
      binder,
      'text',
      0,
      92,
      620,
      190,
      '1. Where we are vs. the plan\n2. The one number that moved (payback)\n3. What we are asking for\n4. Risks we are not handling yet\n\n> Slides live here so the wall outside stays clean.',
      { fontSize: 15 },
    );
    b.inside(binder, 'sticky', 660, 0, 220, 180, 'Data room checklist:\ncap table, contracts,\nSOC2 letter, churn export', { color: STICKY.sky });
    b.wrapScene('06 · Risks & decisions', 'What can kill this, who owns it, and the call we owe ourselves by Friday.', {
      color: '#D64545',
    });

    /* ---------- ask-AI frame ---------- */
    b.begin();
    b.heading(0, B3 + 700, 620, 'Ask the board');
    b.text(
      0,
      B3 + 772,
      760,
      130,
      'Drop a question in here and run the frame — the agent reads **everything inside this box** (and it can read the sections too, if you drag one in).\n\nTry: *“Given the risk register and the runway, what should we cut first?”*',
    );
    b.wrap('Ask AI · drop a question here', { kind: 'agent', color: '#8B5FBF' });
  },
};

/* ============================================================
   2 · Five-Day Design Sprint
   ============================================================ */

const designSprint: CanvasTemplate = {
  id: 'design-sprint',
  title: 'design sprint — onboarding',
  name: 'Five-Day Design Sprint',
  tagline: 'Map, sketch, decide, prototype, test — the whole week, framed.',
  blurb:
    'A real sprint week with real artefacts: a user map, a wall of How-Might-We notes, dot voting, a storyboard, a test script and the findings that came back.',
  category: 'Design',
  accent: '#E0567F',
  emoji: '🎨',
  backgroundId: 'linen',
  skillPresetId: 'design-studio',
  highlights: ['Day-by-day frames', 'HMW sticky wall', 'Dot-vote poll', 'Storyboard + whiteboard', 'Findings table'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1340;
    const B3 = 2320;

    b.display(0, 0, 1100, 'ONBOARDING SPRINT — WEEK 32');
    b.text(
      0,
      170,
      1000,
      120,
      '**The question:** can a new team get their first project live without ever talking to us?\n\n**Sprint goal:** by Friday, five strangers try it and we know the answer. Everything on this wall was made in that week — nothing was written up afterwards.',
    );
    b.quote(1180, 12, 460, 190, 'If you can’t explain the flow with six boxes, the flow is wrong.');
    b.underline(0, 152, 700, '#E0567F');

    /* Monday — map */
    b.begin();
    b.heading(0, B1, 620, 'Monday · Map');
    b.mermaid(
      0,
      B1 + 78,
      660,
      380,
      'graph LR;\n  A[Hears about us] --> B[Signs up];\n  B --> C{Invited by a teammate?};\n  C -- yes --> D[Joins existing project];\n  C -- no --> E[Empty state];\n  E --> F[Template picker];\n  D --> G[First real edit];\n  F --> G;\n  G --> H[Invites someone];',
    );
    b.callout(
      700,
      B1 + 78,
      420,
      170,
      'note',
      '**Target moment:** the *first real edit*. Everything before it is overhead; everything after it is retention.',
    );
    b.sticky(700, B1 + 268, 200, 190, 'Expert: “Nobody reads the empty state. They click the biggest thing.”', STICKY.peach);
    b.sticky(920, B1 + 268, 200, 190, 'Support: 6 of last 10 tickets = “where do I start?”', STICKY.peach);
    b.quickData(1160, B1 + 78, 300, 250, [
      ['Sprint', 'Week 32'],
      ['Decider', 'Priya'],
      ['Facilitator', 'Tom'],
      ['Testers', '5 booked'],
      ['Deadline', 'Friday 15:00'],
    ]);
    b.progress(1160, B1 + 348, 300, 110, 'Week burned', { value: 100, view: 'bar' });
    b.wrapScene('Monday · Map', 'The whole journey in six boxes, and the one moment the sprint is aimed at.', {
      color: '#E0567F',
    });

    /* Tuesday — sketch */
    b.begin();
    b.heading(COL2, B1, 620, 'Tuesday · Sketch');
    const hmw: Array<[string, string]> = [
      ['HMW skip the blank canvas entirely?', STICKY.amber],
      ['HMW make the first edit happen in <60s?', STICKY.amber],
      ['HMW borrow the shape of work they already do?', STICKY.mint],
      ['HMW let a teammate do the setup for them?', STICKY.mint],
      ['HMW make the empty state a demo?', STICKY.sky],
      ['HMW show value before signup?', STICKY.sky],
      ['HMW turn the tour into the product?', STICKY.lilac],
      ['HMW make undo obvious enough to be brave?', STICKY.lilac],
    ];
    hmw.forEach(([text, color], i) => {
      b.sticky(COL2 + (i % 4) * 200, B1 + 78 + Math.floor(i / 4) * 176, 184, 160, text, color);
    });
    b.whiteboard(COL2 + 820, B1 + 78, 380, 336, 'Crazy 8s — round 2');
    b.text(
      COL2 + 1220,
      B1 + 78,
      340,
      336,
      '### Rules we actually kept\n- [x] Work alone, together\n- [x] 8 sketches, 8 minutes, no talking\n- [x] Everything on the wall anonymous\n- [ ] *(broken)* no laptops — Tom cheated\n\n> The best idea came out of the round nobody liked.',
    );
    b.sticky(COL2, B1 + 430, 184, 160, 'Winner: the picker IS the empty state.', STICKY.rose);
    b.sticky(COL2 + 200, B1 + 430, 184, 160, 'Runner-up: teammate-assigned setup.', STICKY.sand);
    b.wrapScene('Tuesday · Sketch', 'Eight How-Might-We notes, a Crazy-8s board, and the two ideas that survived.', {
      color: '#C9904B',
    });

    /* Wednesday — decide */
    b.begin();
    b.heading(0, B2, 620, 'Wednesday · Decide');
    b.poll(0, B2 + 78, 320, 290, 'Dot vote — what do we prototype?', [
      ['Picker as empty state', 7],
      ['Teammate-assigned setup', 4],
      ['Interactive tour', 2],
      ['Value before signup', 1],
    ]);
    b.table(
      360,
      B2 + 78,
      700,
      290,
      'Storyboard — six frames',
      ['#', 'Screen', 'What the user does', 'What we are testing'],
      [
        ['1', 'Landing', 'Clicks “try it”', 'Does the promise land?'],
        ['2', 'Picker', 'Scans six templates', 'Do they recognise their work?'],
        ['3', 'Board opens', 'Sees real content', 'Wow or overwhelm?'],
        ['4', 'First edit', 'Renames a card', 'Is edit affordance obvious?'],
        ['5', 'Invite', 'Adds a teammate', 'Is sharing findable?'],
        ['6', 'Return', 'Comes back next day', 'Do they remember why?'],
      ],
    );
    b.callout(
      1100,
      B2 + 78,
      460,
      170,
      'warning',
      '**Decider’s call:** we prototype the picker only. The tour is a *different* sprint and we keep pretending it isn’t.',
    );
    b.sticky(1100, B2 + 268, 216, 100, 'Conflict logged: Ren still thinks the tour wins.', STICKY.rose);
    b.timeline(0, B2 + 400, 620, 300, 'Sprint week', [
      { label: 'Map & expert interviews', from: -4, to: -4, done: true },
      { label: 'Sketch', from: -3, to: -3, done: true },
      { label: 'Decide & storyboard', from: -2, to: -2, done: true },
      { label: 'Prototype', from: -1, to: -1 },
      { label: 'Test with 5 users', from: 0, to: 0 },
    ]);
    b.todo(660, B2 + 400, 340, 300, 'Prototype build list', [
      ['Six real template thumbnails', true],
      ['Fake data that reads true', true],
      ['One working edit path', false],
      ['Invite modal (non-functional ok)', false],
      ['Kill every dead link', false],
    ]);
    b.timer(1040, B2 + 400, 250, 300, 'Sketch round');
    b.countdown(1310, B2 + 400, 250, 300, 'Test session', 1);
    b.wrapScene('Wednesday · Decide', 'The dot vote, the storyboard it produced, and the decider’s unpopular call.', {
      color: '#3E63DD',
    });

    /* Thursday — prototype */
    b.begin();
    b.heading(COL2, B2, 620, 'Thursday · Prototype');
    b.code(
      COL2,
      B2 + 78,
      620,
      330,
      'javascript',
      "// The whole prototype is one array. That is the point —\n// on Thursday you are faking, not building.\nconst TEMPLATES = [\n  { id: 'sprint',  name: 'Design sprint',  blocks: 61 },\n  { id: 'launch',  name: 'Launch plan',    blocks: 74 },\n  { id: 'research',name: 'Research lab',   blocks: 68 },\n];\n\nexport const pick = (id) =>\n  TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];",
    );
    b.text(
      COL2 + 660,
      B2 + 78,
      440,
      330,
      "### Fidelity rules\n- Real **copy**, fake data\n- Real *first click*, fake everything after\n- No hover states, no empty states\n- If a tester asks “does this work?”, say **yes** and move on\n\n---\n\n`built in: 6h 20m`",
    );
    b.callout(
      COL2 + 1140,
      B2 + 78,
      420,
      150,
      'idea',
      'Copy is the prototype. We rewrote the picker headline four times and changed no pixels.',
    );
    b.sticky(COL2 + 1140, B2 + 248, 200, 160, 'v1: “Choose a template”\nv4: “Start with a board that already has work in it”', STICKY.sage);
    b.sticky(COL2 + 1360, B2 + 248, 200, 160, 'Rejected: “Get started”. Means nothing.', STICKY.sage);
    b.progress(COL2, B2 + 440, 620, 120, 'Prototype ready for testing', { value: 88, view: 'bar' });
    b.wrapScene('Thursday · Prototype', 'One array, six hours, and four rewrites of a single headline.', { color: '#2F9E6E' });

    /* Friday — test */
    b.begin();
    b.heading(0, B3, 620, 'Friday · Test');
    b.table(
      0,
      B3 + 78,
      880,
      300,
      'Five testers, five verdicts',
      ['Tester', 'Role', 'First edit?', 'Where they stalled', 'Verdict'],
      [
        ['P1', 'Ops lead', '41s', 'Looked for “new”', 'Would use'],
        ['P2', 'Founder', '19s', '—', 'Would pay'],
        ['P3', 'Designer', '2m10s', 'Read every template', 'Maybe'],
        ['P4', 'PM', '55s', 'Wanted to rename first', 'Would use'],
        ['P5', 'Student', '—', 'Never found edit', 'Lost'],
      ],
    );
    b.chart(920, B3 + 78, 380, 300, 'bar', 'Seconds to first real edit', [
      ['P1', 41],
      ['P2', 19],
      ['P3', 130],
      ['P4', 55],
      ['P5', 300],
    ]);
    b.metric(1340, B3 + 78, 290, 186, 'Reached first edit', '4 / 5', '+3 vs. blank canvas', [1, 1, 2, 3, 4, 4, 4]);
    b.callout(1340, B3 + 288, 290, 90, 'success', 'The sprint goal is met — with one loud caveat below.');
    b.callout(
      0,
      B3 + 410,
      640,
      170,
      'warning',
      '**P5 never found the edit affordance.** Four wins and one total loss is not a pass — the picker works, the *canvas* does not announce itself. That is next week’s sprint.',
    );
    b.text(
      680,
      B3 + 410,
      620,
      170,
      '### What we ship on Monday\n1. Picker becomes the empty state — **decided**\n2. Templates get a one-line “what’s inside”\n3. First card on every board is an instruction, not content\n4. Re-test with 3 more people before it goes to everyone',
    );
    b.quote(1340, B3 + 410, 290, 170, 'Four out of five is a finding, not a victory.');
    b.wrapScene('Friday · Test', 'Five sessions, one clean win, one loss we are not allowed to round away.', {
      color: '#D64545',
    });
  },
};

/* ============================================================
   3 · Research & Thesis Lab
   ============================================================ */

const researchLab: CanvasTemplate = {
  id: 'research-lab',
  title: 'research lab — thesis',
  name: 'Research & Thesis Lab',
  tagline: 'Question, literature, method, results, write-up — one continuous board.',
  blurb:
    'A working research board: a literature matrix, a hypothesis with its own falsifier, a method diagram, real result charts with the analysis script beside them, and a chapter binder.',
  category: 'Academic',
  accent: '#3E63DD',
  emoji: '🔬',
  backgroundId: 'sky',
  skillPresetId: 'research-lab',
  highlights: ['Literature matrix', 'Method diagram', 'Result charts + script', 'Chapter binder', 'Citation stickies'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1340;
    const B3 = 2340;

    b.display(0, 0, 1100, 'DOES SPATIAL MEMORY SURVIVE THE SCROLL?');
    b.text(
      0,
      170,
      1020,
      130,
      'A thesis board, kept the way a lab notebook should be kept: the question at the top-left, the evidence underneath it, and every claim within arm’s reach of the data that supports it.\n\n> Everything here is arranged so a supervisor can walk it in ten minutes.',
    );
    b.quote(1180, 12, 460, 190, 'No amount of experimentation can prove me right; a single experiment can prove me wrong.');
    b.underline(0, 152, 780, '#3E63DD');

    /* Question */
    b.begin();
    b.heading(0, B1, 620, '01 · The question');
    b.callout(
      0,
      B1 + 78,
      680,
      190,
      'question',
      '**RQ.** Do people recall information better when it is placed in a persistent 2-D space than when it is delivered as a linear scroll?\n\n**H1.** Recall accuracy after 48h is higher for spatially-arranged material (d ≥ 0.4).',
    );
    b.callout(
      0,
      B1 + 292,
      680,
      160,
      'warning',
      '**Falsifier.** If the spatial group is within 3% of the scroll group at 48h, H1 is dead. Written down *before* collecting anything.',
    );
    b.quickData(720, B1 + 78, 320, 288, [
      ['Field', 'Cognitive HCI'],
      ['Design', 'Between-subjects'],
      ['n', '84 (42 / 42)'],
      ['Pre-reg', 'OSF · osf.io/xxxxx'],
      ['Ethics', 'Approved 04/12'],
      ['Supervisor', 'Dr. Halvorsen'],
    ]);
    b.text(
      1080,
      B1 + 78,
      480,
      288,
      '### Variables\n- **IV** — presentation (spatial / linear)\n- **DV** — cued-recall score at 48h (0–20)\n- **Covariates** — prior tool use, screen size, time-on-task\n\n$$d = \\frac{\\bar{x}_1 - \\bar{x}_2}{s_p}$$',
    );
    b.sticky(720, B1 + 392, 200, 160, 'Careful: time-on-task is *not* controlled. Report it, don’t bury it.', STICKY.rose);
    b.sticky(940, B1 + 392, 200, 160, 'Ask Halvorsen about Bonferroni vs. Holm before analysis.', STICKY.amber);
    b.wrapScene('01 · The question', 'One hypothesis, one number that would kill it, written before any data existed.', {
      color: '#3E63DD',
    });

    /* Literature */
    b.begin();
    b.heading(COL2, B1, 620, '02 · Literature matrix');
    b.table(
      COL2,
      B1 + 78,
      940,
      330,
      'What has already been shown',
      ['Study', 'n', 'Design', 'Effect', 'Gap it leaves'],
      [
        ['Ball & Torrance (1978)', '32', 'Lab, maps', 'Large', 'No digital condition'],
        ['Robertson et al. (1998)', '18', 'Data Mountain', 'Medium', 'Tiny n, no delay'],
        ['Cockburn (2004)', '48', 'Doc retrieval', 'Small', 'Retrieval ≠ recall'],
        ['Andrews (2010)', '24', 'Large display', 'Medium', 'Display size confound'],
        ['Liu (2021)', '120', 'VR spatial', 'Large', 'VR does not generalise'],
      ],
    );
    b.chart(COL2 + 980, B1 + 78, 420, 330, 'hbar', 'Reported effect size (d)', [
      ['Ball 78', 0.82],
      ['Robertson 98', 0.51],
      ['Cockburn 04', 0.18],
      ['Andrews 10', 0.44],
      ['Liu 21', 0.79],
    ]);
    b.callout(
      COL2,
      B1 + 440,
      620,
      160,
      'idea',
      '**The gap.** Every strong effect comes from a lab rig nobody uses. Nobody has tested a tool people already work in, with a 48-hour delay.',
    );
    b.sticky(COL2 + 660, B1 + 440, 200, 160, 'Liu 2021 supplementary has the raw scores — email the author.', STICKY.sky);
    b.sticky(COL2 + 880, B1 + 440, 200, 160, 'Cockburn measures retrieval and calls it memory. Say so, politely.', STICKY.sky);
    b.text(
      COL2 + 1100,
      B1 + 440,
      300,
      160,
      '`5 read` · `2 to read`\n`0 cited without reading`',
    );
    b.wrapScene('02 · Literature', 'Five studies, one honest gap, and the reason this thesis is allowed to exist.', {
      color: '#8B5FBF',
    });

    /* Method */
    b.begin();
    b.heading(0, B2, 620, '03 · Method');
    b.mermaid(
      0,
      B2 + 78,
      660,
      400,
      'graph TD;\n  A[Recruit n=84] --> B[Randomise];\n  B --> C[Spatial condition];\n  B --> D[Linear condition];\n  C --> E[20-min study task];\n  D --> E;\n  E --> F[Immediate recall];\n  F --> G[48h gap];\n  G --> H[Delayed cued recall];\n  H --> I[Score + analyse];',
    );
    b.timeline(700, B2 + 78, 620, 330, 'Study calendar', [
      { label: 'Pilot (n=8)', from: -30, to: -22, done: true },
      { label: 'Recruitment', from: -20, to: -2, done: true },
      { label: 'Sessions — wave 1', from: -1, to: 12 },
      { label: 'Sessions — wave 2', from: 14, to: 26 },
      { label: 'Analysis', from: 27, to: 38 },
      { label: 'Draft to supervisor', from: 40, to: 40 },
    ]);
    b.todo(1360, B2 + 78, 320, 330, 'Before wave 2', [
      ['Fix the timer drift bug', true],
      ['Re-balance stimulus order', true],
      ['Second coder for free recall', false],
      ['Pre-register the analysis change', false],
    ]);
    b.callout(
      700,
      B2 + 440,
      620,
      160,
      'note',
      '**Deviation from pre-registration.** Wave 1 used a 24h delay by mistake for the first 9 participants. They are analysed separately and reported. Do not quietly merge them.',
    );
    b.progress(1360, B2 + 440, 320, 160, 'Sessions completed', { current: 51, target: 84, unit: 'p', view: 'bar' });
    b.wrapScene('03 · Method', 'The protocol, the calendar, and the deviation that gets reported instead of hidden.', {
      color: '#2F9E6E',
    });

    /* Results */
    b.begin();
    b.heading(COL2, B2, 620, '04 · Results so far');
    b.chart(COL2, B2 + 78, 440, 320, 'bar', 'Mean recall @48h (of 20)', [
      ['Spatial', 13.8],
      ['Linear', 11.2],
    ]);
    b.chart(COL2 + 480, B2 + 78, 440, 320, 'line', 'Recall decay by condition', [
      ['0h · sp', 16.4],
      ['0h · lin', 15.9],
      ['24h · sp', 14.9],
      ['24h · lin', 13.1],
      ['48h · sp', 13.8],
      ['48h · lin', 11.2],
    ]);
    b.metric(COL2 + 960, B2 + 78, 300, 190, "Cohen's d", '0.47', 'CI [0.11, 0.83]', [0.2, 0.31, 0.38, 0.42, 0.47]);
    b.metric(COL2 + 960, B2 + 288, 300, 190, 'p (two-tailed)', '0.019', 'n = 51 of 84', [0.4, 0.22, 0.11, 0.06, 0.019]);
    b.code(
      COL2,
      B2 + 430,
      700,
      330,
      'python',
      "import pandas as pd\nfrom scipy import stats\n\ndf = pd.read_csv('recall_48h.csv')\nsp  = df.loc[df.cond == 'spatial', 'score']\nlin = df.loc[df.cond == 'linear',  'score']\n\nt, p = stats.ttest_ind(sp, lin, equal_var=False)\npooled = ((sp.std()**2 + lin.std()**2) / 2) ** 0.5\nprint(f'd = {(sp.mean() - lin.mean()) / pooled:.2f}  p = {p:.3f}')",
    );
    b.callout(
      COL2 + 740,
      B2 + 500,
      520,
      150,
      'success',
      '**H1 survives at the halfway mark** — d = 0.47, above the 0.4 threshold. The interval is wide; do not write the abstract yet.',
    );
    b.callout(
      COL2 + 740,
      B2 + 670,
      520,
      150,
      'warning',
      'Spatial group spent 3.2 min longer on task. Until that is modelled, the effect is *confounded*, not found.',
    );
    b.wrapScene('04 · Results', 'The effect is there, the interval is wide, and the confound is written next to it.', {
      color: '#C9904B',
    });

    /* Write-up */
    b.begin();
    b.heading(0, B3, 620, '05 · The write-up');
    const chapters = b.binder(0, B3 + 78, 320, 180, 'Thesis chapters');
    b.inside(chapters, 'heading', 0, 0, 600, 70, 'Chapters', { fontSize: 32, fontFamily: "'Outfit', sans-serif" });
    b.inside(
      chapters,
      'text',
      0,
      92,
      600,
      240,
      '1. **Introduction** — draft ✓\n2. **Related work** — draft ✓\n3. **Method** — in progress\n4. **Results** — blocked on wave 2\n5. **Discussion** — outline only\n6. **Conclusion** — —\n\n> Each chapter gets its own board inside this binder.',
      { fontSize: 15 },
    );
    b.inside(chapters, 'sticky', 640, 0, 220, 180, 'Word budget: 24k.\nCurrently 9,140.', { color: STICKY.mint });
    b.inside(chapters, 'sticky', 880, 0, 220, 180, 'Halvorsen wants Ch.3 before the 14th.', { color: STICKY.rose });
    b.todo(360, B3 + 78, 340, 300, 'Writing queue', [
      ['Method: participants section', true],
      ['Method: apparatus + stimuli', false],
      ['Results: figures at final size', false],
      ['Discussion: address the time confound', false],
      ['Appendix: full stimulus list', false],
    ]);
    b.text(
      740,
      B3 + 78,
      560,
      300,
      '### Standing rules for this board\n- Every claim sits **within arm’s reach** of its evidence\n- Anything unread is a *sticky*, never a citation\n- Deviations get their own callout — never a footnote\n- Figures are built here at final size, then exported\n\n---\n\nThe Skill Set attached to this canvas holds the agent to the same rules.',
    );
    b.quote(1340, B3 + 78, 340, 300, 'Write the discussion you would accept from someone else.');
    b.countdown(360, B3 + 410, 250, 250, 'Draft to supervisor', 40);
    b.timer(630, B3 + 410, 250, 250, 'Writing block');
    b.chart(900, B3 + 410, 400, 250, 'donut', 'Words written by chapter', [
      ['Intro', 3200],
      ['Related work', 4100],
      ['Method', 1840],
    ]);
    b.callout(1340, B3 + 410, 340, 250, 'idea', 'The deadline is not the submission date. It is the day Halvorsen stops replying — three weeks earlier.');
    b.wrapScene('05 · Write-up', 'Chapters as sub-boards, a writing queue, and the deadline behind the deadline.', {
      color: '#E0567F',
    });
  },
};

/* ============================================================
   4 · Creator Content Studio
   ============================================================ */

const creatorStudio: CanvasTemplate = {
  id: 'creator-studio',
  title: 'content studio',
  name: 'Creator Content Studio',
  tagline: 'Idea bank → script → shoot → publish → what the numbers said.',
  blurb:
    'The full production line for a channel: an idea bank scored against effort, a scripting frame, a shoot checklist, a publishing calendar, and the performance board that decides what gets made next.',
  category: 'Creative',
  accent: '#C08AE6',
  emoji: '🎬',
  backgroundId: 'plum',
  skillPresetId: 'content-kitchen',
  highlights: ['Idea bank + scoring', 'Script frame', 'Shoot checklist', 'Publishing calendar', 'Performance charts'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1300;
    const B3 = 2280;

    b.display(0, 0, 1080, 'THE STUDIO — Q3 SLATE');
    b.text(
      0,
      170,
      1000,
      120,
      '**Everything from “what if” to “what happened”, in one loop.** The performance board on the bottom-right feeds the idea bank on the top-left — that is the whole system, and it is why this board is a circle, not a list.',
    );
    b.quote(1180, 12, 460, 190, 'Make the thing you would stop scrolling for. Then make it shorter.');
    b.underline(0, 152, 560, '#C08AE6');

    /* Idea bank */
    b.begin();
    b.heading(0, B1, 620, '01 · Idea bank');
    b.table(
      0,
      B1 + 78,
      860,
      330,
      'Scored ideas — reach vs. effort',
      ['Idea', 'Format', 'Reach', 'Effort', 'Score'],
      [
        ['“I deleted my whole setup”', 'Long', '9', '4', '2.25'],
        ['Desk tour, but honest', 'Short', '8', '2', '4.00'],
        ['Editing a video in 10 min', 'Long', '7', '6', '1.17'],
        ['Reading my own worst comments', 'Short', '9', '1', '9.00'],
        ['Gear I regret buying', 'Long', '8', '3', '2.67'],
        ['One-take, no edit, no plan', 'Short', '6', '1', '6.00'],
      ],
    );
    b.chart(900, B1 + 78, 400, 330, 'hbar', 'Score = reach ÷ effort', [
      ['Worst comments', 9.0],
      ['One-take', 6.0],
      ['Desk tour', 4.0],
      ['Gear regrets', 2.67],
      ['Deleted setup', 2.25],
    ]);
    b.callout(
      1340,
      B1 + 78,
      340,
      170,
      'idea',
      'The top of this list is always something **cheap and honest**. Every quarter we re-learn it.',
    );
    b.sticky(1340, B1 + 268, 340, 140, 'Parking lot: collab with @renders. Needs a real idea first.', STICKY.lilac);
    b.sticky(0, B1 + 440, 200, 160, 'Rule: an idea with no hook in one sentence is not an idea.', STICKY.amber);
    b.sticky(220, B1 + 440, 200, 160, 'Never open with “hey guys”. Open with the mistake.', STICKY.amber);
    b.poll(440, B1 + 440, 300, 250, 'What do we film first?', [
      ['Worst comments', 9],
      ['One-take', 5],
      ['Desk tour', 4],
    ]);
    b.wrapScene('01 · Idea bank', 'Every idea scored reach-over-effort. The cheap honest one always wins.', {
      color: '#C08AE6',
    });

    /* Script */
    b.begin();
    b.heading(COL2, B1, 620, '02 · Script — “Reading my worst comments”');
    b.text(
      COL2,
      B1 + 78,
      680,
      420,
      '### Cold open (0:00–0:12)\n> “This one says I should quit. It has more likes than my last video.”\n\n**No intro. No logo. No name.** Straight into the worst one.\n\n### Body (0:12–4:30)\n- Five comments, worst → funniest\n- Read it **flat**. The comment is the joke, not the delivery\n- One real answer in the middle — the one that actually stung\n\n### Turn (4:30–5:10)\nAdmit the criticism that was right. This is the whole video.\n\n### Close (5:10–5:30)\nNo call to action. Read the last comment. Cut.',
    );
    b.callout(
      COL2 + 720,
      B1 + 78,
      420,
      170,
      'note',
      '**Hook test:** if the first 8 seconds work as a standalone short, the video works. If not, rewrite the open, not the ending.',
    );
    b.quickData(COL2 + 720, B1 + 268, 420, 230, [
      ['Target length', '5:30'],
      ['Shoot', 'One camera, one take'],
      ['B-roll', 'None (deliberate)'],
      ['Music', 'None until 4:30'],
      ['Thumbnail', 'Face + one comment'],
    ]);
    b.sticky(COL2 + 1180, B1 + 78, 220, 190, 'Thumbnail text options:\n“quit”\n“they were right”\n“ouch”', STICKY.rose);
    b.sticky(COL2 + 1180, B1 + 288, 220, 210, 'Do NOT cut the pause at 4:41. It is the best moment.', STICKY.mint);
    b.progress(COL2, B1 + 530, 680, 120, 'Script locked', { value: 100, view: 'bar' });
    b.wrapScene('02 · Script', 'A real script, structured around the eight seconds that decide everything.', {
      color: '#E0567F',
    });

    /* Production */
    b.begin();
    b.heading(0, B2, 620, '03 · Production');
    b.todo(0, B2 + 78, 340, 340, 'Shoot day', [
      ['Charge both batteries', true],
      ['Clear the desk (again)', true],
      ['Lav mic + backup on camera', true],
      ['Comments printed, in order', false],
      ['Do the whole thing in one take', false],
      ['Shoot the thumbnail before changing shirt', false],
    ]);
    b.timeline(380, B2 + 78, 620, 340, 'This video, end to end', [
      { label: 'Script', from: -6, to: -4, done: true },
      { label: 'Shoot', from: -3, to: -3, done: true },
      { label: 'Edit', from: -2, to: 2 },
      { label: 'Thumbnail + title', from: 1, to: 3 },
      { label: 'Publish', from: 4, to: 4 },
    ]);
    b.countdown(1040, B2 + 78, 250, 250, 'Publish', 4);
    b.timer(1310, B2 + 78, 250, 250, 'Edit sprint');
    b.chart(1040, B2 + 348, 520, 300, 'donut', 'Where the hours actually go', [
      ['Editing', 46],
      ['Shooting', 12],
      ['Writing', 22],
      ['Thumbnail', 14],
      ['Uploading', 6],
    ]);
    b.callout(
      0,
      B2 + 450,
      1000,
      170,
      'warning',
      '**Editing is 46% of the time and 0% of the reason people watch.** Every quarter we promise to cut it in half. This quarter the rule is: no cut shorter than 1.5 seconds, and no b-roll we did not already have.',
    );
    b.wrapScene('03 · Production', 'Shoot list, edit sprint, and the honest chart about where the hours vanish.', {
      color: '#2F9E6E',
    });

    /* Calendar */
    b.begin();
    b.heading(COL2, B2, 620, '04 · Publishing calendar');
    b.table(
      COL2,
      B2 + 78,
      900,
      330,
      'Q3 slate',
      ['Week', 'Long form', 'Short', 'Status'],
      [
        ['W1', 'Worst comments', 'Cold open cut', 'Editing'],
        ['W2', '—', 'Desk tour (part 1)', 'Scripted'],
        ['W3', 'Gear I regret', 'Desk tour (part 2)', 'Idea'],
        ['W4', '—', 'One-take', 'Idea'],
        ['W5', 'Deleted my setup', 'Gear regret cut', 'Idea'],
        ['W6', 'Buffer week', '—', 'Deliberate'],
      ],
    );
    b.callout(
      COL2 + 940,
      B2 + 78,
      420,
      170,
      'success',
      '**Week 6 is empty on purpose.** The last three quarters died in week 5. The buffer is the schedule.',
    );
    b.progress(COL2 + 940, B2 + 268, 420, 140, 'Q3 slate filmed', { current: 2, target: 6, unit: ' videos', view: 'bar' });
    b.decision(COL2 + 1400, B2 + 78, 300, 330, 'Stuck? Spin it.', [
      'Ship the rough cut',
      'Cut it to 90 seconds',
      'Shelve it, film the one-take',
    ]);
    b.wrapScene('04 · Calendar', 'Six weeks, one of them deliberately empty — because that is where the last three died.', {
      color: '#C9904B',
    });

    /* Performance */
    b.begin();
    b.heading(0, B3, 620, '05 · What the numbers said');
    b.metric(0, B3 + 78, 290, 190, 'Subscribers', '48.2k', '+2.1k / 30d', [39, 41, 42, 44, 45, 46.5, 48.2]);
    b.metric(310, B3 + 78, 290, 190, 'Median view duration', '54%', '+7pts', [38, 41, 44, 47, 49, 52, 54]);
    b.chart(620, B3 + 78, 460, 320, 'line', 'Views per video (k)', [
      ['Setup tour', 22],
      ['Gear tier list', 61],
      ['Editing rant', 18],
      ['Worst comments', 143],
      ['Desk reset', 37],
    ]);
    b.chart(1120, B3 + 78, 420, 320, 'bar', 'Retention at 30s (%)', [
      ['Setup tour', 51],
      ['Tier list', 68],
      ['Editing rant', 44],
      ['Worst comments', 79],
      ['Desk reset', 58],
    ]);
    b.callout(
      0,
      B3 + 300,
      600,
      170,
      'success',
      '**The honest videos win by 4×.** Not the polished ones. The line goes up exactly where the ego goes down.',
    );
    b.text(
      620,
      B3 + 430,
      560,
      200,
      '### Feeding this back into the bank\n- [x] Add “the mistake that cost me £2k”\n- [x] Add “I tried my own advice for a month”\n- [ ] Delete every idea whose hook needs a setup\n- [ ] Stop pitching tier lists',
    );
    b.quote(1220, B3 + 430, 400, 200, 'The algorithm has excellent taste in humility.');
    b.wrapScene('05 · Performance', 'The loop closes here: the numbers rewrite the idea bank, not the other way round.', {
      color: '#3E63DD',
    });
  },
};

/* ============================================================
   5 · Life OS — Weekly Reset
   ============================================================ */

const lifeOS: CanvasTemplate = {
  id: 'life-os',
  title: 'life os — weekly reset',
  name: 'Life OS · Weekly Reset',
  tagline: 'Review the week, aim the next one, keep the habits honest.',
  blurb:
    'A calm personal operating board: a weekly review, habit rings, a money snapshot, a reading shelf, and a Sunday ritual you can run in twenty minutes.',
  category: 'Personal',
  accent: '#2F9E6E',
  emoji: '🌿',
  backgroundId: 'mint',
  skillPresetId: 'zen-minimalist',
  highlights: ['Habit rings & streaks', 'Money snapshot', 'Weekly review ritual', 'Reading shelf', 'Focus timer'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1300;
    const B3 = 2260;

    b.display(0, 0, 1000, 'WEEKLY RESET');
    b.text(
      0,
      170,
      960,
      120,
      'Twenty minutes, every Sunday, in this order: **look back → tell the truth → aim one week → put it down.**\n\nNothing on this board is aspirational. If a row has been red for three weeks, it gets deleted, not renewed.',
    );
    b.quote(1120, 12, 440, 190, 'You do not rise to the level of your goals. You fall to the level of your systems.');
    b.underline(0, 152, 380, '#2F9E6E');

    /* Review */
    b.begin();
    b.heading(0, B1, 620, '01 · Look back');
    b.text(
      0,
      B1 + 78,
      560,
      300,
      '### Three questions, answered honestly\n\n**What actually happened?**\nShipped the pricing page. Two nights lost to a bug that was a typo.\n\n**What did I avoid?**\nThe dentist. The hard conversation about scope.\n\n**What would I repeat?**\nThursday. No meetings, phone in a drawer, four hours of real work.',
    );
    b.chart(600, B1 + 78, 400, 300, 'bar', 'Energy by day (1–10)', [
      ['Mon', 6],
      ['Tue', 7],
      ['Wed', 4],
      ['Thu', 9],
      ['Fri', 6],
      ['Sat', 8],
      ['Sun', 7],
    ]);
    b.metric(1040, B1 + 78, 290, 190, 'Deep-work hours', '11.5', '+2.5 vs last week', [6, 7, 9, 8, 9, 9, 11.5]);
    b.callout(1040, B1 + 288, 290, 90, 'note', 'Wednesday was the meeting day. It is always Wednesday.');
    b.sticky(0, B1 + 410, 200, 170, 'Win of the week: said no to the podcast. Felt terrible. Correct.', STICKY.mint);
    b.sticky(220, B1 + 410, 200, 170, 'Lost 2 evenings to a missing semicolon. Sleep earlier.', STICKY.peach);
    b.sticky(440, B1 + 410, 200, 170, 'Called Mum. Do that on a fixed day, not “when I remember”.', STICKY.sky);
    b.wrapScene('01 · Look back', 'Three questions and a chart. If the chart and the answers disagree, the chart is right.', {
      color: '#2F9E6E',
    });

    /* Habits */
    b.begin();
    b.heading(COL2, B1, 620, '02 · Habits, honestly');
    b.progress(COL2, B1 + 78, 280, 250, 'Move — 4×/week', { current: 3, target: 4, unit: 'x', view: 'ring' });
    b.progress(COL2 + 300, B1 + 78, 280, 250, 'Read — 30 min/day', { current: 5, target: 7, unit: 'd', view: 'ring' });
    b.progress(COL2 + 600, B1 + 78, 280, 250, 'Lights out by 23:30', { current: 2, target: 7, unit: 'd', view: 'ring' });
    b.progress(COL2 + 900, B1 + 78, 280, 250, 'No phone before 09:00', { current: 6, target: 7, unit: 'd', view: 'ring' });
    b.chart(COL2 + 1220, B1 + 78, 400, 250, 'line', 'Sleep (hours)', [
      ['Mon', 6.2],
      ['Tue', 7.1],
      ['Wed', 5.4],
      ['Thu', 7.8],
      ['Fri', 6.9],
      ['Sat', 8.4],
      ['Sun', 7.6],
    ]);
    b.callout(
      COL2,
      B1 + 360,
      880,
      160,
      'warning',
      '**“Lights out by 23:30” has been red for three weeks.** Under the rules of this board it gets deleted or halved. Halving it: lights out by midnight, five nights.',
    );
    b.table(
      COL2 + 920,
      B1 + 360,
      700,
      160,
      'Streaks',
      ['Habit', 'Current', 'Best'],
      [
        ['Move', '3 wk', '11 wk'],
        ['Read', '9 wk', '9 wk'],
        ['No phone AM', '2 wk', '6 wk'],
      ],
    );
    b.wrapScene('02 · Habits', 'Rings, streaks, and the rule that a three-week red habit gets halved or killed.', {
      color: '#C9904B',
    });

    /* Aim */
    b.begin();
    b.heading(0, B2, 620, '03 · Aim the week');
    b.todo(0, B2 + 78, 340, 320, 'The three that matter', [
      ['Pricing page live', false],
      ['Dentist — actually book it', false],
      ['Scope conversation with Kofi', false],
    ]);
    b.todo(380, B2 + 78, 340, 320, 'Everything else (optional)', [
      ['Renew the domain', false],
      ['Tidy the downloads folder', false],
      ['Reply to Ana', true],
      ['Cancel the gym app', false],
    ]);
    b.timeline(760, B2 + 78, 620, 320, 'This week', [
      { label: 'Pricing page', from: 0, to: 2 },
      { label: 'Deep-work block', from: 3, to: 3 },
      { label: 'Scope conversation', from: 1, to: 1 },
      { label: 'Weekend — off', from: 5, to: 6 },
    ]);
    b.timer(1420, B2 + 78, 250, 320, 'Focus');
    b.callout(
      0,
      B2 + 430,
      720,
      160,
      'idea',
      '**Three is the limit.** A fourth item on the left column is a lie you tell yourself on Sunday and repay on Friday.',
    );
    b.decision(760, B2 + 430, 300, 300, 'Can’t choose?', ['Pricing page', 'Dentist', 'Scope talk']);
    b.quote(1100, B2 + 430, 570, 300, 'A week has room for three real things. Everything else is weather.');
    b.wrapScene('03 · Aim the week', 'Three real commitments, one optional column, and a hard limit that is not negotiable.', {
      color: '#3E63DD',
    });

    /* Money & shelf */
    b.begin();
    b.heading(COL2, B2, 620, '04 · Money & the shelf');
    b.table(
      COL2,
      B2 + 78,
      620,
      290,
      'Monthly snapshot',
      ['Line', 'Planned', 'Actual'],
      [
        ['Rent + bills', '£1,240', '£1,240'],
        ['Food', '£380', '£441'],
        ['Transport', '£90', '£62'],
        ['Fun', '£150', '£218'],
        ['Saved', '£600', '£479'],
      ],
    );
    b.chart(COL2 + 660, B2 + 78, 400, 290, 'donut', 'Where it went', [
      ['Housing', 1240],
      ['Food', 441],
      ['Fun', 218],
      ['Transport', 62],
    ]);
    b.progress(COL2 + 1100, B2 + 78, 300, 290, 'Emergency fund', {
      current: 4200,
      target: 6000,
      unit: '£',
      view: 'ring',
    });
    b.callout(COL2 + 1420, B2 + 78, 300, 140, 'note', 'Fun overspend is fine. Food overspend is takeaway, and takeaway is a Wednesday problem.');
    b.sticky(COL2 + 1420, B2 + 238, 300, 130, 'Cancel: gym app, second cloud drive.', STICKY.peach);
    const shelf = b.binder(COL2, B2 + 400, 320, 170, 'The shelf');
    b.inside(shelf, 'heading', 0, 0, 540, 70, 'Reading shelf', { fontSize: 32, fontFamily: "'Outfit', sans-serif" });
    b.inside(
      shelf,
      'text',
      0,
      92,
      540,
      220,
      '**Reading now**\n- *The Art of Doing Science and Engineering* — Hamming\n\n**Next**\n- *Seeing Like a State*\n- *The Design of Everyday Things* (re-read)\n\n**Abandoned, guilt-free**\n- Two productivity books. They were the same book.',
      { fontSize: 15 },
    );
    b.inside(shelf, 'sticky', 580, 0, 220, 170, 'Rule: one book at a time. Abandon at page 50 without ceremony.', { color: STICKY.sand });
    b.text(
      COL2 + 360,
      B2 + 400,
      520,
      170,
      '### Sunday ritual, in order\n1. Read last week’s three\n2. Answer the three questions\n3. Update the rings — no rounding up\n4. Pick three. Only three.\n5. Close the laptop',
    );
    b.countdown(COL2 + 920, B2 + 400, 250, 250, 'Next reset', 7);
    b.wrapScene('04 · Money & the shelf', 'The boring half — where the money went, what is being read, and the ritual itself.', {
      color: '#8B5FBF',
    });

    /* Year */
    b.begin();
    b.heading(0, B3, 620, '05 · The year, from far away');
    b.chart(0, B3 + 78, 620, 300, 'area', 'Deep-work hours per week', [
      ['W26', 6],
      ['W27', 9],
      ['W28', 4],
      ['W29', 11],
      ['W30', 8],
      ['W31', 9],
      ['W32', 11.5],
    ]);
    b.progress(660, B3 + 78, 300, 300, 'Year, elapsed', { value: 58, view: 'ring' });
    b.text(
      1000,
      B3 + 78,
      580,
      300,
      '### Three things for the year\n1. **Ship one thing people pay for** — in progress\n2. **Be reachable to four people** — holding\n3. **Sleep like it matters** — failing, honestly\n\n---\n\nThat is the whole plan. It fits on a card because it has to.',
    );
    b.wrapScene('05 · The year', 'Zoomed all the way out: three things, one of them honestly failing.', { color: '#C97B4B' });
  },
};

/* ============================================================
   6 · System Design Review
   ============================================================ */

const systemDesign: CanvasTemplate = {
  id: 'system-design',
  title: 'system design review',
  name: 'System Design Review',
  tagline: 'Architecture, API, data, failure modes and the rollout — reviewable in one pass.',
  blurb:
    'An engineering design doc that lives on a canvas: architecture diagram, endpoint table, schema, capacity numbers, a failure-mode register and a staged rollout with its own kill switch.',
  category: 'Engineering',
  accent: '#5B8DEF',
  emoji: '⚙️',
  backgroundId: 'midnight',
  skillPresetId: 'code-architect',
  highlights: ['Mermaid architecture', 'API + schema tables', 'Capacity math', 'Failure-mode register', 'Staged rollout'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1360;
    const B3 = 2360;

    b.display(0, 0, 1120, 'DESIGN REVIEW — REALTIME PRESENCE');
    b.text(
      0,
      170,
      1040,
      130,
      '**Status:** in review · **Author:** Ana · **Reviewers:** Kofi, Ren, Sam\n\nOne board instead of a twelve-page doc. Read it left to right; every section answers one reviewer question, and the failure modes are as prominent as the happy path on purpose.',
    );
    b.quote(1180, 12, 460, 190, 'Everything fails all the time. Design for it, or discover it at 3am.');
    b.underline(0, 152, 820, '#5B8DEF');

    /* Problem */
    b.begin();
    b.heading(0, B1, 620, '01 · Problem & constraints');
    b.callout(
      0,
      B1 + 78,
      680,
      180,
      'note',
      '**Problem.** Two people editing the same board see each other 4–9 seconds late. Cursors jump. Nobody trusts the “live” label, so nobody collaborates live.',
    );
    b.callout(
      0,
      B1 + 282,
      680,
      160,
      'warning',
      '**Non-goal.** Conflict-free merge of simultaneous edits to the same object. That is a CRDT project; this is a transport project.',
    );
    b.quickData(720, B1 + 78, 340, 288, [
      ['P50 target', '< 120 ms'],
      ['P99 target', '< 400 ms'],
      ['Concurrent boards', '2,000'],
      ['Peak peers/board', '12'],
      ['Budget', '$400 / mo'],
      ['Deadline', '6 weeks'],
    ]);
    b.code(
      1100,
      B1 + 78,
      560,
      364,
      'javascript',
      "// Capacity, done on the board so a reviewer can argue with it.\nconst boards       = 2000;\nconst peersPerBoard= 6;      // p50, not peak\nconst opsPerPeerMin= 30;\n\nconst opsPerSec = (boards * peersPerBoard * opsPerPeerMin) / 60;\n// => 6,000 ops/s steady, ~18,000 at peak\n\nconst bytesPerOp = 240;      // measured, not guessed\nconst egressMBps = (opsPerSec * peersPerBoard * bytesPerOp) / 1e6;\n// => ~8.6 MB/s fan-out. This is the number that costs money.",
    );
    b.wrapScene('01 · Problem', 'What is broken, what we are explicitly not fixing, and the capacity math in public.', {
      color: '#5B8DEF',
    });

    /* Architecture */
    b.begin();
    b.heading(COL2, B1, 620, '02 · Architecture');
    b.mermaid(
      COL2,
      B1 + 78,
      700,
      420,
      'graph TD;\n  C1[Client A] -->|ws| G[Edge gateway];\n  C2[Client B] -->|ws| G;\n  G --> R{Room router};\n  R --> P[Presence service];\n  P --> RD[(Redis streams)];\n  P --> DB[(Postgres · durable ops)];\n  RD --> P2[Fan-out workers];\n  P2 --> G;\n  DB -.snapshot.-> S[Snapshot job];',
    );
    b.table(
      COL2 + 740,
      B1 + 78,
      620,
      300,
      'Why each piece exists',
      ['Component', 'Job', 'If it dies'],
      [
        ['Edge gateway', 'WS termination, auth', 'Clients reconnect, 5s gap'],
        ['Room router', 'Board → shard', 'Reads stale map, self-heals'],
        ['Redis streams', 'Ordered op log', 'Degrade to DB polling'],
        ['Fan-out worker', 'Push to peers', 'Latency climbs, no data loss'],
        ['Snapshot job', 'Compaction', 'Replay gets slow, nothing breaks'],
      ],
    );
    b.callout(
      COL2 + 740,
      B1 + 410,
      620,
      170,
      'idea',
      '**The one real decision:** Redis streams over a queue. We need *replay from offset* for a peer that reconnects, and a queue cannot give us that without a second store.',
    );
    b.sticky(COL2 + 1400, B1 + 78, 260, 200, 'Kofi: why not Postgres LISTEN/NOTIFY? → payload cap 8kb, no replay.', STICKY.sky);
    b.sticky(COL2 + 1400, B1 + 298, 260, 200, 'Ren: shard by board id, not user id. Agreed — added to router.', STICKY.mint);
    b.wrapScene('02 · Architecture', 'Six boxes, what each one does when it dies, and the single decision worth arguing about.', {
      color: '#8B5FBF',
    });

    /* API & data */
    b.begin();
    b.heading(0, B2, 620, '03 · API & data');
    b.table(
      0,
      B2 + 78,
      840,
      300,
      'Wire protocol',
      ['Event', 'Direction', 'Payload', 'Rate'],
      [
        ['presence.join', 'c → s', '{boardId, user}', 'once'],
        ['presence.cursor', 'c → s', '{x, y, t}', '20/s throttled'],
        ['op.apply', 'c → s', '{objId, patch, lamport}', 'burst'],
        ['op.broadcast', 's → c', '{ops[], offset}', 'batched 40ms'],
        ['sync.request', 'c → s', '{fromOffset}', 'on reconnect'],
      ],
    );
    b.code(
      880,
      B2 + 78,
      680,
      300,
      'sql',
      'create table board_op (\n  id          bigserial primary key,\n  board_id    uuid        not null,\n  lamport     bigint      not null,\n  author_id   uuid        not null,\n  patch       jsonb       not null,\n  created_at  timestamptz not null default now()\n);\n\n-- Replay is the hot path; index for it, not for writes.\ncreate index board_op_replay\n  on board_op (board_id, lamport desc);',
    );
    b.callout(
      0,
      B2 + 410,
      840,
      160,
      'question',
      '**Open:** do cursors go through `board_op` at all? They are 80% of traffic and 0% of durability value. Proposal: cursors are Redis-only, never persisted. **Needs Sam’s sign-off.**',
    );
    b.chart(880, B2 + 410, 400, 300, 'donut', 'Traffic mix by event', [
      ['cursor', 78],
      ['op.apply', 14],
      ['broadcast ack', 6],
      ['join/leave', 2],
    ]);
    b.metric(1320, B2 + 410, 290, 190, 'Measured P50 (prototype)', '86 ms', 'target < 120', [420, 310, 190, 140, 104, 86]);
    b.progress(1320, B2 + 620, 290, 90, 'Protocol frozen', { value: 80, view: 'bar' });
    b.wrapScene('03 · API & data', 'The wire protocol, the schema, and the open question that blocks the freeze.', {
      color: '#2F9E6E',
    });

    /* Failure modes */
    b.begin();
    b.heading(COL2, B2, 620, '04 · How it breaks');
    b.table(
      COL2,
      B2 + 78,
      900,
      330,
      'Failure-mode register',
      ['Mode', 'Detection', 'Blast radius', 'Response'],
      [
        ['Redis unavailable', 'Health probe 2s', 'All live boards', 'Degrade to poll, banner'],
        ['Fan-out backlog', 'Lag > 1s alert', 'One shard', 'Shed cursor events first'],
        ['Clock skew', 'Lamport regression', 'One board', 'Server stamps, ignore client t'],
        ['Reconnect storm', 'Conn/s spike', 'Gateway', 'Jittered backoff, cap 30s'],
        ['Poison op', 'Apply throws', 'One board', 'Quarantine offset, page on-call'],
      ],
    );
    b.callout(
      COL2 + 940,
      B2 + 78,
      420,
      190,
      'warning',
      '**Shed cursors, never ops.** Under load the correct product behaviour is “their cursor freezes”, not “their edit vanishes”. This is encoded in the worker, not in a runbook.',
    );
    b.code(
      COL2 + 940,
      B2 + 288,
      420,
      220,
      'javascript',
      "if (lagMs > 1000) {\n  drop(evt => evt.type === 'presence.cursor');\n}\nif (lagMs > 5000) {\n  pageOnCall('presence fan-out lag');\n}",
    );
    b.sticky(COL2 + 1400, B2 + 78, 260, 200, 'Ren: add a chaos test that kills Redis mid-session. Not optional.', STICKY.rose);
    b.text(
      COL2,
      B2 + 440,
      900,
      170,
      '### Rollback plan\n1. Feature flag `presence.v2` off → clients fall back to the 4-second poll\n2. No schema change is destructive; `board_op` is additive only\n3. Redis can be flushed without data loss — Postgres is the source of truth\n\n**Rollback is a flag flip, and it has been tested in staging.**',
    );
    b.wrapScene('04 · How it breaks', 'Five failure modes with responses, plus the rollback that is a single flag.', {
      color: '#D64545',
    });

    /* Rollout */
    b.begin();
    b.heading(0, B3, 620, '05 · Rollout');
    b.timeline(0, B3 + 78, 640, 330, 'Six weeks', [
      { label: 'Protocol + prototype', from: -10, to: -1, done: true },
      { label: 'Gateway + router', from: 0, to: 12 },
      { label: 'Fan-out workers', from: 8, to: 20 },
      { label: 'Chaos + load test', from: 18, to: 26 },
      { label: 'Internal dogfood', from: 24, to: 32 },
      { label: '5% → 50% → 100%', from: 33, to: 42 },
    ]);
    b.todo(680, B3 + 78, 340, 330, 'Ship gates', [
      ['P99 < 400ms under 3× peak load', false],
      ['Chaos test: Redis kill, zero data loss', false],
      ['Dashboards + alerts before 5%', false],
      ['On-call runbook reviewed by Ren', false],
      ['Flag kill-switch tested in prod', false],
    ]);
    b.chart(1060, B3 + 78, 400, 330, 'line', 'P99 latency under load (ms)', [
      ['1× ', 140],
      ['2×', 190],
      ['3×', 310],
      ['4×', 620],
      ['5×', 1400],
    ]);
    b.poll(0, B3 + 450, 320, 270, 'Reviewer verdict', [
      ['Approve', 2],
      ['Approve with changes', 1],
      ['Needs another pass', 0],
    ]);
    b.text(
      360,
      B3 + 450,
      620,
      270,
      '### Sign-off\n- [x] **Kofi** — approve; wants the router shard key documented\n- [x] **Ren** — approve with changes; chaos test is a blocker\n- [ ] **Sam** — pending; owes the cursor-persistence call\n\n> Design is not approved until the open question in section 03 is closed.',
    );
    b.countdown(1020, B3 + 450, 250, 270, '5% rollout', 33);
    b.callout(
      1310,
      B3 + 450,
      380,
      270,
      'warning',
      '**We fall over at 4×.** That is above the ship gate but below where a viral board would put us. Shipping anyway, with the shed rule and an alert at 3×.',
    );
    b.wrapScene('05 · Rollout', 'Gates, the load curve where it breaks, and sign-off that is honestly incomplete.', {
      color: '#C9904B',
    });

    /* Ask AI — kept in column one, below the rollout, so its frame can never
       reach across the gutter and swallow a block from column two. */
    b.begin();
    b.heading(0, B3 + 900, 620, 'Ask the reviewer');
    b.text(
      0,
      B3 + 972,
      760,
      140,
      'Write a question in this frame and run it — the agent reads the whole box.\n\nTry: *“Given the failure-mode register, what should the alert thresholds be?”* or drag a section in here and ask it to find the hole.',
    );
    b.wrap('Ask AI · drop a question here', { kind: 'agent', color: '#8B5FBF' });
  },
};

/* ============================================================
   7 · Trip Atlas
   ============================================================ */

const tripAtlas: CanvasTemplate = {
  id: 'trip-atlas',
  title: 'trip atlas — kyoto',
  name: 'Trip Atlas',
  tagline: 'Real maps, a real budget, and a day-by-day plan that survives contact.',
  blurb:
    'A travel board with live maps pinned to the places you are actually going, a budget that adds up, a packing list, and a day plan with the gaps deliberately left in.',
  category: 'Personal',
  accent: '#C97B4B',
  emoji: '🗺️',
  backgroundId: 'cream',
  highlights: ['Live map blocks', 'Budget table + chart', 'Day-by-day timeline', 'Packing checklist', 'Place stickies'],
  build(b) {
    const COL2 = 1720;
    const B1 = 420;
    const B2 = 1340;

    b.display(0, 0, 980, 'KYOTO — ELEVEN DAYS');
    b.text(
      0,
      170,
      940,
      120,
      '**Two rules for this trip.** One neighbourhood a day, and every afternoon after 15:00 stays empty on purpose — that is where the trip actually happens.',
    );
    b.quote(1080, 12, 460, 190, 'A good itinerary is mostly white space.');
    b.underline(0, 152, 420);

    /* Where */
    b.begin();
    b.heading(0, B1, 620, '01 · Where');
    b.map(0, B1 + 78, 420, 340, 'Kyoto', 'Kyoto, Kansai, Japan', 35.0116, 135.7681);
    b.map(460, B1 + 78, 420, 340, 'Arashiyama', 'Arashiyama, Kyoto, Japan', 35.0094, 135.6668);
    b.map(920, B1 + 78, 420, 340, 'Nara', 'Nara, Nara Prefecture, Japan', 34.6851, 135.8048);
    b.quickData(1380, B1 + 78, 320, 290, [
      ['Dates', '14–25 Oct'],
      ['Base', 'Gion, 2 nights'],
      ['Then', 'Arashiyama, 4 nights'],
      ['Then', 'Nara, 3 nights'],
      ['Flights', 'Booked ✓'],
      ['JR pass', 'Not needed — checked'],
    ]);
    b.sticky(0, B1 + 450, 220, 170, 'Fushimi Inari at 06:30 or not at all. Everyone says this and everyone is right.', STICKY.peach);
    b.sticky(240, B1 + 450, 220, 170, 'Nishiki market — go hungry, skip lunch beforehand.', STICKY.amber);
    b.sticky(480, B1 + 450, 220, 170, 'Bamboo grove is 200m long. Manage expectations.', STICKY.mint);
    b.sticky(720, B1 + 450, 220, 170, 'Deer in Nara will eat your map. Bring a paper one anyway.', STICKY.sand);
    b.wrapScene('01 · Where', 'Three real maps, the base for each leg, and the four notes worth keeping.', { color: '#C97B4B' });

    /* Plan */
    b.begin();
    b.heading(COL2, B1, 620, '02 · The plan (with holes in it)');
    b.timeline(COL2, B1 + 78, 660, 340, 'Eleven days', [
      { label: 'Fly + settle, Gion', from: 0, to: 1 },
      { label: 'Higashiyama walk', from: 2, to: 2 },
      { label: 'Move to Arashiyama', from: 3, to: 3 },
      { label: 'Bamboo, monkeys, river', from: 4, to: 6 },
      { label: 'Nara + deer park', from: 7, to: 9 },
      { label: 'Nothing planned', from: 10, to: 10 },
    ]);
    b.table(
      COL2 + 700,
      B1 + 78,
      620,
      340,
      'Mornings only — afternoons stay free',
      ['Day', 'Morning', 'Booked?'],
      [
        ['Tue', 'Fushimi Inari, 06:30', 'No booking needed'],
        ['Wed', 'Kiyomizu-dera → Gion walk', '—'],
        ['Thu', 'Train to Arashiyama', 'Train ✓'],
        ['Fri', 'Bamboo grove, early', '—'],
        ['Sat', 'Tenryu-ji garden', 'Ticket at gate'],
        ['Sun', 'Nara, first train', 'Hotel ✓'],
      ],
    );
    b.callout(
      COL2 + 1360,
      B1 + 78,
      340,
      170,
      'idea',
      'Everything after 15:00 is unplanned on purpose. The best day of the last trip was an unplanned one.',
    );
    b.countdown(COL2 + 1360, B1 + 268, 250, 250, 'Wheels up', 21);
    b.wrapScene('02 · The plan', 'Mornings booked, afternoons deliberately empty — the trip happens in the gaps.', {
      color: '#3E63DD',
    });

    /* Money & bag */
    b.begin();
    b.heading(0, B2, 620, '03 · Money & the bag');
    b.table(
      0,
      B2 + 78,
      620,
      300,
      'Budget (£, two people)',
      ['Line', 'Planned', 'Actual'],
      [
        ['Flights', '1,180', '1,142'],
        ['Stays (11 nights)', '1,540', '1,505'],
        ['Trains + local', '220', '—'],
        ['Food', '700', '—'],
        ['Everything else', '360', '—'],
      ],
    );
    b.chart(660, B2 + 78, 420, 300, 'donut', 'Where the money goes', [
      ['Flights', 1142],
      ['Stays', 1505],
      ['Food', 700],
      ['Trains', 220],
      ['Other', 360],
    ]);
    b.progress(1120, B2 + 78, 300, 300, 'Budget committed', { current: 2647, target: 4000, unit: '£', view: 'ring' });
    b.todo(1460, B2 + 78, 340, 300, 'The bag', [
      ['Passports + residence card', true],
      ['One pair of shoes you can walk 20km in', true],
      ['Coins pouch (cash country)', false],
      ['Power adapter — type A', false],
      ['Paper map, for the deer', false],
    ]);
    b.callout(
      0,
      B2 + 410,
      1080,
      150,
      'note',
      '**Carry cash.** Small restaurants, shrines and the good coffee places are cash only. £200 in yen from an airport ATM on arrival, not from home.',
    );
    b.wrapScene('03 · Money & the bag', 'The budget that adds up, the packing list that is honest, and the cash rule.', {
      color: '#2F9E6E',
    });
  },
};

/* ============================================================
   Registry
   ============================================================ */

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  startupWarRoom,
  designSprint,
  researchLab,
  creatorStudio,
  systemDesign,
  lifeOS,
  tripAtlas,
];

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Business',
  'Design',
  'Academic',
  'Creative',
  'Engineering',
  'Personal',
];

export function templateById(id: string): CanvasTemplate | undefined {
  return CANVAS_TEMPLATES.find((t) => t.id === id);
}

/**
 * Materialise a template into concrete objects/connections/strokes/scenes for
 * a given canvas id. Pure — nothing is written until `createCanvasFromTemplate`.
 */
export function buildTemplate(template: CanvasTemplate, canvasId: string): TemplateBuild {
  const board = new Board(canvasId);
  template.build(board);
  return {
    objects: board.objects,
    connections: board.connections,
    strokes: board.strokes,
    scenes: board.scenes,
  };
}

function templateSkillset(template: CanvasTemplate): CanvasSkillset | undefined {
  if (!template.skillPresetId) return undefined;
  const preset = getPreset(template.skillPresetId);
  if (!preset) return undefined;
  return installPreset(null, preset);
}

/**
 * The camera a fresh copy opens on — the WHOLE board, not a corner of it.
 *
 * The first second decides whether a template reads as "a canvas someone
 * built" or "three cards and a heading". Framing everything lands at ~20–25%
 * zoom, which is exactly where semantic zoom starts printing gists, so the
 * opening shot is a legible map of the board rather than a wall of noise.
 */
function openingCamera(build: TemplateBuild): { x: number; y: number; zoom: number } {
  const pool = build.objects;
  if (pool.length === 0) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...pool.map((o) => o.x));
  const minY = Math.min(...pool.map((o) => o.y));
  const maxX = Math.max(...pool.map((o) => o.x + o.width));
  const maxY = Math.max(...pool.map((o) => o.y + o.height));
  // Reserve a strip at the top: the canvas title, the Skill Set pill and the
  // rest of the floating chrome live there, and a hero heading centred into it
  // opens the board half-hidden behind its own UI.
  const CHROME = 96;
  const cam = cameraForRect(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    1440,
    820 - CHROME,
    0.06
  );
  return { ...cam, y: cam.y + CHROME };
}

/**
 * Create a brand new canvas from a template and return its id.
 *
 * Written in one IndexedDB pass per store — a template is ~60 objects, and
 * doing 60 individual `saveObject` round-trips is what made the old seeding
 * visibly stall the gallery on first load.
 */
export async function createCanvasFromTemplate(
  templateId: string,
  opts: { title?: string; category?: string } = {},
): Promise<string | null> {
  const template = templateById(templateId);
  if (!template) return null;

  const canvasId = uuidv4();
  const build = buildTemplate(template, canvasId);
  const preset = presetById(template.backgroundId);

  const state: CanvasState = {
    id: canvasId,
    title: opts.title || template.title,
    themeColor: preset?.color || '#FAF6F1',
    background: preset
      ? {
          presetId: preset.presetId,
          color: preset.color,
          opacity: preset.opacity,
          dark: preset.dark,
          accent: preset.accent,
          name: preset.name,
        }
      : undefined,
    camera: openingCamera(build),
    scenes: build.scenes,
    skillset: templateSkillset(template),
    lastModified: Date.now(),
    category: opts.category || 'personal',
    isFavorite: false,
    archived: false,
    deleted: false,
  };

  await saveCanvasState(state);
  await writeBuild(build);
  return canvasId;
}

async function writeBuild(build: TemplateBuild): Promise<void> {
  const db = await getDB();

  const objTx = db.transaction('objects', 'readwrite');
  for (const o of build.objects) await objTx.store.put(o);
  await objTx.done;

  if (build.connections.length) {
    const connTx = db.transaction('connections', 'readwrite');
    for (const c of build.connections) await connTx.store.put(c);
    await connTx.done;
  }

  if (build.strokes.length) {
    const strokeTx = db.transaction('strokes', 'readwrite');
    for (const s of build.strokes) await strokeTx.store.put(s);
    await strokeTx.done;
  }
}

/**
 * First run: give the gallery something worth opening.
 *
 * This replaces the old `seedDatabaseIfEmpty`, which wrote seven canvases full
 * of "Brainstorm Idea #7" cards — enough to make the gallery look populated and
 * nothing else. Three real templates teach more than seven fake boards.
 *
 * The single in-flight promise is load-bearing, not caution: the "is it empty?"
 * read and the writes that follow are far apart in time, so two overlapping
 * calls (React's dev double-invoke is the obvious one, a remount mid-seed the
 * subtler) both see an empty database and both seed it — which is how a first
 * visit ended up with two of every starter board.
 */
let seedInFlight: Promise<void> | null = null;

export function seedStarterCanvasesIfEmpty(): Promise<void> {
  if (!seedInFlight) seedInFlight = runSeed();
  return seedInFlight;
}

async function runSeed(): Promise<void> {
  const db = await getDB();
  const existing = await db.getAll('canvas');
  if (existing.length > 0) return;

  const starters: Array<[string, string]> = [
    ['startup-war-room', 'work'],
    ['design-sprint', 'work'],
    ['life-os', 'personal'],
  ];

  // Stagger lastModified so the gallery's "recent" ordering is meaningful and
  // the Continue card lands on the richest board.
  let age = 0;
  for (const [id, category] of starters) {
    const canvasId = await createCanvasFromTemplate(id, { category });
    if (!canvasId) continue;
    const state = await db.get('canvas', canvasId);
    if (state) {
      age += 1;
      await db.put('canvas', { ...state, lastModified: Date.now() - age * 3 * 60 * 60 * 1000 });
    }
  }
}

const LEGACY_SWEEP_FLAG = 'mindspace_legacy_seed_swept_v1';

/**
 * Retire the old filler demo boards for people who already have them.
 *
 * Deliberately conservative: a legacy canvas is only removed when EVERY object
 * still on it carries that seed's original id prefix. The moment someone has
 * added a block of their own the board is theirs, not ours, and it stays —
 * cleaning up our own mess is not a licence to delete somebody's work. Runs at
 * most once per browser.
 */
let sweepInFlight: Promise<number> | null = null;

export function removeLegacySeedCanvases(): Promise<number> {
  if (!sweepInFlight) sweepInFlight = runSweep();
  return sweepInFlight;
}

async function runSweep(): Promise<number> {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_SWEEP_FLAG)) return 0;

  const db = await getDB();
  let removed = 0;

  for (const seed of LEGACY_SEED_CANVASES) {
    const state = await db.get('canvas', seed.id);
    if (!state) continue;

    const objects = await db.getAllFromIndex('objects', 'by-parent', seed.id);
    const untouched = objects.every((o) => o.id.startsWith(seed.objectPrefix));
    if (!untouched) continue;

    await deleteCanvasPermanently(seed.id);
    removed += 1;
  }

  if (typeof localStorage !== 'undefined') localStorage.setItem(LEGACY_SWEEP_FLAG, '1');
  return removed;
}
