import { NextRequest, NextResponse } from 'next/server';

// The 70B planner can take 30-60s+ to emit a full build plan.
export const maxDuration = 300;

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Serverless NIM capacity varies by the hour — some models hang or return 503
// (ResourceExhausted) while others answer in under a second. Try strong
// planners first and fall through on timeout/overload instead of dying.
const MODEL_CHAIN = [
  'moonshotai/kimi-k2.6',
  'qwen/qwen3.5-397b-a17b',
  'meta/llama-3.1-70b-instruct',
  'deepseek-ai/deepseek-v4-flash',
  'meta/llama-3.3-70b-instruct',
];

const PER_ATTEMPT_TIMEOUT_MS = 60_000;
const TOTAL_BUDGET_MS = 240_000;

// System prompt instructing the model on available canvas components, layout coordinates, and output schemas.
const SYSTEM_PROMPT_TEMPLATE = `You are the Mindspace Canvas Agent — an autonomous architect operating INSIDE a spatial infinite-canvas workspace.
You can see everything currently on the canvas and you can create, edit, move, delete and wire together every kind of block the canvas supports.
The user invoked you at coordinates (x: {agentX}, y: {agentY}).

Your job: understand the user's request in the context of what already exists on the canvas, then output a precise build plan.
- If the request refers to existing content ("summarize these notes", "organize this", "connect the steps", "update the checklist"), READ the canvas snapshot below and operate on those real objects by their real ids.
- If the request asks for something new, build it near (x: {agentX}, y: {agentY}) in a clean, professional spatial layout.
- You may combine both: reuse and rewire what exists, add what is missing, delete what the user asked to remove.

### CURRENT CANVAS SNAPSHOT
Objects (real ids — use them for UPDATE_OBJECT / DELETE_OBJECT / connections to existing content):
{canvasObjects}
Connections between objects:
{canvasConnections}

### AVAILABLE ACTIONS
- CREATE_OBJECT: add a new block. Give each a unique "tempId" so later actions can reference it.
- UPDATE_OBJECT: change any fields (content, x, y, width, height, style) of an object. "id" may be a real canvas id or a tempId created earlier in this plan.
- DELETE_OBJECT: remove an object by real id or tempId.
- CREATE_CONNECTION: draw a connector line between two objects (real ids and/or tempIds).
- DELETE_CONNECTION: remove a connection by its real connection id.

### COORDINATE & LAYOUT RULES
- Place new work near (x: {agentX}, y: {agentY}); grow to the right and downward.
- NEVER overlap blocks (unless placing items INSIDE a frame). Typical card is 250-350px wide, 180-260px high. Keep 60-200px gaps.
- Structures: FLOWCHART (connect steps left-to-right), GRID/COLUMNS (group under headings or inside frames), TIMELINE (increasing x, connected), MINDMAP (hub in center, spokes around).
- When organizing EXISTING objects, move them with UPDATE_OBJECT (x/y) into a tidy structure instead of recreating them.

### OBJECT SCHEMAS (for CREATE_OBJECT "objData", also valid as UPDATE_OBJECT "updates")
1. "heading": large title text. { content, width: 300-500, height: 60 }
2. "text": plain paragraph text. { content, width: 300-600, height: 80-200 }
3. "sticky": colored brainstorm note. { content, width: 200, height: 160, style: { "color": "#FEF3C7" | "#F3E8FF" | "#ECFDF5" | "#FEE2E2" } }
4. "shape": labeled geometric shape. { content: "label", width: 120-200, height: 60-120, style: { "shapeType": "square" | "circle" | "triangle" | "diamond" | "pentagon" | "hexagon" | "star" | "heart" | "cloud" | "database" | "document" | "speech" | "message" | "cross" | "lightning" | "shield" | "pill", "color": "#hex" } }
5. "workflow-node": a step in a workflow diagram. { content: "Step name", width: 160, height: 60, style: { "isWorkflowNode": true, "workflowId": "same_string_for_whole_diagram", "nodeShape": "pill" | "circle" | "square" | "diamond", "color": "#FAF6F1", "borderColor": "#C97B4B", "textColor": "#2D2A26", "branchColor": "#C97B4B" } }
6. "frame": dashed boundary grouping items. { content: "Frame Name", width: 600+, height: 400+, style: { "frameColor": "#C97B4B" | "#3E63DD" | "#2F9E6E" } } — create the frame BEFORE the items inside it.
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
  "planDescription": "One-line summary of what you are doing",
  "actions": [
    { "type": "CREATE_OBJECT", "tempId": "hub_1", "objData": { "type": "heading", "x": 0, "y": 0, "width": 400, "height": 60, "content": "Title", "style": {} }, "log": "Adding title..." },
    { "type": "UPDATE_OBJECT", "id": "real-or-temp-id", "updates": { "content": "new text", "x": 100, "y": 200 }, "log": "Rewriting note..." },
    { "type": "DELETE_OBJECT", "id": "real-or-temp-id", "log": "Removing outdated card..." },
    { "type": "CREATE_CONNECTION", "fromId": "hub_1", "toId": "real-id-from-snapshot", "style": { "color": "#3E63DD" }, "log": "Wiring title to existing notes..." },
    { "type": "DELETE_CONNECTION", "connectionId": "real-connection-id", "log": "Removing stale link..." }
  ]
}
"planDescription" must be ONE short sentence. The "actions" array is REQUIRED — every operation you intend must appear as an action object; a plan whose actions array is missing or empty is invalid and will be rejected.
Order actions logically (frames first, then contents, then connections). Aim for a complete, polished result — real content, not placeholders.`;

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

