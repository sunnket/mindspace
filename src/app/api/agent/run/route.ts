import { NextRequest, NextResponse } from 'next/server';

// Big MoE planners can take 30s+ to emit a full build plan.
export const maxDuration = 300;

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Measured 2026-07-07 against NIM serverless: mistral-large-3 and kimi-k2.6
// answer in <1s; llama-3.3-70b, qwen3.5-397b, glm-5.2 and deepseek-v4-pro hang
// indefinitely, so they are deliberately absent. Strongest first.
const MODEL_CHAIN = [
  'mistralai/mistral-large-3-675b-instruct-2512',
  'moonshotai/kimi-k2.6',
  'meta/llama-3.1-70b-instruct',
  'deepseek-ai/deepseek-v4-flash',
  'mistralai/mistral-medium-3.5-128b',
];
// Director calls are raced in parallel across these two for minimum latency.
const DIRECTOR_RACE = [
  'mistralai/mistral-large-3-675b-instruct-2512',
  'moonshotai/kimi-k2.6',
];

const DIRECTOR_TIMEOUT_MS = 25_000;
const BUILD_TIMEOUT_MS = 50_000;
const TOTAL_BUDGET_MS = 150_000;

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

const CANVAS_CONTEXT_TEMPLATE = `### CURRENT CANVAS SNAPSHOT
Objects (real ids — use them to reference, update, delete or connect existing content):
{canvasObjects}
Connections between objects:
{canvasConnections}
{referenceSection}`;

// Phase 1 — the Director: understands intent, sets creative direction, and
// splits large jobs into parallel workstreams for multiple builder agents.
const DIRECTOR_PROMPT = `You are the Director of a team of AI canvas-builder agents inside Mindspace, a spatial infinite-canvas workspace.
The user invoked the team at coordinates (x: {agentX}, y: {agentY}).

Read the user's request plus the canvas snapshot and produce a mission plan:
1. "intent" — one sharp sentence stating what the user actually wants (read between the lines; terse prompts deserve generous, thoughtful interpretation).
2. "designNotes" — a short creative direction the whole team follows: layout structure (flowchart / grid / mindmap / timeline / dashboard), color accents (hex), tone of the written content. Be bold and opinionated.
3. "subtasks" — 1 to 4 self-contained workstreams. Use ONE subtask for small or tightly-coupled jobs. Split into 2-4 ONLY when the work has clearly separable parts (e.g. "research board + task tracker + timeline"). Each subtask has:
   - "id": short slug
   - "title": 2-4 words
   - "brief": a rich, specific assignment the builder can execute alone — include concrete content guidance and, when it must touch existing canvas objects, their real ids from the snapshot
   - "region": { "x", "y", "width", "height" } — an exclusive rectangle near (x: {agentX}, y: {agentY}). Regions must NOT overlap; tile them side by side with ~150px gutters. Size each generously for its content.

{canvasContext}

Return ONLY valid JSON: { "intent": "...", "designNotes": "...", "subtasks": [ { "id": "...", "title": "...", "brief": "...", "region": { "x": 0, "y": 0, "width": 900, "height": 700 } } ] }`;

