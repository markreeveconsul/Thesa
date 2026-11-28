"use client";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, Plus, Trash2, X } from "lucide-react";
import { Brand } from "./Brand";
import { Otto } from "./Otto";
import { ProjectForm } from "./ProjectForm";
import { ThemeButton } from "./ThemeButton";
import { signOut } from "@/app/auth/actions";
import { wordCount, type DocumentNode } from "@/lib/document";
import {
  deleteLocalProject,
  ensureStarterWorkspace,
  readLocal,
} from "@/lib/local-workspace";
import type { Project, Section } from "@/lib/workspace";

type StructureFilter = "all" | "five-chapter" | "blank";
type SortMode = "recent" | "words" | "title";
type DashboardSection = Pick<Section, "project_id" | "content">;

function ThesisProgressRing({
  percentage,
  complete,
}: {
  percentage: number;
  complete: boolean;
}) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={"thesis-progress-ring" + (complete ? " is-complete" : "")}
      aria-label={`${clamped}% chapters drafted`}
    >
      <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
        <circle
          className="thesis-ring-track"
          cx="21"
          cy="21"
          r={radius}
          fill="none"
          strokeWidth="3"
        />
        <circle
          className="thesis-ring-fill"
          cx="21"
          cy="21"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="thesis-ring-label tabular-nums">{clamped}%</span>
    </div>
  );
}

