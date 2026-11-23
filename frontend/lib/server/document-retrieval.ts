import crypto from "node:crypto";
import { z } from "zod";

export const ABSTENTION = "I can't find this in your documents.";

const STOP_WORDS = new Set(
  (
    "a an and are as at be by can could did do does for from had has have how i in is it me of on " +
    "or our please that the their these this to was were what when where which who why with you " +
    "your about sources documents according study research researcher paper author"
  ).split(" "),
);

const WORD_FORMS: Record<string, string> = {
  methodologies: "methodology",
  methodological: "methodology",
  approaches: "approach",
  strategies: "strategy",
  procedures: "procedure",
  techniques: "technique",
  designs: "design",
  used: "use",
  using: "use",
  conducted: "conduct",
  conducting: "conduct",
  employed: "employ",
  employing: "employ",
  carried: "carry",
  carrying: "carry",
  collected: "collect",
  collecting: "collect",
  gathered: "gather",
  gathering: "gather",
  find: "finding",
  found: "finding",
  findings: "finding",
  results: "result",
  outcomes: "outcome",
  limitations: "limitation",
  weaknesses: "weakness",
  challenges: "challenge",
  participants: "participant",
  respondents: "respondent",
  subjects: "subject",
  studies: "study",
  researchers: "researcher",
  interviews: "interview",
  surveys: "survey",
  questionnaires: "questionnaire",
  observations: "observation",
  experiments: "experiment",
  analyses: "analysis",
  analyzed: "analyze",
  analysed: "analyse",
  examined: "examine",
  explored: "explore",
  investigated: "investigate",
  identified: "identify",
  revealed: "reveal",
  discovered: "discover",
  showed: "show",
  demonstrated: "demonstrate",
  improved: "improve",
  increased: "increase",
  decreased: "decrease",
  participated: "participate",
  participating: "participate",
  involved: "involve",
  recruited: "recruit",
  selected: "select",
  sought: "seek",
  intended: "intend",
  aimed: "aim",
};

const CONCEPTS: Record<string, { cues: Set<string>; terms: string[] }> = {
  methods: {
    cues: new Set([
      "method",
      "methodology",
      "approach",
      "strategy",
      "procedure",
      "technique",
      "design",
      "conduct",
      "collect",
      "gather",
      "employ",
      "perform",
    ]),
    terms: [
      "method",
      "methodology",
      "approach",
      "strategy",
      "procedure",
      "technique",
      "design",
      "conduct",
      "employ",
      "interview",
      "survey",
      "questionnaire",
      "experiment",
      "observation",
      "focus",
      "group",
      "qualitative",
      "quantitative",
      "sampling",
      "collect",
      "gather",
    ],
  },
  findings: {
    cues: new Set(["finding", "result", "outcome", "discover", "reveal", "impact", "effect"]),
    terms: [
      "finding",
      "result",
      "outcome",
      "discover",
      "reveal",
      "show",
      "demonstrate",
      "indicate",
      "improve",
      "increase",
      "decrease",
      "impact",
      "effect",
    ],
  },
  aims: {
    cues: new Set(["aim", "objective", "purpose", "goal", "examine", "explore", "investigate"]),
    terms: [
      "aim",
      "objective",
      "purpose",
      "goal",
      "intend",
      "seek",
      "examine",
      "explore",
      "investigate",
      "determine",
    ],
  },
  limitations: {
    cues: new Set(["limitation", "weakness", "constraint", "challenge", "drawback"]),
    terms: [
      "limitation",
      "weakness",
      "constraint",
      "challenge",
      "drawback",
      "restrict",
      "unable",
    ],
  },
  evidence: {
    cues: new Set(["evidence", "support", "useful", "relevance", "relevant"]),
    terms: [
      "finding",
      "result",
      "outcome",
      "conclusion",
      "evidence",
      "support",
      "show",
      "demonstrate",
      "indicate",
      "impact",
      "effect",
    ],
  },
  participants: {
    cues: new Set([
      "participant",
      "respondent",
      "subject",
      "sample",
      "population",
      "participate",
      "involve",
      "recruit",
    ]),
    terms: [
      "participant",
      "respondent",
      "subject",
      "sample",
      "population",
      "participate",
      "involve",
      "recruit",
      "select",
      "student",
      "teacher",
      "patient",
    ],
  },
};