// Phase 2 — a Builder agent: turns one assignment into concrete canvas actions.
const BUILDER_PROMPT = `You are a Mindspace Canvas Agent — an elite autonomous builder operating INSIDE a spatial infinite-canvas workspace, working like a world-class information designer.
You can create, edit, move, delete and wire together every kind of block the canvas supports.
The user invoked you at coordinates (x: {agentX}, y: {agentY}).
{assignmentSection}
{canvasContext}

### AVAILABLE ACTIONS
- CREATE_OBJECT: add a new block. Give each a unique "tempId" so later actions can reference it.
- UPDATE_OBJECT: change any fields (content, x, y, width, height, style) of an object. "id" may be a real canvas id or a tempId created earlier in this plan.
- DELETE_OBJECT: remove an object by real id or tempId.
- CREATE_CONNECTION: draw a connector line between two objects (real ids and/or tempIds).
- DELETE_CONNECTION: remove a connection by its real connection id.

### CRAFT RULES — this is what makes you exceptional
- Write REAL, substantive content: actual task names, actual insights, actual copy. Never lorem ipsum, never "Item 1".
- Compose with variety: mix headings, stickies, cards, shapes and frames instead of a wall of identical blocks.
- Use frames to group related clusters (create the frame BEFORE its contents) and connections to show relationships.
- NEVER overlap blocks (except items inside a frame). Typical card: 250-350px wide, 180-260px high. Keep 60-200px gaps.
- Structures: FLOWCHART (left-to-right connected steps), GRID/COLUMNS (under headings or inside frames), TIMELINE (increasing x), MINDMAP (hub center, spokes around), DASHBOARD (metric + progress + checklist cards in a grid).
- When organizing EXISTING objects, move them with UPDATE_OBJECT (x/y) into a tidy structure instead of recreating them.
- When the user gives reference text, treat it as the primary source material — complete it, transform it, or build from it exactly as asked.

### OBJECT SCHEMAS (for CREATE_OBJECT "objData", also valid as UPDATE_OBJECT "updates")
1. "heading": large title text. { content, width: 300-500, height: 60 }
2. "text": plain paragraph text. { content, width: 300-600, height: 80-200 }
3. "sticky": colored brainstorm note. { content, width: 200, height: 160, style: { "color": "#FEF3C7" | "#F3E8FF" | "#ECFDF5" | "#FEE2E2" } }
4. "shape": labeled geometric shape. { content: "label", width: 120-200, height: 60-120, style: { "shapeType": "square" | "circle" | "triangle" | "diamond" | "pentagon" | "hexagon" | "star" | "heart" | "cloud" | "database" | "document" | "speech" | "message" | "cross" | "lightning" | "shield" | "pill", "color": "#hex" } }
5. "workflow-node": a step in a workflow diagram. { content: "Step name", width: 160, height: 60, style: { "isWorkflowNode": true, "workflowId": "same_string_for_whole_diagram", "nodeShape": "pill" | "circle" | "square" | "diamond", "color": "#FAF6F1", "borderColor": "#C97B4B", "textColor": "#2D2A26", "branchColor": "#C97B4B" } }
6. "frame": dashed boundary grouping items. { content: "Frame Name", width: 600+, height: 400+, style: { "frameColor": "#C97B4B" | "#3E63DD" | "#2F9E6E" } }
7. "card": interactive widget. Pick ONE feature via style flags:
   - To-Do List: style { "isTodo": true, "todoTitle": "Title" }, content = JSON string array like "[{\\"id\\":\\"1\\",\\"text\\":\\"Task A\\",\\"done\\":false}]", width 300, height 280
   - Focus Timer: style { "isTimer": true, "timerLabel": "Deep work" }, content "", width 250, height 190
   - Countdown: style { "isCountdown": true, "countdownTitle": "Launch", "countdownDate": "2026-08-01T09:00:00Z" }, content "", width 250, height 250
   - Poll: style { "isPoll": true, "pollQuestion": "?", "pollOptions": [{"id":"1","text":"A","votes":0},{"id":"2","text":"B","votes":0}] }, content "", width 280, height 260
   - Decision Spinner: style { "isDecision": true, "decisionTitle": "Pick", "decisionOptions": ["A","B","C"] }, content "", width 300, height 240
   - Live Metric: style { "isLiveMetric": true, "metricTitle": "Name", "metricValue": "78%", "metricTrend": "+2% this week", "metricChartData": [60,65,70,78] }, content "", width 260, height 155
   - Progress Goal: style { "isProgress": true, "progressLabel": "Label", "progressValue": 45 }, content "", width 280, height 190
   - Quick Data Table: style { "isQuickData": true, "quickDataRows": [{"key":"Status","value":"Active"},{"key":"Owner","value":"Sam"}] }, content "", width 250, height 210
   - Link Card: style { "isLinkPreview": true, "linkUrl": "https://...", "linkTitle": "Title", "linkDescription": "Short blurb" }, content "", width 280, height 280
   - Code Sandbox: style { "isCode": true }, content = the code, width 450, height 350
   - Quote: style { "isQuote": true }, content = quote text, width 400, height 180
   - Plain Card: style {}, content = text, width 300, height 200

### CONNECTION SCHEMA
{ "type": "CREATE_CONNECTION", "fromId": "real_or_temp_id", "toId": "real_or_temp_id", "style": { "color": "#C97B4B", "isWorkflowConnection": false }, "log": "..." }
Use style { "isWorkflowConnection": true, "color": "#C97B4B" } between workflow-nodes.

### OUTPUT FORMAT — return ONLY this JSON object, no prose, no markdown fences:
{
  "planDescription": "One short sentence",
  "actions": [
    { "type": "CREATE_OBJECT", "tempId": "hub_1", "objData": { "type": "heading", "x": 0, "y": 0, "width": 400, "height": 60, "content": "Title", "style": {} }, "log": "Adding title..." },
    { "type": "UPDATE_OBJECT", "id": "real-or-temp-id", "updates": { "content": "new text", "x": 100, "y": 200 }, "log": "Rewriting note..." },
    { "type": "DELETE_OBJECT", "id": "real-or-temp-id", "log": "Removing outdated card..." },
    { "type": "CREATE_CONNECTION", "fromId": "hub_1", "toId": "real-id-from-snapshot", "style": { "color": "#3E63DD" }, "log": "Wiring title to notes..." },
    { "type": "DELETE_CONNECTION", "connectionId": "real-connection-id", "log": "Removing stale link..." }
  ]
}
"planDescription" must be ONE short sentence. The "actions" array is REQUIRED — every operation you intend must appear as an action object; a plan whose actions array is missing or empty is invalid and will be rejected.
Order actions logically (frames first, then contents, then connections). Deliver a complete, polished result.`;

