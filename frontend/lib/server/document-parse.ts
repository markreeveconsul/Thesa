import crypto from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";

export type ExtractedPage = {
  page_number: number;
  text: string;
  locator_type: "page" | "paragraph" | "line";
};

export class ParseHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_PDF_PAGES = Math.min(
  1000,
  Math.max(1, Number(process.env.DOCUMENT_MAX_PAGES || process.env.MAX_PDF_PAGES || "300") || 300),
);
const MAX_EXTRACTED_CHARS = Number(process.env.MAX_EXTRACTED_CHARS || "2000000") || 2_000_000;
const MAX_DOCX_EXPANDED_BYTES =
  (Number(process.env.MAX_DOCX_EXPANDED_MB || "50") || 50) * 1024 * 1024;

export function safeFilename(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const base = decoded.replace(/\\/g, "/").split("/").pop() || "";
  let cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/^[ .]+|[ .]+$/g, "");
  if (cleaned.length > 180) {
    const ext = path.extname(cleaned);
    cleaned = cleaned.slice(0, 160) + ext;
  }
  return cleaned || "source";
}

function assertBounded(pages: ExtractedPage[]): ExtractedPage[] {
  if (pages.length > 10000) {
    throw new ParseHttpError(
      413,
      "The document exceeds 10,000 extracted locations; split it into smaller files",
    );
  }
  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (totalChars > MAX_EXTRACTED_CHARS) {
    throw new ParseHttpError(413, "The extracted document exceeds the text limit");
  }
  if (!pages.some((p) => p.text.trim().length > 0)) {
    throw new ParseHttpError(422, "No readable text was found in the document");
  }
  return pages;
}

export function decodeXmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
  };
  return input.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (entity) => {
      if (namedEntities[entity] !== undefined) return namedEntities[entity];
      const hexadecimal = entity.startsWith("&#x");
      const value = entity.slice(hexadecimal ? 3 : 2, -1);
      return String.fromCodePoint(Number.parseInt(value, hexadecimal ? 16 : 10));
    },
  );
}

function readZipEntry(buffer: Buffer, targetName: string): { data: Buffer; totalExpanded: number; entryCount: number } {
  // Locate End of Central Directory (EOCD: 0x06054b50)
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new ParseHttpError(422, "The file is corrupt or cannot be read");
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  if (entryCount > 2000) {
    throw new ParseHttpError(413, "The expanded DOCX exceeds the document limit");
  }
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = cdOffset;
  let totalExpanded = 0;
  let targetEntry: {
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    flags: number;
  } | null = null;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new ParseHttpError(422, "The file is corrupt or cannot be read");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    if (flags & 1) {
      throw new ParseHttpError(422, "Encrypted DOCX files are not supported");
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    totalExpanded += uncompressedSize;
    if (totalExpanded > MAX_DOCX_EXPANDED_BYTES) {
      throw new ParseHttpError(413, "The expanded DOCX exceeds the document limit");
    }
    if (name === targetName) {
      targetEntry = {
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        flags,
      };
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (!targetEntry) {
    throw new ParseHttpError(422, "The file is not a valid DOCX document");
  }
  const lh = targetEntry.localHeaderOffset;
  if (lh + 30 > buffer.length || buffer.readUInt32LE(lh) !== 0x04034b50) {
    throw new ParseHttpError(422, "The file is corrupt or cannot be read");
  }
  const lhNameLen = buffer.readUInt16LE(lh + 26);
  const lhExtraLen = buffer.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + lhNameLen + lhExtraLen;
  const compressed = buffer.subarray(dataStart, dataStart + targetEntry.compressedSize);

  let data: Buffer;
  if (targetEntry.compressionMethod === 0) {
    data = compressed;
  } else if (targetEntry.compressionMethod === 8) {
    data = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_DOCX_EXPANDED_BYTES });
  } else {
    throw new ParseHttpError(422, "Unsupported DOCX compression method");
  }
  return { data, totalExpanded, entryCount };
}

function extractParagraphText(xml: string): string {
  const parts: string[] = [];
  const tokenRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(xml)) !== null) {
    if (match[1] !== undefined) {
      parts.push(decodeXmlEntities(match[1]));
    } else if (match[0].startsWith("<w:tab")) {
      parts.push("\t");
    } else {
      parts.push("\n");
    }
  }
  return parts.join("");
}

