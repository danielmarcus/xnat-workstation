/**
 * ContainerList (Rebuild Phase 3, R3.4/R3.5 glue) — maps the projected
 * Container[] into ContainerRow headers + (when expanded) their MemberRows.
 * Presentational: container/member display state + callbacks are injected by the
 * connected wrapper (R3.8). Member visibility/lock are derived from the Member
 * fields here; eligibility/provenance/metric are supplied via optional resolvers
 * (enriched as later wiring lands).
 */
import type { Container, Member } from '@shared/types/annotation';
import ContainerRow from './ContainerRow';
import MemberRow, { type MemberEligibility, type MemberProvenance, type MemberVisibility } from './MemberRow';

export interface ContainerListHandlers {
  onToggleExpand: (containerId: string) => void;
  onApproveToggle: (containerId: string) => void;
  onAddMember: (containerId: string) => void;
  onSaveContainer: (containerId: string) => void;
  onKebab: (containerId: string) => void;
  onDeleteContainer: (containerId: string) => void;
  onRenameContainer: (containerId: string, name: string) => void;
  onSelectMember: (containerId: string, memberId: string, additive: boolean) => void;
  onActivateMember: (containerId: string, memberId: string) => void;
  onCycleVisibility: (containerId: string, memberId: string) => void;
  onToggleLock: (containerId: string, memberId: string) => void;
  onDeleteMember: (containerId: string, memberId: string) => void;
  onRenameMember: (containerId: string, memberId: string, name: string) => void;
}

export interface ContainerListResolvers {
  isExpanded: (containerId: string) => boolean;
  isActive: (containerId: string, memberId: string) => boolean;
  isSelected: (containerId: string, memberId: string) => boolean;
  crossPanelCount?: (containerId: string) => number | undefined;
  visibilityOf?: (m: Member) => MemberVisibility;
  provenanceOf?: (containerId: string, m: Member) => MemberProvenance | undefined;
  eligibilityOf?: (containerId: string, m: Member) => MemberEligibility;
  sourceSeriesLabelOf?: (containerId: string, m: Member) => string | undefined;
  metricOf?: (containerId: string, m: Member) => string | undefined;
}

export interface ContainerListProps extends ContainerListResolvers {
  containers: Container[];
  handlers: ContainerListHandlers;
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
              crossPanelCount={props.crossPanelCount?.(c.id)}
              onToggleExpand={() => h.onToggleExpand(c.id)}
              onApproveToggle={() => h.onApproveToggle(c.id)}
              onAddMember={() => h.onAddMember(c.id)}
              onSave={() => h.onSaveContainer(c.id)}
              onKebab={() => h.onKebab(c.id)}
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
                    empty={false}
                    onSelect={(additive) => h.onSelectMember(c.id, m.id, additive)}
                    onActivate={() => h.onActivateMember(c.id, m.id)}
                    onCycleVisibility={() => h.onCycleVisibility(c.id, m.id)}
                    onToggleLock={() => h.onToggleLock(c.id, m.id)}
                    onDelete={() => h.onDeleteMember(c.id, m.id)}
                    onRename={(name) => h.onRenameMember(c.id, m.id, name)}
                  />
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
