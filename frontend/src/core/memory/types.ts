export interface MemoryFact {
  id: string;
  content: string;
  category: string;
  confidence: number;
  createdAt: string;
  source: string;
  sourceThreadId?: string;
  scope?: { userId: string | null; agentName: string | null };
  updatedAt?: string;
}

export interface MemoryFactInput {
  content: string;
  category: string;
  confidence: number;
}

export interface MemoryFactPatchInput {
  content?: string;
  category?: string;
  confidence?: number;
}

export interface UserMemory {
  version: string;
  lastUpdated: string;
  user: {
    workContext: {
      summary: string;
      updatedAt: string;
    };
    personalContext: {
      summary: string;
      updatedAt: string;
    };
    topOfMind: {
      summary: string;
      updatedAt: string;
    };
  };
  history: {
    recentMonths: {
      summary: string;
      updatedAt: string;
    };
    earlierContext: {
      summary: string;
      updatedAt: string;
    };
    longTermBackground: {
      summary: string;
      updatedAt: string;
    };
  };
  facts: MemoryFact[];
}

export interface MemoryCapabilities {
  scoped_read: boolean;
  scoped_fact_crud: boolean;
  scope_discovery: boolean;
  scoped_clear: boolean;
  shared_summaries: boolean;
}

export interface MemoryScope {
  agent_name: string;
  display_name: string | null;
  fact_count: number;
  last_updated: string | null;
  orphaned: boolean;
}
