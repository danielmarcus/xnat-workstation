/**
 * ContainerList (Rebuild Phase 3, R3.4/R3.5 glue) — maps the projected
 * Container[] into ContainerRow headers + (when expanded) their MemberRows.
 * Presentational: container/member display state + callbacks are injected by the
 * connected wrapper (R3.8). Member visibility/lock are derived from the Member
 * fields here; eligibility/provenance/metric are supplied via optional resolvers
 * (enriched as later wiring lands).
 */
import type { Container, Member } from '@shared/types/annotation';
import ContainerRow, { type RowTransport } from './ContainerRow';
import MemberRow, { type MemberEligibility, type MemberProvenance, type MemberVisibility } from './MemberRow';

export interface ContainerListHandlers {
  onToggleExpand: (containerId: string) => void;
  onApproveToggle: (containerId: string) => void;
  onAddMember: (containerId: string) => void;
  onSaveContainer: (containerId: string) => void;
  /** Open the H7 conflict resolver for a container in save-conflict. */
  onResolveConflict: (containerId: string) => void;
  onKebab: (containerId: string) => void;
  /** Kebab: set visibility for every member of a container. */
  onSetAllVisible: (containerId: string, visible: boolean) => void;
  /** Kebab: set lock for every member of a container. */
  onSetAllLocked: (containerId: string, locked: boolean) => void;
  /** Kebab: revert a container to last-saved. Optional — the menu item only shows when provided. */
  onRevertContainer?: (containerId: string) => void;
  /** Kebab: export a container as a standalone DICOM file. */
  onExportContainerDicom: (containerId: string) => void;
  /** Kebab: export a container's per-member metrics as CSV. */
  onExportContainerCsv: (containerId: string) => void;
  /** Kebab: delete a container's scan on the XNAT server. Optional — the menu item
   *  only shows when provided AND the container has a server copy. */
  onDeleteFromServer?: (containerId: string) => void;
  onDeleteContainer: (containerId: string) => void;
  onRenameContainer: (containerId: string, name: string) => void;
  /** The container's inline name edit was accepted (Enter/blur) — used to advance the create flow. */
  onContainerEditCommit?: (containerId: string) => void;
  /** Activate a container by clicking its name (no specific member) — switches the
   *  active annotation type + routes new drawing into it. */
  onActivateContainer: (containerId: string) => void;
  onSelectMember: (containerId: string, memberId: string, additive: boolean) => void;
  onActivateMember: (containerId: string, memberId: string) => void;
  onCycleVisibility: (containerId: string, memberId: string) => void;
  onToggleLock: (containerId: string, memberId: string) => void;
  onDeleteMember: (containerId: string, memberId: string) => void;
  onRenameMember: (containerId: string, memberId: string, name: string) => void;
  /** A member's inline name edit was accepted (Enter/blur) — ends the create naming
   *  sequence so focus can return to the viewport. */
  onMemberEditCommit?: (containerId: string, memberId: string) => void;
  onColorChange: (containerId: string, memberId: string, color: [number, number, number, number]) => void;
}

export interface ContainerListResolvers {
  isExpanded: (containerId: string) => boolean;
  isActive: (containerId: string, memberId: string) => boolean;
  isSelected: (containerId: string, memberId: string) => boolean;
  crossPanelCount?: (containerId: string) => number | undefined;
  /** Live transport state per container (saving / conflict / error indicators). */
  transportOf?: (containerId: string) => RowTransport | undefined;
  visibilityOf?: (m: Member) => MemberVisibility;
  provenanceOf?: (containerId: string, m: Member) => MemberProvenance | undefined;
  /** Whether a member has no geometry yet (signal 17 — shows the "(empty)" marker). */
  emptyOf?: (containerId: string, m: Member) => boolean;
  eligibilityOf?: (containerId: string, m: Member) => MemberEligibility;
  sourceSeriesLabelOf?: (containerId: string, m: Member) => string | undefined;
  metricOf?: (containerId: string, m: Member) => string | undefined;
  /** Settings color sequence offered as palette swatches in the member color picker. */
  palette?: [number, number, number, number][];
}

