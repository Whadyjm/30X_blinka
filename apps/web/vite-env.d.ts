/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' = in-browser fake API (no backend). 'live' = real Worker under /api/v1. */
  readonly VITE_API_MODE?: 'mock' | 'live';
  /** Base path of the REST API. Same-origin by default. */
  readonly VITE_API_BASE?: string;
  /** P1 feature flags ("true" to enable). */
  readonly VITE_FEATURE_AGENT_ACCESS?: string;
  readonly VITE_FEATURE_CHAT?: string;
  readonly VITE_FEATURE_CLEARANCE?: string;
}
