/**
 * Wraps everything an extension draws (extension framework X2, wireframe E7): a component that
 * throws is contained to its slot and shown there — the rest of the app carries on — with
 * Reload extension and Copy details.
 */
import { Component, type ComponentType, type ErrorInfo } from 'react';
import { reloadExtension } from '../../lib/extensions/rendererHost';
import { useExtensionStore } from '../../stores/extensionStore';

interface Props {
  extId: string;
  extName: string;
  component: ComponentType;
  /** inline: the toolbar's compact warning; card (default): an error card filling the slot. */
  variant?: 'card' | 'inline';
}

function details(extId: string, error: Error): string {
  const ext = useExtensionStore.getState().extensions.find((x) => x.id === extId);
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  return [`Extension: ${extId} ${ext?.version ?? ''}`.trim(), `App: XNAT Workstation ${appVersion}`, '', String(error.stack || error)].join('\n');
}

declare const __APP_VERSION__: string;

export default class ExtensionSlot extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[extensions] ${this.props.extId} failed in its UI:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // A reload registers a new component: try again.
    if (prev.component !== this.props.component && this.state.error) this.setState({ error: null });
  }

  private copy = () => {
    const text = details(this.props.extId, this.state.error!);
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  private reload = () => {
    this.setState({ error: null });
    void reloadExtension(this.props.extId);
  };

  render() {
    const { error } = this.state;
    const { extName, variant = 'card', component: Slot } = this.props;
    if (!error) return <Slot />;
    if (variant === 'inline') {
      return (
        <button
          type="button"
          data-testid="extension-slot-error"
          className="px-1.5 py-0.5 rounded text-[11px] text-red-300 hover:bg-zinc-800"
          title={`${extName} stopped working: ${error.message}. Click to reload it.`}
          onClick={this.reload}
        >
          ⚠ {extName}
        </button>
      );
    }
    return (
      <div data-testid="extension-slot-error" className="m-2 rounded-md border border-red-900 bg-red-950/40 p-2.5 text-[11px] text-red-200 space-y-1">
        <div className="font-medium">{extName} stopped working.</div>
        <div className="text-red-300/80 break-words">{error.message}</div>
        <div className="flex gap-1.5 pt-1">
          <button type="button" className="px-2 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700" onClick={this.reload}>Reload extension</button>
          <button type="button" className="px-2 py-1 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700" onClick={this.copy}>Copy details</button>
        </div>
      </div>
    );
  }
}
