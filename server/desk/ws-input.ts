import { execFile } from 'node:child_process';
import { join } from 'node:path';

/** Runs `ws <args>` with `input` on stdin and returns stdout; rejects with stderr. */
export type WsInputRunner = (args: string[], input: string) => Promise<string>;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** The first output line that starts with `<word> `, without the word. */
export function reportedLine(output: string, word: string): string {
  return stripAnsi(output).split('\n').map((line) => line.trim())
    .find((line) => line.startsWith(`${word} `))?.slice(word.length + 1) ?? '';
}

/**
 * The real `ws`, run as the desk acting for the operator (`WS_AGENT=agent-control`), with
 * an argument array and never a shell (ADR-0019 §2).
 */
export function realWsInputRunner(workspaceRoot: string): WsInputRunner {
  const wsBin = join(workspaceRoot, '.agents', 'bin', 'ws');
  return (args, input) => new Promise((resolve, reject) => {
    const child = execFile(wsBin, args, {
      cwd: workspaceRoot,
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, PAGER: 'cat', WS_AGENT: 'agent-control' },
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(stripAnsi(stderr || err.message).trim()));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}
