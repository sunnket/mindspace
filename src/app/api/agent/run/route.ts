import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 120;

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Measured 2026-07-07 against NIM serverless: all of these stream a first token
// in ~0.7-1.1s. Strongest first. Models that hang (llama-3.3-70b, qwen3.5-397b,
// glm-5.2, deepseek-v4-pro) are deliberately excluded — re-test before adding.
const MODEL_CHAIN = [
  'mistralai/mistral-large-3-675b-instruct-2512',
  'meta/llama-3.1-70b-instruct',
  'moonshotai/kimi-k2.6',
  'mistralai/mistral-medium-3.5-128b',
  'meta/llama-3.1-8b-instruct',
];

// A model must emit its first token within this window or we abandon it and
// fail over. Keeps a stalled/overloaded worker from ever blocking the user.
const TTFT_DEADLINE_MS = 7000;

const SYSTEM_PROMPT = `You are the Mindspace Canvas Agent — an elite, autonomous builder that works INSIDE a spatial infinite-canvas workspace, like a world-class information designer with instant hands.
The user invoked you at coordinates (x: {agentX}, y: {agentY}). Build near there, growing right and down.

Understand the user's intent (terse prompts deserve generous, thoughtful interpretation), read the canvas snapshot, and emit a build plan as ONE JSON object. You plan AND build in a single pass — no chatter.

{assignmentSection}### CURRENT CANVAS SNAPSHOT
Objects (real ids — reference, update, delete or connect these):
{canvasObjects}
Connections:
{canvasConnections}

### ACTIONS
- CREATE_OBJECT: new block. Give a unique "tempId" so later actions can reference it.
- UPDATE_OBJECT: change fields of an object. "id" = a real canvas id or an earlier tempId.
- DELETE_OBJECT: remove by real id or tempId.
- CREATE_CONNECTION: connector between two objects (real ids and/or tempIds).
- DELETE_CONNECTION: remove by real connection id.

### CRAFT — this is what makes you exceptional
- Write REAL, substantive content: actual task names, real insights, real copy. Never "Item 1", never lorem ipsum.
- Compose with VARIETY — mix headings, stickies, cards, shapes, frames. Use the RIGHT widget for the job (a checklist for tasks, a metric for a KPI, a countdown for a deadline, a poll for a vote, a table for structured data).
- Group clusters in frames (create the frame BEFORE its contents). Show relationships with connections.
- NEVER overlap blocks (except items inside a frame). Cards ~250-350w x 180-260h. Keep 60-180px gaps.
- Structures: FLOWCHART (left-to-right connected steps), COLUMNS/GRID (under headings or in frames), TIMELINE (increasing x), MINDMAP (hub center, spokes out), DASHBOARD (metric + progress + checklist grid).
- To organize EXISTING objects, MOVE them with UPDATE_OBJECT (x/y) instead of recreating.

### OBJECT SCHEMAS (objData for CREATE_OBJECT; also valid as UPDATE_OBJECT updates)
- "heading": { content, width 300-500, height 60 }
- "text": { content, width 300-600, height 80-200 }
- "sticky": { content, width 200, height 160, style:{ "color": "#FEF3C7"|"#F3E8FF"|"#ECFDF5"|"#FEE2E2" } }
- "shape": { content:"label", width 120-200, height 60-120, style:{ "shapeType":"square"|"circle"|"triangle"|"diamond"|"pentagon"|"hexagon"|"star"|"heart"|"cloud"|"database"|"document"|"speech"|"message"|"cross"|"lightning"|"shield"|"pill", "color":"#hex" } }
- "workflow-node": { content:"Step", width 160, height 60, style:{ "isWorkflowNode":true, "workflowId":"same_id_for_whole_diagram", "nodeShape":"pill"|"circle"|"square"|"diamond", "color":"#FAF6F1", "borderColor":"#C97B4B", "textColor":"#2D2A26", "branchColor":"#C97B4B" } }
- "frame": { content:"Name", width 600+, height 400+, style:{ "frameColor":"#C97B4B"|"#3E63DD"|"#2F9E6E" } }
- "card" (pick ONE feature):
  - To-Do: style { "isTodo":true, "todoTitle":"Title" }, content = JSON string like "[{\\"id\\":\\"1\\",\\"text\\":\\"Task\\",\\"done\\":false}]", 300x280
  - Timer: style { "isTimer":true, "timerLabel":"Deep work" }, "", 250x190
  - Countdown: style { "isCountdown":true, "countdownTitle":"Launch", "countdownDate":"2026-08-01T09:00:00Z" }, "", 250x250
  - Poll: style { "isPoll":true, "pollQuestion":"?", "pollOptions":[{"id":"1","text":"A","votes":0},{"id":"2","text":"B","votes":0}] }, "", 280x260
  - Decision: style { "isDecision":true, "decisionTitle":"Pick", "decisionOptions":["A","B","C"] }, "", 300x240
  - Live Metric: style { "isLiveMetric":true, "metricTitle":"Name", "metricValue":"78%", "metricTrend":"+2% this week", "metricChartData":[60,65,70,78] }, "", 260x155
  - Progress: style { "isProgress":true, "progressLabel":"Label", "progressValue":45 }, "", 280x190
  - Quick Data Table: style { "isQuickData":true, "quickDataRows":[{"key":"Status","value":"Active"}] }, "", 250x210
  - Link Card: style { "isLinkPreview":true, "linkUrl":"https://...", "linkTitle":"Title", "linkDescription":"Blurb" }, "", 280x280
  - Code: style { "isCode":true }, content = code, 450x350
  - Quote: style { "isQuote":true }, content = quote, 400x180
  - Plain: style {}, content = text, 300x200
- Connection: { "type":"CREATE_CONNECTION", "fromId":"...", "toId":"...", "style":{ "color":"#C97B4B", "isWorkflowConnection":false }, "log":"..." }

### OUTPUT — return ONLY this JSON, no prose, no markdown fences. Put "actions" FIRST so building can start instantly:
{ "actions": [ { "type":"CREATE_OBJECT", "tempId":"a1", "objData":{ "type":"heading", "x":0, "y":0, "width":400, "height":60, "content":"Title", "style":{} }, "log":"Adding title..." } ], "planDescription":"one short sentence" }
The "actions" array is REQUIRED and must be non-empty. Order actions logically (frames first, then contents, then connections). Deliver a complete, polished result.`;