const EXPANSION_WEIGHT = 0.35;
const CONTEXT_ONLY_TERMS = new Set([
  "explain",
  "elaborate",
  "expand",
  "further",
  "more",
  "detail",
  "details",
  "use",
  "mean",
  "useful",
  "help",
]);

export const chatRequestSchema = z
  .object({
    project_id: z.string().min(1).max(100),
    question: z.string().min(3).max(2000),
    sources: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          project_id: z.string().min(1).max(100),
          filename: z.string().min(1).max(180),
          pages: z
            .array(
              z.object({
                page_number: z.number().int().min(1),
                text: z.string().max(2_000_000),
                locator_type: z.enum(["page", "paragraph", "line"]),
              }),
            )
            .max(10000),
        }),
      )
      .max(50),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(2500),
        }).strict(),
      )
      .max(8)
      .default([]),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.sources.some((s) => s.project_id !== data.project_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "Every source must belong to the selected project.",
      });
    }
    if (new Set(data.sources.map((s) => s.id)).size !== data.sources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "Duplicate source IDs.",
      });
    }
    const chars = data.sources.reduce(
      (sum, s) => sum + s.pages.reduce((ps, p) => ps + p.text.length, 0),
      0,
    );
    if (chars > 2_000_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "Select a smaller source library (maximum 2 million characters per question).",
      });
    }
    const histChars = data.history.reduce((sum, t) => sum + t.content.length, 0);
    if (histChars > 12_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["history"],
        message: "Recent chat context is too large. Start a new conversation and retry.",
      });
    }
    if (!data.question.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["question"],
        message: "Enter a question.",
      });
    }
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

type CandidateChunk = {
  source_id: string;
  filename: string;
  location: number;
  locator_type: "page" | "paragraph" | "line";
  text: string;
  page_text: string;
};

export type QuoteOption = {
  id: string;
  source_id: string;
  filename: string;
  location: number;
  locator_type: "page" | "paragraph" | "line";
  text: string;
};

function normalizeWord(word: string): string {
  const mapped = WORD_FORMS[word] ?? word;
  if (mapped.endsWith("ies") && mapped.length > 4) return mapped.slice(0, -3) + "y";
  if (
    mapped.endsWith("s") &&
    mapped.length > 3 &&
    !mapped.endsWith("ss") &&
    !mapped.endsWith("us") &&
    !mapped.endsWith("is")
  ) {
    return mapped.slice(0, -1);
  }
  return mapped;
}

function terms(text: string): string[] {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return matches
    .map(normalizeWord)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function retrievalQuery(req: ChatRequest): string {
  const currentTerms = new Set(terms(req.question));
  const needsContext =
    currentTerms.size === 0 ||
    (currentTerms.size <= 2 && [...currentTerms].every((t) => CONTEXT_ONLY_TERMS.has(t)));
  const prevQuestions = req.history.filter((t) => t.role === "user").map((t) => t.content);
  if (needsContext && prevQuestions.length > 0) {
    return `${prevQuestions[prevQuestions.length - 1]}\nFollow-up: ${req.question}`;
  }
  return req.question;
}

function queryWeights(question: string): Record<string, number> {
  const qTerms = new Set(terms(question));
  const weights: Record<string, number> = {};
  for (const w of qTerms) weights[w] = 1.0;
  const qLower = question.toLowerCase();
  for (const [name, concept] of Object.entries(CONCEPTS)) {
    let matched = [...qTerms].some((t) => concept.cues.has(t));
    if (name === "methods" && !matched) {
      matched = /\bhow\b.*\b(?:do|does|did|was|were|conduct|carry|collect|gather|perform)\b.*\b(?:study|research|data)\b/.test(
        qLower,
      );
    }
    if (name === "participants" && !matched) {
      matched = /\bwho\b.*\b(?:took part|take part|participate)\b/.test(qLower);
    }
    if (matched) {
      for (const word of concept.terms) {
        const norm = normalizeWord(word);
        if (!STOP_WORDS.has(norm) && !(norm in weights)) {
          weights[norm] = EXPANSION_WEIGHT;
        }
      }
    }
  }
  return weights;
}

function chunks(text: string, limit = 600, overlap = 80): string[] {
  const words: Array<{ start: number; end: number }> = [];
  const regex = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    words.push({ start: m.index, end: m.index + m[0].length });
  }
  const result: string[] = [];
  const step = limit - overlap;
  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(start + limit, words.length);
    result.push(text.slice(words[start].start, words[end - 1].end));
    if (end === words.length) break;
  }
  return result;
}

