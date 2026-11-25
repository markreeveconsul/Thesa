import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { createThesis, saved } from "./helpers";

test("Research Studio drawer toggles without losing edits and keeps tabs accessible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createThesis(page);
  const editor = page.getByRole("textbox", {
    name: "Chapter content",
    exact: true,
  });
  await editor.fill("Keep this paragraph while comparing evidence.");
  const drawer = page.getByRole("complementary", {
    name: "Research and source studio",
  });
  await expect(drawer).toBeVisible();
  const withDrawer = await editor.boundingBox();

  // Ctrl/Cmd+K closes the drawer cleanly and expands editor canvas width
  await page.keyboard.press("Control+k");
  await expect(drawer).toHaveCount(0);
  expect((await editor.boundingBox())!.width).toBeGreaterThan(withDrawer!.width);

  // Ctrl/Cmd+K reopens the Split-Studio drawer
  await page.keyboard.press("Control+k");
  await expect(drawer).toBeVisible();

  await drawer.getByRole("tab", { name: "Otto", exact: true }).click();
  await expect(
    drawer.getByRole("button", { name: "Enable Otto chat", exact: true }),
  ).toBeVisible();

  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await expect(
    drawer.getByRole("tabpanel", { name: "Sources" }),
  ).toBeVisible();

  await expect(editor).toHaveText(
    "Keep this paragraph while comparing evidence.",
  );
  await saved(page);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
