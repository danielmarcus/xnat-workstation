/**
 * ContainerListPanel — the unified D7 list panel for all containers
 * (RTSTRUCT structure-sets, DICOM SEGs, POI lists).
 *
 * Phase 3.3 ships the visual shell + per-row rendering. Interactivity
 * (visibility cycling, selection vs active, hover sync, action menus,
 * approval workflow, ROI type editing, provenance, multi-select bulk
 * operations) lands in Phase 3.4 → 3.8.
 *
 * Replaces the legacy AnnotationListPanel + SegmentationPanel split when
 * `multiViewport.enabled` is on; the legacy panels remain mounted under
 * flag-off until Phase 6.
 *
 * Reads from useContainerStore (Phase 3.2 reactive snapshot of the
 * containerBridge). Components don't read the bridge directly.
 *
 * Visual style mirrors the existing AnnotationListPanel / SegmentationPanel
 * (w-64 right-side rail, dark theme, zinc-* tones, xs typography).
 */
import { useContainerStore } from '../../stores/containerStore';
import { containerService } from '../../lib/cornerstone/containerService';
import { nextVisibilityMode } from '../../lib/cornerstone/segmentationService/memberVisibility';
import type { Container, Member, RGB, VisibilityMode } from '../../types/annotation';

export default function ContainerListPanel() {
  const containers = useContainerStore((s) => s.containers);
  const containerList = Array.from(containers.values());

  return (
    <div
      data-testid="container-panel"
      className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between min-h-[36px]">
        <h3 className="text-xs font-semibold text-zinc-300">
          Structures
          <span
            data-testid="container-count"
            className="text-zinc-500 font-normal ml-1.5"
          >
            {containerList.length}
          </span>
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {containerList.length === 0 ? (
          <div
            data-testid="container-panel-empty"
            className="p-4 text-xs text-zinc-600 text-center leading-relaxed"
          >
            No structures yet.
            <br />
            <span className="text-zinc-700">
              Create a new structure-set or load one from XNAT.
            </span>
          </div>
        ) : (
          <ul className="py-0.5">
            {containerList.map((container) => (
              <ContainerRow key={container.id} container={container} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Row components ────────────────────────────────────────────────

function ContainerRow({ container }: { container: Container }) {
  return (
    <li
      data-testid={`container-row:${container.id}`}
      className="border-b border-zinc-800/50"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/30">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold ${kindColor(container.kind)}`}
        >
          {container.kind}
        </span>
        <span className="flex-1 text-xs text-zinc-200 truncate" title={container.name}>
          {container.name}
        </span>
        {container.dirty && (
          <span
            data-testid={`container-dirty:${container.id}`}
            className="w-1.5 h-1.5 rounded-full bg-amber-500"
            title="Unsaved changes"
            aria-label="unsaved changes"
          />
        )}
        {container.approval.approved && (
          <span
            data-testid={`container-approved:${container.id}`}
            className="text-[9px] uppercase font-semibold text-emerald-400"
            title={
              container.approval.reviewerName
                ? `Approved by ${container.approval.reviewerName}`
                : 'Approved'
            }
          >
            ✓ approved
          </span>
        )}
      </div>

      {container.members.length === 0 ? (
        <div
          data-testid={`container-no-members:${container.id}`}
          className="px-6 py-1 text-[11px] text-zinc-600 italic"
        >
          (empty)
        </div>
      ) : (
        <ul>
          {container.members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </ul>
      )}
    </li>
  );
}

function MemberRow({ member }: { member: Member }) {
  return (
    <li
      data-testid={`member-row:${member.id}`}
      className="flex items-center gap-2 pl-6 pr-3 py-1 hover:bg-zinc-800/40"
    >
      <span
        data-testid={`member-color:${member.id}`}
        className="w-2.5 h-2.5 rounded-sm shrink-0 border border-zinc-700"
        style={{ backgroundColor: rgbCss(member.color) }}
        aria-label={`color ${rgbCss(member.color)}`}
      />
      <span
        className="flex-1 text-xs text-zinc-300 truncate"
        title={member.name}
      >
        {member.name}
      </span>
      <button
        type="button"
        data-testid={`member-visibility:${member.id}`}
        className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors px-0.5"
        title={`Visibility: ${member.visibility} (click to cycle)`}
        aria-label={`visibility ${member.visibility}`}
        onClick={(e) => {
          e.stopPropagation();
          containerService.setMemberVisibility(member.id, nextVisibilityMode(member.visibility));
        }}
      >
        {visibilityGlyph(member.visibility)}
      </button>
      {member.locked && (
        <span
          data-testid={`member-locked:${member.id}`}
          className="text-[10px] text-amber-500"
          title="Locked"
          aria-label="locked"
        >
          🔒
        </span>
      )}
    </li>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function rgbCss(color: RGB): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function visibilityGlyph(mode: VisibilityMode): string {
  switch (mode) {
    case 'hidden':
      return '○';
    case 'outlined':
      return '◐';
    case 'filled':
      return '●';
  }
}

function kindColor(kind: Container['kind']): string {
  switch (kind) {
    case 'RTSTRUCT':
      return 'text-violet-400';
    case 'SEG':
      return 'text-cyan-400';
    case 'POI':
      return 'text-amber-400';
  }
}
