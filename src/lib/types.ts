export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallResult[];
  evidence?: EvidenceMetadata[];
  createdAt: number;
}

export type ToolCallStatus = 'pending' | 'done' | 'error';

export interface ToolCallResult {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
}

export type EvidenceReference =
  | { kind: 'task'; id: string; scope?: string }
  | { kind: 'approval'; id: string }
  | { kind: 'diff'; id: string };

export interface EvidenceMetadata {
  id: string;
  tool: string;
  status: ToolCallStatus;
  references: EvidenceReference[];
}

export interface Provider {
  id: string;
  name: string;
  models: string[];
  /** Loopback is local; everything else is remote and needs a project that allows it. */
  locality?: 'local' | 'remote';
}

export interface ProjectInfo {
  key: string;
  client: string;
  folder: string;
  /** Endpoints this project's policy lets receive its context; null means local only. */
  allowedEndpoints: string[] | null;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

export interface ProvidersResponse {
  providers: Provider[];
  defaultProvider: string;
  defaultModel: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApprovalRequest {
  id: string;
  project: string;
  headSha: string;
  action: string;
  inputHash: string;
  policyHash: string;
  requestedAt: string;
  expiresAt: string;
}

export interface CodingSession {
  id: string;
  project: string;
  worktree: string;
  branch: string;
  startedAt: string;
  brief?: string;
  cardKey?: string;
  verify?: SessionVerify;
  shipped?: { head: string; base: string; commits: number; at: string };
}

/** The latest `ws verify` of a coding session's worktree (server/hand-back.ts). */
export interface SessionVerify {
  state: 'running' | 'pass' | 'findings' | 'incomplete' | 'stale' | 'error';
  tree: string;
  startedAt: string;
  finishedAt?: string;
  commands?: Array<{ id: string; status: string; required?: boolean; duration_ms?: number }>;
  error?: string;
}
