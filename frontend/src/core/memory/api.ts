import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

import type {
  MemoryCapabilities,
  MemoryScope,
  MemoryFactInput,
  MemoryFactPatchInput,
  UserMemory,
} from "./types";

async function readMemoryResponse<T = UserMemory>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  function formatErrorDetail(detail: unknown): string | null {
    if (typeof detail === "string") {
      return detail;
    }

    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item && typeof item === "object") {
            const record = item as Record<string, unknown>;
            if (typeof record.msg === "string") {
              return record.msg;
            }

            try {
              return JSON.stringify(record);
            } catch {
              return null;
            }
          }

          return String(item);
        })
        .filter(Boolean);

      return parts.length > 0 ? parts.join("; ") : null;
    }

    if (detail && typeof detail === "object") {
      try {
        return JSON.stringify(detail);
      } catch {
        return null;
      }
    }

    if (
      typeof detail === "string" ||
      typeof detail === "number" ||
      typeof detail === "boolean" ||
      typeof detail === "bigint"
    ) {
      return String(detail);
    }

    if (typeof detail === "symbol") {
      return detail.description ?? null;
    }

    return null;
  }

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    const detailMessage = formatErrorDetail(errorData.detail);
    throw new Error(
      detailMessage ?? `${fallbackMessage}: ${response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

function memoryURL(path = "", agentName?: string) {
  const query =
    agentName === undefined
      ? ""
      : `?${new URLSearchParams({ agent_name: agentName.toLowerCase() })}`;
  return `${getBackendBaseURL()}/api/memory${path}${query}`;
}

export async function loadMemory(
  agentName?: string,
  signal?: AbortSignal,
): Promise<UserMemory> {
  const response = await fetch(memoryURL("", agentName), { signal });
  return readMemoryResponse(response, "Failed to fetch memory");
}

export async function clearMemory(): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory`, {
    method: "DELETE",
  });
  return readMemoryResponse(response, "Failed to clear memory");
}

export async function deleteMemoryFact(
  factId: string,
  agentName?: string,
): Promise<UserMemory> {
  const response = await fetch(
    memoryURL(`/facts/${encodeURIComponent(factId)}`, agentName),
    {
      method: "DELETE",
    },
  );
  return readMemoryResponse(response, "Failed to delete memory fact");
}

export async function exportMemory(): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/export`);
  return readMemoryResponse(response, "Failed to export memory");
}

export async function importMemory(memory: UserMemory): Promise<UserMemory> {
  const response = await fetch(`${getBackendBaseURL()}/api/memory/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(memory),
  });
  return readMemoryResponse(response, "Failed to import memory");
}

export async function createMemoryFact(
  input: MemoryFactInput,
  agentName?: string,
): Promise<UserMemory> {
  const response = await fetch(memoryURL("/facts", agentName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return readMemoryResponse(response, "Failed to create memory fact");
}

export async function updateMemoryFact(
  factId: string,
  input: MemoryFactPatchInput,
  agentName?: string,
): Promise<UserMemory> {
  const response = await fetch(
    memoryURL(`/facts/${encodeURIComponent(factId)}`, agentName),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  return readMemoryResponse(response, "Failed to update memory fact");
}

export async function loadMemoryCapabilities(
  signal?: AbortSignal,
): Promise<MemoryCapabilities> {
  return readMemoryResponse<MemoryCapabilities>(
    await fetch(memoryURL("/capabilities"), { signal }),
    "Failed to load memory capabilities",
  );
}

export async function loadMemoryScopes(
  signal?: AbortSignal,
): Promise<{ scopes: MemoryScope[] }> {
  return readMemoryResponse<{ scopes: MemoryScope[] }>(
    await fetch(memoryURL("/scopes"), { signal }),
    "Failed to load memory scopes",
  );
}

export async function clearMemoryFacts(agentName: string): Promise<UserMemory> {
  return readMemoryResponse(
    await fetch(memoryURL("/facts", agentName), { method: "DELETE" }),
    "Failed to clear selected facts",
  );
}
