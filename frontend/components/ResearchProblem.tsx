"use client";
import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import type { Project } from "@/lib/workspace";
import { updateLocalProblem } from "@/lib/local-workspace";
import { updateResearchProblem } from "@/app/editor-actions";

export function ResearchProblem({
  project,
  local,
  onSaved,
}: {
  project: Project;
  local: boolean;
  onSaved: (project: Project) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.research_problem ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (local) {
        onSaved(await updateLocalProblem(project.id, value, project.revision ?? 0));
      } else {
        const result = await updateResearchProblem(
          project.id,
          value,
          project.revision ?? 0,
        );
        if (result.error) throw new Error(result.error);
        if (result.project) onSaved(result.project);
      }
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pinned-question-card" aria-label="Research question">
      <div className="pinned-question-head">
        <span>Research question</span>
        {!editing && (
          <button
            type="button"
            className="icon-button"
            aria-label="Edit research question"
            title="Edit research question"
            onClick={() => {
              setValue(project.research_problem ?? "");
              setError("");
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={(event) => void submit(event)} className="pinned-question-form">
          <textarea
            aria-label="Research question"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="What question guides your thesis?"
          />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="pinned-question-actions">
            <button type="submit" className="primary" disabled={busy}>
              <Check size={13} />
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError("");
              }}
            >
              <X size={13} />
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p className="pinned-question-text">
          {project.research_problem?.trim() || "Add the question that guides your study."}
        </p>
      )}
    </section>
  );
}
