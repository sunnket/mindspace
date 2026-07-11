import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const amount = Math.min(Number(req.nextUrl.searchParams.get('amount') || 5), 10);
  const category = req.nextUrl.searchParams.get('category') || '';
  const difficulty = req.nextUrl.searchParams.get('difficulty') || '';

  try {
    const params = new URLSearchParams({
      amount: String(amount),
      type: 'multiple',
    });
    if (category) params.set('category', category);
    if (difficulty) params.set('difficulty', difficulty);

    const res = await fetch(`https://opentdb.com/api.php?${params}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ success: false, error: `Open Trivia DB returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    if (data.response_code !== 0 || !data.results?.length) {
      return NextResponse.json({ success: true, results: [] });
    }

    const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const results = data.results.map((q: Record<string, unknown>) => ({
      question: decode(q.question as string),
      correct_answer: decode(q.correct_answer as string),
      incorrect_answers: (q.incorrect_answers as string[]).map(decode),
      category: decode(q.category as string),
      difficulty: q.difficulty as string,
    }));

    return NextResponse.json({ success: true, results }, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