/* ------------------------------------------------------------------ */
/* Snapshot compaction                                                 */
/* ------------------------------------------------------------------ */

interface SnapshotObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  style?: Record<string, unknown>;
}

interface SnapshotConnection {
  id: string;
  fromId: string;
  toId: string;
}

/** Keep the snapshot prompt-sized: drop huge style values, truncate content, cap object count. */
function compactSnapshot(objects: SnapshotObject[], agentX: number, agentY: number): SnapshotObject[] {
  const byDistance = [...objects].sort((a, b) => {
    const da = Math.hypot(a.x - agentX, a.y - agentY);
    const db = Math.hypot(b.x - agentX, b.y - agentY);
    return da - db;
  });

  return byDistance.slice(0, 120).map((o) => {
    const isBinary = o.type === 'image' || o.type === 'drawing' || (o.content || '').startsWith('data:');
    const style: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o.style || {})) {
      if (typeof v === 'string' && v.length > 200) continue;
      style[k] = v;
    }
    return {
      id: o.id,
      type: o.type,
      x: Math.round(o.x),
      y: Math.round(o.y),
      width: Math.round(o.width),
      height: Math.round(o.height),
      content: isBinary ? '[media]' : (o.content || '').slice(0, 280),
      style,
    };
  });
}

/* ------------------------------------------------------------------ */
/* NVIDIA NIM calls                                                    */
/* ------------------------------------------------------------------ */

async function callNvidia(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
  useJsonMode: boolean,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature,
        max_tokens: maxTokens,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Extract a JSON object from LLM output that may include fences or stray prose. */
function extractJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw new Error('No JSON object found in model output');
  }
}

