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
