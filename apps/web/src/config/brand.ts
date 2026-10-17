import { t } from '@/i18n';

/**
 * ALL branding lives here. "OLI" is a provisional codename (brief header):
 * do not hardcode the name or tagline anywhere else.
 * Getters so text follows the active language at render time.
 */
export const brand = {
  name: 'Oli',
  get tagline() {
    return t('Your bills, handled.');
  },
  get cta() {
    return t('Meet Oli');
  },
  get pitch() {
    return t('AI agents can do the work. Oli decides whether they’re allowed to spend.');
  },
  /** Label for the development-only mock controls. */
  get envLabel() {
    return t('Demo environment · No real money');
  },
  /** Wording for APPROVE. Never "paid" / "sent" / "transferred". */
  get approveLabel() {
    return t('Approved');
  },
};