interface SnapshotObject {
  id: string; type: string; x: number; y: number;
  width: number; height: number; content: string; style?: Record<string, unknown>;
}
interface SnapshotConnection { id: string; fromId: string; toId: string; }

function compactSnapshot(objects: SnapshotObject[], agentX: number, agentY: number): SnapshotObject[] {
  const byDistance = [...objects].sort((a, b) =>
    Math.hypot(a.x - agentX, a.y - agentY) - Math.hypot(b.x - agentX, b.y - agentY)
  );
  return byDistance.slice(0, 100).map((o) => {
    const isBinary = o.type === 'image' || o.type === 'drawing' || (o.content || '').startsWith('data:');
    const style: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o.style || {})) {
      if (typeof v === 'string' && v.length > 160) continue;
      style[k] = v;
    }
    return {
      id: o.id, type: o.type,
      x: Math.round(o.x), y: Math.round(o.y),
      width: Math.round(o.width), height: Math.round(o.height),
      content: isBinary ? '[media]' : (o.content || '').slice(0, 240),
      style,
    };
  });
}

/**
 * Open a streaming completion. Resolves only once the FIRST content token has
 * arrived (so callers can fail over on a stall), returning a ReadableStream of
 * plain assistant text (SSE framing and deltas already unwrapped).
 */
