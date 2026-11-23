"use client";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Plus, Trash2, X } from "lucide-react";
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

export function Dashboard({
  local,
  projects,
  autoOpen = false,
}: {
  local: boolean;
  projects: Project[];
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(projects);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [redirecting, setRedirecting] = useState(local && autoOpen);

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
            <p>
              Open a manuscript to write alongside your sources, or start a new
              research project.
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}

        {items.length ? (
          <>
            <div className="dashboard-cards-grid">
              {items.map((project) => {
                const projectSections = sections.filter(
                  (s) => s.project_id === project.id,
                );
                const totalWords = projectSections.reduce(
                  (sum, s) => sum + wordCount(s.content as unknown as DocumentNode),
                  0,
                );
                const isConfirming = confirmDeleteId === project.id;

                return (
                  <article className="thesis-card" key={project.id}>
                    <div className="thesis-card-top">
                      <span className="thesis-card-icon" aria-hidden="true">
                        <BookOpen size={17} />
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

                    <h2>{project.title}</h2>
                    <p className="thesis-card-problem">
                      {project.research_problem ||
                        "No research question added yet."}
                    </p>

                    <div className="thesis-card-meta tabular-nums">
                      {local ? (
                        <span>
                          {totalWords.toLocaleString()} words ·{" "}
                          {projectSections.length} chapters
                        </span>
                      ) : (
                        <span>Cloud project</span>
                      )}
                      <span>{project.citation_style.toUpperCase()}</span>
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
              })}
            </div>

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
                <Otto animate />
                <h2>Room for your next idea.</h2>
                <p>
                  Create your first thesis to open the Split-Studio writing
                  workspace with chapters, grounded source viewer, and Otto.
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
