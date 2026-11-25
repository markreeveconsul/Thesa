import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const MODEL_CASCADE = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

const followUpSchema = z
  .object({
    dimension: z.string().min(1).max(100),
    question: z.string().min(1).max(2000),
    assessment: z.record(z.string(), z.unknown()),
    evidence: z
      .array(
        z
          .object({
            id: z.string().regex(/^E\d{1,2}$/),
            source_id: z.string().min(1).max(100),
            filename: z.string().min(1).max(180),
            location: z.number().int().min(1),
            locator_type: z.enum(["page", "paragraph", "line"]),
            text: z.string().min(1).max(1200),
          })
          .strict(),
      )
      .max(3)
      .default([]),
  })
  .strict();

export async function POST(request: NextRequest) {
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json({ detail: "Sending the follow-up took too long." }, { status: 408 });
  }
  if (Buffer.byteLength(rawText, "utf8") > 180_000) {
    return NextResponse.json({ detail: "The follow-up request is too large." }, { status: 413 });
  }
  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ detail: "The follow-up request is invalid." }, { status: 422 });
  }
  const parsed = followUpSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ detail: "The follow-up request is invalid." }, { status: 422 });
  }

  const key = (process.env.FEASIBILITY_GROQ_API_KEY || "").trim();
  if (!key) {
    return NextResponse.json(
      { detail: "Add your Groq key to FEASIBILITY_GROQ_API_KEY in the server environment." },
      { status: 503 },
    );
  }
  const custom = (process.env.FEASIBILITY_GROQ_MODEL || "").trim();
  const models = custom
    ? [custom, ...MODEL_CASCADE.filter((m) => m !== custom)]
    : [...MODEL_CASCADE];
  const baseUrl = (
    process.env.FEASIBILITY_GROQ_BASE_URL || "https://api.groq.com/openai/v1"
  )
    .trim()
    .replace(/\/+$/, "");

  const system =
    "You answer one practical follow-up question about a thesis feasibility assessment. " +
    "Use only the supplied assessment and evidence. Be concise, distinguish known facts from " +
    "uncertainty, and do not invent sources or approvals.";

  for (const model of models) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(parsed.data) },
          ],
          max_completion_tokens: 700,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(40000),
      });
    } catch {
      return NextResponse.json(
        { detail: "Cannot reach Groq. Check the connection and retry." },
        { status: 503 },
      );
    }
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json(
        { detail: "Groq rejected the feasibility API key or access." },
        { status: 503 },
      );
    }
    if (response.status === 429 || response.status >= 500) continue;
    if (response.status >= 400) {
      return NextResponse.json({ detail: "Groq could not answer the follow-up." }, { status: 502 });
    }
    const data = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      return NextResponse.json({ detail: "Groq returned no follow-up answer." }, { status: 502 });
    }
    return NextResponse.json({ answer: answer.trim() }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { detail: "All Groq models failed. Please retry later." },
    { status: 502 },
  );
}
