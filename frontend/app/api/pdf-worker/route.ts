import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { NextResponse } from "next/server";

const require = createRequire(import.meta.url);

export async function GET() {
  try {
    const workerPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    const content = await fs.readFile(workerPath);
    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "PDF worker unavailable" }, { status: 404 });
  }
}
