import { expect, test } from "@playwright/test";

test("an interviewer and candidate collaborate on the same canvas", async ({ browser, baseURL }) => {
  const interviewerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  const interviewer = await interviewerContext.newPage();
  const candidate = await candidateContext.newPage();
  const title = `E2E interview ${Date.now()}`;
  const componentLabel = "Load Balancer";
  const appOrigin = new URL(baseURL ?? "http://127.0.0.1:8000").origin;
  await interviewerContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: appOrigin });

  try {
    // The production client signs the seeded interviewer in automatically.
    await interviewer.goto("/");
    await expect(interviewer.getByRole("heading", { name: "Interviews" })).toBeVisible();
    await expect(interviewer.getByText("Maya Kern", { exact: true })).toBeVisible();

    await interviewer.getByRole("link", { name: "New interview" }).click();
    await expect(interviewer).toHaveURL(/\/new$/);
    await interviewer.getByPlaceholder("Design a news feed").fill(title);
    await interviewer.getByLabel("Prompt shown to the candidate").fill("Collaborate on a production architecture.");
    await interviewer.getByRole("button", { name: "Create and open workspace" }).click();

    await expect(interviewer).toHaveURL(/\/room\/[^/]+$/);
    await expect(interviewer.getByRole("heading", { name: title })).toBeVisible();
    await expect(interviewer.getByRole("button", { name: "Copy candidate link" })).toBeEnabled();
    await expect(interviewer.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    // Exercise the sharing control, then use the displayed link as the second client's entry point.
    await interviewer.getByRole("button", { name: "Copy candidate link" }).click();
    await expect(interviewer.getByText("Candidate link copied", { exact: true })).toBeVisible();
    const link = interviewer.locator("code").filter({ hasText: /\/join\// });
    await expect(link).toBeVisible();
    const joinUrl = (await link.textContent())?.trim();
    expect(joinUrl).toMatch(new RegExp(`^${appOrigin}/join/[^/]+$`));
    await expect
      .poll(() => interviewer.evaluate(() => navigator.clipboard.readText()))
      .toBe(joinUrl);

    await candidate.goto(joinUrl!);
    await expect(candidate.getByRole("heading", { name: title })).toBeVisible();
    await candidate.getByLabel("Your name").fill("E2E Candidate");
    await candidate.getByRole("button", { name: "Join interview" }).click();
    await expect(candidate.getByRole("heading", { name: title })).toBeVisible();
    await expect(candidate.getByRole("application", { name: "Interview canvas" })).toBeVisible();
    await expect(candidate.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    // Select a component from the candidate's library and place it on the shared canvas.
    await candidate.getByRole("button", { name: componentLabel, exact: true }).click();
    await expect(candidate.getByText(`Click the canvas to place ${componentLabel}`, { exact: true })).toBeVisible();
    const candidateCanvas = candidate.getByRole("application", { name: "Interview canvas" });
    const canvasBox = await candidateCanvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await candidateCanvas.click({ position: { x: canvasBox!.width / 2, y: canvasBox!.height / 3 } });
    await expect(candidate.locator('svg[aria-label="Interview canvas"] text').filter({ hasText: componentLabel })).toBeVisible();

    // The interviewer must receive the candidate's operation through realtime collaboration.
    await expect(
      interviewer.locator('svg[aria-label="Interview canvas"] text').filter({ hasText: componentLabel }),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await candidateContext.close();
    await interviewerContext.close();
  }
});
