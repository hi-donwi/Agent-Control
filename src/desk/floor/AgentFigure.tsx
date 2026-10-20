import type { ActivityState } from '../types';

/** Known agent tools get their own accent; anything else is neutral. */
const TOOL_TONES: Record<string, string> = {
  'agent-control': 'host',
  'claude-code': 'claude',
  claude: 'claude',
  opencode: 'opencode',
  codex: 'codex',
  antigravity: 'antigravity',
  gemini: 'antigravity',
  cursor: 'cursor',
};

export function toolTone(tool: string): string {
  return TOOL_TONES[tool] ?? 'other';
}

interface Props {
  state: ActivityState;
  tool: string;
  size?: number;
}

/**
 * A 2D agent at its desk. The pose is the state: every state draws its own prop (keyboard,
 * page, terminal, book, thought bubble, raised hand, warning mark), and desk.css animates
 * it. The figure is decorative - the caller writes the state in text beside it.
 */
export function AgentFigure({ state, tool, size = 64 }: Props) {
  const raised = state === 'waiting';
  const tone = toolTone(tool);
  return (
    <svg
      className={`fig fig-${state}`}
      data-tone={toolTone(tool)}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse className="fig-ground" cx="32" cy="60" rx="25" ry="3" />
      <g className="fig-person">
        <rect className="fig-torso" x="21" y="33" width="22" height="15" rx="5" />
        <path className="fig-insignia" d="M29 38h6v5h-6Z" />
        <g className="fig-head">
          {tone === 'codex' && <path className="fig-module" d="M14 19h4v10h-4Zm32 0h4v10h-4Z" />}
          {tone === 'claude' && <path className="fig-module" d="m19 15-4-8 10 5m20 3 4-8-10 5" />}
          {tone === 'antigravity' && <path className="fig-module" d="m16 17-5 7 7 4m30-11 5 7-7 4" />}
          {tone === 'host' && <path className="fig-module" d="M23 13V9h18v4" />}
          <line className="fig-antenna" x1="32" y1="12" x2="32" y2="6.5" />
          <circle className="fig-light" cx="32" cy="5" r="2.2" />
          <rect className="fig-skull" x="17" y="12" width="30" height="22" rx="9" />
          <rect className="fig-face" x="21" y="17" width="22" height="12" rx="5" />
          <g className="fig-eyes">
            <rect x="25.5" y="20.5" width="3.5" height="5" rx="1.75" />
            <rect x="35" y="20.5" width="3.5" height="5" rx="1.75" />
          </g>
        </g>
        <path className="fig-arm fig-arm-left" d={armLeft(state)} />
        {raised ? (
          <g className="fig-raised">
            <path className="fig-arm" d="M43 37 Q52 35 54.5 24.5" />
            <circle className="fig-hand" cx="55" cy="20.5" r="3.6" />
          </g>
        ) : (
          <path className="fig-arm fig-arm-right" d={armRight(state)} />
        )}
      </g>

      <rect className="fig-desk" x="4" y="45" width="56" height="5" rx="2.5" />
      <rect className="fig-leg" x="9" y="50" width="3" height="10" rx="1.5" />
      <rect className="fig-leg" x="52" y="50" width="3" height="10" rx="1.5" />

      {state === 'typing' && (
        <g className="prop-keyboard">
          <rect className="fig-prop" x="21" y="41.5" width="22" height="3.5" rx="1.2" />
          <rect className="key key-1" x="24" y="42.4" width="4" height="1.6" rx="0.6" />
          <rect className="key key-2" x="30" y="42.4" width="4" height="1.6" rx="0.6" />
          <rect className="key key-3" x="36" y="42.4" width="4" height="1.6" rx="0.6" />
        </g>
      )}
      {state === 'reading' && (
        <g className="prop-page">
          <rect className="fig-paper" x="23" y="33.5" width="18" height="12" rx="1.5" />
          <path className="fig-lines" d="M26 37h12M26 40h12M26 43h8" />
        </g>
      )}
      {state === 'running' && (
        <g className="prop-terminal">
          <rect className="fig-term" x="41" y="32" width="19" height="13" rx="2.2" />
          <path className="fig-term-text" d="M44 36.5l2.5 2-2.5 2" />
          <rect className="cursor" x="48.5" y="39.6" width="4" height="1.6" rx="0.5" />
        </g>
      )}
      {state === 'learning' && (
        <g className="prop-book">
          <path className="fig-paper" d="M19 44.5 L31.5 42 L31.5 35.5 L19 38 Z" />
          <path className="fig-paper" d="M45 44.5 L32.5 42 L32.5 35.5 L45 38 Z" />
          <path className="spark spark-1" d="M13 20 l1.6 -2.6 l1.6 2.6 l-1.6 2.6 Z" />
          <path className="spark spark-2" d="M48 16 l1.3 -2.1 l1.3 2.1 l-1.3 2.1 Z" />
          <path className="spark spark-3" d="M10 32 l1.1 -1.8 l1.1 1.8 l-1.1 1.8 Z" />
        </g>
      )}
      {state === 'thinking' && (
        <g className="prop-bubble">
          <circle className="fig-bubble" cx="47.5" cy="12" r="1.5" />
          <circle className="fig-bubble" cx="51" cy="8" r="2.1" />
          <rect className="fig-bubble" x="49" y="0.5" width="15" height="8" rx="4" />
          <circle className="dot dot-1" cx="52.8" cy="4.5" r="1.1" />
          <circle className="dot dot-2" cx="56.5" cy="4.5" r="1.1" />
          <circle className="dot dot-3" cx="60.2" cy="4.5" r="1.1" />
        </g>
      )}
      {state === 'working' && (
        <g className="prop-busy">
          <circle className="dot dot-1" cx="27" cy="47.5" r="1.2" />
          <circle className="dot dot-2" cx="32" cy="47.5" r="1.2" />
          <circle className="dot dot-3" cx="37" cy="47.5" r="1.2" />
        </g>
      )}
      {raised && (
        <g className="badge badge-attn">
          <circle cx="9" cy="10" r="6" />
          <path d="M9 6.6v4.2M9 13.2v0.4" />
        </g>
      )}
      {state === 'warning' && (
        <g className="badge badge-warn">
          <path d="M57 2.5 L63 14 L51 14 Z" />
          <path d="M57 6.8v3.6M57 12v0.3" />
        </g>
      )}
    </svg>
  );
}

function armLeft(state: ActivityState): string {
  if (state === 'typing') return 'M22 37 L25 42';
  if (state === 'reading') return 'M22 37 L24 41';
  return 'M21.5 38 L15 44';
}

function armRight(state: ActivityState): string {
  if (state === 'typing') return 'M42 37 L39 42';
  if (state === 'reading') return 'M42 37 L40 41';
  if (state === 'running') return 'M42.5 38 L46 42';
  return 'M42.5 38 L49 44';
}
