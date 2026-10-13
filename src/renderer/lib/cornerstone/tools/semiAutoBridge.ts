/**
 * What the Smart-tab tool classes call — filled in by semiAutoService when it loads.
 *
 * The tool classes are registered with Cornerstone during init; importing the service
 * (and through it the stores and the tool service) from there would drag that whole graph
 * into init. The bridge keeps the classes dependency-free.
 */
export interface SemiAutoBridge {
  clientToWorld(viewportId: string, clientX: number, clientY: number): number[] | null;
  levelTraceAt(viewportId: string, world: number[]): void;
  smartBrushBegin(viewportId: string, world: number[]): boolean;
  smartBrushExtend(world: number[]): void;
  smartBrushEnd(): void;
  setRoi(viewportId: string, corners: number[][]): void;
  addSeedStroke(viewportId: string, kind: 'fg' | 'bg', world: number[]): void;
  extendSeedStroke(world: number[]): void;
  /** The Seeded segmentation painter (branch 5): a stroke of the chosen class, or Background with ⇧. */
  solverSeedBegin(viewportId: string, world: number[], background: boolean): void;
  solverSeedExtend(world: number[]): void;
}

export const semiAutoBridge: Partial<SemiAutoBridge> = {};
