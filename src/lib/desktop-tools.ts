export type DesktopToolName = 'ws' | 'brain' | 'rg' | 'git';
export interface DesktopToolStatus {
  name: DesktopToolName;
  available: boolean;
  path: string | null;
  source: 'override' | 'bundled' | 'user-bin' | 'homebrew' | 'login-shell' | 'path' | 'missing';
  overridden: boolean;
}

export function validateDesktopTools(value: unknown): DesktopToolStatus[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop tool status.');
  const tools = (value as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) throw new Error('Invalid desktop tool status.');
  const names = new Set<DesktopToolName>(['ws', 'brain', 'rg', 'git']);
  const sources = new Set<DesktopToolStatus['source']>(['override', 'bundled', 'user-bin', 'homebrew', 'login-shell', 'path', 'missing']);
  if (tools.length !== names.size) throw new Error('Invalid desktop tool status.');
  const found = new Set<DesktopToolName>();
  return tools.map((tool): DesktopToolStatus => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new Error('Invalid desktop tool status.');
    const record = tool as Record<string, unknown>;
    if (Object.keys(record).some((key) => !['name', 'available', 'path', 'source', 'overridden'].includes(key))
      || !names.has(record.name as DesktopToolName)
      || found.has(record.name as DesktopToolName)
      || typeof record.available !== 'boolean'
      || !(record.path === null || (typeof record.path === 'string' && record.path.length > 0))
      || !sources.has(record.source as DesktopToolStatus['source'])
      || typeof record.overridden !== 'boolean'
      || (record.available !== (record.path !== null))
      || (!record.available && record.source !== 'missing')) {
      throw new Error('Invalid desktop tool status.');
    }
    found.add(record.name as DesktopToolName);
    return record as unknown as DesktopToolStatus;
  });
}