export interface ContainerListProps extends ContainerListResolvers {
  containers: Container[];
  handlers: ContainerListHandlers;
  /** Freshly-created container id whose name should start in edit mode (D7.6). */
  /** Container whose label is currently receiving captured keystrokes, and the draft. */
  capturingContainerId?: string | null;
  capturedContainerDraft?: string | null;
  /** Member (`"<containerId> <index>"`) receiving captured keystrokes, and the draft. */
  capturingMemberKey?: string | null;
  capturedMemberDraft?: string | null;
  autoEditContainerId?: string | null;
  /** Freshly-created member key (`containerIdmemberId`) to start in edit mode. */
  autoEditMemberKey?: string | null;
  /** Called once a pending auto-edit row has consumed the flag. */
  onEditConsumed?: () => void;
}

function defaultVisibility(m: Member): MemberVisibility {
  return m.visible ? 'filled' : 'hidden';
}

export default function ContainerList(props: ContainerListProps) {
  const { containers, handlers: h } = props;

  return (
    <div data-testid="container-list">
      {containers.map((c) => {
        const approved = c.approval === 'APPROVED';
        return (
          <div key={c.id}>
            <ContainerRow
              container={c}
              expanded={props.isExpanded(c.id)}
              transport={props.transportOf?.(c.id)}
              onResolveConflict={() => h.onResolveConflict(c.id)}
              crossPanelCount={props.crossPanelCount?.(c.id)}
              capturing={props.capturingContainerId === c.id}
              capturedDraft={props.capturingContainerId === c.id ? props.capturedContainerDraft ?? null : null}
              autoEdit={props.autoEditContainerId === c.id}
              onEditConsumed={props.onEditConsumed}
              onCommitName={() => h.onContainerEditCommit?.(c.id)}
              onToggleExpand={() => h.onToggleExpand(c.id)}
              onActivate={() => h.onActivateContainer(c.id)}
              onApproveToggle={() => h.onApproveToggle(c.id)}
              onAddMember={() => h.onAddMember(c.id)}
              onSave={() => h.onSaveContainer(c.id)}
              onKebab={() => h.onKebab(c.id)}
              onSetAllVisible={(visible) => h.onSetAllVisible(c.id, visible)}
              onSetAllLocked={(locked) => h.onSetAllLocked(c.id, locked)}
              onRevert={h.onRevertContainer ? () => h.onRevertContainer!(c.id) : undefined}
              onExportDicom={() => h.onExportContainerDicom(c.id)}
              onExportCsv={() => h.onExportContainerCsv(c.id)}
              onDeleteFromServer={h.onDeleteFromServer ? () => h.onDeleteFromServer!(c.id) : undefined}
              onDelete={() => h.onDeleteContainer(c.id)}
              onRename={(name) => h.onRenameContainer(c.id, name)}
            />
            {props.isExpanded(c.id) &&
              c.members.map((m) => {
                const eligibility = props.eligibilityOf?.(c.id, m) ?? 'native';
                const lockState: 'unlocked' | 'locked' | 'approved' = approved
                  ? 'approved'
                  : m.locked
                    ? 'locked'
                    : 'unlocked';
                return (
                  <MemberRow
                    key={m.id}
                    member={m}
                    visibility={(props.visibilityOf ?? defaultVisibility)(m)}
                    lockState={lockState}
                    active={props.isActive(c.id, m.id)}
                    selected={props.isSelected(c.id, m.id)}
                    provenance={props.provenanceOf?.(c.id, m)}
                    eligibility={eligibility}
                    sourceSeriesLabel={props.sourceSeriesLabelOf?.(c.id, m)}
                    metric={props.metricOf?.(c.id, m)}
                    empty={props.emptyOf?.(c.id, m) ?? false}
                    capturing={props.capturingMemberKey === `${c.id} ${m.id}`}
                  capturedDraft={props.capturingMemberKey === `${c.id} ${m.id}` ? props.capturedMemberDraft ?? null : null}
                  autoEdit={props.autoEditMemberKey === `${c.id} ${m.id}`}
                    onEditConsumed={props.onEditConsumed}
                    palette={props.palette}
                    onSelect={(additive) => h.onSelectMember(c.id, m.id, additive)}
                    onActivate={() => h.onActivateMember(c.id, m.id)}
                    onCycleVisibility={() => h.onCycleVisibility(c.id, m.id)}
                    onToggleLock={() => h.onToggleLock(c.id, m.id)}
                    onDelete={() => h.onDeleteMember(c.id, m.id)}
                    onRename={(name) => h.onRenameMember(c.id, m.id, name)}
                    onCommitName={() => h.onMemberEditCommit?.(c.id, m.id)}
                    onColorChange={(color) => h.onColorChange(c.id, m.id, color)}
                  />
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
