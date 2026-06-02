import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ScanContextMenu from './ScanContextMenu';

function renderMenu(overrides: Partial<React.ComponentProps<typeof ScanContextMenu>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onOpenInActive: vi.fn(),
    onOpenInPanel: vi.fn(),
    onOpenInMpr: vi.fn(),
    onPin: vi.fn(),
    onCopyUrl: vi.fn(),
  };
  const utils = render(
    <ScanContextMenu
      open
      x={100}
      y={120}
      panelIds={['panel_0', 'panel_1', 'panel_2', 'panel_3']}
      activePanelId="panel_0"
      panelScanMap={{ panel_0: '7', panel_1: null, panel_2: '8', panel_3: null }}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, ...handlers };
}

describe('ScanContextMenu (spec §7.7)', () => {
  it('does not render when open=false', () => {
    render(
      <ScanContextMenu
        open={false}
        x={0} y={0}
        panelIds={[]}
        activePanelId=""
        panelScanMap={{}}
        onClose={() => {}}
        onOpenInActive={() => {}}
        onOpenInPanel={() => {}}
        onOpenInMpr={() => {}}
        onPin={() => {}}
        onCopyUrl={() => {}}
      />,
    );
    expect(screen.queryByTestId('scan-context-menu')).toBeNull();
  });

  it('renders the six spec items', () => {
    renderMenu();
    expect(screen.queryByTestId('scan-ctx-open-active')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-open-panel_0')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-open-panel_1')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-open-panel_2')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-open-panel_3')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-open-mpr')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-pin')).not.toBeNull();
    expect(screen.queryByTestId('scan-ctx-copy-url')).not.toBeNull();
  });

  it('panels with a loaded scan get the "(replaces)" suffix', () => {
    renderMenu();
    expect(screen.getByTestId('scan-ctx-open-panel_0').textContent).toMatch(/Open in panel_0 \(replaces\)/);
    expect(screen.getByTestId('scan-ctx-open-panel_2').textContent).toMatch(/Open in panel_2 \(replaces\)/);
    expect(screen.getByTestId('scan-ctx-open-panel_1').textContent).toMatch(/^Open in panel_1$/);
    expect(screen.getByTestId('scan-ctx-open-panel_3').textContent).toMatch(/^Open in panel_3$/);
  });

  it('panel button for the active panel is disabled (use "Open in active panel" instead)', () => {
    renderMenu();
    expect((screen.getByTestId('scan-ctx-open-panel_0') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('scan-ctx-open-panel_1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('positions itself at (x, y)', () => {
    renderMenu({ x: 250, y: 400 });
    const menu = screen.getByTestId('scan-context-menu') as HTMLUListElement;
    expect(menu.style.top).toBe('400px');
    expect(menu.style.left).toBe('250px');
  });

  it('item callbacks fire + close the menu', () => {
    const { onOpenInActive, onOpenInPanel, onOpenInMpr, onPin, onCopyUrl, onClose } = renderMenu();

    act(() => fireEvent.click(screen.getByTestId('scan-ctx-open-active')));
    expect(onOpenInActive).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Open in panel_N" calls onOpenInPanel with that id', () => {
    const { onOpenInPanel } = renderMenu();
    act(() => fireEvent.click(screen.getByTestId('scan-ctx-open-panel_3')));
    expect(onOpenInPanel).toHaveBeenCalledWith('panel_3');
  });

  it('MPR / Pin / Copy URL each call their handler', () => {
    const { onOpenInMpr, onPin, onCopyUrl } = renderMenu();
    act(() => fireEvent.click(screen.getByTestId('scan-ctx-open-mpr')));
    expect(onOpenInMpr).toHaveBeenCalled();
    act(() => fireEvent.click(screen.getByTestId('scan-ctx-pin')));
    expect(onPin).toHaveBeenCalled();
    act(() => fireEvent.click(screen.getByTestId('scan-ctx-copy-url')));
    expect(onCopyUrl).toHaveBeenCalled();
  });

  it('Escape closes the menu', () => {
    const { onClose } = renderMenu();
    act(() => fireEvent.keyDown(window, { key: 'Escape' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('outside pointerdown closes the menu', () => {
    const { onClose } = renderMenu();
    act(() => fireEvent.pointerDown(document.body));
    expect(onClose).toHaveBeenCalled();
  });
});