async function callNvidia(apiKey: string, model: string, systemPrompt: string, prompt: string, useJsonMode: boolean): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
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
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 4096,
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

export async function POST(req: NextRequest) {
  try {
    const { prompt, apiKeyIndex, agentX, agentY, canvas } = await req.json();

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

    const selectedIdx = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 && apiKeyIndex < apiKeys.length ? apiKeyIndex : 0;
    const keyIndexesToTry = [selectedIdx, ...apiKeys.map((_, i) => i).filter(i => i !== selectedIdx)];

    const x = Math.round(Number(agentX) || 0);
    const y = Math.round(Number(agentY) || 0);

    const snapshotObjects = compactSnapshot(Array.isArray(canvas?.objects) ? canvas.objects : [], x, y);
    const snapshotIds = new Set(snapshotObjects.map(o => o.id));
    const snapshotConnections: SnapshotConnection[] = (Array.isArray(canvas?.connections) ? canvas.connections : [])
      .filter((c: SnapshotConnection) => snapshotIds.has(c.fromId) || snapshotIds.has(c.toId))
      .map((c: SnapshotConnection) => ({ id: c.id, fromId: c.fromId, toId: c.toId }));

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace(/{agentX}/g, String(x))
      .replace(/{agentY}/g, String(y))
      .replace('{canvasObjects}', snapshotObjects.length > 0 ? JSON.stringify(snapshotObjects) : '(canvas is empty)')
      .replace('{canvasConnections}', snapshotConnections.length > 0 ? JSON.stringify(snapshotConnections) : '(none)');

    let lastError: Error | null = null;
    let parsedPlan: { planDescription?: string; actions?: unknown[] } | null = null;
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    let keyCursor = 0; // rotates through keyIndexesToTry on auth/rate-limit errors

    // Outer loop: model fallback (timeouts / overloaded workers).
    // Inner loop: key rotation (401/403/429 are key problems, not model problems).
    modelLoop:
    for (const model of MODEL_CHAIN) {
      for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        if (Date.now() > deadline) break modelLoop;

        const idx = keyIndexesToTry[keyCursor % keyIndexesToTry.length];
        const apiKey = apiKeys[idx];
        try {
          let response = await callNvidia(apiKey, model, systemPrompt, prompt, true);

          // Some NIM deployments reject response_format — retry without it.
          if (response.status === 400) {
            response = await callNvidia(apiKey, model, systemPrompt, prompt, false);
          }

          if (response.status === 401 || response.status === 403 || response.status === 429) {
            keyCursor++;
            const errText = await response.text();
            lastError = new Error(`Key ${idx + 1} rejected (status ${response.status}): ${errText.slice(0, 200)}`);
            console.warn(lastError.message);
            continue; // same model, next key
          }

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${model} error (status ${response.status}): ${errText.slice(0, 200)}`);
          }

          const data = await response.json();
          const responseText: string = data.choices?.[0]?.message?.content || '';
          if (!responseText) {
            throw new Error(`${model} returned an empty completion`);
          }

          // Validate the plan, not just the JSON — reasoning models sometimes
          // narrate the plan in planDescription and omit the actions array.
          const candidate = extractJson(responseText) as { planDescription?: string; actions?: unknown[] };
          if (!candidate || !Array.isArray(candidate.actions) || candidate.actions.length === 0) {
            throw new Error(`${model} returned a plan without executable actions`);
          }

          parsedPlan = candidate;
          break modelLoop;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          const isTimeout = lastError.name === 'AbortError' || lastError.message.includes('aborted');
          console.warn(`${model} via key ${idx + 1} failed${isTimeout ? ' (timed out)' : ''}:`, lastError.message);
          continue modelLoop; // model is slow/overloaded/incoherent — try the next one
        }
      }
    }

    if (!parsedPlan) {
      return NextResponse.json({
        success: false,
        error: `The agent could not produce a plan. Last error: ${lastError?.message || 'Unknown error'}`,
      }, { status: 502 });
    }

    return NextResponse.json({ success: true, plan: parsedPlan });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('AI Agent endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