function parseDocx(buffer: Buffer): { pages: ExtractedPage[]; warning: string } {
  const { data } = readZipEntry(buffer, "word/document.xml");
  const xml = data.toString("utf8");
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;

  const pages: ExtractedPage[] = [];
  // Extract top-level blocks (<w:p> and <w:tbl>) in order
  let pos = 0;
  while (pos < body.length) {
    const nextP = body.indexOf("<w:p", pos);
    const nextTbl = body.indexOf("<w:tbl", pos);
    if (nextP === -1 && nextTbl === -1) break;

    const isTable = nextTbl !== -1 && (nextP === -1 || nextTbl < nextP);
    if (isTable) {
      const tagChar = body[nextTbl + 6];
      if (tagChar && !/[\s>]/.test(tagChar)) {
        pos = nextTbl + 6;
        continue;
      }
      const endTbl = body.indexOf("</w:tbl>", nextTbl);
      if (endTbl === -1) break;
      const tblXml = body.slice(nextTbl, endTbl + 8);
      const rows = tblXml.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) ?? [];
      for (const row of rows) {
        const cells = row.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) ?? [];
        const rowText = cells
          .map((cell) => {
            const cellParas = cell.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
            return cellParas.map(extractParagraphText).join("\n").trim();
          })
          .join(" | ")
          .trim();
        if (rowText) {
          pages.push({
            page_number: pages.length + 1,
            text: rowText,
            locator_type: "paragraph",
          });
        }
      }
      pos = endTbl + 8;
    } else {
      const tagChar = body[nextP + 4];
      if (tagChar && !/[\s>/]/.test(tagChar)) {
        pos = nextP + 4;
        continue;
      }
      const selfClose = body.indexOf("/>", nextP);
      const openEnd = body.indexOf(">", nextP);
      if (openEnd === -1) break;
      if (selfClose !== -1 && selfClose < openEnd) {
        pos = selfClose + 2;
        continue;
      }
      const endP = body.indexOf("</w:p>", openEnd);
      if (endP === -1) break;
      const pXml = body.slice(nextP, endP + 6);
      const text = extractParagraphText(pXml).trim();
      if (text) {
        pages.push({
          page_number: pages.length + 1,
          text,
          locator_type: "paragraph",
        });
      }
      pos = endP + 6;
    }
  }

  return {
    pages: assertBounded(pages),
    warning:
      "DOCX citations use extracted paragraph numbers (table rows count as paragraphs), not physical pages.",
  };
}

function parseTxt(buffer: Buffer): { pages: ExtractedPage[]; warning: string } {
  if (buffer.includes(0)) {
    throw new ParseHttpError(
      422,
      "TXT files must contain UTF-8 text, not binary data or UTF-16",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ParseHttpError(422, "The file is corrupt or cannot be read");
  }
  if (text.startsWith("\uFEFF")) {
    text = text.slice(1);
  }
  const lines = text.split(/\r?\n/);
  const pages: ExtractedPage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim()) {
      pages.push({
        page_number: i + 1,
        text: line,
        locator_type: "line",
      });
    }
  }
  return {
    pages: assertBounded(pages),
    warning: "TXT citations use original line numbers, not physical pages.",
  };
}

async function parsePdf(buffer: Buffer): Promise<{ pages: ExtractedPage[]; warning: string | null }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    useWorkerFetch: false,
  });
  let doc: Awaited<typeof loadingTask.promise> | null = null;
  try {
    doc = await loadingTask.promise;
    if (doc.numPages > MAX_PDF_PAGES) {
      throw new ParseHttpError(413, "The PDF exceeds the page limit");
    }
    const pages: ExtractedPage[] = [];
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        if ("str" in item && typeof item.str === "string") {
          parts.push(item.str);
          if ("hasEOL" in item && item.hasEOL) parts.push("\n");
          else parts.push(" ");
        }
      }
      const text = parts.join("").replace(/[ \t]+\n/g, "\n").trim();
      total += text.length;
      if (total > MAX_EXTRACTED_CHARS) {
        throw new ParseHttpError(413, "The extracted document exceeds the text limit");
      }
      pages.push({
        page_number: i,
        text,
        locator_type: "page",
      });
    }
    if (!pages.some((p) => p.text.length > 0)) {
      throw new ParseHttpError(
        422,
        "This PDF contains no extractable text; it may be scanned. OCR is not supported.",
      );
    }
    const warning = pages.some((p) => !p.text)
      ? "Some pages have no extractable text and may be scanned."
      : null;
    return { pages, warning };
  } catch (err) {
    if (err instanceof ParseHttpError) throw err;
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("password")) {
      throw new ParseHttpError(422, "Password-protected PDFs are not supported");
    }
    throw new ParseHttpError(422, "The PDF is corrupt or cannot be read");
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function parseUploadedDocument(filenameHeader: string, content: Buffer) {
  const filename = safeFilename(filenameHeader);
  const ext = path.extname(filename).toLowerCase();
  if (![".pdf", ".docx", ".txt"].includes(ext)) {
    throw new ParseHttpError(415, "Choose a PDF, DOCX or UTF-8 TXT file.");
  }
  if (!content.length) {
    throw new ParseHttpError(422, "The file is empty.");
  }
  if (ext === ".pdf" && !content.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new ParseHttpError(415, "The file contents do not match its extension.");
  }
  if (ext === ".docx" && !content.subarray(0, 2).equals(Buffer.from("PK"))) {
    throw new ParseHttpError(415, "The file contents do not match its extension.");
  }

  let parsed: { pages: ExtractedPage[]; warning: string | null };
  if (ext === ".pdf") {
    parsed = await parsePdf(content);
  } else if (ext === ".docx") {
    parsed = parseDocx(content);
  } else {
    parsed = parseTxt(content);
  }

  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  return {
    filename,
    sha256,
    format: ext.slice(1) as "pdf" | "docx" | "txt",
    pages: parsed.pages,
    warning: parsed.warning,
  };
}
