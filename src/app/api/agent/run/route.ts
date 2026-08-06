import { NextRequest, NextResponse } from 'next/server';
import { ChatMsg, HedgeError, nimApiKeys, openHedgedStream } from '@/lib/nim/hedge';
import {
  BUILD_PLANS, HedgeSlot, maxTokensFor, pickProfile, Profile, RESEARCH_RE, SECTION_PLAN, temperatureFor,
} from '@/lib/nim/models';
import {
  BudgetSection, estimateTokens, FAST_INPUT_CHARS, fitToBudget, HARD_INPUT_CHARS,
} from '@/lib/nim/budget';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* ─────────────────────────────────────────────────────────────────────────────
   THE CANVAS BUILDER

   What was wrong, measured live 2026-08-06 (see lib/nim/budget.ts and
   lib/nim/models.ts for the raw numbers):

   1. NOTHING CAPPED THE PROMPT. A 35,339-char system prompt + up to 200
      snapshot objects at 3k chars each + 125k chars of file text + 24k of
      crawled web text all went in unchecked. Past 131,072 tokens the endpoint
      returns a flat HTTP 400 on every key and every model, the race lost every
      slot, and the user was told "AI models are busy or rate-limited" — a lie,
      and one no retry could ever fix. The chat panel sends ~2k tokens and no
      snapshot, which is exactly why chat kept working in the same moment.
      Everything now goes through a priority budget.

   2. THE LEAD MODEL WAS THE SLOWEST GENERATOR ON THE TIER. nemotron-super-49b
      streamed the plan at 37 chars/second and never closed its JSON: 76 seconds
      for a board that arrived truncated. It was chosen on time-to-FIRST-token,
      which is the wrong metric for a builder — the board isn't usable until the
      plan is COMPLETE. gpt-oss-20b does the same board in 11s at 186-207 c/s.

   3. THE SYSTEM PROMPT ARGUED WITH ITSELF. "Match your output size to the
      prompt size / a one-line ask deserves 1-2 actions" sat next to "FINISH THE
      JOB END TO END, deliver real depth" and "budget your ambition, a tight
      8-14 actions beats 25". Given 10k tokens of contradictory policy, a
      mid-size model hedges — which is precisely the "short, half-done, doesn't
      make sense" output. It also ORDERED the two behaviours the user hates:
      "WRAP YOUR ENTIRE ANSWER in a frame" and a connector vocabulary it reached
      for constantly. Both are gone.

   4. pickProfile STARVED REAL WORK. Any prompt under 60 chars starting with
      add/make/set/... became 'quick' with a 2500-token ceiling, so "make me a
      full startup dashboard" was cut off mid-JSON by construction.
   ──────────────────────────────────────────────────────────────────────────── */

/* The user's literal instruction is the highest authority in the prompt, so it
   is repeated verbatim at the very END of the system prompt as well as being
   the user turn. Models weight the start and end of a long context far more
   than the middle, and "use sticky notes" kept getting lost in the middle. */