export function Dashboard({
  local,
  projects,
  initialSections = [],
  autoOpen = false,
}: {
  local: boolean;
  projects: Project[];
  initialSections?: DashboardSection[];
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(projects);
  const [sections, setSections] = useState<DashboardSection[]>(initialSections);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [redirecting, setRedirecting] = useState(local && autoOpen);
  const [filter, setFilter] = useState<StructureFilter>("all");
  const [sortBy, setSortBy] = useState<SortMode>("recent");

  useEffect(() => {
    if (!local) return;

    let cancelled = false;
    async function initLocal() {
      if (autoOpen) {
        try {
          const starter = await ensureStarterWorkspace();
          if (!cancelled) {
            router.replace("/project/" + starter.project.id);
            return;
          }
        } catch (e) {
          if (!cancelled) {
            setRedirecting(false);
            setError(
              e instanceof Error
                ? e.message
                : "Could not open starter workspace.",
            );
          }
        }
      }
      try {
        const data = readLocal();
        if (!cancelled) {
          setItems(data.projects);
          setSections(data.sections);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Could not read browser drafts.",
          );
        }
      }
    }

    void initLocal();

    const refresh = () => {
      try {
        const data = readLocal();
        setItems(data.projects);
        setSections(data.sections);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not read browser drafts.",
        );
      }
    };
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", refresh);
    };
  }, [local, autoOpen, router]);

  if (redirecting) {
    return (
      <main className="center-state">
        <h1>Opening your writing workspace…</h1>
        <p className="muted">Loading chapters, research question, and sources.</p>
      </main>
    );
  }

  function handleDeleteLocal(id: string) {
    deleteLocalProject(id);
    const data = readLocal();
    setItems(data.projects);
    setSections(data.sections);
    setConfirmDeleteId(undefined);
  }

  const enriched = items.map((project, originalIndex) => {
    const projectSections = sections.filter((s) => s.project_id === project.id);
    const totalWords = projectSections.reduce(
      (sum, s) => sum + wordCount(s.content as unknown as DocumentNode),
      0,
    );
    const draftedChapters = projectSections.filter(
      (s) => wordCount(s.content as unknown as DocumentNode) > 25,
    ).length;
    const totalChapters = projectSections.length;
    const completionPct = totalChapters
      ? Math.round((draftedChapters / totalChapters) * 100)
      : 0;
    const inferredStructure: "five-chapter" | "blank" =
      project.structure ?? (totalChapters >= 5 ? "five-chapter" : "blank");

    return {
      project,
      originalIndex,
      totalWords,
      draftedChapters,
      totalChapters,
      completionPct,
      inferredStructure,
    };
  });

  const libraryTotalWords = enriched.reduce(
    (sum, item) => sum + item.totalWords,
    0,
  );

  const visibleItems = enriched
    .filter((entry) =>
      filter === "all" ? true : entry.inferredStructure === filter,
    )
    .sort((a, b) => {
      if (sortBy === "words") {
        return b.totalWords - a.totalWords;
      }
      if (sortBy === "title") {
        return a.project.title.localeCompare(b.project.title);
      }
      const dateA = a.project.updated_at
        ? Date.parse(a.project.updated_at)
        : 0;
      const dateB = b.project.updated_at
        ? Date.parse(b.project.updated_at)
        : 0;
      if (dateA && dateB && dateA !== dateB) return dateB - dateA;
      return a.originalIndex - b.originalIndex;
    });

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="topbar-left">
          <Link href={local ? "/?library=1" : "/"} className="wordmark">
            <Brand />
          </Link>
          <span className="top-divider" />
          <span className="workspace-title">
            {local ? "Browser draft library" : "Cloud thesis library"}
          </span>
        </div>
        <div className="top-actions">
          <ThemeButton />
          {local ? (
            <Link href="/auth" className="secondary topbar-btn">
              Account setup
            </Link>
          ) : (
            <form action={signOut}>
              <button className="secondary topbar-btn">Log out</button>
            </form>
          )}
          {items.length > 0 && (
            <button
              type="button"
              className="primary topbar-btn"
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={15} />
              New thesis
            </button>
          )}
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-header-row">
          <div className="dashboard-title">
            <span className="eyebrow">THESIS LIBRARY</span>
            <h1>Your theses</h1>
            <p className="tabular-nums">
              {items.length > 0
                ? `${items.length} ${items.length === 1 ? "manuscript" : "manuscripts"}${
                    ` · ${libraryTotalWords.toLocaleString()} words total`
                  }`
                : "Open a manuscript to write alongside your sources, or start a new research project."}
            </p>
          </div>

          {items.length > 0 && (
            <div className="dashboard-controls">
              <div
                className="dashboard-filter-tabs"
                role="tablist"
                aria-label="Filter by thesis structure"
              >
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "five-chapter", label: "Five-chapter" },
                    { id: "blank", label: "Blank" },
                  ] as const
                ).map((tabItem) => (
                  <button
                    key={tabItem.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === tabItem.id}
                    className={filter === tabItem.id ? "active" : ""}
                    onClick={() => setFilter(tabItem.id)}
                  >
                    {tabItem.label}
                  </button>
                ))}
              </div>
              <label className="dashboard-sort-wrap">
                <span className="sr-only">Sort theses</span>
                <select
                  aria-label="Sort theses"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortMode)}
                >
                  <option value="recent">Recently updated</option>
                  <option value="words">Most words</option>
                  <option value="title">Title A–Z</option>
                </select>
              </label>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}

        {items.length ? (
          <>
            {visibleItems.length ? (
              <div className="dashboard-cards-grid">
                {visibleItems.map(
                  (
                    {
                      project,
                      totalWords,
                      draftedChapters,
                      totalChapters,
                      completionPct,
                    },
                    idx,
                  ) => {
                    const isConfirming = confirmDeleteId === project.id;

                    return (
                      <article
                        className="thesis-card"
                        key={project.id}
                        style={{ "--stagger": idx } as CSSProperties}
                      >
                        <div className="thesis-card-top">
                          <ThesisProgressRing
                            percentage={completionPct}
                            complete={
                              totalChapters > 0 &&
                              draftedChapters === totalChapters
                            }
                          />

                          <div className="thesis-card-badges">
                            <span className="thesis-card-style">
                              {project.citation_style.toUpperCase()}
                            </span>
                            {local && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`Delete ${project.title}`}
                                onClick={() =>
                                  setConfirmDeleteId(
                                    isConfirming ? undefined : project.id,
                                  )
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>

                        <h2>{project.title}</h2>
                        <p className="thesis-card-problem">
                          {project.research_problem ||
                            "No research question added yet."}
                        </p>

                        <div className="thesis-card-meta tabular-nums">
                          <span>
                            {draftedChapters}/{totalChapters} chapters drafted ·{" "}
                            {totalWords.toLocaleString()} words
                          </span>
                        </div>

                        {isConfirming ? (
                          <div className="thesis-card-confirm">
                            <span>Remove from this browser?</span>
                            <div>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setConfirmDeleteId(undefined)}
                              >
                                Keep
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => handleDeleteLocal(project.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <Link
                            className="secondary thesis-card-open"
                            href={"/project/" + project.id}
                          >
                            Open workspace
                            <ArrowRight size={14} />
                          </Link>
                        )}
                      </article>
                    );
                  },
                )}
              </div>
            ) : (
              <div className="dashboard-filter-empty">
                <p>No theses match the selected structure filter.</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setFilter("all")}
                >
                  Show all theses
                </button>
              </div>
            )}

            {local && (
              <aside className="local-notice">
                <strong>Browser draft storage:</strong> Projects are saved in
                this browser on this device. Use Export in the workspace to back
                up Markdown or JSON copies, or visit{" "}
                <Link href="/auth" className="text-button">
                  Account setup
                </Link>{" "}
                for cloud sync.
              </aside>
            )}
          </>
        ) : (
          <div className="dashboard-grid">
            <ProjectForm local={local} />
            <section className="recent-projects" aria-label="Getting started">
              <div className="dashboard-empty">
                <Otto pose="welcome" size="lg" animate />
                <h2>Room for your next idea.</h2>
                <p>
                  Create your first thesis to open the writing workspace with
                  chapters, grounded source viewer, and Otto.
                </p>
                {local && (
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 16 }}
                    onClick={async () => {
                      const starter = await ensureStarterWorkspace();
                      router.push("/project/" + starter.project.id);
                    }}
                  >
                    Open starter sample thesis
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content new-thesis-dialog">
            <Dialog.Title className="sr-only">Create new thesis</Dialog.Title>
            <Dialog.Description className="sr-only">
              Set up a new thesis title, research problem, and citation style.
            </Dialog.Description>
            <Dialog.Close className="icon-button dialog-close" aria-label="Close">
              <X size={17} />
            </Dialog.Close>
            <ProjectForm local={local} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
