/**
 * Fictitious starter set offered in onboarding step 3 ("Who can be paid").
 * It is applied through the normal POST /vendors and POST /agreements endpoints,
 * so it works identically against the mock and the real backend.
 */
export const SAMPLE_VENDOR_SET = [
  { name: 'Demo Cloud Hosting (ficticio)', allowed: true, agreement: { amountMinor: 20_000, toleranceMinor: 0, frequency: 'MONTHLY' as const, concept: 'Hosting mensual ficticio' } },
  { name: 'Acme Cloud Services', allowed: true, agreement: { amountMinor: 32_000, toleranceMinor: 1_000, frequency: 'MONTHLY' as const, concept: 'Cloud hosting' } },
  { name: 'Atlas Consulting', allowed: true, agreement: { amountMinor: 85_000, toleranceMinor: 0, frequency: 'MONTHLY' as const, concept: 'Advisory retainer' } },
  { name: 'Brightline Office Supply', allowed: true, agreement: { amountMinor: 40_000, toleranceMinor: 0, frequency: 'MONTHLY' as const, concept: 'Office supplies' } },
  { name: 'Cedar Logistics', allowed: true, agreement: { amountMinor: 15_000, toleranceMinor: 500, frequency: 'MONTHLY' as const, concept: 'Courier services' } },
];
