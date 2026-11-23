import { NextRequest, NextResponse } from "next/server";
import { ParseHttpError, parseUploadedDocument } from "@/lib/server/document-parse";

const MAX_BYTES =
  (Number(process.env.DOCUMENT_MAX_UPLOAD_MB || process.env.MAX_UPLOAD_MB || "25") || 25) *
  1024 *
  1024;

export async function POST(request: NextRequest) {
  try {
    const filenameHeader = request.headers.get("x-filename") ?? "";
    const arrayBuffer = await request.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { detail: `Maximum file size is ${Math.floor(MAX_BYTES / (1024 * 1024))} MB.` },
        { status: 413 },
      );
    }
    const result = await parseUploadedDocument(filenameHeader, Buffer.from(arrayBuffer));
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof ParseHttpError) {
      return NextResponse.json({ detail: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { detail: "The document parser could not read this file." },
      { status: 422 },
    );
  }
}
