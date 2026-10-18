import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(new URL('../../public/theme.js', import.meta.url), 'utf8');
function boot(saved: string | null, systemDark: boolean, blocked = false) {
  const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  let addressBar = '';
  runInNewContext(bootstrap, {
    localStorage: { getItem: () => { if (blocked) throw new Error('Storage unavailable'); return saved; } },
    matchMedia: () => ({ matches: systemDark }),
    document: { documentElement: element, querySelector: () => ({ setAttribute: (_name: string, value: string) => { addressBar = value; } }) },
  });
  return { ...element, addressBar };
}

describe('appearance before first paint', () => {
  it('honors explicit preferences even when the device has the opposite theme', () => {
    expect(boot('dark', false).dataset.theme).toBe('dark');
    expect(boot('light', true).dataset.theme).toBe('light');
  });
  it('follows the device for new, system and invalid preferences', () => {
    for (const saved of [null, 'system', 'corrupted']) {
      expect(boot(saved, true).dataset.theme).toBe('dark');
      expect(boot(saved, false).dataset.theme).toBe('light');
    }
  });
  it('keeps native controls and browser chrome in the same theme', () => {
    const dark = boot('dark', false);
    expect(dark.style.colorScheme).toBe(dark.dataset.theme);
    expect(dark.addressBar).toBe('#191715');
  });
  it('still applies the device theme when browser storage is blocked', () => {
    expect(boot(null, true, true).dataset.theme).toBe('dark');
  });
});
