import type { Project, Section } from "./workspace";
import { chapterTitles, emptyDocument, validateDocument } from "./document";

export const LOCAL_KEY = "thesisdesk-drafts-v1";
type LocalData = { version: 1; projects: Project[]; sections: Section[] };
export type SaveResult = {
  section?: Section;
  error?: string;
  conflict?: boolean;
};
export function readLocal(): LocalData {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return { version: 1, projects: [], sections: [] };
  const data = JSON.parse(raw) as LocalData;
  if (
    data.version !== 1 ||
    !Array.isArray(data.projects) ||
    !Array.isArray(data.sections) ||
    !data.sections.every((section) => validateDocument(section.content))
  )
    throw new Error(
      "Browser drafts could not be read. Export a backup before clearing browser storage.",
    );
  return data;
}
function writeLocal(data: LocalData) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event("thesisdesk-local-change"));
}
async function locked<T>(action: () => T): Promise<T> {
  if (!navigator.locks)
    throw new Error(
      "Safe browser draft saving requires a browser with Web Locks support.",
    );
  return navigator.locks.request(LOCAL_KEY, action);
}
export async function createLocal(
  project: Omit<Project, "id">,
): Promise<Project> {
  return locked(() => {
    const data = readLocal();
    const created = {
      ...project,
      id: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
      revision: 0,
    };
    data.projects.unshift(created);
    if (project.structure === "five-chapter")
      chapterTitles.forEach((title, position) =>
        data.sections.push({
          id: crypto.randomUUID(),
          project_id: created.id,
          title,
          position,
          parent_id: null,
          revision: 0,
          content: structuredClone(emptyDocument),
        }),
      );
    writeLocal(data);
    return created;
  });
}
export async function saveLocal(
  section: Section,
  expected: number,
): Promise<SaveResult> {
  return locked(() => {
    const data = readLocal(),
      index = data.sections.findIndex(
        (item) =>
          item.id === section.id && item.project_id === section.project_id,
      );
    if (index < 0)
      return { error: "This chapter no longer exists.", conflict: true };
    if (data.sections[index].revision !== expected)
      return {
        error:
          "This chapter changed in another tab. Your draft is kept here; reload the latest version or download your draft.",
        conflict: true,
      };
    if (!validateDocument(section.content))
      return { error: "This chapter is invalid or too large." };
    const next = { ...section, revision: expected + 1 };
    data.sections[index] = next;
    const project = data.projects.find(
      (item) => item.id === section.project_id,
    );
    if (project) project.updated_at = new Date().toISOString();
    writeLocal(data);
    return { section: next };
  });
}
export async function addLocalChapter(
  projectId: string,
  title: string,
): Promise<Section> {
  return locked(() => {
    const data = readLocal();
    if (!data.projects.some((item) => item.id === projectId))
      throw new Error("Project unavailable.");
    const position =
      Math.max(
        -1,
        ...data.sections
          .filter((item) => item.project_id === projectId)
          .map((item) => item.position),
      ) + 1;
    const section: Section = {
      id: crypto.randomUUID(),
      project_id: projectId,
      title,
      position,
      parent_id: null,
      revision: 0,
      content: structuredClone(emptyDocument),
    };
    data.sections.push(section);
    writeLocal(data);
    return section;
  });
}
export async function updateLocalProblem(
  projectId: string,
  problem: string,
  revision: number,
) {
  return locked(() => {
    const data = readLocal(),
      project = data.projects.find((item) => item.id === projectId);
    if (!project || (project.revision ?? 0) !== revision)
      throw new Error(
        "Project changed in another tab. Reload before updating the research problem.",
      );
    project.research_problem = problem;
    project.revision = revision + 1;
    project.updated_at = new Date().toISOString();
    writeLocal(data);
    return project;
  });
}
export async function reorderLocal(projectId: string, ordered: Section[]) {
  return locked(() => {
    const data = readLocal(),
      current = data.sections.filter((item) => item.project_id === projectId);
    if (
      current.length !== ordered.length ||
      new Set(ordered.map((item) => item.id)).size !== current.length ||
      ordered.some(
        (item) =>
          !current.some(
            (existing) =>
              existing.id === item.id && existing.revision === item.revision,
          ),
      )
    )
      throw new Error(
        "Chapters changed in another tab. Reload before reordering.",
      );
    const updated = ordered.map((item, position) => ({
      ...item,
      position,
      revision: item.revision + 1,
    }));
    data.sections = data.sections
      .filter((item) => item.project_id !== projectId)
      .concat(updated);
    writeLocal(data);
    return updated;
  });
}

