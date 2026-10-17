export const RULE_SECTIONS = [
  { form: 'approval', label: 'Approval', title: 'How much can I approve?', body: 'Set my automatic limit and when you want a person to review.', state: 'understanding' },
  { form: 'budget', label: 'Budget', title: 'What’s our budget?', body: 'Give me a monthly budget and a ceiling I must never exceed.', state: 'focused' },
  { form: 'checks', label: 'Checks', title: 'What should I check?', body: 'Choose the checks I should make before deciding on an invoice.', state: 'understanding' },
] as const;

export const VENDOR_SECTIONS = [
  { label: 'Vendors', title: 'Let’s meet your vendors.', body: 'Add who is authorized, or start with the sample set.', state: 'listening' },
  { label: 'Agreements', title: 'What did you agree on?', body: 'Tell me what each vendor normally charges so I can check their invoices.', state: 'understanding' },
] as const;
