import { expect, it } from 'vitest';
import { ApiError, errorMessage } from '../../src/api/errors';

it('explains how to recover from an exhausted chat message instead of showing an internal code', () => {
  const text = errorMessage(new ApiError({ status: 409, code: 'CHAT_RETRY_LIMIT', message: 'CHAT_RETRY_LIMIT' }));
  expect(text).not.toContain('CHAT_RETRY_LIMIT');
  expect(text).toMatch(/new conversation|conversación nueva/);
});

it('preserves transport and other API errors for idempotent retry recovery', () => {
  expect(errorMessage(new ApiError({ status: 503, code: 'CHAT_PROVIDER_UNAVAILABLE', message: 'Provider unavailable' }))).toBe('Provider unavailable');
  expect(errorMessage(new ApiError({ status: 0, code: 'NETWORK', message: 'Network error' }))).not.toContain('retry limit');
});
