/** The compute worker (branch 4, C2): one request at a time; see protocol.ts. */
import { handleComputeRequest, type ComputeRequest, type ComputeResponse } from './protocol';

const scope = self as unknown as { postMessage: (m: ComputeResponse, t?: Transferable[]) => void; onmessage: ((e: MessageEvent<ComputeRequest>) => void) | null };
scope.onmessage = (e) => handleComputeRequest(e.data, (msg, transfer) => scope.postMessage(msg, transfer ?? []));
