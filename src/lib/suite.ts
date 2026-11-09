export type SuiteComponentId =
  | 'agent-control'
  | 'agent-brain'
  | 'agent-workspace'
  | 'agent-skills'
  | 'agent-secure';

export type SuiteComponentState = 'ready' | 'configured' | 'not-configured' | 'not-installed';

export interface SuiteComponent {
  id: SuiteComponentId;
  name: string;
  role: string;
  distribution: string;
  requiredFor: string;
  state: SuiteComponentState;
  detail: string;
}

export interface SuiteManifest {
  schemaVersion: 1;
  name: 'Agent Workspace Suite';
  components: SuiteComponent[];
}