const SYSTEM_PROMPT = `You are the Mindspace Canvas Agent. You build on the user's infinite canvas by emitting ONE JSON object — no prose, no chatter, no markdown fences.

Today is {today}. You were invoked at (x:{agentX}, y:{agentY}); put new work near there, growing right and down.

{skillsetSection}### THE FIRST RULE — DO WHAT THEY ACTUALLY ASKED
Read the user's words literally and satisfy every part of them in this one pass.
- They name a widget (sticky notes, timeline, donut chart, table, checklist, map, code block, poll) → use THAT widget, not something close.
- They name a topic, a set of sections, a count, a font, a color, a format → honour each one.
- They ask for depth ("research", "in detail", "everything about", "full report") → write real depth: substantive paragraphs of real content, not an outline of headings.
- They ask for one small thing → do that one thing and stop.
Their instruction outranks every preference below. Getting the ask right IS the job.

### INTENT — classify before you act
- BUILD / MAKE / WRITE something new → CREATE_OBJECT in free space.
- ADD / MORE / ALSO / EXTEND / CONTINUE → CREATE_OBJECT beside the existing work. Never delete the earlier answer to swap in a longer one.
- EDIT / REWRITE / IMPROVE / FIX / RESIZE / RECOLOR a specific block → UPDATE_OBJECT it by its REAL id from the snapshot. Don't clone it.
- ORGANIZE / TIDY / GROUP / "lay this out" → UPDATE_OBJECT every relevant block with new x/y. You are MOVING FURNITURE: never delete, never recreate, keep every real id and every word of content.
- ANSWER a question about what's on the board → read the SNAPSHOT and write the answer into a NEW text block beside the thing you're answering about.
- DELETE → only when they explicitly said delete / remove / clear / "get rid of" / "replace this with". Otherwise never.
THE USER'S EXISTING CONTENT IS SACRED. Deleting their work in order to "improve" or "redo" it is the worst thing you can do here.

### BUILD THE SUBJECT, NOT A REPORT ABOUT THE CANVAS
If you were asked to build a topic ("a report on Indian media", "a launch plan"), build THAT topic in full. Only describe the canvas itself when they explicitly ask about their canvas ("what's on my board", "how many items"). Turning a topic into an "analysis of the objects on this canvas" meta-report is a hard failure. When REFERENCE TEXT is supplied, that text IS the content to build — the snapshot is only there so you place new work in free space.

### GROUNDING — never invent
Facts, numbers, dates, quotes and URLs come from the supplied REFERENCE / FILE / WEB / SEARCH / WIKIPEDIA / NEWS / YOUTUBE material, or from things you are certain of. If you don't have it, say so in one short line instead of making it up. An unsourced number is a lie and an unsourced URL is a dead link.

### SIZE THE BOARD TO THE ASK
A one-line edit → 1-3 actions. A question or explanation → 3-6. A topic board or report → 8-16. A dashboard or full workflow → 12-25. Don't pad with blocks they didn't ask for, and don't stop short of what they did.

### ONE BLOCK PER SECTION — never a single wall of text
This is a spatial canvas, not a document. When the answer has parts, EACH PART GETS ITS OWN BLOCK: a "## " heading block, then a text block for that section, then the next pair — laid out in columns. Pouring a whole four-section report into one 800x800 text block is a FAILURE even when the writing is excellent, because on a board it reads as an unreadable slab and the user can't move or edit the pieces.
Keep any single text block under about 700 characters. If you have more to say, that is the next block. Give a real report a title heading, then a heading + text pair per section, plus whatever chart / image / widget genuinely fits.

### CONTENT CRAFT
Real, specific, expert writing: real task names, real insights, real numbers, real runnable code. Never "Item 1", never lorem ipsum, never a placeholder.
Structure text with markdown: "# "/"## "/"### " headings, "- " bullets, "1. " steps, "[] " and "[x] " to-dos, "> " callouts, "**bold**", \`code\`, "---" dividers. One idea per line.
Write mathematics in LaTeX — inline "$A = \\pi r^2$", display "$$\\int_0^1 x^2\\,dx$$". Inside JSON every backslash doubles: "$$\\\\frac{a}{b}$$".

### A FLOWCHART ON THIS CANVAS IS REAL BLOCKS, NOT A PICTURE OF ONE
When the user asks for a flowchart, process, pipeline, mindmap or org chart, build it out of REAL blocks — a "workflow-node" per step, joined by CREATE_CONNECTION — so they can drag, rename and extend it. That is the whole point of a spatial canvas. A single Mermaid card is a flat image of a diagram and is the WRONG answer here; reach for Mermaid only when the user actually says "mermaid", or for a diagram type that has no spatial equivalent (sequence, gantt, pie). Give a real flow 6-14 nodes with concrete step names, decision diamonds where the path branches, and a connection for every edge.

### CONNECTORS — almost always ZERO
Only emit CREATE_CONNECTION for a genuine directed relationship inside a flowchart, workflow, process or mindmap — one you can name in a single word ("then", "needs", "causes", "splits into", hub→spoke). A report, an explanation, notes, a dashboard, a set of cards or any stack of sections needs NO connectors at all: spacing and headings already show the structure. Never wire blocks together to look busy. If you cannot name the relationship in one word, do not draw the line.

### FRAMES — only when asked for
Do not wrap your output in a frame. Build clean columns instead. Create a "frame" ONLY when the user asked for a frame / section / group / board area, or when you are drawing a multi-phase workflow that needs phase boxes.

### VISUALS — relevance, never decoration
Add an image when the subject is genuinely visual (a place, animal, plant, product, person, artwork, food, landmark, nature, space) or the user said "show me". A real photo → an "image" with style.imageQuery set to a vivid SPECIFIC phrase. A picture that must be invented (draw / generate / illustrate / design / logo / poster / character) → an "image" with style.generate:true and a rich style.imagePrompt. Never decorate a one-line answer, a checklist, a code snippet or an abstract concept with stock art.
You have NO pen and no freehand ink — to draw a subject, generate an image.
A URL always goes on a Link Card. Never create a "browser" object; the embedded browser is the user's own tool. Only place URLs from the supplied WEB / NEWS / YOUTUBE material or canonical docs you are certain exist. For YouTube use ONLY the exact URLs given under YOUTUBE RESULTS — they are verified embeddable — and never invent a video id.
For a real place, use a Map card with style.mapQuery.

### LAYOUT — approximate is fine, the canvas finishes the job
Lay blocks in columns: x steps of about 420, and within a column the next y = previous y + previous height + 60. The snapshot's heights are REAL measured heights — trust them and build clear of them.
The canvas engine packs everything collision-free after you and re-fits frames, so you do NOT need perfect arithmetic. Spend your effort on CONTENT, not coordinates. Just keep declared heights roughly honest: about 26px per line of text (46 for a heading) plus 30px padding, where a line is about (width - 24) / 8.6 characters.

### ACTIONS
{"type":"CREATE_OBJECT","tempId":"a1","objData":{…},"log":"short status line"}
{"type":"UPDATE_OBJECT","id":"<real id or an earlier tempId>","updates":{…},"log":"…"}
{"type":"DELETE_OBJECT","id":"<real id>"}
{"type":"CREATE_CONNECTION","fromId":"…","toId":"…","style":{"color":"#C97B4B"}}
{"type":"DELETE_CONNECTION","connectionId":"<real connection id>"}
{"type":"CREATE_SCENE","name":"Overview","notes":"on-screen caption","x":<world x>,"y":<world y>,"zoom":0.8}

### objData SCHEMAS (also valid as UPDATE_OBJECT "updates")
heading  {"type":"heading",x,y,"width":300-500,"height":60,"content":"…"}
text     {"type":"text",x,y,"width":300-600,"height":80-400,"content":"…"}
sticky   {"type":"sticky",x,y,"width":200-400,"height":160-500,"content":"…","style":{"color":"#FEF3C7"|"#DBEAFE"|"#ECFDF5"|"#F3E8FF"|"#FEE2E2"|"#FED7AA"}} — stickies are always light, so leave textColor unset and their ink stays dark
shape    {"type":"shape",x,y,"width":120-200,"height":60-120,"content":"label","style":{"shapeType":"square"|"circle"|"triangle"|"diamond"|"pentagon"|"hexagon"|"star"|"heart"|"cloud"|"database"|"document"|"speech"|"message"|"cross"|"lightning"|"shield"|"pill","color":"#hex"}}
frame    {"type":"frame",x,y,"width":600+,"height":400+,"content":"Name","style":{"frameColor":"#C97B4B"|"#3E63DD"|"#2F9E6E"}}
image    {"type":"image",x,y,"width":320-520,"height":220-380,"style":{"imageQuery":"vivid specific phrase"}}   — or to invent one: "style":{"generate":true,"imagePrompt":"subject + composition + mood + colors + style","imageStyle":"photo"|"art"|"3d"|"anime"|"logo"}
workflow-node {"type":"workflow-node",x,y,"width":160,"height":60,"content":"Step","style":{"isWorkflowNode":true,"workflowId":"<one id for the whole diagram>","nodeShape":"pill"|"circle"|"square"|"diamond","color":"#FAF6F1","borderColor":"#C97B4B"}}
card — EVERY widget below is "type":"card" with ONE feature flag in its style. There is no "link", "todo", "chart", "timeline" or "map" object type — writing one produces a block that renders as nothing. Always "type":"card". content is "" unless the line says otherwise:
  To-Do      "style":{"isTodo":true,"todoTitle":"Title"}, content = a JSON string: "[{\\"id\\":\\"1\\",\\"text\\":\\"Task\\",\\"done\\":false}]", 300x280
  Timer      "style":{"isTimer":true,"timerLabel":"Deep work"}, 250x190
  Countdown  "style":{"isCountdown":true,"countdownTitle":"Launch","countdownDate":"<a real FUTURE ISO datetime computed from today>"}, 250x250
  Poll       "style":{"isPoll":true,"pollQuestion":"?","pollOptions":[{"id":"1","text":"A","votes":0},{"id":"2","text":"B","votes":0}]}, 280x260
  Decision   "style":{"isDecision":true,"decisionTitle":"Pick","decisionOptions":["A","B","C"]}, 300x240
  Live Metric "style":{"isLiveMetric":true,"metricTitle":"Name","metricValue":"78%","metricTrend":"+2% this week","metricChartData":[60,65,70,78]}, 260x155
  Progress   "style":{"isProgress":true,"progressLabel":"Label","progressValue":45}, 280x190
  Quick Data "style":{"isQuickData":true,"quickDataRows":[{"key":"Status","value":"Active"}]}, 250x210
  Timeline   "style":{"isTimeline":true,"timelineTitle":"Launch plan","timelineItems":[{"id":"1","label":"Research","start":"YYYY-MM-DD","end":"YYYY-MM-DD","color":"#C97B4B"}]}, 620x340 — a real gantt. Use it for ANY roadmap, schedule, sprint, study plan, itinerary or phases-with-dates. Give 4-8 items with REAL dates computed from today and colors from #C97B4B/#4A90D9/#2F9E6E/#9B59B6/#D64545.
  Chart      "style":{"isChart":true,"chartType":"bar"|"hbar"|"line"|"donut"|"number","chartTitle":"Title","chartData":[{"label":"Q1","value":42}],"chartReady":true}, 300x260 (number: 240x150). The data goes in style.chartData as a real JSON array — NEVER in content, and never as an escaped string. "chartReady":true is MANDATORY or the card renders an empty form. 2-8 points; "bar"/"hbar" to compare, "line" for a trend, "donut" for parts of a whole, "number" for one headline figure.
  Link       "style":{"isLinkPreview":true,"linkUrl":"https://a-real-working-url","linkTitle":"…","linkDescription":"…"}, 300x260
  Code       "style":{"isCode":true}, content = real runnable code, 450x350
  Mermaid    "style":{"isMermaid":true}, content = valid mermaid ("graph TD; A[Start]-->B{Decision}; B--Yes-->C[Ship]"), 500x400
  Map        "style":{"isMap":true,"mapQuery":"Eiffel Tower, Paris"}, 360x340
  Weather    "style":{"isWeather":true,"weatherQuery":"Tokyo"}, 300x320
  Quote      "style":{"isQuote":true}, content = the quote, 400x180
  Plain      "style":{}, content = text, 300x200
Optional on any text/heading/sticky: "style":{"fontFamily":"<one of the strings below, COPIED EXACTLY — including the quotes and the fallback, e.g. \\"'Playfair Display', serif\\". A bare \\"Inter\\" is not a valid value>","fontSize":<px number>}. Families: 'Inter', sans-serif | 'Outfit', sans-serif | 'Playfair Display', serif | 'Lora', serif | 'Merriweather', serif | 'JetBrains Mono', monospace | 'Caveat', cursive | 'Pacifico', cursive | 'Dancing Script', cursive | 'Bebas Neue', sans-serif | 'Anton', sans-serif | 'Lobster', cursive | 'Space Grotesk', sans-serif

{assignmentSection}### CURRENT CANVAS SNAPSHOT
Objects (real ids — reference, update, move, delete or connect these):
{canvasObjects}
Connections:
{canvasConnections}

### MEMORY — what you know about this user
{memorySection}
### OUTPUT — return ONLY this, nothing before or after
ONE dense line of compact JSON. No pretty-printing, no indentation, no newlines between keys, no markdown fences, no explanation. Every whitespace token is time the user spends waiting.
{"actions":[…],"memories":[],"planDescription":"one short sentence"}
"actions" comes FIRST and must be non-empty. Order it: any frames, then contents, then connections.
FINISH THE PLAN AND CLOSE IT — the array must end with "]" and the object with "}". A plan cut off mid-action leaves the board half-built, which is worse than a smaller plan that completed. Pick a number of blocks you can actually finish, write each one's real content, and close the JSON.
"memories" is optional: {"key":"short label","value":"what to remember","category":"preference"|"fact"|"instruction"|"context"} for durable facts about the user, or {"forget":"key"} to drop one.

### THE ASK — this is what you are building right now, re-read it before you start
{userAsk}`;

