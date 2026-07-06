import { NextRequest, NextResponse } from 'next/server';

// System prompt instructing the model on available canvas components, layout coordinates, and output schemas.
const SYSTEM_PROMPT_TEMPLATE = `You are the Mindspace AI Canvas Agent, an advanced architect that plans and builds interactive spatial environments on an infinite canvas.
The user has placed you at coordinates (x: {agentX}, y: {agentY}). 

Your task is to analyze the user's request and build a complete layout of cards, sticky notes, connectors, and tools.
You MUST output a single JSON object containing:
1. "planDescription": A short summary of what you are building.
2. "actions": A list of sequential actions to perform on the canvas.

Available actions you can output:
- CREATE_OBJECT: Create a new canvas node.
- CREATE_CONNECTION: Draw a connector line between two nodes.

### Coordinate Grid & Layout Guidelines:
- Place all new objects to the right, top, or bottom of the agent's position (x: {agentX}, y: {agentY}).
- Do NOT overlap nodes. An interactive card is usually 250px to 350px wide and 180px to 260px high. Space them out by at least 100px-200px gap.
- Organize items into visually logical structures:
  - FLOWCHART: Connect steps sequentially (e.g., A -> B -> C).
  - GRID/COLUMNS: Group related items vertically or horizontally under headings or within frames.
  - TIMELINE: Place items left-to-right (increasing x) and connect them.

### Object Schemas:
When creating an object (CREATE_OBJECT), choose one of these types:
1. "heading": A large, stylized text block for titles or sections.
   - content: "Title text"
   - width: 300, height: 60
2. "sticky": A colored brainstorming note.
   - content: "Note text"
   - width: 200, height: 160
   - style: { "color": "#FEF3C7" (yellow) | "#F3E8FF" (purple) | "#ECFDF5" (green) | "#FEE2E2" (red) }
3. "workflow-node": A step in a workflow diagram.
   - content: "Step Description"
   - width: 160, height: 60
   - style: { "isWorkflowNode": true, "nodeShape": "pill" | "circle" | "square" | "diamond", "color": "#FAF6F1", "borderColor": "#C97B4B", "textColor": "#2D2A26", "branchColor": "#C97B4B" }
4. "frame": A large dashed boundary that groups multiple items together.
   - content: "Frame Name"
   - width: 600, height: 400 (or larger)
   - style: { "frameColor": "#C97B4B" | "#3E63DD" | "#2F9E6E" }
5. "card": An interactive widget. Specify style flags to enable features:
   - Checklist / To-Do List:
     - style: { "isTodo": true, "todoTitle": "List Title" }
     - content: A JSON stringified array of items: "[{\\"id\\":\\"1\\",\\"text\\":\\"Task A\\",\\"done\\":false},{\\"id\\":\\"2\\",\\"text\\":\\"Task B\\",\\"done\\":true}]"
     - width: 300, height: 280
   - Focus Timer:
     - style: { "isTimer": true, "timerLabel": "Work timer" }
     - content: ""
     - width: 250, height: 190
   - Countdown:
     - style: { "isCountdown": true, "countdownTitle": "Launch Date", "countdownDate": "2026-07-20T09:00:00Z" }
     - content: ""
     - width: 250, height: 250
   - Interactive Poll:
     - style: { "isPoll": true, "pollQuestion": "Question?", "pollOptions": [{"id":"1","text":"Option A","votes":0},{"id":"2","text":"Option B","votes":0}] }
     - content: ""
     - width: 280, height: 260
   - Decision Spinner:
     - style: { "isDecision": true, "decisionTitle": "What to pick?", "decisionOptions": ["Option A", "Option B", "Option C"] }
     - content: ""
     - width: 300, height: 240
   - Live Metric:
     - style: { "isLiveMetric": true, "metricTitle": "Metric Name", "metricValue": "78.4%", "metricTrend": "+2.5% this week", "metricChartData": [60, 65, 70, 72, 75, 78.4] }
     - content: ""
     - width: 260, height: 155
   - Progress Goal:
     - style: { "isProgress": true, "progressLabel": "Completion Progress", "progressValue": 45 }
     - content: ""
     - width: 280, height: 190
   - Code Sandbox:
     - style: { "isCode": true }
     - content: "HTML/JS Code content"
     - width: 450, height: 350
   - Quote Block:
     - style: { "isQuote": true }
     - content: "Quote text"
     - width: 400, height: 180

### Connection Schema:
- fromId: A temporary ID of the source object (e.g. "task_A").
- toId: A temporary ID of the target object (e.g. "task_B").
- style: { "color": "hex_color", "isWorkflowConnection": true|false }

### Output JSON Format:
{
  "planDescription": "Short text of what the agent is building",
  "actions": [
    {
      "type": "CREATE_OBJECT",
      "tempId": "unique_temporary_id_string_like_card_1",
      "objData": {
        "type": "card" | "text" | "sticky" | "heading" | "frame" | "workflow-node",
        "x": number,
        "y": number,
        "width": number,
        "height": number,
        "content": "string",
        "style": {}
      },
      "log": "Status message to show in console (e.g. 'Creating database decision spinner...')"
    },
    {
      "type": "CREATE_CONNECTION",
      "fromId": "unique_temporary_id_string_like_card_1",
      "toId": "unique_temporary_id_string_like_card_2",
      "style": { "color": "#C97B4B" },
      "log": "Status message to show in console (e.g. 'Connecting milestone A to milestone B...')"
    }
  ]
}

DO NOT output any introductory or explanatory text. Return ONLY valid, stringified JSON in the specified format.`;