export async function deleteLocalProject(projectId: string): Promise<void> {
  return locked(() => {
    const data = readLocal();
    data.projects = data.projects.filter((item) => item.id !== projectId);
    data.sections = data.sections.filter((item) => item.project_id !== projectId);
    writeLocal(data);
  });
}

export async function ensureStarterWorkspace(): Promise<{
  project: Project;
  seeded: boolean;
}> {
  const {
    STARTER_PROJECT_TITLE,
    STARTER_RESEARCH_PROBLEM,
    starterChapterDocs,
    STARTER_SOURCE_FILENAME,
    STARTER_SOURCE_LINES,
  } = await import("./sample-manuscript");

  return locked(async () => {
    const data = readLocal();
    if (data.projects.length > 0) {
      return { project: data.projects[0], seeded: false };
    }
    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    const project: Project = {
      id: projectId,
      title: STARTER_PROJECT_TITLE,
      research_problem: STARTER_RESEARCH_PROBLEM,
      citation_style: "apa",
      structure: "five-chapter",
      updated_at: now,
      revision: 0,
    };
    data.projects.unshift(project);
    chapterTitles.forEach((title, position) => {
      data.sections.push({
        id: crypto.randomUUID(),
        project_id: projectId,
        title,
        position,
        parent_id: null,
        revision: 0,
        content: structuredClone(starterChapterDocs[title] ?? emptyDocument),
      });
    });
    writeLocal(data);

    // Seed one starter source into IndexedDB so the right-hand Source Viewer is immediately rich.
    const sourceId = crypto.randomUUID();
    try {
      const textBody = STARTER_SOURCE_LINES.join("\n");
      const bytes = new TextEncoder().encode(textBody);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      const pages = STARTER_SOURCE_LINES.map((line, idx) => ({
        page_number: idx + 1,
        text: line,
        locator_type: "line" as const,
      }));
      await new Promise<void>((resolve) => {
        const req = indexedDB.open("thesa-sources-v1", 1);
        req.onupgradeneeded = () => {
          const meta = req.result.createObjectStore("sources", { keyPath: "id" });
          meta.createIndex("project", "projectId");
          meta.createIndex("projectHash", ["projectId", "sha256"], { unique: true });
          req.result.createObjectStore("documents", { keyPath: "id" });
        };
        req.onerror = () => resolve();
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(["sources", "documents"], "readwrite");
          tx.objectStore("sources").put({
            id: sourceId,
            projectId,
            filename: STARTER_SOURCE_FILENAME,
            sha256,
            format: "txt",
            size: bytes.byteLength,
            count: pages.length,
            warning: "TXT citations use original line numbers, not physical pages.",
            createdAt: now,
          });
          tx.objectStore("documents").put({
            id: sourceId,
            projectId,
            blob: new Blob([bytes], { type: "text/plain;charset=utf-8" }),
            pages,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            resolve();
          };
        };
      });
    } catch {
      // Best-effort source seeding; editor still opens cleanly if IndexedDB is restricted.
    }

    try {
      const fKey = `thesa-feasibility-${projectId}`;
      if (!localStorage.getItem(fKey)) {
        const starterAssessment = [
          {
            id: crypto.randomUUID(),
            created_at: now,
            inputs: {
              topic: STARTER_PROJECT_TITLE,
              research_problem: STARTER_RESEARCH_PROBLEM,
              questions_objectives:
                "1. Measure how often undergraduates separate collaborative study chats from passive leisure feeds during independent study.\n2. Identify self-regulation strategies linked to higher assignment completion.",
              population_setting:
                "60–80 full-time undergraduate students across two university departments during one 14-week semester.",
              method:
                "14-day structured daily study diary combined with end-of-term semi-structured interviews (n = 15).",
              access:
                "Recruitment via undergraduate course mailing lists with department instructor consent.",
              timeline: "14 weeks across Spring semester (IRB weeks 1–3, diary weeks 4–7, analysis weeks 8–11, writing weeks 12–14).",
              resources: "University Qualtrics license, audio recorder, and qualitative coding software.",
              ethics: "Expedited university IRB review, informed consent, and anonymized participant IDs.",
              constraints: "Self-reported diary logs may miss brief phone micro-checks under 30 seconds.",
            },
            report: {
              summary:
                "Your mixed-methods diary + interview design is well-scoped for a 14-week undergraduate thesis. Four of six dimensions look workable; tightening diary compliance prompts and confirming instructor sign-off early will keep data collection on schedule.",
              dimensions: {
                scope: {
                  status: "Looks workable",
                  assessment:
                    "Focusing on two specific behavioral modes (collaborative study vs. passive scrolling) avoids the ambiguity of generic screen-time totals.",
                  known: "Clear two-part research objective grounded in prior 14-day diary methodology.",
                  unknown: "Whether differences across academic majors will be analyzed or held exploratory.",
                  citations: [
                    {
                      id: "E1",
                      source_id: sourceId,
                      filename: STARTER_SOURCE_FILENAME,
                      location: 3,
                      locator_type: "line",
                      text: STARTER_SOURCE_LINES[2],
                    },
                  ],
                },
                method_fit: {
                  status: "Looks workable",
                  assessment:
                    "Pairing short daily study-block logs with follow-up interviews captures both routine patterns and why students switch modes.",
                  known: "14-day diary interval aligns cleanly with established undergraduate digital-habit studies.",
                  unknown: "How brief sub-30-second micro-checks will be estimated or acknowledged.",
                  citations: [
                    {
                      id: "E2",
                      source_id: sourceId,
                      filename: STARTER_SOURCE_FILENAME,
                      location: 5,
                      locator_type: "line",
                      text: STARTER_SOURCE_LINES[4],
                    },
                  ],
                },
                access: {
                  status: "Needs planning",
                  assessment:
                    "Course mailing-list recruitment is realistic, though securing written sign-off from two department instructors before week 3 is critical.",
                  known: "Target sample of 60–80 participants fits single-semester recruitment.",
                  unknown: "Backup recruitment channels if initial response rate falls below 40%.",
                  citations: [],
                },
                timeline: {
                  status: "Looks workable",
                  assessment:
                    "A 4-week collection window plus 4 weeks for coding and 3 weeks for drafting fits comfortably within a 14-week term.",
                  known: "Phased weekly milestones from IRB submission through final writing.",
                  unknown: "Buffer time if IRB revisions add 1–2 weeks.",
                  citations: [],
                },
                resources: {
                  status: "Looks workable",
                  assessment:
                    "Institutional Qualtrics access and qualitative coding tools cover all instrument needs without external budget.",
                  known: "Core survey and transcription tools are already available.",
                  unknown: "Whether small completion incentives are needed for 14-day retention.",
                  citations: [],
                },
                ethics: {
                  status: "Needs planning",
                  assessment:
                    "Expedited IRB approval and anonymized participant IDs are appropriate; confirm that message content itself is never collected.",
                  known: "Diary logs track study-block intent and app categories rather than private chats.",
                  unknown: "Exact university IRB submission lead time for expedited review.",
                  citations: [],
                },
              },
              risks: [
                {
                  title: "Diary fatigue and undercounting brief micro-checks",
                  why_it_matters:
                    "Participants often drop off after day 7 of daily logs or forget quick phone checks lasting under 30 seconds.",
                  mitigation:
                    "Keep daily check-ins under 90 seconds via evening SMS/email reminders and include one end-of-block recall item for brief interruptions.",
                  citations: [
                    {
                      id: "E3",
                      source_id: sourceId,
                      filename: STARTER_SOURCE_FILENAME,
                      location: 5,
                      locator_type: "line",
                      text: STARTER_SOURCE_LINES[4],
                    },
                  ],
                },
              ],
              next_steps: [
                {
                  action: "Submit expedited IRB protocol in Week 1",
                  reason: "Prevents ethics review turnaround from compressing your 4-week diary window.",
                  citations: [],
                },
                {
                  action: "Pilot the 90-second study-block log with 5 peers",
                  reason: "Verifies clarity between collaborative chats and passive scrolling categories before full launch.",
                  citations: [
                    {
                      id: "E4",
                      source_id: sourceId,
                      filename: STARTER_SOURCE_FILENAME,
                      location: 4,
                      locator_type: "line",
                      text: STARTER_SOURCE_LINES[3],
                    },
                  ],
                },
                {
                  action: "Confirm backup recruitment channels with student clubs",
                  reason: "Protects sample size if course mailing lists yield fewer than 60 participants.",
                  citations: [],
                },
              ],
              scope_adjustments: [
                "Treat differences across majors as descriptive context rather than a primary hypothesis unless each group exceeds 25 students.",
              ],
              missing_information: [
                "Target response-rate threshold for launching backup recruitment.",
                "Exact institutional IRB submission cutoff date for Spring term.",
              ],
            },
          },
        ];
        localStorage.setItem(fKey, JSON.stringify(starterAssessment));
      }
    } catch {
      // Non-fatal if storage is full or disabled.
    }

    return { project, seeded: true };
  });
}
