import { afterEach, expect, rs, test } from "@rstest/core";
import { NextRequest } from "next/server";

import * as nested from "@/app/api/memory/[...path]/route";
import * as root from "@/app/api/memory/route";

afterEach(() => {
  rs.restoreAllMocks();
});
for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
  test(`nested proxy preserves query and request for ${method}`, async () => {
    const fetch = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ facts: [] }));
    const body =
      method === "POST" || method === "PATCH"
        ? JSON.stringify({ content: "new" })
        : undefined;
    await nested[method](
      new NextRequest(
        "http://localhost/api/memory/facts/id?agent_name=writer",
        { method, body },
      ),
      { params: Promise.resolve({ path: ["facts", "id"] }) },
    );
    const [url, init] = fetch.mock.calls[0]!;
    expect(
      new URL(url instanceof Request ? url.url : url).searchParams.get(
        "agent_name",
      ),
    ).toBe("writer");
    expect(init?.method).toBe(method);
    if (body)
      expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
  });
}
for (const method of ["GET", "DELETE"] as const) {
  test(`root proxy preserves scope for ${method}`, async () => {
    const fetch = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ facts: [] }));
    await root[method](
      new NextRequest("http://localhost/api/memory?agent_name=__default__", {
        method,
      }),
    );
    expect(
      new URL(fetch.mock.calls[0]![0] as URL).searchParams.get("agent_name"),
    ).toBe("__default__");
  });
}
