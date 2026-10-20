const LAYOUTS = ['atelier', 'library', 'lab'] as const;

/** Stable scenery only: this does not infer the project's type or activity. */
export function studioLayout(project: string): typeof LAYOUTS[number] {
  let hash = 0;
  for (const character of project) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return LAYOUTS[hash % LAYOUTS.length]!;
}