export async function POST(req: NextRequest) {
  try {
    const { prompt, apiKeyIndex, agentX, agentY } = await req.json();

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt is required' }, { status: 400 });
    }

    // Load available API keys
    const apiKeys = [
      process.env.NVIDIA_API_KEY,
      process.env.NVIDIA_API_KEY_2,
      process.env.NVIDIA_API_KEY_3,
      process.env.NVIDIA_API_KEY_4,
      process.env.NVIDIA_API_KEY_5
    ].filter(Boolean);

    if (apiKeys.length === 0) {
      return NextResponse.json({ success: false, error: 'No NVIDIA API keys configured in environment variables' }, { status: 500 });
    }

    // Determine key sequence to try (start with selected, fallback to others)
    const selectedIdx = typeof apiKeyIndex === 'number' && apiKeyIndex >= 0 && apiKeyIndex < apiKeys.length ? apiKeyIndex : 0;
    const keyIndexesToTry = [selectedIdx, ...apiKeys.map((_, i) => i).filter(i => i !== selectedIdx)];

    let lastError: any = null;
    let responseText = '';

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace(/{agentX}/g, String(agentX || 0))
      .replace(/{agentY}/g, String(agentY || 0));

    // Try keys sequentially until one succeeds
    for (const idx of keyIndexesToTry) {
      const apiKey = apiKeys[idx];
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500); // 6.5s timeout per key
      
      try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'meta/llama-3.3-70b-instruct',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 4096,
            response_format: { type: 'json_object' }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`NVIDIA API response error (status ${response.status}): ${errText}`);
        }

        const data = await response.json();
        responseText = data.choices?.[0]?.message?.content || '';
        break; // Success! Break the loop
      } catch (err: any) {
        clearTimeout(timeoutId);
        console.warn(`NVIDIA API Key index ${idx} failed:`, err.message);
        lastError = err;
      }
    }

    if (!responseText) {
      return NextResponse.json({ 
        success: false, 
        error: `All NVIDIA API keys failed. Last error: ${lastError?.message || 'Unknown error'}` 
      }, { status: 500 });
    }

    // Parse LLM response
    let parsedPlan;
    try {
      // Find JSON block if the model output markdown blocks
      const cleanJson = responseText.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      parsedPlan = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse LLM JSON:', responseText);
      return NextResponse.json({ 
        success: false, 
        error: 'AI agent returned an invalid JSON response structure. Please try again.',
        rawResponse: responseText
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, plan: parsedPlan });

  } catch (error: any) {
    console.error('AI Agent endpoint error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
