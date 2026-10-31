import { validateSnapshot } from '@context-atlas/model';
import type { ContextEdge, ContextNode, ContextSnapshot, ContextSource, ContextView } from '@context-atlas/viewer';
import type { ProjectDetail } from '../types';

const ROOM_SOURCE_ID = 'room-response';
const IMPLEMENTATION_STATUS = 'proposed' as const;
const EVIDENCE = 'declared' as const;
type ProjectTaskState = NonNullable<NonNullable<ContextNode['details']>['task']>['state'];

function safeId(value: string, fallback: string): string {
  const id = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  return id || fallback;
}

function isSafeRelativePath(path: string): boolean {
  const hasControlCharacter = Array.from(path).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });
  if (
    /^[a-z][a-z\d+.-]*:/i.test(path) ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('%') ||
    hasControlCharacter
  )
    return false;
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function taskState(status: string, blocked: string): ProjectTaskState {
  const normalized = status.trim().toLowerCase().replaceAll('_', '-');
  if (blocked === 'yes' || normalized === 'blocked') return 'blocked';
  if (['done', 'complete', 'completed', 'shipped'].includes(normalized)) return 'done';
  if (['in-progress', 'working', 'active', 'hands', 'review'].includes(normalized)) return 'in-progress';
  return 'todo';
}

function taskPriority(priority: string): 'low' | 'medium' | 'high' {
  const normalized = priority.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'high') return normalized;
  return 'medium';
}

function taskDescription(row: Record<string, string>, fallback: string): string {
  return [
    row.status ? `Status: ${row.status}` : '',
    row.owner ? `Owner: ${row.owner}` : '',
    row.blockedReason ? `Blocked by: ${row.blockedReason}` : '',
    row.notes ? row.notes : '',
  ].filter(Boolean).join(' · ') || fallback;
}

function sourceIdsFor(path: string | undefined, sourcesByPath: Map<string, ContextSource>): string[] {
  const fileSource = path ? sourcesByPath.get(path) : undefined;
  return fileSource ? [ROOM_SOURCE_ID, fileSource.id] : [ROOM_SOURCE_ID];
}

