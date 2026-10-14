/**
 * An operation's parameter control, built from its schema — ONE control for the built-in Cleanup
 * operations and for modules' manifest parameters (branch 9, M4: one operation registry), so the
 * two cannot drift.
 */
import { OperationRow } from './OperationsSection';
import type { ModuleParamSpec } from '@shared/modules/manifest';

/** The schema a parameter is declared with: Cleanup's catalog and module manifests share it. */
export type OperationParamSpec = ModuleParamSpec | (Omit<Extract<ModuleParamSpec, { kind: 'number' }>, 'kind'> & { kind: 'number' });

export function OperationParam({ spec, value, onChange }: { spec: OperationParamSpec; value: number | string | boolean; onChange: (v: number | string | boolean) => void }) {
  if (spec.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-300" title={spec.hint}>
        <input type="checkbox" aria-label={spec.label} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {spec.label}
      </label>
    );
  }
  if (spec.kind === 'select') {
    return (
      <OperationRow label={spec.label} title={spec.hint}>
        <select
          aria-label={spec.label}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px]"
        >
          {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </OperationRow>
    );
  }
  return (
    <OperationRow label={spec.label} title={spec.hint}>
      <input
        type="range"
        aria-label={spec.label}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={Number(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 accent-blue-500"
      />
      <span className="text-zinc-300 tabular-nums whitespace-nowrap">
        {Number(value)}{spec.unit ? ` ${spec.unit}` : ''}
      </span>
    </OperationRow>
  );
}