async function openModelStream(
  apiKey: string, model: string, systemPrompt: string, userPrompt: string,
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const ttftTimer = setTimeout(() => controller.abort(), TTFT_DEADLINE_MS);

  const res = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 4096,
      stream: true,
    }),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) {
    clearTimeout(ttftTimer);
    const errText = res.body ? await res.text() : '';
    const err = new Error(`${model} status ${res.status}: ${errText.slice(0, 160)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }

  const upstream = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = '';
  let firstTokenSeen = false;

  // Pull SSE lines, unwrap delta.content. Returns the text produced by one read,
  // or null at end of stream.
  const pump = async (): Promise<string | null> => {
    while (true) {
      const { done, value } = await upstream.read();
      if (done) return null;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';
      let out = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return out || '';
        try {
          const json = JSON.parse(payload);
          const piece = json.choices?.[0]?.delta?.content;
          if (typeof piece === 'string') out += piece;
        } catch { /* partial JSON line — ignore, next read completes it */ }
      }
      if (out) return out;
    }
  };

  // Wait for the first content token before we commit to this model.
  let firstText = '';
  while (!firstTokenSeen) {
    const chunk = await pump();
    if (chunk === null) {
      clearTimeout(ttftTimer);
      throw new Error(`${model} produced no content`);
    }
    if (chunk.length > 0) { firstTokenSeen = true; firstText = chunk; }
  }
  clearTimeout(ttftTimer); // first token landed — no more TTFT abort

  return new ReadableStream<Uint8Array>({
    start(ctrl) { if (firstText) ctrl.enqueue(encoder.encode(firstText)); },
    async pull(ctrl) {
      try {
        const chunk = await pump();
        if (chunk === null) { ctrl.close(); return; }
        if (chunk) ctrl.enqueue(encoder.encode(chunk));
      } catch (e) {
        ctrl.error(e);
      }
    },
    cancel() { controller.abort(); },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, apiKeyIndex, agentX, agentY, canvas, context, brief } = await req.json();
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
      return NextResponse.json({ success: false, error: 'No NVIDIA API keys configured' }, { status: 500 });
    }

    const startKey = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 ? apiKeyIndex % apiKeys.length : 0;
    const x = Math.round(Number(agentX) || 0);
    const y = Math.round(Number(agentY) || 0);

    const snapObjects = compactSnapshot(Array.isArray(canvas?.objects) ? canvas.objects : [], x, y);
    const snapIds = new Set(snapObjects.map((o) => o.id));
    const snapConns: SnapshotConnection[] = (Array.isArray(canvas?.connections) ? canvas.connections : [])
      .filter((c: SnapshotConnection) => snapIds.has(c.fromId) || snapIds.has(c.toId))
      .map((c: SnapshotConnection) => ({ id: c.id, fromId: c.fromId, toId: c.toId }));

    const parts: string[] = [];
    if (typeof context === 'string' && context.trim()) {
      parts.push(`### REFERENCE TEXT — the user invoked you directly on this text; it is your primary source material to complete, transform, or build from exactly as asked:\n"""${context.trim().slice(0, 2000)}"""`);
    }
    if (typeof brief === 'string' && brief.trim()) {
      parts.push(`### FOCUS\n${brief.trim()}`);
    }
    const assignmentSection = parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';

    const systemPrompt = SYSTEM_PROMPT
      .replace(/{agentX}/g, String(x))
      .replace(/{agentY}/g, String(y))
      .replace('{assignmentSection}', assignmentSection)
      .replace('{canvasObjects}', snapObjects.length ? JSON.stringify(snapObjects) : '(empty)')
      .replace('{canvasConnections}', snapConns.length ? JSON.stringify(snapConns) : '(none)');

    // Try models in order, rotating keys; stream the first that produces tokens.
    let lastError: Error | null = null;
    for (let m = 0; m < MODEL_CHAIN.length; m++) {
      const model = MODEL_CHAIN[m];
      const apiKey = apiKeys[(startKey + m) % apiKeys.length];
      try {
        const stream = await openModelStream(apiKey, model, systemPrompt, prompt);
        return new NextResponse(stream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Agent-Model': model,
          },
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`Agent model ${model} failed:`, lastError.message);
      }
    }

    return NextResponse.json({
      success: false,
      error: `No model responded. Last error: ${lastError?.message || 'unknown'}`,
    }, { status: 502 });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('AI Agent endpoint error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