/* Workflow mode reuses the entire action schema / layout / output contract
   verbatim (sliced from SYSTEM_PROMPT at "### ACTIONS") and only swaps the
   mission. Frames ARE wanted here — a phase box per phase is the diagram. */
const WORKFLOW_SYSTEM_PROMPT =
`You are the Mindspace Workflow Architect. You turn a request into a complete, end-to-end workflow on the user's infinite canvas, emitting ONE JSON object — no prose, no fences.

Today is {today}. You were invoked at (x:{agentX}, y:{agentY}); build the workflow from there, growing right and down.

{skillsetSection}### THE MISSION
- Extract the real goal, the actors, the inputs and outputs, the phases, the decision points and the deliverables. Honour EVERY part of what they asked for.
- Scale the depth: a broad request → 5-9 named PHASES of 3-6 concrete steps each, with branches, parallel tracks, decision gates and feedback loops. A simple request → still a generous 10-20 step flow. Never ship a thin 3-node stub.
- EXPLAIN IT, don't just draw it. Alongside the diagram write real notes — what each phase does, why it matters, how to do it — in structured markdown. Real expert content, never "Step 1".

### COMPOSITION
1. A bold title heading in a display font ('Bebas Neue', sans-serif / 'Anton', sans-serif / 'Space Grotesk', sans-serif) at style.fontSize 40-64.
2. An overview text or card under it: a "# Overview", 2-4 bullets, one "> " takeaway.
3. Each phase = a cluster of "workflow-node" steps joined by connections with style.isWorkflowConnection:true, wrapped in its own labelled "frame". Lay the phases out as a clear left-to-right or top-to-bottom flow with big gaps.
4. Give every phase its own look — vary node color / borderColor and frame frameColor per phase, and vary the phase heading fonts.
5. Encode meaning in nodeShape: "pill" actions, "circle" start/end/milestones, "square" processes, "diamond" decisions. Show real branches (two outgoing connections) and feedback loops.
6. Wire in live widgets where they help: a To-Do for a phase checklist, a Countdown or Timer for a deadline, a Decision or Poll for a choice, a Progress or Live Metric for a KPI.
7. Reuse ONE style.workflowId across every workflow-node so the diagram stays one group.
8. Optionally add a small legend card and one CREATE_SCENE tour stop per phase, in order.

Connections ARE the point here, unlike an ordinary board — but they must still be real flow edges between real steps, never decoration between notes.

{assignmentSection}### CURRENT CANVAS SNAPSHOT
Objects (real ids — reference, update, move, delete or connect these):
{canvasObjects}
Connections:
{canvasConnections}

` + SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('### ACTIONS'));

