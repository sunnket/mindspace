import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 40;
export const dynamic = 'force-dynamic';

/**
 * Vision captioner. The canvas agent is text-only, so when the user asks it to
 * caption / describe / title an IMAGE they placed, the client downscales that
 * image and POSTs it here. We run a NIM vision-language model and return a
 * concrete description the agent then grounds its caption on.
 *
 * POST { image: "data:image/...;base64,…", prompt?: string }
 *  → { description } on success, { error } otherwise (agent degrades gracefully).
 */

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Vision-capable NIMs, strongest first. If one stalls/errors we fail over.
const VISION_MODELS = [
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'microsoft/phi-3.5-vision-instruct',
];

const PER_MODEL_TIMEOUT_MS = 22000;

const DEFAULT_PROMPT =
  'Describe this image in 1-2 vivid, concrete sentences. Name the main subject, the setting, dominant colors, the mood, and transcribe any clearly visible text. Be specific — no hedging, no "this image shows".';

export async function POST(req: NextRequest) {
  try {
    const { image, prompt } = await req.json();

    if (typeof image !== 'string' || !/^data:image\//.test(image)) {
      return NextResponse.json({ error: 'A data:image/... payload is required' }, { status: 400 });
    }
    // NIM inline images have a payload ceiling; the client should downscale, but
    // guard here so a huge upload fails fast instead of timing out upstream.
    if (image.length > 320_000) {
      return NextResponse.json({ error: 'Image too large; downscale before sending' }, { status: 413 });
    }

    const apiKeys = [
      process.env.NVIDIA_API_KEY,
      process.env.NVIDIA_API_KEY_2,
      process.env.NVIDIA_API_KEY_3,
      process.env.NVIDIA_API_KEY_4,
      process.env.NVIDIA_API_KEY_5,
    ].filter(Boolean) as string[];
    if (apiKeys.length === 0) {
      return NextResponse.json({ error: 'No NVIDIA API keys configured' }, { status: 500 });
    }

    const userPrompt = (typeof prompt === 'string' && prompt.trim()) ? prompt.trim().slice(0, 400) : DEFAULT_PROMPT;

    let lastError = '';
    for (let m = 0; m < VISION_MODELS.length; m++) {
      const model = VISION_MODELS[m];
      const apiKey = apiKeys[m % apiKeys.length];
      try {
        const res = await fetch(NVIDIA_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: userPrompt },
                  { type: 'image_url', image_url: { url: image } },
                ],
              },
            ],
            max_tokens: 320,
            temperature: 0.2,
            stream: false,
          }),
        });

        if (!res.ok) {
          lastError = `${model} status ${res.status}: ${(await res.text()).slice(0, 160)}`;
          continue;
        }
        const json = await res.json();
        const description =
          json?.choices?.[0]?.message?.content ??
          (Array.isArray(json?.choices?.[0]?.message?.content)
            ? json.choices[0].message.content.map((c: { text?: string }) => c.text || '').join(' ')
            : '');
        const text = typeof description === 'string' ? description.trim() : '';
        if (text) {
          return NextResponse.json({ description: text, model });
        }
        lastError = `${model} returned empty content`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`Vision model ${model} failed:`, lastError);
      }
    }

    return NextResponse.json({ error: `No vision model responded. ${lastError}` }, { status: 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Vision endpoint error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
