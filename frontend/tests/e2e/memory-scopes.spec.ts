import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

test("memory browser isolates edits and clears across default and custom agents", async ({
  page,
}, testInfo) => {
  mockLangGraphAPI(page);
  const section = {
    summary: "Shared profile: prefers concise answers.",
    updatedAt: "2026-09-01T00:00:00Z",
  };
  const facts = new Map(
    ["__default__", "writer", "coder", "orphan"].map((agent) => [
      agent,
      [
        {
          id: "same",
          content: `${agent} preference`,
          category: "preference",
          confidence: 0.9,
          createdAt: "2026-09-01T00:00:00Z",
          source: "manual",
        },
      ],
    ]),
  );
  await page.route(/\/api\/memory(?:[/?]|$)/, async (route) => {
    const url = new URL(route.request().url());
    const agent = url.searchParams.get("agent_name") ?? "__default__";
    if (url.pathname.endsWith("/capabilities")) {
      await route.fulfill({
        json: {
          scoped_read: true,
          scoped_fact_crud: true,
          scope_discovery: true,
          scoped_clear: true,
          shared_summaries: true,
        },
      });
      return;
    }
    if (url.pathname.endsWith("/scopes")) {
      await route.fulfill({
        json: {
          scopes: [...facts]
            .filter(([name, rows]) => name !== "orphan" || rows.length)
            .map(([agent_name, rows]) => ({
              agent_name,
              display_name:
                agent_name === "writer" ? "Writing assistant" : null,
              fact_count: rows.length,
              last_updated: null,
              orphaned: agent_name === "orphan",
            })),
        },
      });
      return;
    }
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { content: string };
      facts.set(
        agent,
        (facts.get(agent) ?? []).map((fact) => ({
          ...fact,
          content: body.content,
        })),
      );
    } else if (route.request().method() === "DELETE") {
      facts.set(agent, []);
    }
    await route.fulfill({
      json: {
        version: "1.0",
        lastUpdated: "",
        user: {
          workContext: section,
          personalContext: section,
          topOfMind: section,
        },
        history: {
          recentMonths: section,
          earlierContext: section,
          longTermBackground: section,
        },
        facts: facts.get(agent) ?? [],
      },
    });
  });
  await page.goto("/workspace/chats/new");
  await page
    .locator("[data-sidebar='sidebar']")
    .getByRole("button", { name: /Settings and more/ })
    .click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    page.getByText("__default__ preference", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Fact scope", { exact: true }).selectOption("writer");
  await expect(
    page.getByText("writer preference", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit memory fact" });
  await expect(editor).toContainText("Writing assistant (writer)");
  await editor
    .getByLabel("Content", { exact: true })
    .fill("Writing prefers a formal tone");
  await editor.getByRole("button", { name: "Save fact" }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByText("Writing prefers a formal tone", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Fact scope", { exact: true }).selectOption("coder");
  await expect(
    page.getByText("coder preference", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Writing prefers a formal tone", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("Fact scope", { exact: true }).selectOption("orphan");
  await page
    .getByRole("button", { name: "Clear selected agent facts", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Clear selected agent facts",
    exact: true,
  });
  await expect(confirmation).toContainText(
    "Shared summaries and other agents are preserved",
  );
  await confirmation
    .getByRole("button", { name: "Clear selected agent facts", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByLabel("Fact scope", { exact: true })).toHaveValue(
    "__default__",
  );
  await expect(
    page.getByText("__default__ preference", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Fact scope", { exact: true }).selectOption("writer");
  await expect(
    page.getByText("Writing prefers a formal tone", { exact: true }),
  ).toBeVisible();
  await settings.getByRole("radio", { name: "Facts", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("memory-scopes.png"),
    fullPage: true,
  });
});
