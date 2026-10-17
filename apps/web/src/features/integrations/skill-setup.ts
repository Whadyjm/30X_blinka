const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

export function skillSetup(apiUrl: string, archiveUrl: string) {
  const install = [
    `curl --fail --silent --show-error ${shellQuote(archiveUrl)} -o oli-skill.tar.gz`,
    'tar -tzf oli-skill.tar.gz',
    '# Extract into a new folder, then install oli in your agent’s skills directory',
    'oli_skill_dir=$(mktemp -d)',
    'tar -xzf oli-skill.tar.gz -C "$oli_skill_dir"',
    'echo "$oli_skill_dir/oli"',
  ].join('\n');
  const configure = `export OLI_API_URL=${shellQuote(apiUrl)}\n# OLI_API_KEY: configure in your agent runtime secret manager`;
  const prompt = `Connect this agent to Oli for invoice review. This setup is independent of the agent vendor: Hermes, OpenClaw, Grokbot or another runtime.\n\nDownload the Oli skill from ${archiveUrl}. Inspect the archive entries and extract into a new temporary directory. Read SKILL.md and inspect the bundled client before running it. Detect this runtime's supported skill-installation mechanism from its configuration or official documentation and install the oli folder there. Preserve unrelated skills and existing installations; do not guess a vendor-specific command. If this runtime has no skill loader, use the documented HTTP contract and its available HTTP tools instead.\n\nConfigure OLI_API_URL=${apiUrl} in the agent runtime. Use OLI_API_KEY from its secret manager; never print the key, put it in chat or write it in skill files. If missing, explain how the user can configure the key created in Oli → Integrations → Oli Skill → Connections. Do not request the owner's login or try to create keys through an agent connection.\n\nIf Python 3.10+ is available, verify the client with python3 <installed-skill-directory>/scripts/oli.py --help. Otherwise use HTTP tools with secrets injected by the runtime, without exposing the key to chat or command arguments. When credentials are configured, run python3 <installed-skill-directory>/scripts/oli.py check (or GET OLI_API_URL/me with runtime secret injection) to verify the connection without submitting a document. Report installation and credential configuration separately; do not claim a successful connection without an authenticated request.\n\nWhen asked to submit a fictitious PDF, JPG or PNG invoice, use the installed skill or HTTP contract: retain a UUID operation key before uploading, request evaluation and read the result. This connection may only submit and read its own invoices. Oli controls decisions and human exceptions. All authorizations are simulated; no money moves. Do not submit an invoice until the user supplies or authorizes the document.`;
  return { install, configure, prompt };
}
