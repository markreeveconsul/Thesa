"use client";
import { useState } from "react";
import {
  FileText,
  Plus,
  ArrowUp,
  ArrowDown,
  Library,
  ClipboardCheck,
} from "lucide-react";
import type { Project, Section } from "@/lib/workspace";
import { wordCount, type DocumentNode } from "@/lib/document";
import { ResearchProblem } from "./ResearchProblem";

export function ChapterNavigation({
  project,
  sourceCount,
  sections,
  activeId,
  activeView,
  onSelect,
  onAdd,
  onReorder,
  onSources,
  onFeasibility,
  onProjectSaved,
  local,
  busy,
}: {
  project: Project;
  sourceCount: number;
  sections: Section[];
  activeId?: string;
  activeView: "editor" | "feasibility";
  onSelect: (id: string) => void;
  onAdd: (title: string) => void;
  onReorder: (sections: Section[]) => void;
  onSources: () => void;
  onFeasibility: () => void;
  onProjectSaved: (project: Project) => void;
  local: boolean;
  busy: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dragged, setDragged] = useState<string | null>(null);

  const totalWords = sections.reduce(
    (sum, s) => sum + wordCount(s.content as unknown as DocumentNode),
    0,
  );

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || to >= sections.length) return;
    const next = [...sections];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
  }

  return (
    <aside className="left-panel editor-nav" aria-label="Project navigation">
      <div className="nav-body">
        <ResearchProblem project={project} local={local} onSaved={onProjectSaved} />

        <div className="section-label">
          <span>Chapters</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Add chapter"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="chapter-list">
          {sections.map((section, index) => {
            const words = wordCount(section.content as unknown as DocumentNode);
            const isActive = activeView === "editor" && activeId === section.id;
            return (
              <div
                className={"chapter-row" + (isActive ? " active" : "")}
                key={section.id}
                draggable={!busy}
                onDragStart={() => setDragged(section.id)}
                onDragEnd={() => setDragged(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged)
                    move(
                      sections.findIndex((item) => item.id === dragged),
                      index,
                    );
                  setDragged(null);
                }}
              >
                <button
                  type="button"
                  className="chapter-select"
                  disabled={busy}
                  onClick={() => onSelect(section.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="chapter-num">{index + 1}.</span>
                  <span className="chapter-name">{section.title}</span>
                  <span className="chapter-words tabular-nums">
                    {words > 0 ? `${words.toLocaleString()}w` : "0w"}
                  </span>
                </button>
                <div className="chapter-order">
                  <button
                    type="button"
                    aria-label={"Move " + section.title + " up"}
                    disabled={busy || index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    aria-label={"Move " + section.title + " down"}
                    disabled={busy || index === sections.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {adding ? (
          <form
            className="add-chapter-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) {
                onAdd(title.trim());
                setTitle("");
                setAdding(false);
              }
            }}
          >
            <label>
              New chapter title
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={160}
              />
            </label>
            <div className="add-chapter-actions">
              <button className="primary" disabled={busy}>
                Add
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="add-chapter"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <Plus size={14} />
            Add chapter
          </button>
        )}

        <div className="rail-tools">
          <button
            type="button"
            className="rail-tool-link"
            onClick={onSources}
          >
            <Library size={15} />
            <span>Sources</span>
            <span className="rail-count tabular-nums">{sourceCount}</span>
          </button>
          <button
            type="button"
            className={"rail-tool-link" + (activeView === "feasibility" ? " active" : "")}
            onClick={onFeasibility}
          >
            <ClipboardCheck size={15} />
            <span>Feasibility check</span>
          </button>
        </div>
      </div>

      <div className="nav-bottom">
        <span className="private-label tabular-nums">
          <FileText size={13} />
          {project.citation_style.toUpperCase()} · {totalWords.toLocaleString()} words total
        </span>
      </div>
    </aside>
  );
}
