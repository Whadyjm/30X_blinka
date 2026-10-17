import { describe, expect, it } from 'vitest';
import { skillSetup } from '../../src/features/integrations/skill-setup';

describe('Oli Skill setup', () => {
  it('quotes deployment URLs safely in shell commands', () => {
    const { install, configure } = skillSetup("https://example.invalid/api/v1/agent?x=';echo injected", "https://example.invalid/'$(touch /tmp/injected)");
    expect(install).toContain("'https://example.invalid/'\"'\"'$(touch /tmp/injected)'");
    expect(configure).toContain("'https://example.invalid/api/v1/agent?x='\"'\"';echo injected'");
  });
  it('uses the deployment URL and a host-neutral procedure with secret injection', () => {
    const setup = skillSetup('https://oli.invalid/api/v1/agent', 'https://oli.invalid/skills/oli-skill.tar.gz');
    expect(setup.prompt).toContain('https://oli.invalid/api/v1/agent');
    expect(setup.prompt).toContain('secret manager');
    expect(setup.prompt).toContain('no skill loader');
    expect(setup.install).not.toContain('.hermes');
    expect(setup.prompt).not.toMatch(/oli_sk_[0-9a-f]/);
  });
});
