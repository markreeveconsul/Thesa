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

export function ChapterEditor({
  section,
  chapterIndex,
  chapterTotal,
  local,
  onSaved,
  onReady,
  onStatus,
  onCite,
}: {
  section: Section;
  chapterIndex: number;
  chapterTotal: number;
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
  const save = useChapterSave(section, local, onSaved);
  const onChange = useRef(save.change);
  onChange.current = save.change;

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
        <article className="document-paper live-paper">
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
        <span role="status">{label}</span>
        <span className="tabular-nums">
          {wordCount(json).toLocaleString()} words · {local ? "Browser draft" : "Cloud draft"}
        </span>
      </footer>
    </div>
  );
}
