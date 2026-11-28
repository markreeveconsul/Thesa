import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createThesis } from "./helpers";
import path from "node:path";

const fixture = (name: string) => path.resolve(".source-test-fixtures", name);

test("real upload, PDF page rendering, DOCX/TXT locators, persistence, project filtering and deletion", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createThesis(page, "Source reading project");
  const projectUrl = page.url();
  const drawer = page.getByRole("complementary", {
    name: "Research and source studio",
  });
  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles([
      fixture("study.pdf"),
      fixture("study.docx"),
      fixture("notes.txt"),
    ]);
  await expect(drawer.getByText("3 sources saved.", { exact: true })).toBeVisible(
    { timeout: 60000 },
  );
  const row = (name: string) =>
    drawer.locator(".drawer-source-list > li").filter({ hasText: name });
  await row("study.pdf").locator(".drawer-source-open").click();
  await expect(
    drawer.getByRole("img", { name: "study.pdf, page 1" }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    await drawer
      .locator(".pdf-canvas canvas")
      .evaluate((canvas: HTMLCanvasElement) => canvas.width),
  ).toBeGreaterThan(100);
  await expect(drawer.locator(".drawer-passage-text")).toContainText(
    "Page one: study aim.",
  );
  await drawer.getByRole("button", { name: "Next location" }).click();
  await expect(drawer.locator(".drawer-passage-text")).toContainText(
    "Page two: interview results.",
  );
  await expect(
    drawer.getByRole("img", { name: "study.pdf, page 2" }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(drawer.getByText("125%", { exact: true })).toBeVisible();
  await drawer.getByLabel("Search source text").fill("study aim");
  await drawer.getByRole("button", { name: "Next", exact: true }).click();
  await expect(drawer.getByLabel("Go to page")).toHaveValue("1");
  await page.screenshot({
    path: "test-results/source-pdf-reader.png",
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await row("study.docx").locator(".drawer-source-open").click();
  await expect(drawer.getByLabel("Go to paragraph")).toHaveValue("1");
  await drawer.getByRole("button", { name: "Next location" }).click();
  await expect(drawer.locator(".drawer-passage-text")).toContainText(
    "Table findings.",
  );

  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await row("notes.txt").locator(".drawer-source-open").click();
  await drawer.getByRole("button", { name: "Next location" }).click();
  await expect(drawer.getByLabel("Go to line")).toHaveValue("3");
  await drawer.getByRole("button", { name: "Next location" }).click();
  await expect(drawer.locator(".drawer-passage-text")).toContainText(
    "<script>untrusted()</script>",
  );

  await page.reload();
  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await expect(drawer.locator(".drawer-source-list > li")).toHaveCount(3);
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles(fixture("study.pdf"));
  await expect(drawer.locator(".source-errors")).toContainText(
    "already in this project's source library",
  );
  await page.screenshot({
    path: "test-results/source-library-populated.png",
    fullPage: true,
  });

  await createThesis(page, "Separate project");
  await expect(page.getByRole("tab", { name: "Sources (0)" })).toBeVisible();
  await page.getByRole("tab", { name: "Sources (0)" }).click();
  await expect(page.locator(".drawer-source-list > li")).toHaveCount(0);

  await page.goto(projectUrl);
  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await row("study.pdf")
    .getByRole("button", { name: "Delete study.pdf", exact: true })
    .click();
  await row("study.pdf")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(drawer.locator(".drawer-source-list > li")).toHaveCount(2);

  const counts = await page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const request = indexedDB.open("thesa-sources-v1");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(["sources", "documents"]);
          const a = tx.objectStore("sources").count(),
            b = tx.objectStore("documents").count();
          tx.oncomplete = () => {
            db.close();
            resolve([a.result, b.result]);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  expect(counts).toEqual([2, 2]);
  expect(errors).toEqual([]);
});

test("scanned, corrupt, unsupported and offline uploads fail honestly; retry works", async ({
  page,
}) => {
  await createThesis(page);
  const drawer = page.getByRole("complementary", {
    name: "Research and source studio",
  });
  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles([fixture("scan.pdf"), fixture("broken.pdf")]);
  await expect(drawer.locator(".source-errors")).toContainText(
    "OCR is not supported",
  );
  await expect(drawer.locator(".source-errors")).toContainText("corrupt");
  await expect(drawer.locator(".drawer-source-list > li")).toHaveCount(0);
  await drawer.getByLabel("Choose source files").setInputFiles({
    name: "bad.html",
    mimeType: "text/html",
    buffer: Buffer.from("test"),
  });
  await expect(drawer.locator(".source-errors")).toContainText(
    "Choose a PDF, DOCX or UTF-8 TXT",
  );
  await page.route("**:8012/parse", (route) =>
    route.abort("connectionrefused"),
  );
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles(fixture("notes.txt"));
  await expect(drawer.locator(".source-errors")).toContainText(
    "Cannot reach the document service",
  );
  await page.unroute("**:8012/parse");
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles(fixture("notes.txt"));
  await expect(
    drawer.getByText("1 source saved.", { exact: true }),
  ).toBeVisible();
});

test("storage failures roll back the whole source; mobile PDF reader fits", async ({
  page,
}) => {
  await createThesis(page);
  const drawer = page.getByRole("complementary", {
    name: "Research and source studio",
  });
  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let fail = true;
    IDBObjectStore.prototype.add = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "documents" && fail) {
        fail = false;
        throw new DOMException("Storage full", "QuotaExceededError");
      }
      return original.call(this, value, key);
    };
  });
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles(fixture("study.pdf"));
  await expect(drawer.locator(".source-errors")).toContainText(
    "Browser storage is full",
  );
  await expect(drawer.locator(".drawer-source-list > li")).toHaveCount(0);
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles(fixture("study.pdf"));
  await expect(
    drawer.getByText("1 source saved.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "Mobile workspace" })
    .getByRole("button", { name: "Studio", exact: true })
    .click();
  await drawer.locator(".drawer-source-open").first().click();
  await expect(
    drawer.getByRole("img", { name: "study.pdf, page 1" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/source-reader-mobile.png",
    fullPage: true,
  });
});