/** Project one already-scoped room response into a validated, non-persistent visual snapshot. */
export function buildProjectSnapshot(detail: ProjectDetail): ContextSnapshot {
  const projectKey = safeId(detail.key, 'project');
  const roomSource: ContextSource = {
    id: ROOM_SOURCE_ID,
    label: 'Selected project room',
    path: `api/agent/desk/projects/${projectKey}`,
    revision: detail.memory.updated || 'current-room-response',
    freshness: 'current',
  };
  const sources: ContextSource[] = [roomSource];
  const sourcesByPath = new Map<string, ContextSource>();
  const seenPaths = new Set<string>();

  detail.context.pack.forEach((path, index) => {
    if (!isSafeRelativePath(path) || seenPaths.has(path)) return;
    seenPaths.add(path);
    const source: ContextSource = {
      id: `context-source-${index + 1}`,
      label: path.split('/').at(-1) || `Context source ${index + 1}`,
      path,
      revision: detail.memory.updated || 'current-room-response',
      freshness: 'current',
    };
    sources.push(source);
    sourcesByPath.set(path, source);
  });

  const nodes: ContextNode[] = [];
  const edges: ContextEdge[] = [];
  const addChild = (node: ContextNode): void => {
    nodes.push(node);
    edges.push({
      id: `relation-${edges.length + 1}`,
      source: 'project',
      target: node.id,
      relation: 'contains',
      sourceIds: node.sourceIds,
      evidence: EVIDENCE,
    });
  };

  const projectNotes = [
    detail.memory.stage ? `Stage: ${detail.memory.stage}` : '',
    detail.memory.focus ? `Focus: ${detail.memory.focus}` : '',
  ].filter(Boolean);
  const projectPath = `context/memory/projects/${detail.key}/project.md`;
  nodes.push({
    id: 'project',
    kind: 'module',
    label: detail.key,
    description: detail.description || 'Selected project context and current work.',
    sourceIds: sourceIdsFor(projectPath, sourcesByPath),
    status: IMPLEMENTATION_STATUS,
    evidence: EVIDENCE,
    tags: ['selected-project'],
    ...(projectNotes.length ? { details: { notes: projectNotes } } : {}),
  });

  const contextNodeIds: string[] = [];
  detail.context.pack.forEach((path, index) => {
    const source = sourcesByPath.get(path);
    if (!source) return;
    const id = `context-document-${index + 1}`;
    addChild({
      id,
      kind: 'document',
      moduleId: 'project',
      label: source.label,
      description: 'Listed in the selected project context pack. The source file is not opened by this view.',
      sourceIds: [source.id],
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['context-pack'],
    });
    contextNodeIds.push(id);
  });

  const taskNodeIds: string[] = [];
  detail.tasks.forEach((task, index) => {
    const id = `backlog-task-${safeId(task.id || task.title || '', `item-${index + 1}`)}-${index + 1}`;
    addChild({
      id,
      kind: 'task',
      moduleId: 'project',
      label: task.title || task.id || `Task ${index + 1}`,
      description: taskDescription(task, 'Project backlog task.'),
      sourceIds: [ROOM_SOURCE_ID],
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['backlog'],
      details: {
        task: {
          state: taskState(task.status || '', task.blocked || ''),
          priority: taskPriority(task.priority || ''),
        },
        ...(task.blockedReason ? { notes: [task.blockedReason] } : {}),
      },
    });
    taskNodeIds.push(id);
  });

  const planNodeIds: string[] = [];
  const journeySteps: NonNullable<ContextView['steps']> = [];
  detail.plans.forEach((plan, index) => {
    const id = `plan-step-${safeId(plan.id || plan.task || '', `item-${index + 1}`)}-${index + 1}`;
    const label = plan.task || `Plan step ${index + 1}`;
    const node: ContextNode = {
      id,
      kind: 'task',
      moduleId: 'project',
      label,
      description: taskDescription(plan, plan.run ? `Open run: ${plan.run}` : 'Open run plan step.'),
      sourceIds: [ROOM_SOURCE_ID],
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['run-plan'],
      details: {
        task: { state: taskState(plan.status || '', plan.status === 'blocked' ? 'yes' : ''), priority: 'medium' },
        ...(plan.notes ? { notes: [plan.notes] } : {}),
      },
    };
    addChild(node);
    planNodeIds.push(id);
    journeySteps.push({
      nodeId: id,
      label,
      ...(plan.run ? { description: plan.run } : {}),
    });
  });

  const studyNodeIds: string[] = [];
  const decisionsPath = `context/memory/projects/${detail.key}/decisions.md`;
  detail.memory.decisions.forEach((decision, index) => {
    const id = `decision-${index + 1}`;
    addChild({
      id,
      kind: 'decision',
      moduleId: 'project',
      label: decision.title,
      description: decision.date ? `Recorded ${decision.date}.` : 'Recorded project decision.',
      sourceIds: sourceIdsFor(decisionsPath, sourcesByPath),
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['decision'],
    });
    studyNodeIds.push(id);
  });

  detail.memory.notes.forEach((note, index) => {
    const id = `project-note-${index + 1}`;
    addChild({
      id,
      kind: 'document',
      moduleId: 'project',
      label: note.name || `Note ${index + 1}`,
      description: note.excerpt || 'Project note from the selected room response.',
      sourceIds: [ROOM_SOURCE_ID],
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['note'],
    });
    studyNodeIds.push(id);
  });

  detail.memory.log.forEach((entry, index) => {
    const id = `project-log-${index + 1}`;
    addChild({
      id,
      kind: 'document',
      moduleId: 'project',
      label: entry.date ? `Log ${entry.date}` : `Log entry ${index + 1}`,
      description: entry.text,
      sourceIds: [ROOM_SOURCE_ID],
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['project-log'],
    });
    studyNodeIds.push(id);
  });

  detail.memory.nextUp.forEach((item, index) => {
    const id = `next-up-${index + 1}`;
    addChild({
      id,
      kind: 'task',
      moduleId: 'project',
      label: item,
      description: 'Listed in project memory as upcoming work.',
      sourceIds: sourceIdsFor(`context/memory/projects/${detail.key}/active.md`, sourcesByPath),
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['next-up'],
      details: { task: { state: 'todo', priority: 'medium' } },
    });
    studyNodeIds.push(id);
  });

  detail.memory.blockedOn.forEach((blocker, index) => {
    const id = `memory-blocker-${index + 1}`;
    const description = [blocker.waitingFor, blocker.since ? `Since ${blocker.since}` : '']
      .filter(Boolean).join(' · ');
    addChild({
      id,
      kind: 'task',
      moduleId: 'project',
      label: blocker.item,
      description: description || 'Listed as a project blocker.',
      sourceIds: sourceIdsFor(`context/memory/projects/${detail.key}/active.md`, sourcesByPath),
      status: IMPLEMENTATION_STATUS,
      evidence: EVIDENCE,
      tags: ['blocked'],
      details: { task: { state: 'blocked', priority: 'medium' } },
    });
    studyNodeIds.push(id);
  });

  const allNodeIds = nodes.map((node) => node.id);
  const views: ContextView[] = [
    {
      id: 'overview',
      kind: 'overview',
      label: 'Overview',
      description: 'Project context and the facts available from the selected room response.',
      nodeIds: allNodeIds,
    },
  ];
  if (planNodeIds.length) {
    views.push({
      id: 'run-plan',
      kind: 'journey',
      label: 'Run plan',
      description: 'Ordered steps from open run plans; this is project work, not a user journey.',
      nodeIds: planNodeIds,
      steps: journeySteps,
    });
    for (let index = 1; index < planNodeIds.length; index += 1) {
      const from = planNodeIds[index - 1]!;
      const to = planNodeIds[index]!;
      edges.push({
        id: `sequence-${index}`,
        source: from,
        target: to,
        relation: 'precedes',
        sourceIds: [ROOM_SOURCE_ID],
        evidence: EVIDENCE,
      });
    }
  }
  if (taskNodeIds.length || planNodeIds.length) {
    views.push({
      id: 'work',
      kind: 'work',
      label: 'Work',
      description: 'Backlog tasks and plan steps from the selected project room.',
      nodeIds: [...taskNodeIds, ...planNodeIds],
    });
  }
  if (studyNodeIds.length || contextNodeIds.length) {
    views.push({
      id: 'study',
      kind: 'study',
      label: 'Study',
      description: 'Project decisions, notes, recent log entries, and open questions.',
      nodeIds: [...contextNodeIds, ...studyNodeIds],
    });
  }

  const snapshot: ContextSnapshot = {
    schemaVersion: '1.0',
    project: {
      id: projectKey,
      name: detail.key || 'Project',
      description: detail.description || 'Selected project context and current work.',
      kind: 'general',
      capabilities: views.map((view) => view.kind),
      tags: [],
      version: detail.memory.updated || 'current-room-response',
    },
    sources,
    nodes,
    edges,
    views,
  };
  const result = validateSnapshot(snapshot);
  if (!result.success) {
    const issue = result.issues[0];
    throw new Error(issue ? `Project context is invalid at ${issue.path}: ${issue.message}` : 'Project context is invalid.');
  }
  return result.snapshot;
}
