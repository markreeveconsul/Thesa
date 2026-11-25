import { test, expect } from "@playwright/test";
import { createThesis } from "./helpers";
import AxeBuilder from "@axe-core/playwright";

test("upload, ask, cited answer, exact source page and honest abstention", async ({
  page,
}) => {
  await createThesis(page, "Evidence chat test");
  const drawer = page.getByRole("complementary", {
    name: "Research and source studio",
  });
  await drawer.getByRole("tab", { name: /Sources \(/ }).click();
  await drawer
    .getByLabel("Choose source files")
    .setInputFiles(".source-test-fixtures/study.pdf");
  await expect(drawer.getByText("1 source saved.", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await drawer.getByRole("tab", { name: "Otto", exact: true }).click();
  await drawer
    .getByRole("button", { name: "Enable Otto chat", exact: true })
    .click();
  await drawer
    .getByRole("textbox", { name: "Ask Otto" })
    .fill("What are the interview results?");
  await drawer.getByRole("button", { name: "Send question" }).click();
  await expect(
    drawer.getByRole("article", { name: "Otto answer" }).first(),
  ).toContainText("The source identifies interview results");
  await expect(
    drawer.getByRole("article", { name: "Otto answer" }).first(),
  ).toContainText("Page two: interview results.");
  expect(
    (await new AxeBuilder({ page }).include(".studio-drawer").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: "test-results/otto-cited-answer.png",
    fullPage: true,
  });

  await drawer
    .getByRole("button", { name: "study.pdf · page 2", exact: true })
    .click();
  await expect(drawer.locator("canvas")).toHaveAttribute("aria-label", /page 2/i);

  await drawer.getByRole("tab", { name: "Otto", exact: true }).click();
  await drawer
    .getByRole("textbox", { name: "Ask Otto" })
    .fill("Can you explain that more?");
  await drawer.getByRole("button", { name: "Send question" }).click();
  await expect(
    drawer.getByRole("article", { name: "Otto answer" }).last(),
  ).toContainText("In plain language");
  await expect(
    drawer.getByRole("article", { name: "Otto answer" }).last(),
  ).toContainText("Page two: interview results.");
  await drawer
    .getByRole("textbox", { name: "Ask Otto" })
    .fill("Which telescope observed Jupiter?");
  await drawer.getByRole("button", { name: "Send question" }).click();
  await expect(
    drawer.getByRole("article", { name: "Otto answer" }).last(),
  ).toContainText("I can't find this in your documents.");
  await expect(
    drawer
      .getByRole("article", { name: "Otto answer" })
      .last()
      .getByRole("button", { name: "study.pdf · page 2", exact: true }),
  ).toHaveCount(0);

  await createThesis(page, "Separate project");
  const separateDrawer = page.getByRole("complementary", {
    name: "Research and source studio",
  });
  await separateDrawer.getByRole("tab", { name: "Otto", exact: true }).click();
  await separateDrawer
    .getByRole("textbox", { name: "Ask Otto" })
    .fill("What are the interview results?");
  await separateDrawer.getByRole("button", { name: "Send question" }).click();
  await expect(separateDrawer.locator(".otto-error")).toContainText(
    "No sources are uploaded for this project in this browser.",
  );
  await expect(
    separateDrawer.getByRole("article", { name: "Otto answer" }),
  ).toHaveCount(0);
});
