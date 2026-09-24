import { Component, useMemo, useState, useCallback, type ReactNode } from 'react';
import {
  UIDocumentRenderer,
  createDocumentState,
  createRegistry,
  defaultRegistry,
  type UIDLDocument,
  type ComponentRegistry,
} from 'uidl-runtime';

interface UIDLPreviewProps {
  code: string;
}

// Global registry initialized with all default UIDL components
const registry: ComponentRegistry = createRegistry();
for (const manifest of defaultRegistry.list()) {
  registry.register(manifest);
}

// Register helpful fallback/disclosure widget if not present
if (!registry.has('WorkspaceDisclosure')) {
  registry.register({
    type: 'WorkspaceDisclosure',
    category: 'data',
    acceptsChildren: false,
    component: ({ title, content }) => (
      <details className="uidl-disclosure">
        <summary>{String(title ?? 'Details')}</summary>
        <pre>{String(content ?? '')}</pre>
      </details>
    ),
  });
}

/** Error boundary to prevent malformed UIDL from breaking the chat view. */
class UIDLRenderBoundary extends Component<
  { children: ReactNode; onFallback: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('UIDL render error:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="uidl-error-notice">
          <p>⚠️ Unable to render interactive preview: {this.state.error.message}</p>
          <button
            type="button"
            className="uidl-btn-sm"
            onClick={() => {
              this.setState({ error: null });
              this.props.onFallback();
            }}
          >
            View Raw JSON
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Checks if a parsed object is a UIDL document.
 */
export function isUIDLDocument(val: unknown): val is UIDLDocument {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;

  // Check for schema URI or root node structure
  const schemaStr = (typeof obj.$schema === 'string' ? obj.$schema : typeof obj.schema === 'string' ? obj.schema : '') as string;
  const hasSchema = schemaStr.includes('uidl') || schemaStr.includes('agent-workspace');

  const hasRoot =
    Boolean(obj.root) &&
    typeof obj.root === 'object' &&
    typeof (obj.root as Record<string, unknown>).type === 'string';

  return Boolean(hasSchema || hasRoot);
}

export function UIDLPreview({ code }: UIDLPreviewProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'json'>('preview');
  const [copied, setCopied] = useState(false);

  // Parse document and detect validity
  const doc = useMemo(() => {
    try {
      const parsed = JSON.parse(code) as Record<string, unknown>;
      if (isUIDLDocument(parsed)) {
        // Ensure minimal UIDL schema structure
        const validDoc: UIDLDocument = {
          $schema: (parsed.$schema as string) ?? (parsed.schema as string) ?? 'https://agent-workspace.dev/uidl/v1',
          version: (parsed.version as string) ?? '1.0.0',
          id: (parsed.id as string) ?? ((parsed.root as { id?: string })?.id) ?? 'doc-preview',
          name: (parsed.name as string) ?? 'UIDL Preview',
          root: (parsed.root as UIDLDocument['root']) ?? { id: 'root', type: 'Container', children: [] },
          state: (parsed.state as Record<string, unknown>) ?? {},
        };
        return validDoc;
      }
      return null;
    } catch {
      return null;
    }
  }, [code]);

  // Document state store
  const stateStore = useMemo(() => {
    if (!doc) return null;
    return createDocumentState(doc.state ?? {});
  }, [doc]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  // If not a valid UIDL document or has parse error, don't render preview
  if (!doc) {
    return null;
  }

  return (
    <div className="uidl-preview-card">
      <div className="uidl-preview-header">
        <div className="uidl-preview-title">
          <span className="uidl-badge">✦ UIDL</span>
          <span className="uidl-doc-id">{doc.root.id || 'Interactive UI'}</span>
        </div>
        <div className="uidl-preview-actions">
          <div className="uidl-tab-group" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'preview'}
              className={`uidl-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'json'}
              className={`uidl-tab-btn ${activeTab === 'json' ? 'active' : ''}`}
              onClick={() => setActiveTab('json')}
            >
              JSON
            </button>
          </div>
          <button
            type="button"
            className="uidl-copy-btn"
            onClick={handleCopy}
            title="Copy UIDL JSON"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="uidl-preview-body">
        {activeTab === 'preview' ? (
          <div className="uidl-rendered-container">
            <UIDLRenderBoundary onFallback={() => setActiveTab('json')}>
              {stateStore ? (
                <UIDocumentRenderer
                  document={doc}
                  stateStore={stateStore.getState()}
                  registry={registry}
                />
              ) : null}
            </UIDLRenderBoundary>
          </div>
        ) : (
          <pre className="uidl-json-view">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
