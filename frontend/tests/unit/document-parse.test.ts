import { describe, expect, it } from "vitest";
import { decodeXmlEntities } from "@/lib/server/document-parse";

describe("decodeXmlEntities", () => {
  it("decodes XML entities once without re-decoding escaped ampersands", () => {
    expect(decodeXmlEntities("&amp;lt; &lt; &#65; &#x42;")).toBe(
      "&lt; < A B",
    );
  });
});
