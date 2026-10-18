export const RULE_SECTIONS = [
  { form: 'approval', label: 'Approval', title: 'When can I approve on my own?', body: 'The automatic limit is per invoice. The review threshold can require a person even below that limit.', state: 'understanding' },
  { form: 'budget', label: 'Budget', title: 'Where must I stop?', body: 'The ceiling limits each invoice. The budget limits the total for the month. Neither can be bypassed by a human approval.', state: 'focused' },
  { form: 'checks', label: 'Checks', title: 'Which conditions must every invoice meet?', body: 'A small amount is not enough: vendor, agreement and document checks also affect the decision.', state: 'understanding' },
] as const;

export const VENDOR_SECTIONS = [
  { label: 'Vendors', title: 'Who is authorized to invoice you?', body: 'Uploading an invoice does not register its vendor. Add the fictional vendor here or load the sample set.', state: 'listening' },
  { label: 'Agreements', title: 'What should their invoices match?', body: 'Register the service, amount and currency agreed with each vendor. Registering a vendor does not create an agreement.', state: 'understanding' },
] as const;
