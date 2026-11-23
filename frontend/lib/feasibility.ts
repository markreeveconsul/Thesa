import { z } from "zod";
import type { SourceContent } from "./sources";
import type { Citation } from "./chat";

export const feasibilityInputsSchema = z.object({
  topic: z.string().trim().min(1, "Enter a topic or working title.").max(300),
  research_problem: z.string().max(4000),
  questions_objectives: z.string().max(3000),
  population_setting: z.string().max(2000),
  method: z.string().max(3000),
  access: z.string().max(2000),
  timeline: z.string().max(1500),
  resources: z.string().max(1500),
  ethics: z.string().max(2000),
  constraints: z.string().max(2000),
});
export type FeasibilityInputs = z.infer<typeof feasibilityInputsSchema>;

const citationSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  filename: z.string(),
  location: z.number().int().positive(),
  locator_type: z.enum(["page", "paragraph", "line"]),
  text: z.string().min(1).max(1200),
});
const dimensionSchema = z.object({
  status: z.enum(["Looks workable", "Needs planning", "Needs clarification"]),
  assessment: z.string().max(1200),
  known: z.string().max(1200),
  unknown: z.string().max(1200),
  citations: z.array(citationSchema).max(3),
});
export const feasibilityReportSchema = z.object({
  summary: z.string().min(1).max(1600),
  dimensions: z.object({
    scope: dimensionSchema,
    method_fit: dimensionSchema,
    access: dimensionSchema,
    timeline: dimensionSchema,
    resources: dimensionSchema,
    ethics: dimensionSchema,
  }),
  risks: z.array(z.object({
    title: z.string().max(700),
    why_it_matters: z.string().max(700),
    mitigation: z.string().max(700),
    citations: z.array(citationSchema).max(3),
  })).max(8),
  next_steps: z.array(z.object({
    action: z.string().max(700),
    reason: z.string().max(700),
    citations: z.array(citationSchema).max(3).optional().default([]),
  })).max(8),
  scope_adjustments: z.array(z.string().max(700)).max(5),
  missing_information: z.array(z.string().max(700)).max(12),
});
export type FeasibilityReport = z.infer<typeof feasibilityReportSchema>;
export type FeasibilityAssessment = {
  id: string;
  created_at: string;
  inputs: FeasibilityInputs;
  report: FeasibilityReport;
};

export function buildFeasibilityMarkdown(assessment: FeasibilityAssessment): string {
  const { report, inputs, created_at } = assessment;
  const lines = [
    `# Feasibility Review: ${inputs.topic}`,
    "",
    `Created: ${new Date(created_at).toLocaleString()}`,
    "",
    "## Summary",
    report.summary,
    "",
    "## Dimensions",
  ];
  for (const [name, item] of Object.entries(report.dimensions)) {
    lines.push(`### ${name.replaceAll("_", " ")}`, `**Status:** ${item.status}`, item.assessment);
    if (item.known) lines.push(`- **Known:** ${item.known}`);
    if (item.unknown) lines.push(`- **Uncertain:** ${item.unknown}`);
    for (const citation of item.citations) {
      lines.push(`- Source: ${citation.filename} (${citation.locator_type} ${citation.location}) — "${citation.text}"`);
    }
  }
  if (report.risks.length) {
    lines.push("", "## Risks");
    for (const risk of report.risks) {
      lines.push(`### ${risk.title}`, risk.why_it_matters, `**Possible response:** ${risk.mitigation}`);
      for (const citation of risk.citations) {
        lines.push(`- Source: ${citation.filename} (${citation.locator_type} ${citation.location}) — "${citation.text}"`);
      }
    }
  }
  if (report.next_steps.length) {
    lines.push("", "## Suggested next steps");
    for (const step of report.next_steps) {
      lines.push(`- **${step.action}:** ${step.reason}`);
      for (const citation of step.citations ?? []) {
        lines.push(`  - Source: ${citation.filename} (${citation.locator_type} ${citation.location}) — "${citation.text}"`);
      }
    }
  }
  if (report.scope_adjustments.length) lines.push("", "## Scope adjustments", ...report.scope_adjustments.map((item) => `- ${item}`));
  if (report.missing_information.length) lines.push("", "## Still to clarify", ...report.missing_information.map((item) => `- ${item}`));
  return `${lines.join("\n")}\n`;
}

