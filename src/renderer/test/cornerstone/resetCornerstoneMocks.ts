import type { CornerstoneMockState } from './cornerstoneMocks';

export function resetCornerstoneMocks(state: CornerstoneMockState): void {
  state.reset();
}