function candidateChunks(req: ChatRequest): CandidateChunk[] {
  const list: CandidateChunk[] = [];
  for (const source of req.sources) {
    for (const page of source.pages) {
      for (const text of chunks(page.text)) {
        list.push({
          source_id: source.id,
          filename: source.filename,
          location: page.page_number,
          locator_type: page.locator_type,
          text,
          page_text: page.text,
        });
      }
    }
  }
  return list;
}

export function lexicalRetrieve(req: ChatRequest, topK = 5): CandidateChunk[] {
  const candidates = candidateChunks(req);
  const query = queryWeights(retrievalQuery(req));
  if (!Object.keys(query).length || !candidates.length) return [];

  const countsList = candidates.map((item) => {
    const map = new Map<string, number>();
    let total = 0;
    for (const t of terms(item.text)) {
      map.set(t, (map.get(t) ?? 0) + 1);
      total++;
    }
    return { map, total: Math.max(1, total) };
  });

  const frequencies: Record<string, number> = {};
  for (const word of Object.keys(query)) {
    frequencies[word] = countsList.reduce((acc, c) => acc + (c.map.has(word) ? 1 : 0), 0);
  }

  const ranked: Array<{ score: number; index: number; item: CandidateChunk }> = [];
  for (let index = 0; index < candidates.length; index++) {
    const { map, total } = countsList[index];
    let score = 0;
    for (const [word, weight] of Object.entries(query)) {
      const count = map.get(word) ?? 0;
      if (count > 0) {
        score +=
          weight *
          Math.log(1 + candidates.length / (1 + frequencies[word])) *
          (count / (count + 1.2 * (0.25 + (0.75 * total) / 250)));
      }
    }
    if (score > 0) ranked.push({ score, index, item: candidates[index] });
  }
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, topK).map((r) => r.item);
}

const embeddingCache = new Map<string, number[]>();
const CACHE_LIMIT = 5000;

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  const denom = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denom ? dot / denom : 0;
}

export type GeminiConfig = {
  key: string;
  model: string;
  embeddingModel: string;
  baseUrl: string;
  embeddingDimensions: number;
  minimumSimilarity: number;
};

export function getGeminiConfig(): GeminiConfig | null {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key || key === "YOUR_GEMINI_API_KEY") return null;
  const embeddingDimensions = Number(process.env.AI_EMBED_DIMENSIONS || "768") || 768;
  const minimumSimilarity = Number(process.env.AI_RETRIEVAL_MIN_SCORE || "0.3");
  return {
    key,
    model: (process.env.AI_CHAT_MODEL || "gemini-3.6-flash").trim() || "gemini-3.6-flash",
    embeddingModel:
      (process.env.AI_EMBED_MODEL || "gemini-embedding-2").trim() || "gemini-embedding-2",
    baseUrl: (
      process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
    )
      .trim()
      .replace(/\/+$/, ""),
    embeddingDimensions,
    minimumSimilarity: Number.isFinite(minimumSimilarity) ? minimumSimilarity : 0.3,
  };
}

function modelUrl(config: GeminiConfig, model: string, method: string): string {
  const resource = model.startsWith("models/") ? model : `models/${model}`;
  return `${config.baseUrl}/${resource}:${method}`;
}

