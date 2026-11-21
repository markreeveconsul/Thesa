import { afterEach, describe, expect, it, vi } from "vitest";
import { runFeasibility, type FeasibilityInputs } from "@/lib/feasibility";

const inputs: FeasibilityInputs = {
  topic: "Air quality and student attendance",
  research_problem: "",
  questions_objectives: "",
  population_setting: "",
  method: "",
  access: "",
  timeline: "",
  resources: "",
  ethics: "",
  constraints: "",
};

function report(citations: unknown[] = []) {
  return {
    summary: "More detail is needed before assessing this plan.",
    dimensions: Object.fromEntries(["scope", "method_fit", "access", "timeline", "resources", "ethics"].map((key) => [key, {
      status: "Needs clarification",
      assessment: "The method is not yet specified.",
      known: "A topic was supplied.",
      unknown: "The study design is undecided.",
      citations,
    }])),
    risks: [], next_steps: [], scope_adjustments: [], missing_information: [],
  };
}

describe("feasibility client contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows a preliminary report without source files", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(report()), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const result = await runFeasibility("project-1", inputs, [], new AbortController().signal);
    expect(result.dimensions.ethics.status).toBe("Needs clarification");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).evidence).toEqual([]);
    expect(fetcher.mock.calls[0][0]).toContain("/feasibility");
  });

  it("rejects a citation that does not match the selected project's source text", async () => {
    const citation = {
      id: "E1", source_id: "source-1", filename: "study.txt", location: 1,
      locator_type: "line", text: "Invented quotation.",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(report([citation])), { status: 200 })));
    const source = {
      id: "source-1", projectId: "project-1", filename: "study.txt", sha256: "",
      format: "txt" as const, size: 10, count: 1, warning: null, createdAt: "now",
      pages: [{ page_number: 1, locator_type: "line" as const, text: "The study used interviews." }],
    };
    await expect(runFeasibility("project-1", inputs, [source], new AbortController().signal))
      .rejects.toThrow(/invalid source citation/i);
  });
});
