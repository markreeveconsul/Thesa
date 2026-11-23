"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FlaskConical,
  HelpCircle,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
  Triangle,
  Users,
} from "lucide-react";
import { getSourceContent, type SourceInfo } from "@/lib/sources";
import {
  askFeasibilityFollowUp,
  buildFeasibilityMarkdown,
  feasibilityInputsSchema,
  runFeasibility,
  type FeasibilityAssessment,
  type FeasibilityInputs,
  type FeasibilityReport,
} from "@/lib/feasibility";
import {
  deleteFeasibilityAssessment,
  listFeasibilityAssessments,
  saveFeasibilityAssessment,
} from "@/app/feasibility-actions";
import type { Citation } from "@/lib/chat";

const blank: FeasibilityInputs = {
  topic: "",
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

type FieldDef = {
  key: keyof FeasibilityInputs;
  label: string;
  hint: string;
  required?: boolean;
  rows?: number;
  maxLength: number;
};

const stepDefs: { title: string; subtitle: string; fields: FieldDef[] }[] = [
  {
    title: "1. Scope & Question",
    subtitle: "Define your working title, motivating problem, and core research objectives.",
    fields: [
      {
        key: "topic",
        label: "Topic or working title",
        hint: "Describe the study you want to carry out.",
        required: true,
        maxLength: 300,
      },
      {
        key: "research_problem",
        label: "Research problem",
        hint: "What gap, tension, or need motivates this study?",
        rows: 4,
        maxLength: 4000,
      },
      {
        key: "questions_objectives",
        label: "Research questions or objectives",
        hint: "What specific questions will your study answer?",
        rows: 3,
        maxLength: 3000,
      },
    ],
  },
  {
    title: "2. Method & Access",
    subtitle: "Outline your participants, study design, and how you will reach data or sites.",
    fields: [
      {
        key: "population_setting",
        label: "Participants and setting",
        hint: "Who or what will you study, and in what context?",
        rows: 3,
        maxLength: 2000,
      },
      {
        key: "method",
        label: "Proposed method",
        hint: "Design, data collection instruments, and analytical approach.",
        rows: 4,
        maxLength: 3000,
      },
      {
        key: "access",
        label: "Access to data or participants",
        hint: "Do you have institutional permission or realistic recruitment paths?",
        rows: 3,
        maxLength: 2000,
      },
    ],
  },
  {
    title: "3. Timeline, Resources & Ethics",
    subtitle: "Capture deadlines, practical constraints, ethical approvals, and open uncertainties.",
    fields: [
      {
        key: "timeline",
        label: "Timeline",
        hint: "Include target submission dates, semesters, or weeks available.",
        rows: 2,
        maxLength: 1500,
      },
      {
        key: "resources",
        label: "Resources and constraints",
        hint: "Software, budget, advisor availability, or technical limits.",
        rows: 3,
        maxLength: 1500,
      },
      {
        key: "ethics",
        label: "Ethics and permissions",
        hint: "IRB/ethics board approval, consent, anonymization, or site sign-off.",
        rows: 3,
        maxLength: 2000,
      },
      {
        key: "constraints",
        label: "Anything uncertain?",
        hint: "Specific risks or trade-offs you want evaluated.",
        rows: 2,
        maxLength: 2000,
      },
    ],
  },
];

const dimensions: { key: keyof FeasibilityReport["dimensions"]; label: string }[] = [
  { key: "scope", label: "Scope" },
  { key: "method_fit", label: "Method fit" },
  { key: "access", label: "Access" },
  { key: "timeline", label: "Timeline" },
  { key: "resources", label: "Resources" },
  { key: "ethics", label: "Ethics" },
];

const localKey = (projectId: string) => `thesa-feasibility-${projectId}`;
const draftKey = (projectId: string) => `thesa-feasibility-draft-${projectId}`;

export function FeasibilityWorkspace({
  projectId,
  projectTitle,
  researchProblem,
  sources,
  local,
  onBack,
  onCitation,
}: {
  projectId: string;
  projectTitle: string;
  researchProblem: string;
  sources: SourceInfo[];
  local: boolean;
  onBack: () => void;
  onCitation: (citation: Citation) => void;
}) {
  const [inputs, setInputs] = useState<FeasibilityInputs>(() => {
    const fallback = {
      ...blank,
      topic: projectTitle,
      research_problem: researchProblem ?? "",
    };
    if (typeof window === "undefined") return fallback;
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(draftKey(projectId)) || "null",
      ) as FeasibilityInputs | null;
      if (!saved) return fallback;
      const parsed = feasibilityInputsSchema.partial().safeParse(saved);
      return parsed.success ? { ...fallback, ...parsed.data } : fallback;
    } catch {
      return fallback;
    }
  });

  const [step, setStep] = useState(0);
  const [assessments, setAssessments] = useState<FeasibilityAssessment[]>([]);
  const [selected, setSelected] = useState<FeasibilityAssessment>();
  const [stage, setStage] = useState<"intake" | "report">("intake");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [followUpDimension, setFollowUpDimension] = useState("timeline");
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (local) {
        try {
          const saved = JSON.parse(
            window.localStorage.getItem(localKey(projectId)) || "[]",
          ) as FeasibilityAssessment[];
          if (alive) {
            setAssessments(saved);
            if (saved[0]) {
              setSelected(saved[0]);
              setStage("report");
            }
          }
        } catch {
          if (alive) {
            setError("Could not read feasibility reviews saved in this browser.");
          }
        }
        return;
      }
      const result = await listFeasibilityAssessments(projectId);
      if (!alive) return;
      setAssessments(result.assessments);
      if (result.assessments[0]) {
        setSelected(result.assessments[0]);
        setStage("report");
      }
      if (result.error) setError(result.error);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [local, projectId]);

  useEffect(() => {
    setDraftStatus("Saving draft…");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey(projectId), JSON.stringify(inputs));
        setDraftStatus("Draft saved locally.");
      } catch {
        setDraftStatus("Could not save this draft locally.");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [inputs, projectId]);

  function update(key: keyof FeasibilityInputs, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  async function save(input: FeasibilityInputs, report: FeasibilityReport) {
    const draft: FeasibilityAssessment = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      inputs: input,
      report,
    };
    if (local) {
      const next = [draft, ...assessments].slice(0, 20);
      window.localStorage.setItem(localKey(projectId), JSON.stringify(next));
      setAssessments(next);
      setSelected(draft);
      setStage("report");
      return;
    }
    const result = await saveFeasibilityAssessment({
      projectId,
      inputs: input,
      report,
    });
    if (!result.assessment) {
      throw new Error(result.error || "Could not save the review.");
    }
    const next = [result.assessment, ...assessments].slice(0, 20);
    setAssessments(next);
    setSelected(result.assessment);
    setStage("report");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !consent) return;
    const parsed = feasibilityInputsSchema.safeParse(inputs);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the assessment details.");
      return;
    }
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError("");
    setStatus("Reviewing your plan and selecting relevant source excerpts…");
    try {
      const contents = [];
      if (sources.length > 50) {
        throw new Error("This review supports up to 50 sources per project.");
      }
      let total = 0;
      for (const source of sources) {
        const content = await getSourceContent(projectId, source.id, local);
        if (!content) continue;
        total += content.pages.reduce((count, page) => count + page.text.length, 0);
        if (total > 2_000_000) {
          throw new Error(
            "The source library is too large for one review. Remove some sources and retry.",
          );
        }
        contents.push(content);
      }
      setStatus("Evaluating feasibility across six dimensions…");
      const report = await runFeasibility(
        projectId,
        parsed.data,
        contents,
        controller.signal,
      );
      await save(parsed.data, report);
      window.localStorage.removeItem(draftKey(projectId));
      setDraftStatus("");
      setStatus("Review saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not complete the feasibility review.",
      );
      setStatus("");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setBusy(false);
    }
  }

  async function remove(assessment: FeasibilityAssessment) {
    setError("");
    let next: FeasibilityAssessment[] = [];
    if (local) {
      next = assessments.filter((item) => item.id !== assessment.id);
      window.localStorage.setItem(localKey(projectId), JSON.stringify(next));
      setAssessments(next);
    } else {
      const result = await deleteFeasibilityAssessment(projectId, assessment.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      next = assessments.filter((item) => item.id !== assessment.id);
      setAssessments(next);
    }
    if (selected?.id === assessment.id) {
      setSelected(next[0]);
      if (!next.length) setStage("intake");
    }
  }

  async function copyMarkdown() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(buildFeasibilityMarkdown(selected));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the report to the clipboard.");
    }
  }

  function downloadMarkdown() {
    if (!selected) return;
    const blob = new Blob([buildFeasibilityMarkdown(selected)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `feasibility-${selected.inputs.topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "review"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function askFollowUp() {
    if (!selected || !followUpQuestion.trim()) return;
    setFollowUpBusy(true);
    setFollowUpAnswer("");
    setError("");
    try {
      const dimension =
        selected.report.dimensions[
          followUpDimension as keyof FeasibilityReport["dimensions"]
        ];
      const evidence = [...dimension.citations];
      const answer = await askFeasibilityFollowUp(
        followUpDimension,
        followUpQuestion,
        selected,
        evidence,
        new AbortController().signal,
      );
      setFollowUpAnswer(answer);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not answer the follow-up.",
      );
    } finally {
      setFollowUpBusy(false);
    }
  }

  const selectedReport = selected?.report;
  const dimensionResults = selectedReport
    ? dimensions.map(({ key, label }) => ({
        key,
        label,
        item: selectedReport.dimensions[key],
      }))
    : [];
  const strongCount = dimensionResults.filter(
    ({ item }) => item.status === "Looks workable",
  ).length;
  const planningCount = dimensionResults.filter(
    ({ item }) => item.status === "Needs planning",
  ).length;
  const clarityCount = dimensionResults.filter(
    ({ item }) => item.status === "Needs clarification",
  ).length;

  const fixCards = selectedReport
    ? [
        ...selectedReport.next_steps.map((stepItem) => ({
          title: stepItem.action,
          detail: stepItem.reason,
          kind: "recommended",
        })),
        ...selectedReport.risks.map((risk) => ({
          title: risk.title,
          detail: risk.mitigation,
          kind: "risk",
        })),
        ...selectedReport.scope_adjustments.map((item) => ({
          title: "Adjust the scope",
          detail: item,
          kind: "scope",
        })),
        ...selectedReport.missing_information.map((item) => ({
          title: "Clarify the plan",
          detail: item,
          kind: "clarity",
        })),
      ].slice(0, 3)
    : [];

  const currentStep = stepDefs[step];

  return (
    <main className="feasibility-view">
      <div className="feasibility-shell">
        <header className="feasibility-heading">
          <button
            type="button"
            className="secondary feasibility-back"
            onClick={onBack}
          >
            <ArrowLeft size={15} />
            Back to manuscript
          </button>
          <div className="feasibility-heading-row">
            <div>
              <span className="eyebrow">STUDY FEASIBILITY STUDIO</span>
              <h1>Feasibility check</h1>
              <p>
                Evaluate scope, methodology, access, timeline, resources, and
                ethics against your uploaded literature. Guidance only — you
                stay the author.
              </p>
            </div>
            <div className="feasibility-stage-switch" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={stage === "intake"}
                className={stage === "intake" ? "active" : ""}
                onClick={() => setStage("intake")}
              >
                <Pencil size={14} />
                Plan details
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={stage === "report"}
                className={stage === "report" ? "active" : ""}
                disabled={!selected}
                onClick={() => selected && setStage("report")}
              >
                <FlaskConical size={14} />
                Diagnostic report ({assessments.length})
              </button>
            </div>
          </div>
        </header>

        {error && (
          <p className="feasibility-error" role="alert">
            {error}
          </p>
        )}

        {stage === "intake" ? (
          <div className="feasibility-intake-grid">
            <form
              className="feasibility-stepper-card"
              onSubmit={(event) => void submit(event)}
            >
              <div className="feasibility-steps" role="tablist">
                {stepDefs.map((s, idx) => (
                  <button
                    type="button"
                    key={s.title}
                    role="tab"
                    aria-selected={step === idx}
                    className={
                      "feasibility-step-btn" + (step === idx ? " active" : "")
                    }
                    onClick={() => setStep(idx)}
                  >
                    <span>{s.title}</span>
                  </button>
                ))}
              </div>

              <div className="feasibility-step-head">
                <h2>{currentStep.title}</h2>
                <p>{currentStep.subtitle}</p>
              </div>

              <div className="feasibility-fields">
                {currentStep.fields.map((field) => (
                  <label className="feasibility-field" key={field.key}>
                    <span>
                      {field.label}
                      {field.required && <b> · required</b>}
                    </span>
                    <small>{field.hint}</small>
                    {field.key === "topic" ? (
                      <input
                        maxLength={field.maxLength}
                        required
                        value={inputs[field.key]}
                        onChange={(event) =>
                          update(field.key, event.target.value)
                        }
                      />
                    ) : (
                      <textarea
                        rows={field.rows ?? 3}
                        maxLength={field.maxLength}
                        placeholder="Not decided yet"
                        value={inputs[field.key]}
                        onChange={(event) =>
                          update(field.key, event.target.value)
                        }
                      />
                    )}
                  </label>
                ))}
              </div>

              {step === stepDefs.length - 1 && (
                <label className="feasibility-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={busy}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    Send these study details and up to 10 relevant source
                    excerpts for feasibility analysis. Reviews stay in{" "}
                    {local ? "this browser only" : "your private project"}.
                    Avoid entering sensitive personal data.
                  </span>
                </label>
              )}

              <div className="feasibility-step-actions">
                {step > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setStep((v) => v - 1)}
                  >
                    <ArrowLeft size={14} />
                    Previous
                  </button>
                )}
                {step < stepDefs.length - 1 ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setStep((v) => v + 1)}
                  >
                    Continue
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="primary"
                    disabled={busy || !consent || !inputs.topic.trim()}
                  >
                    {busy ? "Evaluating plan…" : "Create feasibility review"}
                  </button>
                )}
                {busy && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => activeRequest.current?.abort()}
                  >
                    Cancel review
                  </button>
                )}
              </div>

              <div className="feasibility-form-footer">
                {draftStatus && (
                  <span role="status" aria-live="polite">
                    {draftStatus}
                  </span>
                )}
                {status && (
                  <span role="status" aria-live="polite">
                    {status}
                  </span>
                )}
              </div>
            </form>

            <aside className="feasibility-side-history">
              <h3>Saved reviews</h3>
              {!assessments.length ? (
                <p className="muted">
                  Complete the three-step plan on the left to generate your
                  first six-dimension feasibility report. Uploaded sources (
                  {sources.length}) will be checked automatically.
                </p>
              ) : (
                <div className="feasibility-history-list">
                  {assessments.map((item) => (
                    <div
                      key={item.id}
                      className={
                        selected?.id === item.id
                          ? "feasibility-history-row active"
                          : "feasibility-history-row"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          setInputs(item.inputs);
                          setStage("report");
                        }}
                      >
                        <strong>{item.inputs.topic}</strong>
                        <small className="tabular-nums">
                          {new Date(item.created_at).toLocaleString()}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Delete review for ${item.inputs.topic}`}
                        onClick={() => void remove(item)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        ) : selected && selectedReport ? (
          <div className="feasibility-report">
            <section className="feasibility-summary-card">
              <div className="feasibility-summary-main">
                <span className="feasibility-verdict">
                  {planningCount || clarityCount ? (
                    <AlertCircle size={15} />
                  ) : (
                    <CheckCircle2 size={15} />
                  )}
                  {planningCount || clarityCount
                    ? "Feasible with targeted revisions"
                    : "Plan looks workable"}
                </span>
                <h2>{selected.inputs.topic}</h2>
                <p>{selectedReport.summary}</p>
                <div className="feasibility-summary-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setInputs(selected.inputs);
                      setStage("intake");
                      setStep(0);
                    }}
                  >
                    <Pencil size={14} />
                    Edit plan &amp; re-run
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void copyMarkdown()}
                  >
                    <Copy size={14} />
                    {copied ? "Copied" : "Copy Markdown"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={downloadMarkdown}
                  >
                    <Download size={14} />
                    Export .md
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Delete this review"
                    onClick={() => void remove(selected)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="feasibility-score-box">
                <div className="feasibility-score-num tabular-nums">
                  <strong>{strongCount}</strong>
                  <span>/ {dimensionResults.length}</span>
                </div>
                <small>Dimensions workable</small>
                <div className="feasibility-score-breakdown tabular-nums">
                  <span>{planningCount} need planning</span>
                  <span>{clarityCount} need clarity</span>
                </div>
              </div>
            </section>

            <section>
              <h3 className="feasibility-section-title">
                Dimension breakdown
              </h3>
              <div className="feasibility-dimensions">
                {dimensionResults.map(({ key, label, item }) => {
                  const Icon =
                    key === "scope"
                      ? Triangle
                      : key === "method_fit"
                        ? FlaskConical
                        : key === "access"
                          ? KeyRound
                          : key === "timeline"
                            ? Clock3
                            : key === "resources"
                              ? Users
                              : ShieldCheck;
                  const statusClass =
                    item.status === "Looks workable"
                      ? "strong"
                      : item.status === "Needs planning"
                        ? "planning"
                        : "clarity";
                  return (
                    <article className="feasibility-dimension" key={key}>
                      <div className="feasibility-dim-head">
                        <h4>
                          <Icon size={15} />
                          {label}
                        </h4>
                        <span className={`feasibility-status ${statusClass}`}>
                          {item.status === "Looks workable" ? (
                            <CheckCircle2 size={12} />
                          ) : item.status === "Needs planning" ? (
                            <AlertCircle size={12} />
                          ) : (
                            <HelpCircle size={12} />
                          )}
                          {item.status}
                        </span>
                      </div>
                      <p>{item.assessment}</p>
                      {item.known && (
                        <p className="dim-meta">
                          <strong>Known:</strong> {item.known}
                        </p>
                      )}
                      {item.unknown && (
                        <p className="dim-meta">
                          <strong>Uncertain:</strong> {item.unknown}
                        </p>
                      )}
                      {item.citations.map((citation) => (
                        <button
                          type="button"
                          key={citation.id}
                          className="text-button dim-cite-btn"
                          onClick={() => onCitation(citation)}
                        >
                          {citation.filename} · {citation.locator_type}{" "}
                          {citation.location}
                        </button>
                      ))}
                    </article>
                  );
                })}
              </div>
            </section>

            {!!fixCards.length && (
              <section>
                <h3 className="feasibility-section-title">Priority actions</h3>
                <div className="feasibility-fix-grid">
                  {fixCards.map((fix, index) => (
                    <article
                      className="feasibility-fix-card"
                      key={`${fix.title}-${index}`}
                    >
                      <div className="feasibility-fix-top">
                        <span className="feasibility-fix-number tabular-nums">
                          {index + 1}
                        </span>
                        <span className="feasibility-fix-kind">
                          {fix.kind === "risk"
                            ? "High risk"
                            : fix.kind === "clarity"
                              ? "Clarify"
                              : "Recommended"}
                        </span>
                      </div>
                      <h4>{fix.title}</h4>
                      <p>{fix.detail}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="feasibility-plan-card">
              <div className="feasibility-plan-head">
                <div>
                  <h3 className="feasibility-section-title">
                    Timeline &amp; execution milestones
                  </h3>
                  <p className="muted">
                    Stated timeline:{" "}
                    <strong>
                      {selected.inputs.timeline?.trim() ||
                        "Not yet specified in intake"}
                    </strong>
                  </p>
                </div>
              </div>

              {!!selectedReport.next_steps.length && (
                <ol className="feasibility-milestones">
                  {selectedReport.next_steps.map((stepItem, index) => (
                    <li key={index}>
                      <strong>{stepItem.action}</strong>
                      <p>{stepItem.reason}</p>
                      {(stepItem.citations ?? []).map((citation) => (
                        <button
                          type="button"
                          key={citation.id}
                          className="text-button"
                          onClick={() => onCitation(citation)}
                        >
                          {citation.filename} · {citation.locator_type}{" "}
                          {citation.location}
                        </button>
                      ))}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <div className="feasibility-detail-columns">
              {!!selectedReport.risks.length && (
                <section className="feasibility-detail-panel">
                  <h3>Risks &amp; mitigations</h3>
                  {selectedReport.risks.map((risk, index) => (
                    <article
                      className="feasibility-risk-item"
                      key={`${risk.title}-${index}`}
                    >
                      <h4>{risk.title}</h4>
                      <p>{risk.why_it_matters}</p>
                      <p className="dim-meta">
                        <strong>Mitigation:</strong> {risk.mitigation}
                      </p>
                      {risk.citations.map((citation) => (
                        <button
                          type="button"
                          key={citation.id}
                          className="text-button"
                          onClick={() => onCitation(citation)}
                        >
                          {citation.filename} · {citation.locator_type}{" "}
                          {citation.location}
                        </button>
                      ))}
                    </article>
                  ))}
                </section>
              )}

              {(!!selectedReport.scope_adjustments.length ||
                !!selectedReport.missing_information.length) && (
                <section className="feasibility-detail-panel">
                  {!!selectedReport.scope_adjustments.length && (
                    <>
                      <h3>Scope adjustments</h3>
                      <ul>
                        {selectedReport.scope_adjustments.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {!!selectedReport.missing_information.length && (
                    <>
                      <h3>Still to clarify</h3>
                      <ul>
                        {selectedReport.missing_information.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}
            </div>

            <section className="feasibility-follow-up">
              <h3>Ask a follow-up question</h3>
              <p className="muted">
                Drill into a specific dimension to test alternative designs or
                scope adjustments.
              </p>
              <div className="feasibility-follow-up-row">
                <label>
                  <span>Dimension</span>
                  <select
                    value={followUpDimension}
                    onChange={(event) => setFollowUpDimension(event.target.value)}
                  >
                    {dimensions.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="feasibility-follow-up-q">
                  <span>Question</span>
                  <input
                    maxLength={2000}
                    placeholder="Why is this dimension flagged, and how can I narrow it?"
                    value={followUpQuestion}
                    onChange={(event) => setFollowUpQuestion(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={followUpBusy || !followUpQuestion.trim()}
                  onClick={() => void askFollowUp()}
                >
                  {followUpBusy ? "Thinking…" : "Ask Otto"}
                </button>
              </div>
              {followUpAnswer && (
                <article className="feasibility-follow-up-answer">
                  <strong>Otto:</strong> {followUpAnswer}
                </article>
              )}
            </section>

            {assessments.length > 1 && (
              <section className="feasibility-history">
                <h3>Review history</h3>
                <div className="feasibility-history-list">
                  {assessments.map((item) => (
                    <div
                      key={item.id}
                      className={
                        selected.id === item.id
                          ? "feasibility-history-row active"
                          : "feasibility-history-row"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(item);
                          setInputs(item.inputs);
                        }}
                      >
                        <strong>{item.inputs.topic}</strong>
                        <small className="tabular-nums">
                          {new Date(item.created_at).toLocaleString()}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Delete review for ${item.inputs.topic}`}
                        onClick={() => void remove(item)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
