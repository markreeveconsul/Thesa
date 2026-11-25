"use client";
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import type { Section } from "@/lib/workspace";
import { type DocumentNode, validateDocument, wordCount } from "@/lib/document";
import { SafeImage, Footnote } from "./extensions";
import { EditorTools } from "./EditorTools";
import { useChapterSave } from "./useChapterSave";

export type EditorHandle = {
  flush: () => Promise<boolean>;
  download: () => void;
  insertCitation: (citationText: string) => void;
};

const GOAL_STORAGE_KEY = "thesa-session-word-goal-v1";
const sessionBaselineKey = (projectId: string) =>
  `thesa-session-baseline-${projectId}`;

export function ChapterEditor({
  section,
  chapterIndex,
  chapterTotal,
  otherChaptersWords = 0,
  local,
  onSaved,
  onReady,
  onStatus,
  onCite,
}: {
  section: Section;
  chapterIndex: number;
  chapterTotal: number;
  otherChaptersWords?: number;
  local: boolean;
  onSaved: (section: Section) => void;
  onReady: (handle: EditorHandle) => void;
  onStatus: (label: string) => void;
  onCite: () => void;
}) {
  const [title, setTitle] = useState(section.title);
  const titleRef = useRef(section.title);
  const [outline, setOutline] = useState<
    { text: string; pos: number; level: number }[]
  >([]);
  const [wordGoal, setWordGoal] = useState<number>(() => {
    if (typeof window === "undefined") return 500;
    const raw = Number(window.localStorage.getItem(GOAL_STORAGE_KEY));
    return Number.isFinite(raw) && raw >= 50 && raw <= 20000 ? raw : 500;
  });
  const [goalOpen, setGoalOpen] = useState(false);
  const [sessionBaseline, setSessionBaseline] = useState<number | null>(null);
  const [citationFlash, setCitationFlash] = useState(false);
  const flashTimerRef = useRef<number | null>(null);
  const goalWrapRef = useRef<HTMLDivElement>(null);
  const save = useChapterSave(section, local, onSaved);
  const onChange = useRef(save.change);
  onChange.current = save.change;

  useEffect(
    () => () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: { openOnClick: false, autolink: false },
      }),
      TableKit.configure({ table: { resizable: true } }),
      SafeImage,
      Footnote,
      Placeholder.configure({
        placeholder:
          "Start writing, paste your literature review, or type / for a writing tool…",
      }),
    ],
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    content: section.content,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Chapter content",
        "aria-multiline": "true",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor }) => {
      onChange.current(editor.getJSON() as DocumentNode, titleRef.current);
    },
    onTransaction: ({ editor }) => {
      const headings: { text: string; pos: number; level: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading")
          headings.push({
            text: node.textContent,
            pos,
            level: node.attrs.level,
          });
      });
      setOutline(headings);
    },
  });

  const [slash, setSlash] = useState(false);

  useEffect(() => {
    onReady({
      flush: save.flush,
      download: () => save.downloadDraft(),
      insertCitation: (citationText: string) => {
        if (!editor) return;
        editor.chain().focus().insertContent(` ${citationText}`).run();
        setCitationFlash(true);
        if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          setCitationFlash(false);
        }, 1600);
      },
    });
  }, [onReady, save.flush, save.downloadDraft, editor]);

  const label =
    save.status === "saved"
      ? local
        ? "Saved in browser"
        : "Saved to cloud"
      : save.status === "saving"
        ? "Saving…"
        : save.status === "dirty"
          ? "Unsaved changes"
          : save.status === "conflict"
            ? "Save conflict"
            : "Not saved";

  useEffect(() => onStatus(label), [label, onStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = sessionBaselineKey(section.project_id);
    const existing = window.sessionStorage.getItem(key);
    const initialTotal =
      otherChaptersWords + wordCount(section.content as DocumentNode);
    if (existing !== null && Number.isFinite(Number(existing))) {
      setSessionBaseline(Number(existing));
    } else {
      window.sessionStorage.setItem(key, String(initialTotal));
      setSessionBaseline(initialTotal);
    }
  }, [section.project_id]); // anchor once per project session

  useEffect(() => {
    if (!goalOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (
        goalWrapRef.current &&
        !goalWrapRef.current.contains(event.target as Node)
      ) {
        setGoalOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [goalOpen]);

  if (!editor)
    return (
      <div className="center-state editor-loading">Opening your chapter…</div>
    );

  const json = editor.getJSON() as DocumentNode;
  const footnotes: { id: string; text: string }[] = [];
  function collect(node: DocumentNode) {
    if (node.type === "footnote")
      footnotes.push({
        id: String(node.attrs?.id),
        text: String(node.attrs?.text),
      });
    node.content?.forEach(collect);
  }
  collect(json);

  return (
    <div className="chapter-editor">
      <EditorTools editor={editor} onCite={onCite} />
      {save.recovery && (
        <div className="recovery-notice" role="status">
          <p>
            An unsaved draft was recovered from this tab.
            {save.recovery.revision !== section.revision
              ? " A newer saved version exists; download the recovered draft to compare."
              : ""}
          </p>
          <button
            className="secondary"
            disabled={save.recovery.revision !== section.revision}
            onClick={() => {
              const draft = save.recovery;
              if (draft && validateDocument(draft.content)) {
                titleRef.current = draft.title;
                setTitle(draft.title);
                editor.commands.setContent(draft.content, { emitUpdate: true });
                save.hideRecovery();
              }
            }}
          >
            Restore draft
          </button>
          <button
            className="secondary"
            onClick={() => save.downloadDraft(save.recovery!)}
          >
            Download recovered draft
          </button>
          <button className="text-button" onClick={save.clearRecovery}>
            Dismiss recovery
          </button>
        </div>
      )}
      {save.error && (
        <div className="save-error" role="alert">
          <p>{save.error}</p>
          <button className="secondary" onClick={() => void save.retry()}>
            Retry save
          </button>
          <button className="secondary" onClick={() => save.downloadDraft()}>
            Download my draft
          </button>
        </div>
      )}
      <div
        className="paper-scroller"
        tabIndex={0}
        role="region"
        aria-label="Writing surface"
      >
        <article
          className={
            "document-paper live-paper is-chapter-enter" +
            (citationFlash ? " is-citation-flash" : "")
          }
        >
          <div className="paper-chapter-kicker">
            Chapter {chapterIndex + 1} of {chapterTotal}
          </div>
          <label className="sr-only" htmlFor="chapter-title">
            Chapter title
          </label>
          <input
            id="chapter-title"
            className="chapter-title-input"
            value={title}
            maxLength={160}
            onChange={(event) => {
              setTitle(event.target.value);
              if (event.target.value.trim()) {
                titleRef.current = event.target.value.trim();
                save.change(json, event.target.value.trim());
              }
            }}
            onBlur={() => {
              if (!title.trim()) setTitle(titleRef.current);
            }}
          />
          {outline.length > 0 && (
            <details className="section-outline">
              <summary>In this chapter · {outline.length} sections</summary>
              {outline.map((item) => (
                <button
                  key={item.pos}
                  style={{ paddingLeft: (item.level - 1) * 12 }}
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .setTextSelection(item.pos + 1)
                      .scrollIntoView()
                      .run()
                  }
                >
                  {item.text || "Untitled section"}
                </button>
              ))}
            </details>
          )}
          <div
            onKeyUp={(event) => {
              if (event.key === "/") setSlash(true);
              if (event.key === "Escape") setSlash(false);
            }}
          >
            <EditorContent editor={editor} />
          </div>
          {slash && (
            <div className="slash-menu" aria-label="Writing tools">
              <span>Insert block</span>
              {[
                {
                  label: "Heading",
                  run: () =>
                    editor.chain().focus().toggleHeading({ level: 2 }).run(),
                },
                {
                  label: "Bullet list",
                  run: () => editor.chain().focus().toggleBulletList().run(),
                },
                {
                  label: "Quote",
                  run: () => editor.chain().focus().toggleBlockquote().run(),
                },
                {
                  label: "Table",
                  run: () =>
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                      .run(),
                },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    const pos = editor.state.selection.from;
                    if (
                      editor.state.doc.textBetween(
                        Math.max(0, pos - 1),
                        pos,
                      ) === "/"
                    )
                      editor.commands.deleteRange({ from: pos - 1, to: pos });
                    item.run();
                    setSlash(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
              <button onClick={() => setSlash(false)}>Close</button>
            </div>
          )}
          {footnotes.length > 0 && (
            <ol className="footnotes" aria-label="Footnotes">
              {footnotes.map((note) => (
                <li key={note.id} id={"footnote-" + note.id}>
                  {note.text}
                </li>
              ))}
            </ol>
          )}
        </article>
      </div>
      <footer className="document-status">
        <span className="status-left">
          <span role="status">{label}</span>
          {citationFlash && (
            <span className="citation-flash-note" role="status">
              · Citation inserted
            </span>
          )}
        </span>
        {(() => {
          const chapterWords = wordCount(json);
          const readingMinutes = Math.max(1, Math.round(chapterWords / 225));
          const totalProjectWords = otherChaptersWords + chapterWords;
          const baseline = sessionBaseline ?? totalProjectWords;
          const sessionDelta = Math.max(0, totalProjectWords - baseline);
          const progressPct = Math.min(
            100,
            Math.round((sessionDelta / Math.max(1, wordGoal)) * 100),
          );
          const goalMet = sessionDelta >= wordGoal;

          return (
            <div className="status-metrics-row tabular-nums">
              <span>
                {chapterWords.toLocaleString()} words · ~{readingMinutes} min read
              </span>
              <span aria-hidden="true" className="status-sep">
                ·
              </span>
              <div className="session-goal-wrap" ref={goalWrapRef}>
                <button
                  type="button"
                  className={
                    "session-goal-trigger" + (goalMet ? " is-complete" : "")
                  }
                  aria-expanded={goalOpen}
                  onClick={() => setGoalOpen((v) => !v)}
                  title="Edit session word goal"
                >
                  <span>
                    Session: +{sessionDelta.toLocaleString()} /{" "}
                    {wordGoal.toLocaleString()}
                  </span>
                  <span className="session-goal-track" aria-hidden="true">
                    <span
                      className="session-goal-fill"
                      style={{ transform: `scaleX(${progressPct / 100})` }}
                    />
                  </span>
                </button>
                {goalOpen && (
                  <div className="session-goal-popover" role="dialog" aria-label="Session word goal">
                    <div className="session-goal-head">
                      <strong>Session word goal</strong>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="session-goal-presets">
                      {[250, 500, 1000, 1500].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={wordGoal === preset ? "active" : ""}
                          onClick={() => {
                            setWordGoal(preset);
                            window.localStorage.setItem(
                              GOAL_STORAGE_KEY,
                              String(preset),
                            );
                          }}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <label className="session-goal-custom">
                      <span>Custom target</span>
                      <input
                        type="number"
                        min={50}
                        max={20000}
                        step={50}
                        value={wordGoal}
                        onChange={(e) => {
                          const next = Math.max(
                            50,
                            Math.min(20000, Number(e.target.value) || 500),
                          );
                          setWordGoal(next);
                          window.localStorage.setItem(
                            GOAL_STORAGE_KEY,
                            String(next),
                          );
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        window.sessionStorage.setItem(
                          sessionBaselineKey(section.project_id),
                          String(totalProjectWords),
                        );
                        setSessionBaseline(totalProjectWords);
                        setGoalOpen(false);
                      }}
                    >
                      Reset session count
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </footer>
    </div>
  );
}
