"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { getSourceContent, type SourceInfo } from "@/lib/sources";
import {
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
const fields: { key: keyof FeasibilityInputs; label: string; hint: string; required?: boolean }[] = [
  { key: "topic", label: "Topic or working title", hint: "Describe the study you want to carry out.", required: true },
  { key: "research_problem", label: "Research problem", hint: "What problem or need motivates the study?" },
  { key: "questions_objectives", label: "Research questions or objectives", hint: "What do you want the study to answer or accomplish?" },
  { key: "population_setting", label: "Participants and setting", hint: "Who or what will you study, and where?" },
  { key: "method", label: "Proposed method", hint: "Design, data collection, and analysis you have in mind." },
  { key: "access", label: "Access to data or participants", hint: "Do you have permission or a realistic way to access them?" },
  { key: "timeline", label: "Timeline", hint: "Include deadlines or time available." },
  { key: "resources", label: "Resources and constraints", hint: "Skills, budget, tools, equipment, or other limits." },
  { key: "ethics", label: "Ethics and permissions", hint: "Consent, privacy, ethics review, safety, or site approvals." },
  { key: "constraints", label: "Anything uncertain?", hint: "Add questions or concerns you want Otto to consider." },
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
  const [inputs, setInputs] = useState<FeasibilityInputs>({ ...blank, topic: projectTitle, research_problem: researchProblem ?? "" });
  const [assessments, setAssessments] = useState<FeasibilityAssessment[]>([]);
  const [selected, setSelected] = useState<FeasibilityAssessment>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (local) {
        try {
          const saved = JSON.parse(window.localStorage.getItem(localKey(projectId)) || "[]") as FeasibilityAssessment[];
          if (alive) setAssessments(saved);
        } catch {
          if (alive) setError("Could not read feasibility reviews saved in this browser.");
        }
        return;
      }
      const result = await listFeasibilityAssessments(projectId);
      if (!alive) return;
      setAssessments(result.assessments);
      if (result.error) setError(result.error);
    }
    void load();
    return () => { alive = false; };
  }, [local, projectId]);

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
      return;
    }
    const result = await saveFeasibilityAssessment({ projectId, inputs: input, report });
    if (!result.assessment) throw new Error(result.error || "Could not save the review.");
    const next = [result.assessment, ...assessments].slice(0, 20);
    setAssessments(next);
    setSelected(result.assessment);
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
      if (sources.length > 50) throw new Error("This review supports up to 50 sources per project.");
      let total = 0;
      for (const source of sources) {
        const content = await getSourceContent(projectId, source.id, local);
        if (!content) continue;
        total += content.pages.reduce((count, page) => count + page.text.length, 0);
        if (total > 2_000_000) throw new Error("The source library is too large for one review. Remove some sources and retry.");
        contents.push(content);
      }
      setStatus("Groq is preparing your feasibility review…");
      const report = await runFeasibility(projectId, parsed.data, contents, controller.signal);
      await save(parsed.data, report);
      setStatus("Review saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not complete the feasibility review.");
      setStatus("");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setBusy(false);
    }
  }

  async function remove(assessment: FeasibilityAssessment) {
    setError("");
    if (local) {
      const next = assessments.filter((item) => item.id !== assessment.id);
      window.localStorage.setItem(localKey(projectId), JSON.stringify(next));
      setAssessments(next);
    } else {
      const result = await deleteFeasibilityAssessment(projectId, assessment.id);
      if (result.error) { setError(result.error); return; }
      setAssessments((items) => items.filter((item) => item.id !== assessment.id));
    }
    if (selected?.id === assessment.id) setSelected(undefined);
  }

  return (
    <main className="feasibility-view">
      <header className="feasibility-heading">
        <button className="secondary" onClick={onBack}><ArrowLeft size={16} /> Back to editor</button>
        <span className="eyebrow">PROJECT RESEARCH TOOL</span>
        <h1>Feasibility check</h1>
        <p>Think through what is practical, what is uncertain, and what to resolve next. This is guidance, not an approval decision.</p>
      </header>
      <div className="feasibility-layout">
        <form className="feasibility-form" onSubmit={(event) => void submit(event)}>
          <h2>Tell Otto about your study</h2>
          <p>You can leave details blank or mark them undecided. Otto will identify what still needs clarification.</p>
          {fields.map((field) => (
            <label className="feasibility-field" key={field.key}>
              <span>{field.label}{field.required && <b> · required</b>}</span>
              <small>{field.hint}</small>
              {field.key === "topic" ? (
                <input maxLength={300} required value={inputs[field.key]} onChange={(event) => update(field.key, event.target.value)} />
              ) : (
                <textarea rows={field.key === "research_problem" || field.key === "method" ? 4 : 3} maxLength={field.key === "research_problem" ? 4000 : field.key === "questions_objectives" || field.key === "method" ? 3000 : field.key === "population_setting" || field.key === "access" || field.key === "ethics" || field.key === "constraints" ? 2000 : 1500} placeholder="Not decided yet" value={inputs[field.key]} onChange={(event) => update(field.key, event.target.value)} />
              )}
            </label>
          ))}
          <label className="feasibility-consent">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
            <span>Send these answers and up to 10 relevant source excerpts to Groq to create this review. Thesa stores the review in {local ? "this browser only" : "your private project"}. Avoid entering sensitive personal information.</span>
          </label>
          <button className="primary" disabled={busy || !consent || !inputs.topic.trim()}>{busy ? "Reviewing…" : "Create feasibility review"}</button>
          {busy && <button type="button" className="text-button" onClick={() => activeRequest.current?.abort()}>Cancel review</button>}
          <p role="status" aria-live="polite">{status}</p>
          {error && <p className="feasibility-error" role="alert">{error}</p>}
        </form>
        <section className="feasibility-results" aria-label="Feasibility report">
          {selected ? (
            <>
              <div className="feasibility-report-head">
                <div><span className="eyebrow">SAVED REVIEW · {new Date(selected.created_at).toLocaleString()}</span><h2>Review of {selected.inputs.topic}</h2></div>
                <button className="icon-button" aria-label="Delete this review" onClick={() => void remove(selected)}><Trash2 size={16} /></button>
              </div>
              <p className="feasibility-summary">{selected.report.summary}</p>
              <div className="feasibility-dimensions">
                {dimensions.map(({ key, label }) => {
                  const item = selected.report.dimensions[key];
                  return <article className="feasibility-dimension" key={key}>
                    <div><h3>{label}</h3><span className="feasibility-status">{item.status}</span></div>
                    <p>{item.assessment}</p>
                    {item.known && <p><b>Known:</b> {item.known}</p>}
                    {item.unknown && <p><b>Uncertain:</b> {item.unknown}</p>}
                    {item.citations.map((citation) => <button key={citation.id} className="text-button" onClick={() => onCitation(citation)}>{citation.filename} · {citation.locator_type} {citation.location}</button>)}
                  </article>;
                })}
              </div>
              {!!selected.report.risks.length && <section><h3>Risks to work through</h3>{selected.report.risks.map((risk, index) => <article className="feasibility-risk" key={`${risk.title}-${index}`}><h4>{risk.title}</h4><p>{risk.why_it_matters}</p><p><b>Possible response:</b> {risk.mitigation}</p>{risk.citations.map((citation) => <button key={citation.id} className="text-button" onClick={() => onCitation(citation)}>{citation.filename} · {citation.locator_type} {citation.location}</button>)}</article>)}</section>}
              {!!selected.report.next_steps.length && <section><h3>Suggested next steps</h3><ol>{selected.report.next_steps.map((step, index) => <li key={index}><b>{step.action}</b> {step.reason}</li>)}</ol></section>}
              {!!selected.report.scope_adjustments.length && <section><h3>Possible scope adjustments</h3><ul>{selected.report.scope_adjustments.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
              {!!selected.report.missing_information.length && <section><h3>Still to clarify</h3><ul>{selected.report.missing_information.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
              <button className="secondary" onClick={() => { setInputs(selected.inputs); setSelected(undefined); }}>Revise answers and run again</button>
            </>
          ) : (
            <div className="feasibility-empty"><span className="eyebrow">YOUR REVIEW</span><h2>Make the plan more workable, one question at a time.</h2><p>Otto will look at scope, method fit, access, timeline, resources, and ethics. Uploaded sources are optional.</p></div>
          )}
          {!!assessments.length && <section className="feasibility-history"><h3>Previous reviews</h3>{assessments.map((item) => <div key={item.id} className={selected?.id === item.id ? "feasibility-history-row active" : "feasibility-history-row"}><button onClick={() => { setSelected(item); setInputs(item.inputs); }}>{item.inputs.topic}<small>{new Date(item.created_at).toLocaleString()}</small></button><button className="icon-button" aria-label={`Delete review for ${item.inputs.topic}`} onClick={() => void remove(item)}><Trash2 size={14} /></button></div>)}</section>}
        </section>
      </div>
    </main>
  );
}
