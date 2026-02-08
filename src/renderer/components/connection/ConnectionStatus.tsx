/**
 * ConnectionStatus — compact header bar indicator showing connection
 * state with a disconnect button.
 *
 * Displays: green dot + server URL + username + Disconnect button
 */
import { useConnectionStore } from '../../stores/connectionStore';
import { IconDisconnect } from '../icons';

export default function ConnectionStatus() {
  const connection = useConnectionStore((s) => s.connection);
  const logout = useConnectionStore((s) => s.logout);

  if (!connection) return null;

  // Show just the hostname from the server URL
  let displayUrl = connection.serverUrl;
  try {
    displayUrl = new URL(connection.serverUrl).hostname;
  } catch {
    // Keep full URL if parsing fails
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Green status dot */}
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>

      {/* Server + user info */}
      <span className="text-zinc-400 truncate max-w-[200px]" title={connection.serverUrl}>
        {displayUrl}
      </span>
      <span className="text-zinc-600">/</span>
      <span className="text-zinc-300 font-medium">{connection.username}</span>

      {/* Disconnect button */}
      <button
        onClick={logout}
        className="flex items-center gap-1 text-zinc-500 hover:text-red-400 transition-colors ml-0.5 p-1 rounded hover:bg-zinc-800"
        title="Disconnect from XNAT"
      >
        <IconDisconnect className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