async function embedTexts(
  config: GeminiConfig,
  texts: string[],
  task: "RETRIEVAL_DOCUMENT" | "QUESTION_ANSWERING",
  titles?: Array<string | null>,
): Promise<number[][]> {
  if (!texts.length) return [];
  const isEmbeddingTwo = config.embeddingModel.startsWith("gemini-embedding-2");
  const requests = texts.map((text, idx) => {
    const title = titles?.[idx] ?? null;
    const contentText = isEmbeddingTwo
      ? task === "RETRIEVAL_DOCUMENT"
        ? `title: ${title || "none"} | text: ${text}`
        : `task: question answering | query: ${text}`
      : text;
    const embedContentConfig: Record<string, unknown> = isEmbeddingTwo
      ? { outputDimensionality: config.embeddingDimensions }
      : {
          taskType: task,
          outputDimensionality: config.embeddingDimensions,
          ...(title && task === "RETRIEVAL_DOCUMENT" ? { title } : {}),
        };
    return {
      model: `models/${config.embeddingModel.replace(/^models\//, "")}`,
      content: { parts: [{ text: contentText }] },
      embedContentConfig,
    };
  });

  const resp = await fetch(modelUrl(config, config.embeddingModel, "batchEmbedContents"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.key,
    },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    throw new Error(`Gemini source indexing failed (HTTP ${resp.status}).`);
  }
  const data = (await resp.json()) as { embeddings?: Array<{ values?: number[] }> };
  if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
    throw new Error("Gemini returned an incomplete embedding batch.");
  }
  return data.embeddings.map((e) => e.values ?? []);
}

export async function retrieveEvidence(req: ChatRequest, config: GeminiConfig, topK = 5): Promise<CandidateChunk[]> {
  const candidates = candidateChunks(req);
  if (!candidates.length) return [];

  const keys = candidates.map((item) =>
    crypto
      .createHash("sha256")
      .update(
        [
          config.embeddingModel,
          String(config.embeddingDimensions),
          req.project_id,
          item.source_id,
          item.filename,
          String(item.location),
          item.text,
        ].join("\0"),
      )
      .digest("hex"),
  );

  const missingIndexes = keys
    .map((k, i) => (embeddingCache.has(k) ? -1 : i))
    .filter((i) => i >= 0);

  for (let start = 0; start < missingIndexes.length; start += 12) {
    const batch = missingIndexes.slice(start, start + 12);
    const vectors = await embedTexts(
      config,
      batch.map((i) => candidates[i].text),
      "RETRIEVAL_DOCUMENT",
      batch.map((i) => candidates[i].filename),
    );
    for (let j = 0; j < batch.length; j++) {
      const k = keys[batch[j]];
      embeddingCache.set(k, vectors[j]);
      if (embeddingCache.size > CACHE_LIMIT) {
        const oldest = embeddingCache.keys().next().value;
        if (oldest) embeddingCache.delete(oldest);
      }
    }
  }

  const [queryVector] = await embedTexts(config, [retrievalQuery(req)], "QUESTION_ANSWERING");
  const semanticRanked = candidates
    .map((candidate, index) => ({
      score: cosineSimilarity(queryVector, embeddingCache.get(keys[index]) ?? []),
      index,
      candidate,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter((item) => item.score >= config.minimumSimilarity);

  const combined: CandidateChunk[] = semanticRanked.slice(0, Math.min(3, topK)).map((x) => x.candidate);
  const seen = new Set(combined.map((item) => `${item.source_id}\0${item.location}\0${item.text}`));
  for (const kw of lexicalRetrieve(req, topK)) {
    const key = `${kw.source_id}\0${kw.location}\0${kw.text}`;
    if (!seen.has(key)) {
      combined.push(kw);
      seen.add(key);
    }
    if (combined.length >= topK) break;
  }
  return combined;
}

export function quoteOptions(evidence: CandidateChunk[]): QuoteOption[] {
  const options: QuoteOption[] = [];
  const seen = new Set<string>();
  for (const passage of evidence) {
    const sentences = passage.page_text.split(/(?<=[.!?])\s+|\n\s*\n/);
    for (const raw of sentences) {
      const sentence = raw.trim();
      const key = `${passage.source_id}\0${passage.location}\0${sentence}`;
      if (
        sentence &&
        passage.text.includes(sentence) &&
        sentence.length <= 4000 &&
        !seen.has(key)
      ) {
        seen.add(key);
        options.push({
          id: `Q${options.length + 1}`,
          source_id: passage.source_id,
          filename: passage.filename,
          location: passage.location,
          locator_type: passage.locator_type,
          text: sentence,
        });
      }
    }
  }
  return options.slice(0, 80);
}
