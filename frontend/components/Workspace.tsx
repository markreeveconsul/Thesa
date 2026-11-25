"use client";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { Brand } from "./Brand";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  Command,
  Download,
  FileText,
  Focus,
  LayoutGrid,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { CitationStyle, Project, Section } from "@/lib/workspace";
import { wordCount, type DocumentNode } from "@/lib/document";
import {
  readLocal,
  addLocalChapter,
  reorderLocal,
  updateLocalCitationStyle,
} from "@/lib/local-workspace";
import {
  addChapter,
  reorderChapters,
  updateCitationStyle,
} from "@/app/editor-actions";
import { sectionToMarkdown, thesisToMarkdown } from "@/lib/citations";
import { ChapterEditor, type EditorHandle } from "./editor/ChapterEditor";
import { ChapterNavigation } from "./ChapterNavigation";
import { ThemeButton } from "./ThemeButton";
import { Otto } from "./Otto";
import { listSources, watchSources, type SourceInfo } from "@/lib/sources";
import { FeasibilityWorkspace } from "./FeasibilityWorkspace";
import { SourceStudioDrawer, type StudioTab } from "./SourceStudioDrawer";

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "thesis"
  );
}

export function Workspace({
  local,
  projectId,
  initialProject,
  sections,
}: {
  local: boolean;
  projectId: string;
  initialProject?: Project;
  sections: Section[];
}) {
  const [project, setProject] = useState(initialProject);
  const [chapters, setChapters] = useState(sections);
  const [activeId, setActiveId] = useState(sections[0]?.id);
  const [loading, setLoading] = useState(local);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [focus, setFocus] = useState(false);
  const [left, setLeft] = useState(true);
  const [studioOpen, setStudioOpen] = useState(true);
  const [studioTab, setStudioTab] = useState<StudioTab>("viewer");
  const [view, setView] = useState<"editor" | "feasibility">("editor");
  const [busy, setBusy] = useState(false);
  const [saveLabel, setSaveLabel] = useState(
    local ? "Saved in browser" : "Saved to cloud",
  );
  const [command, setCommand] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceError, setSourceError] = useState("");
  const [sourceId, setSourceId] = useState<string>();
  const [sourceLocation, setSourceLocation] = useState<number>();

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const items = await listSources(projectId, local);
        if (alive) {
          setSources(items);
          setSourceError("");
        }
      } catch (err) {
        if (alive) {
          setSourceError(
            err instanceof Error
              ? err.message
              : "Could not load source storage.",
          );
        }
      }
    }
    void refresh();
    const stop = watchSources(() => void refresh(), local, projectId);
    return () => {
      alive = false;
      stop();
    };
  }, [local, projectId]);

  const handle = useRef<EditorHandle | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const ready = useCallback((value: EditorHandle) => {
    handle.current = value;
  }, []);

  useEffect(() => {
    if (window.innerWidth < 980) {
      setLeft(false);
      setStudioOpen(false);
    }
    if (local) {
      try {
        const data = readLocal();
        setProject(data.projects.find((item) => item.id === projectId));
        const items = data.sections
          .filter((item) => item.project_id === projectId)
          .sort((a, b) => a.position - b.position);
        setChapters(items);
        setActiveId((current) =>
          current && items.some((i) => i.id === current)
            ? current
            : items[0]?.id,
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not read browser drafts.",
        );
      }
      setLoading(false);
    }
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (event.shiftKey) setCommand((value) => !value);
        else {
          setFocus(false);
          setStudioOpen((value) => !value);
        }
      }
      if (event.key === "Escape") {
        setFocus(false);
        setExportOpen(false);
      }
    };
    const clickAway = (event: MouseEvent) => {
      if (
        exportRef.current &&
        !exportRef.current.contains(event.target as Node)
      ) {
        setExportOpen(false);
      }
    };
    const offline = () =>
      setNotice(
        local
          ? "You’re offline. Browser drafts can still save on this device."
          : "You’re offline. Keep this tab open until your draft saves, or download a backup.",
      );
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", clickAway);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", clickAway);
      window.removeEventListener("offline", offline);
    };
  }, [local, projectId]);

  const active = chapters.find((item) => item.id === activeId);
  const activeIndex = chapters.findIndex((item) => item.id === activeId);

  async function flush() {
    const ok = await (handle.current?.flush() ?? Promise.resolve(true));
    if (!ok) {
      setNotice(
        "Your chapter has unsaved changes. Resolve the save issue or download a backup before leaving.",
      );
    }
    return ok;
  }

  async function select(id: string) {
    setBusy(true);
    try {
      if (await flush()) {
        setActiveId(id);
        setView("editor");
        handle.current = null;
      }
    } finally {
      setBusy(false);
    }
  }

  async function add(title: string) {
    if (!project) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const result = local
        ? { section: await addLocalChapter(project.id, title) }
        : await addChapter(project.id, title);
      if (result.error) throw new Error(result.error);
      if (result.section) {
        setChapters((items) => [...items, result.section!]);
        setActiveId(result.section.id);
        setView("editor");
        handle.current = null;
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not add chapter.");
    } finally {
      setBusy(false);
    }
  }

  const latestSaved = useRef<Section | null>(null);
  const [editorGeneration, setEditorGeneration] = useState(0);

  async function reorder(ordered: Section[]) {
    if (!project) return;
    setBusy(true);
    try {
      if (!(await flush())) return;
      const snapshot = local
        ? ordered.map(
            (item) =>
              readLocal().sections.find((latest) => latest.id === item.id) ??
              item,
          )
        : ordered.map((item) =>
            item.id === latestSaved.current?.id ? latestSaved.current : item,
          );
      if (local) setChapters(await reorderLocal(project.id, snapshot));
      else {
        const result = await reorderChapters(
          project.id,
          snapshot.map((item) => ({ id: item.id, revision: item.revision })),
        );
        if (result.error) throw new Error(result.error);
        setChapters(
          snapshot.map((item, position) => ({
            ...item,
            position,
            revision: item.revision + 1,
          })),
        );
      }
      setEditorGeneration((value) => value + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not reorder chapters.");
    } finally {
      setBusy(false);
    }
  }

  const saved = useCallback((section: Section) => {
    latestSaved.current = section;
    setChapters((items) =>
      items.map((item) => (item.id === section.id ? section : item)),
    );
  }, []);

  async function changeCitationStyle(nextStyle: CitationStyle) {
    if (!project || project.citation_style === nextStyle) return;
    const prevProject = project;
    setProject({ ...project, citation_style: nextStyle });
    try {
      if (local) {
        const updated = await updateLocalCitationStyle(project.id, nextStyle);
        setProject(updated);
      } else {
        const result = await updateCitationStyle(
          project.id,
          nextStyle,
          project.revision ?? 0,
        );
        if (result.error) {
          setProject(prevProject);
          setNotice(result.error);
          return;
        }
        if (result.project) setProject(result.project);
      }
    } catch (e) {
      setProject(prevProject);
      setNotice(
        e instanceof Error ? e.message : "Could not update citation style.",
      );
    }
  }

  const showFeasibility = async () => {
    if (await flush()) {
      setFocus(false);
      setView("feasibility");
    }
  };

  function handleInsertCitation(citationText: string) {
    if (view !== "editor") setView("editor");
    if (!handle.current) {
      setNotice("Open a chapter first to insert a citation at your cursor.");
      return;
    }
    handle.current.insertCitation(citationText);
    setNotice(`Inserted ${citationText}`);
  }

  function exportFullThesisMarkdown() {
    if (!project) return;
    const md = thesisToMarkdown(
      project.title,
      project.research_problem,
      chapters,
    );
    downloadTextFile(
      `${slugify(project.title)}.md`,
      md,
      "text/markdown;charset=utf-8",
    );
    setExportOpen(false);
  }

  function exportActiveChapterMarkdown() {
    if (!active) return;
    const md = sectionToMarkdown(active);
    downloadTextFile(
      `${slugify(active.title)}.md`,
      md,
      "text/markdown;charset=utf-8",
    );
    setExportOpen(false);
  }

  const libraryHref = local ? "/?library=1" : "/";

  const commands = [
    {
      label: "All screens (System map)",
      run: () => setViewsOpen(true),
    },
    {
      label: "All theses (Thesis Library)",
      run: async () => {
        if (await flush()) router.push(libraryHref);
      },
    },
    {
      label: "Login & Account setup screen",
      run: async () => {
        if (await flush()) router.push("/auth");
      },
    },
    {
      label: studioOpen ? "Hide Research Studio" : "Show Research Studio",
      run: () => {
        setView("editor");
        setFocus(false);
        setStudioOpen((v) => !v);
      },
    },
    {
      label: "Open Source Viewer",
      run: () => {
        setView("editor");
        setFocus(false);
        setStudioOpen(true);
        setStudioTab("viewer");
      },
    },
    {
      label: "Ask Otto about sources",
      run: () => {
        setView("editor");
        setFocus(false);
        setStudioOpen(true);
        setStudioTab("otto");
      },
    },
    {
      label: "Manage Sources",
      run: () => {
        setView("editor");
        setFocus(false);
        setStudioOpen(true);
        setStudioTab("sources");
      },
    },
    { label: "Run Feasibility check", run: showFeasibility },
    {
      label: focus ? "Leave focus mode" : "Enter focus mode",
      run: () => {
        setView("editor");
        setFocus((value) => !value);
      },
    },
    { label: "Add chapter", run: () => add("Untitled chapter") },
    { label: "Export full thesis (.md)", run: exportFullThesisMarkdown },
    {
      label: "Download chapter backup (.json)",
      run: () => handle.current?.download(),
    },
  ].filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

  if (loading) {
    return (
      <main className="center-state">
        <h1>Opening your thesis…</h1>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="center-state">
        <h1>Thesis unavailable.</h1>
        <p>
          {error ||
            "This project does not exist in this browser. Cloud projects need a signed-in account."}
        </p>
        <Link href={libraryHref} className="primary">
          Back to your theses
        </Link>
      </main>
    );
  }

  return (
    <div
      className={"workspace wireframe-workspace" + (focus ? " is-focused" : "")}
    >
      <a className="skip-link" href="#writing-surface">
        Skip to document
      </a>

      <header className="topbar">
        <div className="topbar-left">
          <Link
            href={libraryHref}
            className="wordmark"
            title="View all theses"
            onClick={async (event) => {
              event.preventDefault();
              if (await flush()) router.push(libraryHref);
            }}
          >
            <Brand />
          </Link>
          <span className="top-divider" />
          <span className="workspace-title">{project.title}</span>
        </div>

        <div className="top-actions">
          {view !== "editor" ? (
            <>
              <ThemeButton />
              <button
                type="button"
                className="secondary topbar-btn"
                onClick={() => setView("editor")}
              >
                <ArrowLeft size={15} />
                Back to editor
              </button>
            </>
          ) : (
            <>
              <details className="save-details">
                <summary className="save-indicator">{saveLabel}</summary>
                <div>
                  <p>
                    {local
                      ? "Browser draft · saved locally on this device."
                      : "Your private cloud workspace."}
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => handle.current?.download()}
                    disabled={!active}
                  >
                    <Download size={12} /> Download chapter backup (.json)
                  </button>
                </div>
              </details>

              <label className="topbar-citation-wrap">
                <span className="sr-only">Citation style</span>
                <select
                  aria-label="Citation style"
                  className="topbar-citation-select"
                  value={project.citation_style}
                  onChange={(event) =>
                    void changeCitationStyle(
                      event.target.value as CitationStyle,
                    )
                  }
                >
                  <option value="apa">APA</option>
                  <option value="mla">MLA</option>
                  <option value="ieee">IEEE</option>
                </select>
              </label>

              <button
                type="button"
                className="icon-button"
                aria-label="Browse all screens"
                title="All screens in system"
                onClick={() => setViewsOpen(true)}
              >
                <LayoutGrid size={16} />
              </button>

              <button
                type="button"
                className="icon-button"
                aria-label="Open command palette"
                title="Commands (Ctrl/⌘ Shift K)"
                onClick={() => setCommand(true)}
              >
                <Command size={16} />
              </button>

              <ThemeButton />

              <button
                type="button"
                className="quiet-button topbar-btn"
                aria-pressed={focus}
                onClick={() => setFocus((value) => !value)}
              >
                <Focus size={15} />
                <span>{focus ? "Exit focus" : "Focus"}</span>
              </button>

              <button
                type="button"
                className={
                  "quiet-button topbar-btn" +
                  (studioOpen && !focus ? " is-active" : "")
                }
                aria-pressed={studioOpen && !focus}
                onClick={() => {
                  setFocus(false);
                  setStudioOpen((value) => !value);
                }}
              >
                <PanelRight size={15} />
                <span>{studioOpen && !focus ? "Hide studio" : "Studio"}</span>
              </button>

              <div className="export-wrap" ref={exportRef}>
                <button
                  type="button"
                  className="primary topbar-btn export-button"
                  aria-expanded={exportOpen}
                  aria-haspopup="menu"
                  onClick={() => setExportOpen((v) => !v)}
                >
                  <Download size={14} />
                  <span>Export</span>
                  <ChevronDown size={13} />
                </button>
                {exportOpen && (
                  <div className="export-popover" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={exportFullThesisMarkdown}
                    >
                      <FileText size={14} />
                      Download full thesis (.md)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!active}
                      onClick={exportActiveChapterMarkdown}
                    >
                      <FileText size={14} />
                      Download active chapter (.md)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!active}
                      onClick={() => {
                        handle.current?.download();
                        setExportOpen(false);
                      }}
                    >
                      <Download size={14} />
                      Download chapter backup (.json)
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {view === "feasibility" ? (
        <FeasibilityWorkspace
          projectId={projectId}
          projectTitle={project.title}
          researchProblem={project.research_problem ?? ""}
          sources={sources}
          local={local}
          onBack={() => setView("editor")}
          onCitation={async (citation) => {
            if (await flush()) {
              setSourceId(citation.source_id);
              setSourceLocation(citation.location);
              setView("editor");
              setStudioOpen(true);
              setStudioTab("viewer");
            }
          }}
        />
      ) : (
        <div
          className="workspace-grid"
          style={
            {
              "--left-width": left && !focus ? "268px" : "0px",
              "--right-width": studioOpen && !focus ? "396px" : "0px",
            } as CSSProperties
          }
        >
          {left && !focus && (
            <ChapterNavigation
              project={project}
              sourceCount={sources.length}
              sections={chapters}
              activeId={activeId}
              activeView={view}
              onSelect={(id) => void select(id)}
              onAdd={(title) => void add(title)}
              onReorder={(items) => void reorder(items)}
              onSources={() => {
                setFocus(false);
                setStudioOpen(true);
                setStudioTab("sources");
              }}
              onFeasibility={() => void showFeasibility()}
              onProjectSaved={setProject}
              local={local}
              busy={busy}
            />
          )}

          <main className="writing-pane" id="writing-surface" tabIndex={-1}>
            {!focus && (
              <button
                type="button"
                className="icon-button rail-toggle-float"
                aria-label={left ? "Hide outline sidebar" : "Show outline sidebar"}
                title={left ? "Hide outline sidebar" : "Show outline sidebar"}
                onClick={() => setLeft((value) => !value)}
              >
                <PanelLeft size={16} />
              </button>
            )}

            {active ? (
              <ChapterEditor
                key={active.id + ":" + editorGeneration}
                section={active}
                chapterIndex={Math.max(0, activeIndex)}
                chapterTotal={chapters.length}
                otherChaptersWords={chapters
                  .filter((item) => item.id !== active.id)
                  .reduce(
                    (sum, item) =>
                      sum + wordCount(item.content as unknown as DocumentNode),
                    0,
                  )}
                local={local}
                onSaved={saved}
                onReady={ready}
                onStatus={setSaveLabel}
                onCite={() => {
                  setFocus(false);
                  setStudioOpen(true);
                  setStudioTab(sources.length ? "viewer" : "sources");
                }}
              />
            ) : (
              <div className="empty-editor">
                <Otto pose="welcome" />
                <h1>Start your first chapter</h1>
                <p>Pick a way to begin. You can change your mind anytime.</p>
                <div className="start-options">
                  <button
                    type="button"
                    onClick={() => void add("Introduction")}
                  >
                    <Plus size={20} />
                    <strong>Create an outline</strong>
                    <span>
                      Add chapters around your main ideas. You stay the author.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStudioOpen(true);
                      setStudioTab("sources");
                    }}
                  >
                    <Upload size={20} />
                    <strong>Upload sources first</strong>
                    <span>
                      Add PDF, DOCX, or TXT literature to cite alongside your
                      manuscript.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void add("Untitled chapter")}
                  >
                    <ArrowLeft size={20} />
                    <strong>Write from scratch</strong>
                    <span>Open a blank chapter and start writing.</span>
                  </button>
                </div>
              </div>
            )}
          </main>

          {!focus && studioOpen && (
            <SourceStudioDrawer
              open={studioOpen}
              tab={studioTab}
              onTabChange={setStudioTab}
              onClose={() => setStudioOpen(false)}
              projectId={projectId}
              citationStyle={project.citation_style}
              local={local}
              sources={sources}
              storageError={sourceError}
              selectedSourceId={sourceId}
              selectedLocation={sourceLocation}
              onSelectSource={(id, loc) => {
                setSourceId(id);
                setSourceLocation(loc);
              }}
              onInsertCitation={handleInsertCitation}
              onFeasibility={() => void showFeasibility()}
            />
          )}
        </div>
      )}

      <nav className="mobile-nav" aria-label="Mobile workspace">
        <button
          type="button"
          className={left && !focus ? "active" : ""}
          onClick={() => {
            setView("editor");
            setFocus(false);
            setLeft((value) => !value);
            setStudioOpen(false);
          }}
        >
          Chapters
        </button>
        <button
          type="button"
          className={!left && !studioOpen ? "active" : ""}
          onClick={() => {
            setView("editor");
            setLeft(false);
            setStudioOpen(false);
          }}
        >
          Document
        </button>
        <button
          type="button"
          className={studioOpen && !focus ? "active" : ""}
          onClick={() => {
            setView("editor");
            setFocus(false);
            setStudioOpen((value) => !value);
            setLeft(false);
          }}
        >
          Studio
        </button>
      </nav>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <Dialog.Root
        open={command}
        onOpenChange={(value) => {
          setCommand(value);
          setQuery("");
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content command-dialog">
            <Dialog.Title className="sr-only">Command palette</Dialog.Title>
            <Dialog.Description className="sr-only">
              Search writing and navigation actions.
            </Dialog.Description>
            <div className="command-search">
              <Search size={18} />
              <input
                aria-label="Search commands"
                placeholder="Find a workspace action…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Dialog.Close className="icon-button" aria-label="Close commands">
                <X size={17} />
              </Dialog.Close>
            </div>
            <div className="command-results">
              {commands.map((item) => (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => {
                    setCommand(false);
                    setQuery("");
                    void item.run();
                  }}
                >
                  {item.label}
                </button>
              ))}
              {!commands.length && <p>No matching commands.</p>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={viewsOpen} onOpenChange={setViewsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content views-dialog">
            <Dialog.Close className="icon-button dialog-close" aria-label="Close">
              <X size={17} />
            </Dialog.Close>
            <span className="eyebrow">SYSTEM MAP</span>
            <h2>Explore all screens</h2>
            <p>
              Jump directly to any workspace mode, studio panel, or system page.
            </p>
            <div className="views-dialog-grid">
              <button
                type="button"
                onClick={() => {
                  setView("editor");
                  setFocus(false);
                  setLeft(true);
                  setStudioOpen(true);
                  setStudioTab("viewer");
                  setViewsOpen(false);
                }}
              >
                <strong>Editor + Source Viewer</strong>
                <span>Chapter outline, live manuscript, and side-by-side source reader.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("editor");
                  setFocus(false);
                  setStudioOpen(true);
                  setStudioTab("otto");
                  setViewsOpen(false);
                }}
              >
                <strong>Otto Source-Grounded Q&amp;A</strong>
                <span>Ask questions across uploaded sources and insert citations.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("editor");
                  setFocus(false);
                  setStudioOpen(true);
                  setStudioTab("sources");
                  setViewsOpen(false);
                }}
              >
                <strong>Source Library &amp; Uploader</strong>
                <span>Upload PDF, DOCX, or TXT files and manage project literature.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewsOpen(false);
                  void showFeasibility();
                }}
              >
                <strong>Feasibility Check Studio</strong>
                <span>3-step guided study intake and 6-dimension diagnostic report.</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setView("editor");
                  setFocus(true);
                  setViewsOpen(false);
                }}
              >
                <strong>Focus Writing Mode</strong>
                <span>Distraction-free full-canvas manuscript view.</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  setViewsOpen(false);
                  if (await flush()) router.push(libraryHref);
                }}
              >
                <strong>Thesis Library Dashboard</strong>
                <span>View all theses, word counts, or start a new thesis.</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  setViewsOpen(false);
                  if (await flush()) router.push("/auth");
                }}
              >
                <strong>Login &amp; Account Setup</strong>
                <span>Sign-in, sign-up, and recovery screen preview.</span>
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