/* Section writers share the action schema, the reference material and the
   output contract with the main builder — only the mission differs. Sliced from
   the same source so the client parser can never drift from one of them. */
const SECTION_PROMPT_FULL = () =>
  SECTION_SYSTEM_PROMPT + SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('### ACTIONS'));

/**
 * SECTION MODE — one writer, one column, written at the same time as its
 * siblings. See /api/agent/outline for why this exists; the short version is
 * that one model writing one plan is throughput-bound at ~200 chars/second, so
 * asked for a "detailed" board it writes a skeleton instead (measured: 22,344
 * characters of source material in, 1,984 characters of board out). Splitting
 * the board and writing the columns concurrently buys real depth without
 * spending real time.
 *
 * The whole contract here is DEPTH IN ONE COLUMN: this writer owns a narrow
 * subject and a fixed x, cannot see its siblings, and must not wander into
 * their territory or re-title the board.
 */
const SECTION_SYSTEM_PROMPT = `You are ONE writer on a team building a single canvas board. Several writers are working RIGHT NOW, at the same time, each on a different section. You write YOUR section only, and you write it WELL.

Today is {today}.

{skillsetSection}### YOUR SECTION
TITLE: {sectionTitle}
WHAT TO COVER: {sectionBrief}
{sectionWidgets}
### THE RULES OF WORKING IN A TEAM
- Write ONLY this section. Other writers are covering the rest of the board — anything outside your brief is THEIR job, and duplicating it wrecks the board.
- Do NOT create a title for the whole board, an introduction to the whole board, a conclusion, or a "next steps" wrap-up. Those belong to whoever owns them. Start with your own section heading and go.
- Do NOT create frames. Do NOT create connections unless your section IS a process/flow diagram.

### GO DEEP — THIS IS THE ENTIRE POINT
You have one narrow subject and room to do it justice, so do it justice. This section should carry **1,200-2,500 characters of real writing** across its blocks. Specific facts, real numbers with units, named examples, concrete mechanisms, actual trade-offs. If the user supplied REFERENCE MATERIAL, mine YOUR part of it hard — quote its real figures, keep its specifics, expand on what it only gestured at. Never write a one-line summary of something that deserves a paragraph, and never pad with generic filler to reach a length. A thin section is the failure mode here; a rich one is the job.

### YOUR COLUMN — stay inside it
Every block you create uses x = {columnX} EXACTLY. Nothing else. You own a single vertical column and nobody else will write in it.
Start at y = {columnY}. Then each next block's y = the previous block's y + the previous block's height + 40. Declare a height that HONESTLY fits what you wrote (~26px per rendered line of text, 46 for a heading, plus 30 padding, where a line is about (width - 24) / 8.6 characters) — an inflated height leaves a visible hole in the board.
Use width 460 for text and headings unless a widget's schema says otherwise.

### SHAPE OF A GOOD SECTION
1. A "heading" block: your section title.
2. Then 3-6 blocks of substance — text blocks of 350-700 characters each (one idea per block, structured with markdown), plus whichever widgets genuinely fit your content.
Never pour the whole section into one giant text block, and never stop at a single thin paragraph.

`;