export async function askFeasibilityFollowUp(
  dimension: string,
  question: string,
  assessment: FeasibilityAssessment,
  evidence: Citation[],
  signal: AbortSignal,
): Promise<string> {
  const base = process.env.NEXT_PUBLIC_DOCUMENT_API_URL || "/api/document";
  const response = await fetch(`${base.replace(/\/$/, "")}/feasibility/follow-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
    body: JSON.stringify({
      dimension,
      question,
      assessment,
      evidence,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "Could not answer the follow-up.");
  }
  const body = await response.json() as { answer?: string };
  if (typeof body.answer !== "string" || !body.answer.trim()) throw new Error("Otto returned an empty follow-up answer.");
  return body.answer;
}

function terms(text: string) {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function selectEvidence(inputs: FeasibilityInputs, sources: SourceContent[]) {
  const query = terms(Object.values(inputs).join(" "));
  const candidates = sources.flatMap((source) => source.pages.flatMap((page) => {
    const sentences = page.text.match(/[^.!?\n]+[.!?]?/g) ?? [];
    return sentences.map((raw) => {
      const text = raw.trim();
      const words = terms(text);
      const score = [...query].reduce((sum, word) => sum + Number(words.has(word)), 0);
      return { source, page, text: text.slice(0, 1200), score };
    });
  })).filter((item) => item.score > 0 && item.text.length > 30);
  candidates.sort((a, b) => b.score - a.score || a.source.filename.localeCompare(b.source.filename));
  const selected: { id: string; source_id: string; filename: string; location: number; locator_type: "page" | "paragraph" | "line"; text: string }[] = [];
  let chars = 0;
  for (const item of candidates) {
    const key = `${item.source.id}:${item.page.page_number}:${item.text}`;
    if (selected.some((entry) => `${entry.source_id}:${entry.location}:${entry.text}` === key)) continue;
    if (chars + item.text.length > 10000) continue;
    selected.push({
      id: `E${selected.length + 1}`,
      source_id: item.source.id,
      filename: item.source.filename,
      location: item.page.page_number,
      locator_type: item.page.locator_type,
      text: item.text,
    });
    chars += item.text.length;
    if (selected.length === 10) break;
  }
  return selected;
}

export async function runFeasibility(
  projectId: string,
  inputs: FeasibilityInputs,
  sources: SourceContent[],
  signal: AbortSignal,
): Promise<FeasibilityReport> {
  const evidence = selectEvidence(inputs, sources);
  const base = process.env.NEXT_PUBLIC_DOCUMENT_API_URL || "/api/document";
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/feasibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
      body: JSON.stringify({ project_id: projectId, inputs, evidence }),
    });
  } catch {
    throw new Error(signal.aborted ? "Feasibility review canceled." : "Cannot reach the feasibility service. Check the backend or retry later.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail : "Otto could not assess feasibility. Retry later.");
  }
  const result = feasibilityReportSchema.safeParse(await response.json());
  if (!result.success) throw new Error("Otto returned an invalid feasibility report. No report was saved.");
  const references = new Map(sources.map((source) => [source.id, source]));
  const allCitations = [
    ...Object.values(result.data.dimensions).flatMap((item) => item.citations),
    ...result.data.risks.flatMap((item) => item.citations),
  ];
  for (const citation of allCitations) {
    const source = references.get(citation.source_id);
    const page = source?.pages.find((item) => item.page_number === citation.location && item.locator_type === citation.locator_type);
    if (!source || source.filename !== citation.filename || !page?.text.includes(citation.text))
      throw new Error("Otto returned an invalid source citation. No report was saved.");
  }
  return result.data;
}
