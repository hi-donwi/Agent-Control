export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallResult[];
  createdAt: number;
}

export interface ToolCallResult {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'done' | 'error';
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
