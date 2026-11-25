import type { CitationStyle, Section } from "./workspace";
import type { DocumentNode } from "./document";

export function formatInlineCitation(
  filename: string,
  location: number,
  locatorType: "page" | "paragraph" | "line",
  style: CitationStyle,
): string {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || filename;
  const loc =
    locatorType === "page"
      ? `p. ${location}`
      : locatorType === "paragraph"
        ? `para. ${location}`
        : `line ${location}`;
  if (style === "ieee") return `[${stem}, ${loc}]`;
  if (style === "mla") return `(${stem} ${location})`;
  return `(${stem}, ${loc})`;
}

function nodeToMarkdown(node: DocumentNode): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    const marks = (node as { marks?: Array<{ type: string }> }).marks ?? [];
    for (const mark of marks) {
      if (mark.type === "bold") text = `**${text}**`;
      else if (mark.type === "italic") text = `*${text}*`;
      else if (mark.type === "underline") text = `<u>${text}</u>`;
    }
    return text;
  }
  if (node.type === "footnote") {
    const noteText = String(node.attrs?.text ?? "");
    return ` [^${noteText.slice(0, 32).replace(/\s+/g, "_")}]`;
  }
  const children = (node.content ?? []).map(nodeToMarkdown).join("");
  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${children}\n\n`;
    }
    case "paragraph":
      return children.trim() ? `${children}\n\n` : "";
    case "blockquote":
      return (
        children
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    case "bulletList":
      return (
        (node.content ?? [])
          .map((item) => `- ${nodeToMarkdown(item).trim()}`)
          .join("\n") + "\n\n"
      );
    case "orderedList":
      return (
        (node.content ?? [])
          .map((item, idx) => `${idx + 1}. ${nodeToMarkdown(item).trim()}`)
          .join("\n") + "\n\n"
      );
    case "listItem":
      return (node.content ?? []).map(nodeToMarkdown).join(" ").trim();
    case "table": {
      const rows = node.content ?? [];
      if (!rows.length) return "";
      const renderedRows = rows.map(
        (row) =>
          "| " +
          (row.content ?? [])
            .map((cell) => nodeToMarkdown(cell).replace(/\n+/g, " ").trim())
            .join(" | ") +
          " |",
      );
      if (renderedRows.length > 0) {
        const colCount = (rows[0].content ?? []).length || 1;
        renderedRows.splice(1, 0, "| " + Array(colCount).fill("---").join(" | ") + " |");
      }
      return renderedRows.join("\n") + "\n\n";
    }
    case "doc":
      return (node.content ?? []).map(nodeToMarkdown).join("").trim() + "\n";
    default:
      return children;
  }
}

export function sectionToMarkdown(section: Section): string {
  const doc = section.content as unknown as DocumentNode;
  const body = nodeToMarkdown(doc);
  const footnotes: string[] = [];
  const walk = (node: DocumentNode) => {
    if (node.type === "footnote") {
      footnotes.push(String(node.attrs?.text ?? ""));
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  const fnBlock = footnotes.length
    ? "\n**Notes**\n" + footnotes.map((t, i) => `${i + 1}. ${t}`).join("\n") + "\n"
    : "";
  return `## ${section.title}\n\n${body}${fnBlock}`;
}

export function thesisToMarkdown(
  title: string,
  researchProblem: string | null | undefined,
  sections: Section[],
): string {
  const parts = [`# ${title}`, ""];
  if (researchProblem?.trim()) {
    parts.push(`> **Research question:** ${researchProblem.trim()}`, "");
  }
  for (const section of [...sections].sort((a, b) => a.position - b.position)) {
    parts.push(sectionToMarkdown(section).trim(), "");
  }
  return parts.join("\n").trim() + "\n";
}