/** One full attempt: call, retry without json mode on 400, parse, validate. */
async function attemptModel<T>(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
  validate: (plan: unknown) => T | null,
): Promise<T> {
  let response = await callNvidia(apiKey, model, systemPrompt, userPrompt, maxTokens, temperature, timeoutMs, true);
  if (response.status === 400) {
    response = await callNvidia(apiKey, model, systemPrompt, userPrompt, maxTokens, temperature, timeoutMs, false);
  }
  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`${model} error (status ${response.status}): ${errText.slice(0, 200)}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }
  const data = await response.json();
  const responseText: string = data.choices?.[0]?.message?.content || '';
  if (!responseText) throw new Error(`${model} returned an empty completion`);
  const validated = validate(extractJson(responseText));
  if (!validated) throw new Error(`${model} returned a plan that failed validation`);
  return validated;
}

/* ------------------------------------------------------------------ */
/* Plan validators                                                     */
/* ------------------------------------------------------------------ */

interface DirectorPlan {
  intent?: string;
  designNotes?: string;
  subtasks: { id?: string; title?: string; brief: string; region?: { x: number; y: number; width: number; height: number } }[];
}

interface BuildPlan {
  planDescription?: string;
  actions: unknown[];
}

function validateDirector(plan: unknown): DirectorPlan | null {
  const p = plan as DirectorPlan;
  if (!p || !Array.isArray(p.subtasks) || p.subtasks.length === 0) return null;
  const subtasks = p.subtasks.filter((s) => s && typeof s.brief === 'string' && s.brief.length > 0).slice(0, 4);
  if (subtasks.length === 0) return null;
  return { ...p, subtasks };
}

function validateBuild(plan: unknown): BuildPlan | null {
  const p = plan as BuildPlan;
  if (!p || !Array.isArray(p.actions) || p.actions.length === 0) return null;
  return p;
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const {
      prompt, phase, apiKeyIndex, agentX, agentY, canvas,
      context, brief, region, designNotes, intent, chainOffset,
    } = await req.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    const apiKeys = [
      process.env.NVIDIA_API_KEY,
      process.env.NVIDIA_API_KEY_2,
      process.env.NVIDIA_API_KEY_3,
      process.env.NVIDIA_API_KEY_4,
      process.env.NVIDIA_API_KEY_5,
    ].filter(Boolean) as string[];

    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No NVIDIA API keys configured in environment variables' }, { status: 500 });
    }

    const startKey = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 ? apiKeyIndex % apiKeys.length : 0;
    const keyAt = (offset: number) => apiKeys[(startKey + offset) % apiKeys.length];

    const x = Math.round(Number(agentX) || 0);
    const y = Math.round(Number(agentY) || 0);

    const snapshotObjects = compactSnapshot(Array.isArray(canvas?.objects) ? canvas.objects : [], x, y);
    const snapshotIds = new Set(snapshotObjects.map(o => o.id));
    const snapshotConnections: SnapshotConnection[] = (Array.isArray(canvas?.connections) ? canvas.connections : [])
      .filter((c: SnapshotConnection) => snapshotIds.has(c.fromId) || snapshotIds.has(c.toId))
      .map((c: SnapshotConnection) => ({ id: c.id, fromId: c.fromId, toId: c.toId }));

    const referenceSection = typeof context === 'string' && context.trim()
      ? `### REFERENCE TEXT — the user invoked the agent directly on this text; it is your primary source material:\n"""${context.trim().slice(0, 2000)}"""\n`
      : '';

    const canvasContext = CANVAS_CONTEXT_TEMPLATE
      .replace('{canvasObjects}', snapshotObjects.length > 0 ? JSON.stringify(snapshotObjects) : '(canvas is empty)')
      .replace('{canvasConnections}', snapshotConnections.length > 0 ? JSON.stringify(snapshotConnections) : '(none)')
      .replace('{referenceSection}', referenceSection);

    /* ---------------- Phase 1: Director ---------------- */
    if (phase === 'plan') {
      const systemPrompt = DIRECTOR_PROMPT
        .replace(/{agentX}/g, String(x))
        .replace(/{agentY}/g, String(y))
        .replace('{canvasContext}', canvasContext);

      try {
        const plan = await Promise.any(
          DIRECTOR_RACE.map((model, i) =>
            attemptModel(keyAt(i), model, systemPrompt, prompt, 1200, 0.3, DIRECTOR_TIMEOUT_MS, validateDirector)
          )
        );
        return NextResponse.json({ success: true, plan });
      } catch (err) {
        const messages = err instanceof AggregateError
          ? err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join(' | ')
          : (err instanceof Error ? err.message : String(err));
        console.warn('Director race failed:', messages);
        // Client falls back to a single direct build — this is not fatal.
        return NextResponse.json({ success: false, error: `Director unavailable: ${messages.slice(0, 300)}` }, { status: 502 });
      }
    }

    /* ---------------- Phase 2: Builder (default) ---------------- */
    const assignmentParts: string[] = [];
    if (typeof intent === 'string' && intent.trim()) assignmentParts.push(`### MISSION INTENT\n${intent.trim()}`);
    if (typeof designNotes === 'string' && designNotes.trim()) assignmentParts.push(`### TEAM DESIGN NOTES — follow this shared direction\n${designNotes.trim()}`);
    if (typeof brief === 'string' && brief.trim()) assignmentParts.push(`### YOUR ASSIGNMENT (other agents handle the rest — build ONLY this)\n${brief.trim()}`);
    if (region && typeof region.x === 'number' && typeof region.width === 'number') {
      assignmentParts.push(`### YOUR REGION — place ALL new objects inside this rectangle\nx: ${Math.round(region.x)} to ${Math.round(region.x + region.width)}, y: ${Math.round(region.y)} to ${Math.round(region.y + (region.height || 800))}`);
    }
    const assignmentSection = assignmentParts.length > 0 ? `\n${assignmentParts.join('\n\n')}\n` : '';

    const systemPrompt = BUILDER_PROMPT
      .replace(/{agentX}/g, String(x))
      .replace(/{agentY}/g, String(y))
      .replace('{assignmentSection}', assignmentSection)
      .replace('{canvasContext}', canvasContext);

    const userMessage = typeof brief === 'string' && brief.trim()
      ? `Overall user request: ${prompt}\n\nExecute your assignment now.`
      : prompt;

    // Rotate the chain start per worker so parallel agents spread across models.
    const rotation = typeof chainOffset === 'number' ? Math.abs(chainOffset) % 2 : 0;
    const chain = [...MODEL_CHAIN.slice(rotation), ...MODEL_CHAIN.slice(0, rotation)];

    let lastError: Error | null = null;
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let keyCursor = 0;

    for (const model of chain) {
      if (Date.now() > deadline) break;
      // Inner retries rotate keys on auth/rate-limit; other failures move models.
      for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        if (Date.now() > deadline) break;
        try {
          const plan = await attemptModel(
            keyAt(keyCursor), model, systemPrompt, userMessage,
            4096, 0.4, BUILD_TIMEOUT_MS, validateBuild,
          );
          return NextResponse.json({ success: true, plan });
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const status = (lastError as Error & { status?: number }).status;
          console.warn(`${model} via key slot ${keyCursor} failed:`, lastError.message);
          if (status === 401 || status === 403 || status === 429) {
            keyCursor++;
            continue; // key problem — same model, next key
          }
          break; // model problem — next model
        }
      }
    }

    return NextResponse.json({
      success: false,
      error: `The agent could not produce a plan. Last error: ${lastError?.message || 'Unknown error'}`,
    }, { status: 502 });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('AI Agent endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
