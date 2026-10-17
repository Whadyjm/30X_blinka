import { env } from '@/config/env';
import { createHttpApi } from './http-api';
import type { OliApi } from './types';

export type { OliApi } from './types';
export { ApiError, ContractError, errorMessage } from './errors';

/** Fired on any 401 (except GET /me) so the app can drop the session and go to /login. */
export const UNAUTHORIZED_EVENT = 'oli:unauthorized';

const http = createHttpApi({
  base: env.apiBase,
  onUnauthorized: () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  },
});

let mockPromise: Promise<OliApi> | null = null;
const loadMock = () => (mockPromise ??= import('./mock/mock-api').then((m) => m.mockApi));

/**
 * The single entry point for the UI. In `live` mode the mock module is never imported,
 * so it is code-split out of the bundle's critical path.
 */
function resolve(): Promise<OliApi> | OliApi {
  return env.apiMode === 'mock' ? loadMock() : http;
}

export const api: OliApi = new Proxy({} as OliApi, {
  get(_t, prop: string) {
    if (prop === 'invoiceFileUrl') {
      // sync method: resolved by shape — mock sets `fileUrl` on the detail, http derives from the id
      return (inv: Parameters<OliApi['invoiceFileUrl']>[0]) =>
        env.apiMode === 'mock' ? (inv.fileUrl ?? '') : http.invoiceFileUrl(inv);
    }
    return async (...args: unknown[]) => {
      const impl = (await resolve()) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      return impl[prop]!(...args);
    };
  },
});

export async function mockControls() {
  if (env.apiMode !== 'mock') return null;
  return (await import('./mock/mock-api')).mockControls;
}
