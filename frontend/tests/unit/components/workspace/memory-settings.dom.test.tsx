import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const mocks = rs.hoisted(() => ({ fetch: rs.fn() }));
rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "alice" } }),
}));
rs.mock("@/core/streamdown/plugins", () => ({ streamdownPlugins: {} }));
rs.mock("@/core/streamdown/components", () => ({
  SafeStreamdown: ({ children }: { children: string }) => <div>{children}</div>,
  toStreamdownComponents: () => ({}),
}));

import { MemorySettingsPage } from "@/components/workspace/settings/memory-settings-page";
import { I18nProvider } from "@/core/i18n/context";


const capabilities = {
  scoped_read: true,
  scoped_fact_crud: true,
  scope_discovery: true,
  scoped_clear: true,
  shared_summaries: true,
};
const section = {
  summary: "shared profile",
  updatedAt: "2026-09-01T00:00:00Z",
};
const document = (agent: string) => ({
  version: "1.0",
  lastUpdated: "",
  user: { workContext: section, personalContext: section, topOfMind: section },
  history: {
    recentMonths: section,
    earlierContext: section,
    longTermBackground: section,
  },
  facts: [
    {
      id: "same",
      content: `${agent} fact`,
      category: "context",
      confidence: 0.9,
      createdAt: "2026-09-01T00:00:00Z",
      source: "unknown",
    },
  ],
});
const scopes = ["__default__", "writer", "coder"].map((agent_name) => ({
  agent_name,
  display_name: null,
  fact_count: 1,
  last_updated: null,
  orphaned: false,
}));
function setup(scoped = true) {
  mocks.fetch.mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/capabilities"))
      return Promise.resolve(
        Response.json(
          scoped
            ? capabilities
            : { ...capabilities, scoped_read: false, scope_discovery: false },
        ),
      );
    if (url.pathname.endsWith("/scopes"))
      return Promise.resolve(Response.json({ scopes }));
    const agent = url.searchParams.get("agent_name") ?? "__default__";
    return Promise.resolve(
      Response.json(
        init?.method === "DELETE"
          ? { ...document(agent), facts: [] }
          : document(agent),
      ),
    );
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en-US">
        <MemorySettingsPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => {
  cleanup();
  rs.resetAllMocks();
});

test("selector switches among default and two agents and resets the editor", async () => {
  const client = setup();
  await screen.findByText("__default__ fact");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog").textContent).toContain("Default assistant");
  fireEvent.change(screen.getByLabelText("Fact scope"), {
    target: { value: "writer" },
  });
  await screen.findByText("writer fact");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("__default__ fact")).toBeNull();
  fireEvent.change(screen.getByLabelText("Fact scope"), {
    target: { value: "coder" },
  });
  await screen.findByText("coder fact");
  expect(screen.getAllByText("Shared user context")).toHaveLength(1);
  expect(screen.queryByRole("link", { name: "View" })).toBeNull();
  expect(
    screen.getByText(
      /Import \/ export: shared summaries and default assistant facts/,
    ),
  ).toBeTruthy();
  client.clear();
});

test("selected clear and all-memory clear have separate confirmations and URLs", async () => {
  const client = setup();
  await screen.findByText("__default__ fact");
  fireEvent.change(screen.getByLabelText("Fact scope"), {
    target: { value: "writer" },
  });
  await screen.findByText("writer fact");
  fireEvent.click(
    screen.getByRole("button", { name: "Clear selected agent facts" }),
  );
  expect(screen.getByRole("dialog").textContent).toContain(
    "Shared summaries and other agents are preserved",
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Clear selected agent facts",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    mocks.fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith("/memory/facts?agent_name=writer") &&
        init?.method === "DELETE",
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Clear all memory" }));
  expect(screen.getByRole("dialog").textContent).toContain(
    "all saved summaries and facts",
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Clear all memory",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    mocks.fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith("/memory") && init?.method === "DELETE",
    ),
  ).toBe(true);
  client.clear();
});

test("legacy backend retains unscoped management and explains its limitation", async () => {
  const client = setup(false);
  await screen.findByText("__default__ fact");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Clear selected agent facts" }),
  ).toBeNull();
  expect(
    screen.getByText(/does not support browsing agent scopes/),
  ).toBeTruthy();
  expect(
    mocks.fetch.mock.calls.some(([url]) => String(url).includes("agent_name=")),
  ).toBe(false);
  client.clear();
});