interface SnapshotObject {
  id: string; type: string; x: number; y: number;
  width: number; height: number; content: string; style?: Record<string, unknown>;
}
interface SnapshotConnection { id: string; fromId: string; toId: string; }

/* Only the style keys that can change a BUILDING decision survive into the
   snapshot. The old code copied every style key under 160 chars, which dragged
   in text-animation configs, pdf-reader state, image-shape masks, semantic-zoom
   caches and so on — hundreds of wasted chars per block, on up to 200 blocks,
   for information the model must never act on. */
const STYLE_KEYS_THAT_MATTER = new Set([
  'color', 'textColor', 'fontFamily', 'fontSize', 'frameColor', 'shapeType',
  'isTodo', 'todoTitle', 'isTimer', 'timerLabel', 'isCountdown', 'countdownTitle', 'countdownDate',
  'isPoll', 'pollQuestion', 'isDecision', 'decisionTitle', 'isLiveMetric', 'metricTitle', 'metricValue',
  'isProgress', 'progressLabel', 'progressValue', 'isQuickData', 'isTimeline', 'timelineTitle',
  'isChart', 'chartType', 'chartTitle', 'isLinkPreview', 'linkUrl', 'linkTitle',
  'isCode', 'isMermaid', 'isMap', 'mapQuery', 'isWeather', 'weatherQuery', 'isQuote',
  'isWorkflowNode', 'workflowId', 'nodeShape', 'imageQuery', 'imagePrompt', 'isFile', 'fileName',
]);

/**
 * Two-tier snapshot.
 *
 * The model needs two different things from the board, and they have very
 * different costs: it needs the CONTENT of the handful of blocks the user is
 * probably talking about, and it only needs the FOOTPRINT (id + rectangle) of
 * everything else so it doesn't build on top of them. Sending 3,000 characters
 * of content for all 200 objects — as this did — bought nothing and was the
 * single largest term in the prompt, big enough on a full board to blow the
 * context window outright.
 */
