/// <reference types="vite/client" />

const flag = (v: string | undefined) => v === 'true' || v === '1';

export const env = {
  /** 'mock' → in-browser fake API. 'live' → Worker at API_BASE. */
  apiMode: (import.meta.env.VITE_API_MODE ?? 'live') as 'mock' | 'live',
  apiBase: (import.meta.env.VITE_API_BASE ?? '/api/v1').replace(/\/+$/, ''),
  features: {
    agentAccess: flag(import.meta.env.VITE_FEATURE_AGENT_ACCESS),
    chat: flag(import.meta.env.VITE_FEATURE_CHAT),
    clearance: flag(import.meta.env.VITE_FEATURE_CLEARANCE),
  },
} as const;

/** Upload constraints (§10). Server re-validates; this only gives instant feedback. */
export const UPLOAD = {
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ['application/pdf', 'image/png', 'image/jpeg'] as readonly string[],
  accept: 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg',
} as const;
