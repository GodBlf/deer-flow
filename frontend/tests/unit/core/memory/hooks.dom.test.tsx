import { afterEach, expect, rs, test } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const mocks = rs.hoisted(() => ({ fetch: rs.fn(), user: { id: "alice" } }));
rs.mock("@/core/api/fetcher", () => ({ fetch: mocks.fetch }));
rs.mock("@/core/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mocks.user }),
}));
import {
  memoryKeys,
  useMemory,
  useUpdateMemoryFact,
  useClearMemory,
  useImportMemory,
} from "@/core/memory/hooks";

const doc = (content: string) => ({
  version: "1.0",
  lastUpdated: "",
  user: {},
  history: {},
  facts: [{ id: "same", content }],
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
afterEach(() => {
  cleanup();
  rs.resetAllMocks();
  mocks.user = { id: "alice" };
});

test("a late write stays bound to the initiating user and agent", async () => {
  const { client, wrapper } = setup();
  client.setQueryData(memoryKeys.document("alice", "writer"), doc("writer"));
  client.setQueryData(memoryKeys.document("alice", "coder"), doc("coder"));
  let finish!: (response: Response) => void;
  mocks.fetch.mockReturnValue(
    new Promise<Response>((resolve) => {
      finish = resolve;
    }),
  );
  const { result, rerender } = renderHook(() => useUpdateMemoryFact(), {
    wrapper,
  });
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.mutateAsync({
      agentName: "writer",
      factId: "same",
      input: { content: "updated" },
    });
  });
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  mocks.user = { id: "bob" };
  rerender();
  await act(async () => {
    finish(Response.json(doc("updated")));
    await pending;
  });
  expect(client.getQueryData(memoryKeys.document("alice", "writer"))).toEqual(
    doc("updated"),
  );
  expect(client.getQueryData(memoryKeys.document("alice", "coder"))).toEqual(
    doc("coder"),
  );
  expect(
    client.getQueryData(memoryKeys.document("bob", "writer")),
  ).toBeUndefined();
  expect(String(mocks.fetch.mock.calls[0]?.[0])).toContain("agent_name=writer");
  client.clear();
});

test("switching scopes never shows the previous facts", async () => {
  const { client, wrapper } = setup();
  mocks.fetch
    .mockResolvedValueOnce(Response.json(doc("writer")))
    .mockReturnValue(
      new Promise(() => {
        /* Deliberately unresolved while the new scope loads. */
      }),
    );
  const { result, rerender } = renderHook(({ agent }) => useMemory(agent), {
    wrapper,
    initialProps: { agent: "writer" },
  });
  await waitFor(() =>
    expect(result.current.memory?.facts[0]?.content).toBe("writer"),
  );
  rerender({ agent: "coder" });
  expect(result.current.memory).toBeNull();
  expect(result.current.isLoading).toBe(true);
  client.clear();
});

test("mutation completion cancels a stale read before publishing the result", async () => {
  const { client, wrapper } = setup();
  let finishRead!: (response: Response) => void;
  mocks.fetch.mockImplementation((_url, init) =>
    init?.method === "PATCH"
      ? Promise.resolve(Response.json(doc("new")))
      : new Promise<Response>((resolve) => {
          finishRead = resolve;
        }),
  );
  const { result } = renderHook(
    () => ({ memory: useMemory("writer"), update: useUpdateMemoryFact() }),
    { wrapper },
  );
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  await act(async () => {
    await result.current.update.mutateAsync({
      agentName: "writer",
      factId: "same",
      input: { content: "new" },
    });
  });
  await act(async () => {
    finishRead(Response.json(doc("old")));
  });
  await waitFor(() =>
    expect(result.current.memory.memory?.facts[0]?.content).toBe("new"),
  );
  client.clear();
});

for (const operation of ["clear", "import"]) {
  test(`${operation} invalidates every user scope without touching another user`, async () => {
    const { client, wrapper } = setup();
    for (const user of ["alice", "bob"])
      for (const agent of ["writer", "coder"])
        client.setQueryData(memoryKeys.document(user, agent), doc(agent));
    mocks.fetch.mockResolvedValue(Response.json(doc("default")));
    const { result } = renderHook(
      () => ({ clear: useClearMemory(), import: useImportMemory() }),
      { wrapper },
    );
    await act(async () => {
      if (operation === "clear") await result.current.clear.mutateAsync();
      else await result.current.import.mutateAsync(doc("import") as never);
    });
    for (const agent of ["writer", "coder"]) {
      expect(
        client.getQueryState(memoryKeys.document("alice", agent))
          ?.isInvalidated,
      ).toBe(true);
      expect(
        client.getQueryState(memoryKeys.document("bob", agent))?.isInvalidated,
      ).toBe(false);
    }
    client.clear();
  });
}
