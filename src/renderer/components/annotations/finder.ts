/**
 * The ⌘K finder's entries and matching (R4-A, annotation-panel-modes): every tool, mode and
 * operation of the active annotation type, found by its name today or by the name it had
 * before tools were grouped into families ("threshold" → Brush · Window).
 */
import type { ContainerKind } from '@shared/types/annotation';
import { SEG_FAMILIES, SEG_OPERATIONS, TOOL_LABELS_BEFORE_FAMILIES, toolsForKind, type OperationDescriptor } from './toolCatalog';

export type FinderTarget =
  | { kind: 'tool'; toolId: string }
  | { kind: 'operation'; operationId: string; seededMethod?: 'randomWalker' }
  | { kind: 'measureSegment' };

export interface FinderEntry {
  id: string;
  label: string;
  /** Where it lives, shown beside it: "Tool", "Operation · Fill in"… */
  hint: string;
  /** Other names it is found by. */
  aliases: string[];
  target: FinderTarget;
}

export function finderEntries(kind: ContainerKind, modules: ReadonlyArray<OperationDescriptor> = []): FinderEntry[] {
  if (kind !== 'SEG') {
    return toolsForKind(kind).map((t) => ({ id: `tool:${t.id}`, label: t.label, hint: 'Tool', aliases: [t.title], target: { kind: 'tool', toolId: t.id } }));
  }
  const out: FinderEntry[] = [];
  for (const f of SEG_FAMILIES) {
    if (!f.axes) {
      const id = f.members[0];
      out.push({ id: `tool:${id}`, label: f.label, hint: 'Tool', aliases: [TOOL_LABELS_BEFORE_FAMILIES[id] ?? '', f.title], target: { kind: 'tool', toolId: id } });
      continue;
    }
    for (const id of f.members) {
      const modes = f.modes?.[id];
      if (!modes) continue;
      const parts = f.axes.map((a) => a.options.find((o) => o.value === modes[a.id])!.label);
      out.push({
        id: `tool:${id}`,
        label: `${f.label} · ${parts.join(' · ')}`,
        hint: 'Tool',
        aliases: [TOOL_LABELS_BEFORE_FAMILIES[id] ?? '', f.label],
        target: { kind: 'tool', toolId: id },
      });
    }
  }
  out.push({ id: 'tool:roiLimit', label: 'ROI limit', hint: 'Tool', aliases: ['region of interest', 'rectangle limit'], target: { kind: 'tool', toolId: 'roiLimit' } });
  for (const o of [...SEG_OPERATIONS, ...modules]) {
    out.push({ id: `op:${o.id}`, label: o.label, hint: `Operation · ${o.group}`, aliases: [o.title], target: { kind: 'operation', operationId: o.id } });
  }
  out.push({ id: 'op:seeded:randomWalker', label: 'Random Walker', hint: 'Operation · Seeded segmentation', aliases: ['Rnd. Walker'], target: { kind: 'operation', operationId: 'seeded', seededMethod: 'randomWalker' } });
  out.push({ id: 'action:measureSegment', label: 'Measure segment axes', hint: 'Segmentation ⋮', aliases: ['Seg Bidir.', 'bidirectional', 'long axis'], target: { kind: 'measureSegment' } });
  return out;
}

/** The entries matching `query`, best first: a label starting with it, then containing it, then an alias. */
export function findEntries(entries: FinderEntry[], query: string): FinderEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const rank = (e: FinderEntry) => {
    const label = e.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (label.includes(q)) return 1;
    if (e.aliases.some((a) => a.toLowerCase().includes(q))) return 2;
    return -1;
  };
  return entries
    .map((e, i) => ({ e, r: rank(e), i }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}
