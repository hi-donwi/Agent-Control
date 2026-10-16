import { Component, useMemo, type ReactNode } from 'react';
import {
  UIDocumentRenderer,
  createDocumentState,
  meridianDarkTheme,
  meridianLightTheme,
  type CommandRequest,
  type UIDLDocument,
} from 'uidl-runtime';
import { deskAdapter } from './adapter';

/** A malformed section must not take the drawer down with it. */
class SectionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <p className="section-error" role="alert">[ERROR] This section could not render: {this.state.error.message}</p>;
    }
    return this.props.children;
  }
}

/**
 * One drawer section: a UIDL document rendered by uidl-runtime, reading through the desk
 * adapter. The renderer runs `$query` data sources only with a state store, where each
 * result lands under `state.$data.<name>`; a section gets a fresh one per document.
 */
/** Host commands a section may run, by name; each gets the document state and the payload. */
export type SectionCommands = Record<string, (state: Record<string, unknown>, payload: Record<string, unknown>) => Promise<unknown>>;

interface Props {
  document: UIDLDocument;
  dark: boolean;
  commands?: SectionCommands;
}

export function SectionView({ document, dark, commands }: Props) {
  return (
    <SectionBoundary key={document.id}>
      <Section key={document.id} document={document} dark={dark} commands={commands} />
    </SectionBoundary>
  );
}

function Section({ document, dark, commands }: Props) {
  // Callers rebuild documents on every floor poll; an equal document must keep its identity,
  // or the renderer would abort and refetch its queries every five seconds.
  const content = JSON.stringify(document);
  const stable = useMemo(() => JSON.parse(content) as UIDLDocument, [content]);
  const stateStore = useMemo(() => createDocumentState(stable.state ?? {}).getState(), [stable]);
  // A command the section does not offer fails with a message, never silently.
  const commandHandler = useMemo(() => async (request: CommandRequest) => {
    const run = commands?.[request.name];
    if (!run) throw new Error(`This section cannot run ${request.name}.`);
    return run((stateStore.getValue() ?? {}) as Record<string, unknown>, request.payload ?? {});
  }, [commands, stateStore]);
  return (
    <div className="section-doc" data-section={stable.id}>
      <UIDocumentRenderer
        document={stable}
        stateStore={stateStore}
        dataAdapter={deskAdapter}
        commandHandler={commandHandler}
        theme={dark ? meridianDarkTheme : meridianLightTheme}
      />
    </div>
  );
}
