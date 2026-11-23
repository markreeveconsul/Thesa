"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Info,
  Minus,
  Plus,
  Quote,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { askSources, type ChatTurn, type Citation } from "@/lib/chat";
import { formatInlineCitation } from "@/lib/citations";
import {
  deleteSource,
  getSource,
  locatorLabel,
  uploadSource,
  watchSources,
  type SourceInfo,
  type StoredSource,
} from "@/lib/sources";
import type { CitationStyle } from "@/lib/workspace";
import { PdfPage } from "./PdfPage";

export type StudioTab = "viewer" | "otto" | "sources";

type OttoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
};

const OTTO_ACK_KEY = "thesa-otto-ai-ack-v1";

export function SourceStudioDrawer({
  open,
  tab,
  onTabChange,
  onClose,
  projectId,
  citationStyle,
  local,
  sources,
  storageError,
  selectedSourceId,
  selectedLocation,
  onSelectSource,
  onInsertCitation,
  onFeasibility,
}: {
  open: boolean;
  tab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  onClose: () => void;
  projectId: string;
  citationStyle: CitationStyle;
  local: boolean;
  sources: SourceInfo[];
  storageError: string;
  selectedSourceId?: string;
  selectedLocation?: number;
  onSelectSource: (id: string | undefined, location?: number) => void;
  onInsertCitation: (citationText: string) => void;
  onFeasibility: () => void;
}) {
  // --- Source Viewer state ---
  const activeSourceId = selectedSourceId ?? sources[0]?.id;
  const [stored, setStored] = useState<StoredSource | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState("");
  const [position, setPosition] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [locationInput, setLocationInput] = useState("1");
  const [copyFeedback, setCopyFeedback] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!activeSourceId) {
        setStored(null);
        setViewerLoading(false);
        setViewerError("");
        return;
      }
      setViewerLoading(true);
      try {
        const value = await getSource(projectId, activeSourceId, local);
        if (!alive) return;
        setStored(value);
        if (value && selectedLocation !== undefined) {
          const idx = value.pages.findIndex((p) => p.page_number === selectedLocation);
          setPosition(Math.max(0, idx));
        } else {
          setPosition(0);
        }
        setViewerError(
          value ? "" : "This source is no longer available in this project.",
        );
      } catch (err) {
        if (alive) {
          setViewerError(
            err instanceof Error ? err.message : "Could not load the source.",
          );
        }
      } finally {
        if (alive) setViewerLoading(false);
      }
    }
    setZoom(1);
    setSearchQuery("");
    setCopyFeedback("");
    void load();
    return () => {
      alive = false;
    };
  }, [activeSourceId, selectedLocation, projectId, local]);

  const currentPage = stored?.pages[position];
  useEffect(() => {
    setLocationInput(String(currentPage?.page_number ?? 1));
  }, [currentPage?.page_number]);

  const searchMatches =
    stored?.pages
      .map((item, idx) =>
        searchQuery.trim() &&
        item.text.toLowerCase().includes(searchQuery.trim().toLowerCase())
          ? idx
          : -1,
      )
      .filter((idx) => idx >= 0) ?? [];

  function findNext() {
    if (!searchMatches.length) return;
    setPosition(
      searchMatches.find((idx) => idx > position) ?? searchMatches[0],
    );
  }

  function downloadOriginal() {
    if (!stored) return;
    const url = URL.createObjectURL(stored.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = stored.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function copyPassage() {
    if (!stored || !currentPage?.text) return;
    const label = locatorLabel(stored.format).toLowerCase();
    try {
      await navigator.clipboard.writeText(
        `${currentPage.text}\n\n[${stored.filename}, ${label} ${currentPage.page_number}]`,
      );
      setCopyFeedback("Copied");
      setTimeout(() => setCopyFeedback(""), 2000);
    } catch {
      setCopyFeedback("Copy unavailable");
    }
  }

  function insertCurrentCitation() {
    if (!stored || !currentPage) return;
    const text = formatInlineCitation(
      stored.filename,
      currentPage.page_number,
      currentPage.locator_type,
      citationStyle,
    );
    onInsertCitation(text);
  }

  // --- Otto Chat state ---
  const [question, setQuestion] = useState("");
  const [aiAck, setAiAck] = useState(false);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [chatError, setChatError] = useState("");
  const [messages, setMessages] = useState<OttoMessage[]>([]);
  const chatAbort = useRef<AbortController | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setAiAck(window.localStorage.getItem(OTTO_ACK_KEY) === "true");
    } catch {
      setAiAck(false);
    }
  }, []);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [messages, chatStatus, chatError]);

  useEffect(() => {
    setMessages([]);
    setQuestion("");
    setChatError("");
    const stop = watchSources(() => {
      chatAbort.current?.abort();
      setMessages([]);
      setChatStatus("Sources updated. Ask again to query the current library.");
    }, local, projectId);
    return () => {
      stop();
      chatAbort.current?.abort();
    };
  }, [projectId, local]);

  function acceptAiDisclosure() {
    setAiAck(true);
    setShowDisclosure(false);
    try {
      window.localStorage.setItem(OTTO_ACK_KEY, "true");
    } catch {
      // Non-fatal if storage is blocked.
    }
  }

  async function sendQuestion() {
    if (chatBusy || !aiAck || question.trim().length < 3) return;
    const abort = new AbortController();
    chatAbort.current = abort;
    const currentQuestion = question.trim();
    const history: ChatTurn[] = messages
      .filter((m) => m.content.trim())
      .map(({ role, content }) => ({ role, content }));
    const userMessage: OttoMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: currentQuestion,
      citations: [],
    };
    const responseId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: responseId, role: "assistant", content: "", citations: [] },
    ]);
    setQuestion("");
    setChatBusy(true);
    setChatError("");
    setChatStatus("Reading this project's sources…");
    try {
      await askSources(
        projectId,
        currentQuestion,
        history,
        abort.signal,
        (event) => {
          if (abort.signal.aborted) return;
          if (event.type === "status") setChatStatus(event.message);
          if (event.type === "answer" || event.type === "abstention") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === responseId ? { ...m, content: event.message } : m,
              ),
            );
          }
          if (event.type === "citation") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === responseId
                  ? { ...m, citations: [...m.citations, event.citation] }
                  : m,
              ),
            );
          }
          if (event.type === "done") setChatStatus("");
        },
        local,
      );
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== responseId));
      setChatStatus("");
      setChatError(
        abort.signal.aborted
          ? "Question canceled."
          : err instanceof Error
            ? err.message
            : "Otto could not answer. Please retry.",
      );
    } finally {
      setChatBusy(false);
    }
  }

  // --- Sources Upload & Library state ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [removingId, setRemovingId] = useState<string>();

  useEffect(() => () => uploadAbort.current?.abort(), []);

  async function handleFiles(files: File[]) {
    if (uploadBusy || !files.length) return;
    if (files.length > 10) {
      setUploadErrors(["Choose at most 10 files at a time."]);
      return;
    }
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploadBusy(true);
    setUploadErrors([]);
    setUploadMessage("");
    let successes = 0;
    let lastId: string | undefined;
    for (const file of files) {
      if (controller.signal.aborted) break;
      try {
        const info = await uploadSource(
          projectId,
          file,
          controller.signal,
          (stage) => setUploadStage(`${file.name}: ${stage}`),
          local,
        );
        lastId = info.id;
        successes++;
      } catch (err) {
        setUploadErrors((prev) => [
          ...prev,
          `${file.name}: ${err instanceof Error ? err.message : "Upload failed."}`,
        ]);
      }
    }
    setUploadBusy(false);
    setUploadStage("");
    uploadAbort.current = null;
    if (successes > 0) {
      setUploadMessage(
        `${successes} ${successes === 1 ? "source" : "sources"} saved.`,
      );
      if (lastId) {
        onSelectSource(lastId, undefined);
      }
    }
  }

  if (!open) return null;

  const pageLabel = stored ? locatorLabel(stored.format) : "Page";

  return (
    <aside className="studio-drawer" aria-label="Research and source studio">
      <header className="studio-drawer-head">
        <div className="studio-drawer-brand">
          <Image src="/otto/otto-head-512.png" width={28} height={28} alt="" />
          <strong>Research Studio</strong>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close studio drawer"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>

      <div className="studio-tabs" role="tablist" aria-label="Studio panels">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "viewer"}
          className={tab === "viewer" ? "active" : ""}
          onClick={() => onTabChange("viewer")}
        >
          Source Viewer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "otto"}
          className={tab === "otto" ? "active" : ""}
          onClick={() => onTabChange("otto")}
        >
          Otto
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sources"}
          className={tab === "sources" ? "active" : ""}
          onClick={() => onTabChange("sources")}
        >
          Sources ({sources.length})
        </button>
      </div>

      {/* TAB 1: SOURCE VIEWER */}
      {tab === "viewer" && (
        <div className="studio-body" role="tabpanel" aria-label="Source Viewer">
          {!sources.length ? (
            <div className="studio-empty">
              <FileText size={30} />
              <h3>No sources in this thesis yet</h3>
              <p>
                Upload a PDF, DOCX, or TXT source to read passages side-by-side
                and insert grounded citations at your cursor.
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => onTabChange("sources")}
              >
                <Upload size={15} />
                Add sources
              </button>
            </div>
          ) : (
            <>
              <div className="viewer-source-bar">
                <select
                  aria-label="Select source"
                  value={activeSourceId ?? ""}
                  onChange={(e) => onSelectSource(e.target.value, undefined)}
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.filename} ({s.count}{" "}
                      {locatorLabel(s.format, s.count !== 1).toLowerCase()})
                    </option>
                  ))}
                </select>
                {stored && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Download original source"
                    title="Download original source"
                    onClick={downloadOriginal}
                  >
                    <Download size={15} />
                  </button>
                )}
              </div>

              {viewerLoading && (
                <p role="status" className="studio-status-note">
                  Opening source…
                </p>
              )}
              {viewerError && (
                <p role="alert" className="source-errors">
                  {viewerError}
                </p>
              )}

              {stored && currentPage && (
                <>
                  <div className="viewer-controls">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Previous location"
                      disabled={position === 0}
                      onClick={() => setPosition(position - 1)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <label className="viewer-loc-input">
                      <span>{pageLabel}</span>
                      <input
                        aria-label={`Go to ${pageLabel.toLowerCase()}`}
                        type="number"
                        min={1}
                        max={stored.pages.at(-1)?.page_number}
                        value={locationInput}
                        onBlur={() =>
                          setLocationInput(String(currentPage.page_number))
                        }
                        onChange={(e) => {
                          setLocationInput(e.target.value);
                          const idx = stored.pages.findIndex(
                            (item) => item.page_number === Number(e.target.value),
                          );
                          if (idx >= 0) setPosition(idx);
                        }}
                      />
                    </label>
                    <span className="viewer-count tabular-nums">
                      {position + 1} / {stored.pages.length}
                    </span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Next location"
                      disabled={position === stored.pages.length - 1}
                      onClick={() => setPosition(position + 1)}
                    >
                      <ChevronRight size={16} />
                    </button>
                    {stored.format === "pdf" && (
                      <div className="viewer-zoom">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Zoom out"
                          disabled={zoom <= 0.5}
                          onClick={() =>
                            setZoom((v) => Math.max(0.5, v - 0.25))
                          }
                        >
                          <Minus size={14} />
                        </button>
                        <span className="tabular-nums">
                          {Math.round(zoom * 100)}%
                        </span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Zoom in"
                          disabled={zoom >= 2}
                          onClick={() => setZoom((v) => Math.min(2, v + 0.25))}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  <form
                    className="viewer-search"
                    onSubmit={(e) => {
                      e.preventDefault();
                      findNext();
                    }}
                  >
                    <Search size={14} />
                    <input
                      aria-label="Search source text"
                      value={searchQuery}
                      maxLength={200}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search in source…"
                    />
                    <button
                      type="submit"
                      className="secondary"
                      disabled={!searchQuery.trim() || !searchMatches.length}
                    >
                      Next
                    </button>
                    {searchQuery.trim() && (
                      <span className="tabular-nums">
                        {searchMatches.length} hit
                        {searchMatches.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </form>

                  {stored.warning && (
                    <p className="viewer-warning">{stored.warning}</p>
                  )}

                  {stored.format === "pdf" && (
                    <div className="drawer-pdf-wrap">
                      <PdfPage
                        blob={stored.blob}
                        number={currentPage.page_number}
                        zoom={zoom}
                        filename={stored.filename}
                      />
                    </div>
                  )}

                  <section
                    className="drawer-passage-card"
                    aria-label="Extracted source passage"
                  >
                    <div className="drawer-passage-head">
                      <span>
                        {pageLabel} {currentPage.page_number}
                      </span>
                      <span className="tabular-nums">{stored.filename}</span>
                    </div>
                    <p className="drawer-passage-text" tabIndex={0}>
                      {currentPage.text ||
                        "No extractable text on this page."}
                    </p>
                    <div className="drawer-passage-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={insertCurrentCitation}
                      >
                        <Quote size={14} />
                        Insert citation
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!currentPage.text}
                        onClick={() => void copyPassage()}
                      >
                        {copyFeedback === "Copied" ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        {copyFeedback || "Copy quote"}
                      </button>
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: OTTO ASSISTANT */}
      {tab === "otto" && (
        <div className="studio-otto" role="tabpanel" aria-label="Otto assistant">
          <div className="otto-log" ref={chatLogRef} tabIndex={0}>
            {!messages.length && (
              <div className="otto-welcome-box">
                <p>
                  Ask naturally about your uploaded sources. Otto returns
                  source-grounded answers with exact quotations and page
                  locations you can inspect or cite directly.
                </p>
                <div className="otto-quick-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={onFeasibility}
                  >
                    Run feasibility check
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onTabChange("sources")}
                  >
                    Manage sources ({sources.length})
                  </button>
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <p className="otto-user-message" key={m.id}>
                  {m.content}
                </p>
              ) : (
                <article
                  className="otto-answer"
                  aria-label="Otto answer"
                  key={m.id}
                >
                  {m.content && <p>{m.content}</p>}
                  {m.citations.map((citation, idx) => (
                    <div
                      className="otto-citation-card"
                      key={`${citation.source_id}-${citation.location}-${idx}`}
                    >
                      <blockquote>{citation.text}</blockquote>
                      <div className="otto-citation-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            onSelectSource(citation.source_id, citation.location);
                            onTabChange("viewer");
                          }}
                        >
                          <BookOpen size={13} />
                          {citation.filename} · {citation.locator_type}{" "}
                          {citation.location}
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() =>
                            onInsertCitation(
                              formatInlineCitation(
                                citation.filename,
                                citation.location,
                                citation.locator_type,
                                citationStyle,
                              ),
                            )
                          }
                        >
                          + Cite
                        </button>
                      </div>
                    </div>
                  ))}
                </article>
              ),
            )}

            {chatStatus && (
              <p role="status" className="studio-status-note">
                {chatStatus}
              </p>
            )}
            {chatError && (
              <p role="alert" className="otto-error">
                {chatError}
              </p>
            )}
          </div>

          <footer className="otto-footer">
            {!aiAck ? (
              <div className="otto-ack-card">
                <p>
                  Otto sends your question and matching source excerpts to
                  Google Gemini to generate grounded citations. Files remain in{" "}
                  {local ? "this browser" : "your private project"}.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={acceptAiDisclosure}
                >
                  Enable Otto chat
                </button>
              </div>
            ) : (
              <>
                <div className="otto-disclosure-row">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowDisclosure((v) => !v)}
                  >
                    <Info size={12} />
                    AI data notice
                  </button>
                  {chatBusy && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => chatAbort.current?.abort()}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {showDisclosure && (
                  <p className="otto-disclosure-detail">
                    Extracted excerpts and recent chat turns are sent to Google
                    Gemini when you ask a question. Your draft manuscript is
                    never edited automatically.
                  </p>
                )}
                <form
                  className="otto-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendQuestion();
                  }}
                >
                  <input
                    aria-label="Ask Otto"
                    placeholder={
                      sources.length
                        ? `Ask Otto about your ${sources.length} source${sources.length === 1 ? "" : "s"}…`
                        : "Upload a source first to ask Otto…"
                    }
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={2000}
                    disabled={chatBusy}
                  />
                  <button
                    type="submit"
                    disabled={chatBusy || question.trim().length < 3}
                    aria-label="Send question"
                  >
                    <ArrowUp size={17} />
                  </button>
                </form>
              </>
            )}
          </footer>
        </div>
      )}

      {/* TAB 3: SOURCES LIBRARY */}
      {tab === "sources" && (
        <div className="studio-body" role="tabpanel" aria-label="Sources">
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            aria-label="Choose source files"
            accept=".pdf,.docx,.txt"
            multiple
            disabled={uploadBusy}
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <button
            type="button"
            className="source-dropzone"
            disabled={uploadBusy}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <Upload size={20} />
            <strong>Upload PDF, DOCX, or TXT</strong>
            <span>Drop files here or click to browse · 25 MB max</span>
          </button>

          {storageError && (
            <p className="error-text" role="alert">
              {storageError}
            </p>
          )}
          {uploadErrors.length > 0 && (
            <div className="source-errors" role="alert">
              <strong>Some files could not be added</strong>
              <ul>
                {uploadErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          {uploadBusy && (
            <div className="upload-status" role="status">
              <span>{uploadStage}</span>
              <button
                type="button"
                className="secondary"
                onClick={() => uploadAbort.current?.abort()}
              >
                Cancel
              </button>
            </div>
          )}
          {!uploadBusy && uploadMessage && (
            <p role="status" className="studio-status-note">
              {uploadMessage}
            </p>
          )}

          {!sources.length ? (
            <p className="studio-empty-note">
              No sources uploaded yet. Added files are parsed for page/paragraph
              citations and stay private to{" "}
              {local ? "this browser" : "your account"}.
            </p>
          ) : (
            <ul className="drawer-source-list">
              {sources.map((source) => (
                <li
                  key={source.id}
                  className={activeSourceId === source.id ? "selected" : ""}
                >
                  <div className="drawer-source-row">
                    <button
                      type="button"
                      className="drawer-source-open"
                      onClick={() => {
                        onSelectSource(source.id, undefined);
                        onTabChange("viewer");
                      }}
                    >
                      <FileText size={16} />
                      <span>
                        <strong>{source.filename}</strong>
                        <small className="tabular-nums">
                          {source.format.toUpperCase()} ·{" "}
                          {Math.max(1, Math.round(source.size / 1024))} KB ·{" "}
                          {source.count}{" "}
                          {locatorLabel(
                            source.format,
                            source.count !== 1,
                          ).toLowerCase()}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete ${source.filename}`}
                      disabled={uploadBusy}
                      onClick={() => setRemovingId(source.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {source.warning && (
                    <p className="drawer-source-warning">{source.warning}</p>
                  )}
                  {removingId === source.id && (
                    <div
                      className="source-delete-confirm"
                      role="group"
                      aria-label={`Confirm deletion of ${source.filename}`}
                    >
                      <p>Remove this source from this project?</p>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setRemovingId(undefined)}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={async () => {
                          try {
                            await deleteSource(projectId, source.id, local);
                            setRemovingId(undefined);
                            setUploadMessage("Source removed.");
                          } catch (err) {
                            setUploadErrors([
                              err instanceof Error
                                ? err.message
                                : "Deletion failed.",
                            ]);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