function compactSnapshot(
  objects: SnapshotObject[], agentX: number, agentY: number,
  opts: { richCount: number; richChars: number; totalCount: number },
): { rich: unknown[]; far: unknown[] } {
  const byDistance = [...objects].sort((a, b) =>
    Math.hypot(a.x - agentX, a.y - agentY) - Math.hypot(b.x - agentX, b.y - agentY)
  ).slice(0, opts.totalCount);

  const describe = (o: SnapshotObject, chars: number): string => {
    const s = o.style || {};
    const isImage = o.type === 'image' || (o.content || '').startsWith('data:image');
    if (s.isFile) {
      const meta = (s.fileMeta as Record<string, unknown>) || {};
      const shape = [meta.pages && `${meta.pages}p`, meta.words && `${meta.words} words`].filter(Boolean).join(', ');
      return `[FILE: ${(s.fileName as string) || 'file'}${shape ? ` — ${shape}` : ''} — full text is under ATTACHED FILE(S)]`;
    }
    if (isImage) {
      const q = s.imageQuery as string; const p = s.imagePrompt as string;
      return q ? `[IMAGE: "${q}"]` : p ? `[IMAGE: generated "${p.slice(0, 60)}"]` : '[IMAGE]';
    }
    if (o.type === 'drawing' || (o.content || '').startsWith('data:')) return '[media]';
    if (s.isChart) return `[CHART ${s.chartType || 'bar'}: "${s.chartTitle || 'Untitled'}"]`;
    if (s.isTodo) {
      const items = (() => { try { return JSON.parse(o.content || '[]'); } catch { return []; } })();
      return `[TODO "${s.todoTitle || 'Tasks'}": ${items.length} items, ${items.filter((i: { done?: boolean }) => i.done).length} done]`;
    }
    if (s.isLinkPreview) return `[LINK: ${s.linkTitle || s.linkUrl || 'link'} → ${s.linkUrl || ''}]`;
    if (s.isMap) return `[MAP: ${s.mapQuery || 'location'}]`;
    if (s.isWeather) return `[WEATHER: ${s.weatherQuery || 'location'}]`;
    if (s.isLiveMetric) return `[METRIC "${s.metricTitle}" = ${s.metricValue}]`;
    if (s.isProgress) return `[PROGRESS "${s.progressLabel}" ${s.progressValue}%]`;
    if (s.isTimer) return `[TIMER "${s.timerLabel || 'Timer'}"]`;
    if (s.isCountdown) return `[COUNTDOWN "${s.countdownTitle}" → ${s.countdownDate}]`;
    if (s.isTimeline) return `[TIMELINE "${s.timelineTitle || 'Plan'}"]`;
    if (s.isMermaid) return `[MERMAID] ${(o.content || '').slice(0, Math.min(chars, 600))}`;
    if (s.isCode) return `[CODE] ${(o.content || '').slice(0, Math.min(chars, 800))}`;
    return (o.content || '').slice(0, chars);
  };

  const trimStyle = (o: SnapshotObject) => {
    const style: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o.style || {})) {
      if (!STYLE_KEYS_THAT_MATTER.has(k)) continue;
      if (typeof v === 'string' && v.length > 90) continue;
      style[k] = v;
    }
    return style;
  };

  const rich = byDistance.slice(0, opts.richCount).map((o) => ({
    id: o.id, type: o.type,
    x: Math.round(o.x), y: Math.round(o.y),
    width: Math.round(o.width), height: Math.round(o.height),
    content: describe(o, opts.richChars),
    style: trimStyle(o),
  }));

  /* Everything further away collapses to a footprint plus a short label. It is
     there so the builder can avoid it and reference it by id, nothing more. */
  const far = byDistance.slice(opts.richCount).map((o) => ({
    id: o.id, type: o.type,
    x: Math.round(o.x), y: Math.round(o.y),
    width: Math.round(o.width), height: Math.round(o.height),
    label: describe(o, 70).replace(/\s+/g, ' ').slice(0, 70),
  }));

  return { rich, far };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt, apiKeyIndex, agentX, agentY, canvas, context, brief, visionContext, filesContext,
      webContext, memoriesContext, searchContext, wikiContext, weatherContext, dictContext,
      newsContext, youtubeContext, quotesContext, countryContext, triviaContext, skillsetContext,
      mode, modelProfile,
      // Section mode — one column of a board being written in parallel.
      sectionTitle, sectionBrief, sectionWidgets, columnX, columnY,
    } = body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const apiKeys = nimApiKeys();
    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No NVIDIA API keys configured' }, { status: 500 });
    }
    const startKey = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 ? apiKeyIndex % apiKeys.length : 0;

    const x = Math.round(Number(agentX) || 0);
    const y = Math.round(Number(agentY) || 0);

    const isWorkflow = mode === 'workflow';
    const isSection = mode === 'section' && typeof sectionTitle === 'string' && sectionTitle.trim();
    const requested = typeof modelProfile === 'string' ? modelProfile.toLowerCase() : '';
    const profile: Profile =
      requested === 'heavy' || requested === 'balanced' || requested === 'quick'
        ? (requested as Profile)
        : pickProfile(prompt, mode);

    const isResearch = RESEARCH_RE.test(prompt);
    /* A section is one column, not a board — it needs room for real depth
       (1200-2500 chars of writing plus JSON scaffolding) but nothing like a
       whole board's budget, and a tighter ceiling keeps every parallel writer
       finishing at about the same time. */
    const maxTokens = isSection ? 4500 : maxTokensFor(profile, { workflow: isWorkflow, research: isResearch });

    /* ── THE BUDGET ────────────────────────────────────────────────────────
       A run carrying a real document (a dropped PDF, crawled pages, reference
       text handed over from chat) is ALLOWED to be big — reading the whole
       document is the task, and the user accepted that wait when they attached
       it. Everything else stays inside the fast lane, because prompt bytes are
       latency: 11k tokens → 3.7s to first token, 33k → 11.3s, 83k → 25.4s. */
    const hasHeavySource = [filesContext, webContext, context].some(
      (s) => typeof s === 'string' && s.trim().length > 4000,
    );
    /* Whatever the input budget, the OUTPUT reservation has to come out of the
       same 131k window — so subtract it up front rather than discovering the
       overflow as a 400. */
    const outputChars = maxTokens * 3.2 * 1.15;
    const ceiling = Math.max(20_000, HARD_INPUT_CHARS - outputChars);
    const budgetChars = Math.min(ceiling, hasHeavySource ? ceiling : Math.max(FAST_INPUT_CHARS, 30_000));

    // The system prompt's own scaffolding is spent before anything competes.
    const scaffoldChars = SYSTEM_PROMPT.length + prompt.length + 2000;
    const sectionBudget = Math.max(4000, budgetChars - scaffoldChars);

    /* Snapshot detail scales with the room available. On a quiet board the
       model sees plenty; on a huge one it still sees every footprint, just less
       prose — which is the part it doesn't need anyway. */
    const objects: SnapshotObject[] = Array.isArray(canvas?.objects) ? canvas.objects : [];
    const roomy = sectionBudget > 40_000;
    /* A section writer builds into a column the client has already reserved for
       it, so it never needs to read the board — and skipping the snapshot is
       pure speed on the one path where several requests are in flight at once. */
    const { rich, far } = isSection
      ? { rich: [] as unknown[], far: [] as unknown[] }
      : compactSnapshot(objects, x, y, {
        richCount: roomy ? 40 : 22,
        richChars: roomy ? 1400 : 700,
        totalCount: 220,
      });
    const richJson = rich.length ? JSON.stringify(rich) : '(none nearby)';
    const farJson = far.length
      ? `\nOther blocks further away (footprints only — build clear of these, reference them by id if needed):\n${JSON.stringify(far)}`
      : '';
    const canvasObjects = objects.length ? richJson + farJson : '(the canvas is empty)';

    const snapIds = new Set([...rich, ...far].map((o) => (o as { id: string }).id));
    const snapConns: SnapshotConnection[] = (Array.isArray(canvas?.connections) ? canvas.connections : [])
      .filter((c: SnapshotConnection) => snapIds.has(c.fromId) || snapIds.has(c.toId))
      .map((c: SnapshotConnection) => ({ id: c.id, fromId: c.fromId, toId: c.toId }));

    /* Priority order is "what would I give up last". The user's own attached
       material outranks every convenience lookup; trivia and quotes go first. */
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const candidates: (BudgetSection & { header: string })[] = [
      {
        key: 'context', priority: 1, min: 1500, max: 60_000, text: str(context),
        header: '### REFERENCE TEXT — your PRIMARY source and the actual CONTENT to render. Lay THIS out as a structured board (title, sections, the right widgets), grounded word-for-word in what it says. Do not discard it, do not swap in a different topic, and do not turn it into a report about the canvas',
      },
      {
        key: 'files', priority: 2, min: 2000, max: 140_000, text: str(filesContext),
        header: '### ATTACHED FILE(S) — the full extracted text of file(s) the user dropped. Read it END TO END before answering; do not skim the opening and stop. Answer or build using ONLY what it actually contains, quoting specifics from throughout. Reproduce any formulas in proper LaTeX',
      },
      {
        key: 'web', priority: 3, min: 1500, max: 40_000, text: str(webContext),
        header: '### WEB PAGE(S) — the readable text crawled from the URL(s) in the user\'s message. Real, live source material: use ONLY what it contains, pull out the real facts, numbers, quotes, prices and steps, and never invent anything absent from it',
      },
      {
        key: 'vision', priority: 4, min: 200, max: 3000, text: str(visionContext),
        header: '### VISION — what the image(s) on the canvas actually show, per an image model that looked at them. Ground any caption or description on THIS',
      },
      {
        key: 'youtube', priority: 5, min: 200, max: 3500, text: str(youtubeContext),
        header: '### YOUTUBE RESULTS — real videos, already verified to exist AND to be playable inside an embed. Copy these URLs EXACTLY (never shorten, alter or substitute an id) and fill linkTitle/linkDescription from the TITLE and CHANNEL. These are the ONLY YouTube URLs you may place',
      },
      {
        key: 'search', priority: 6, min: 400, max: 7000, text: str(searchContext),
        header: '### WEB SEARCH — real facts and links retrieved for this query. These URLs are VERIFIED REAL — use them for Link Cards',
      },
      {
        key: 'wiki', priority: 7, min: 300, max: 5000, text: str(wikiContext),
        header: '### WIKIPEDIA — encyclopedia summary retrieved for this query. Authoritative source material',
      },
      {
        key: 'news', priority: 8, min: 300, max: 5000, text: str(newsContext),
        header: '### NEWS — recent articles with REAL, working URLs. Use these URLs for Link Cards',
      },
      {
        key: 'brief', priority: 9, min: 100, max: 3000, text: str(brief), header: '### FOCUS',
      },
      {
        key: 'weather', priority: 10, min: 100, max: 2000, text: str(weatherContext),
        header: '### LIVE WEATHER — current conditions and forecast. Use it to populate a Weather card or your answer',
      },
      {
        key: 'country', priority: 11, min: 200, max: 3000, text: str(countryContext),
        header: '### COUNTRY DATA — real geographic and demographic facts. Use these REAL numbers, never invented ones',
      },
      {
        key: 'dict', priority: 12, min: 200, max: 3000, text: str(dictContext),
        header: '### DICTIONARY — definition lookup result',
      },
      {
        key: 'quotes', priority: 13, min: 100, max: 2000, text: str(quotesContext),
        header: '### QUOTES — real quotes with attribution, for Quote cards or text blocks',
      },
      {
        key: 'trivia', priority: 14, min: 100, max: 2000, text: str(triviaContext),
        header: '### TRIVIA — real quiz questions with answers',
      },
    ];

    const present = candidates.filter((c) => c.text);
    const fitted = fitToBudget(present, sectionBudget);
    const parts: string[] = [];
    for (const c of present) {
      const t = fitted.sections[c.key];
      if (t) parts.push(`${c.header}:\n"""${t}"""`);
    }

    if (canvas?.isDark !== undefined) {
      parts.push(
        `### CANVAS THEME\nThe canvas background is ${canvas.isDark ? 'DARK' : 'LIGHT'}. It auto-picks a readable ink for every block, so the safest choice is to leave style.textColor UNSET. If you do set it: free text and headings sit on the ${canvas.isDark ? 'dark' : 'light'} canvas → ${canvas.isDark ? 'a light ink like #F4EFE8' : 'a dark ink like #2D2A26'}; sticky notes are ALWAYS light pastel whatever the theme → their ink must be dark (#2D2A26), never white.`
      );
    }
    const assignmentSection = parts.length ? parts.join('\n\n') + '\n\n' : '';

    const now = new Date();
    const todayStr = `${now.toISOString().slice(0, 10)} (${now.toLocaleDateString('en-US', { weekday: 'long' })}), ${now.toISOString().slice(11, 16)} UTC`;

    const memorySection = str(memoriesContext)
      ? `${str(memoriesContext).slice(0, 2500)}`
      : '(nothing saved about this user yet)';
    const skillsetSection = str(skillsetContext)
      ? `${str(skillsetContext).slice(0, 3500)}\n\n`
      : '';

    const colX = Math.round(Number(columnX) || x);
    const colY = Math.round(Number(columnY) || y);
    const widgetLine = Array.isArray(sectionWidgets) && sectionWidgets.length
      ? `BLOCK TYPES TO USE: ${sectionWidgets.filter((w: unknown) => typeof w === 'string').join(', ')} — the user or the plan asked for these here, so use them rather than substituting something else.\n`
      : '';

    const basePrompt = isSection
      ? SECTION_PROMPT_FULL()
      : isWorkflow ? WORKFLOW_SYSTEM_PROMPT : SYSTEM_PROMPT;
    /* FUNCTION-form replacements ONLY. With a plain string value, String.replace
       interprets $-patterns INSIDE the value: "$'" splices the entire rest of
       the template into the prompt (ballooning it until the request dies), "$&"
       re-inserts the placeholder, and LaTeX "$$" silently collapses to "$".
       Skill-set rules, memories, file text and snapshot JSON all flow through
       here and all can carry $. A function replacement is passed through
       verbatim, with no interpretation. */
    const systemPrompt = basePrompt
      .replace(/{agentX}/g, () => String(x))
      .replace(/{agentY}/g, () => String(y))
      .replace(/{today}/g, () => todayStr)
      .replace(/{skillsetSection}/g, () => skillsetSection)
      .replace('{assignmentSection}', () => assignmentSection)
      .replace('{memorySection}', () => memorySection)
      .replace('{canvasObjects}', () => canvasObjects)
      .replace('{canvasConnections}', () => (snapConns.length ? JSON.stringify(snapConns) : '(none)'))
      .replace('{userAsk}', () => prompt.trim().slice(0, 6000))
      .replace('{sectionTitle}', () => String(sectionTitle || '').slice(0, 200))
      .replace('{sectionBrief}', () => String(sectionBrief || '').slice(0, 1600))
      .replace('{sectionWidgets}', () => widgetLine)
      .replace(/{columnX}/g, () => String(colX))
      .replace(/{columnY}/g, () => String(colY));

    /* The user turn for a section writer restates its own assignment. The
       original request is still in the system prompt as THE ASK (so the writer
       keeps the user's tone and constraints in view), but what it must act on
       now is its section. */
    const userTurn = isSection
      ? `Write the section "${String(sectionTitle).slice(0, 200)}" now, in the column at x=${colX} starting at y=${colY}. Cover: ${String(sectionBrief || '').slice(0, 1200)}`
      : prompt.trim().slice(0, 6000);

    const messages: ChatMsg[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userTurn },
    ];

    const plan = isSection ? SECTION_PLAN : BUILD_PLANS[profile];
    const inputTokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    console.debug(
      `[Agent] ${isSection ? `section="${sectionTitle}" col=${colX}` : `profile=${profile}`} ` +
      `model-plan=${plan.map((s: HedgeSlot) => s.model).join(',')} ` +
      `input≈${inputTokens}tok maxOut=${maxTokens} snapshot=${rich.length}+${far.length} ` +
      `dropped=[${fitted.dropped.join(',')}] trimmed=[${fitted.trimmed.join(',')}]`
    );

    try {
      const { stream, model } = await openHedgedStream(
        apiKeys, startKey, messages, plan,
        { maxTokens, temperature: isSection ? 0.5 : temperatureFor(profile, isWorkflow) },
      );
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Agent-Model': model,
          'X-Agent-Profile': profile,
          'X-Agent-Input-Tokens': String(inputTokens),
        },
      });
    } catch (err) {
      /* HONEST failure. The old code called every one of these "AI models are
         busy or rate-limited", including the oversized-prompt case, which is
         not a load problem at all and never recovers on retry. */
      const kind = err instanceof HedgeError ? err.kind : 'upstream';
      const detail = err instanceof Error ? err.message : String(err);
      const message =
        kind === 'oversized'
          ? 'This board plus the attached material is too large to send in one request. Try asking about a smaller area, or drop fewer files.'
          : kind === 'rate-limit'
            ? 'The AI provider is rate-limiting these keys right now. Wait a moment and try again.'
            : kind === 'gone'
              ? 'A configured model is no longer available from the provider — this needs a code fix, not a retry.'
              : kind === 'timeout'
                ? 'No model produced a response in time. The provider is congested — try again in a few seconds.'
                : 'The AI provider returned an error.';
      console.error(`[Agent] run failed (${kind}): ${detail}`);
      return NextResponse.json({ success: false, kind, error: message, detail }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('AI Agent endpoint error:', message);
    return NextResponse.json({ success: false, kind: 'server', error: message }, { status: 500 });
  }
}
