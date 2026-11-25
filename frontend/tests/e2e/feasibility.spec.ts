import { expect, test } from "@playwright/test";

const report = {
  summary: "This is a preliminary review based on the plan you provided.",
  dimensions: Object.fromEntries(
    ["scope", "method_fit", "access", "timeline", "resources", "ethics"].map(
      (key) => [
        key,
        {
          status: "Needs clarification",
          assessment: "Add more detail before relying on this assessment.",
          known: "A topic has been supplied.",
          unknown: "The method has not been decided.",
          citations: [],
        },
      ],
    ),
  ),
  risks: [],
  next_steps: [
    {
      action: "Choose a study design.",
      reason: "The method is currently undecided.",
    },
  ],
  scope_adjustments: [],
  missing_information: ["Proposed method"],
};

test("feasibility intake creates, persists, and deletes a saved review", async ({
  page,
}) => {
  await page.route("**/feasibility", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.inputs.topic).toBe("Air quality and attendance");
    expect(request.evidence).toEqual([]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(report),
    });
  });
  const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await page.addInitScript((id) => {
    localStorage.setItem(
      "thesisdesk-drafts-v1",
      JSON.stringify({
        version: 1,
        projects: [
          {
            id,
            title: "Air quality and attendance",
            citation_style: "apa",
            research_problem: "How does air quality relate to attendance?",
            structure: "blank",
            revision: 0,
          },
        ],
        sections: [],
      }),
    );
  }, projectId);
  await page.goto(`/project/${projectId}`);
  await page
    .getByRole("button", { name: "Feasibility check", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Feasibility check" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator(".feasibility-consent input").check();
  await page
    .getByRole("button", { name: "Create feasibility review" })
    .click();
  await expect(page.getByText(report.summary)).toBeVisible();
  await expect(
    page.locator(".feasibility-fix-card h4", {
      hasText: "Choose a study design.",
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Feasibility check", exact: true })
    .click();
  await expect(page.getByText(report.summary)).toBeVisible();
  await page.getByRole("button", { name: "Delete this review" }).click();
  await expect(
    page.getByRole("tab", { name: /Diagnostic report \(0\)/ }),
  ).toBeDisabled();
});
