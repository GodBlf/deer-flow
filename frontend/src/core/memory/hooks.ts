import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/core/auth/AuthProvider";

import {
  clearMemory,
  clearMemoryFacts,
  createMemoryFact,
  deleteMemoryFact,
  importMemory,
  loadMemory,
  loadMemoryCapabilities,
  loadMemoryScopes,
  updateMemoryFact,
} from "./api";
import type {
  MemoryFactInput,
  MemoryFactPatchInput,
  UserMemory,
} from "./types";

export const memoryKeys = {
  all: (userId: string) => ["memory", userId] as const,
  // Unscoped legacy backends may interpret omission differently from a default bucket.
  document: (userId: string, agentName?: string) =>
    ["memory", userId, "document", agentName?.toLowerCase() ?? null] as const,
  scopes: (userId: string) => ["memory", userId, "scopes"] as const,
  capabilities: (userId: string) => ["memory", userId, "capabilities"] as const,
};

function useMemoryOwner() {
  return useAuth().user?.id ?? "anonymous";
}

export function useMemory(agentName?: string, enabled = true) {
  const userId = useMemoryOwner();
  const { data, isLoading, error } = useQuery({
    queryKey: memoryKeys.document(userId, agentName),
    queryFn: ({ signal }) => loadMemory(agentName, signal),
    enabled,
  });
  return { memory: data ?? null, isLoading, error };
}

export function useMemoryCapabilities() {
  const userId = useMemoryOwner();
  return useQuery({
    queryKey: memoryKeys.capabilities(userId),
    queryFn: ({ signal }) => loadMemoryCapabilities(signal),
  });
}

export function useMemoryScopes(enabled: boolean) {
  const userId = useMemoryOwner();
  return useQuery({
    queryKey: memoryKeys.scopes(userId),
    queryFn: ({ signal }) => loadMemoryScopes(signal),
    enabled,
  });
}

/** Capture ownership before awaiting. Completion must not use the active selector/account. */
function useMemoryWrite<T>(
  write: (variables: T) => Promise<UserMemory>,
  scopeOf: (variables: T) => string | undefined,
  allScopes = false,
) {
  const userId = useMemoryOwner();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onMutate: async (variables: T) => {
      const owner = userId;
      const key = allScopes
        ? memoryKeys.all(owner)
        : memoryKeys.document(owner, scopeOf(variables));
      await queryClient.cancelQueries({ queryKey: key });
      return { owner, key };
    },
    onSuccess: async (memory, _variables, context) => {
      if (!context) return;
      // Reads can begin while a mutation is in flight (focus, remount, scope switch).
      await queryClient.cancelQueries({ queryKey: context.key });
      if (allScopes) {
        await queryClient.invalidateQueries({
          queryKey: memoryKeys.all(context.owner),
        });
      } else {
        queryClient.setQueryData<UserMemory>(context.key, memory);
        await queryClient.invalidateQueries({
          queryKey: memoryKeys.scopes(context.owner),
        });
      }
    },
    onError: async (_error, _variables, context) => {
      if (context)
        await queryClient.invalidateQueries({ queryKey: context.key });
    },
  });
}

export function useClearMemory() {
  return useMemoryWrite<void>(
    () => clearMemory(),
    () => undefined,
    true,
  );
}

export function useClearMemoryFacts() {
  return useMemoryWrite<{ agentName: string }>(
    ({ agentName }) => clearMemoryFacts(agentName),
    (v) => v.agentName,
  );
}

export function useDeleteMemoryFact() {
  return useMemoryWrite<{ factId: string; agentName?: string }>(
    ({ factId, agentName }) => deleteMemoryFact(factId, agentName),
    (v) => v.agentName,
  );
}

export function useImportMemory() {
  return useMemoryWrite<UserMemory>(
    (memory) => importMemory(memory),
    () => undefined,
    true,
  );
}

export function useCreateMemoryFact() {
  return useMemoryWrite<{ input: MemoryFactInput; agentName?: string }>(
    ({ input, agentName }) => createMemoryFact(input, agentName),
    (v) => v.agentName,
  );
}

export function useUpdateMemoryFact() {
  return useMemoryWrite<{
    factId: string;
    input: MemoryFactPatchInput;
    agentName?: string;
  }>(
    ({ factId, input, agentName }) =>
      updateMemoryFact(factId, input, agentName),
    (v) => v.agentName,
  );
}
