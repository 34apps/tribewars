// VAT shown in the shop BEFORE paying (owner, 2026-11-20). Display only: with STRIPE_TAX=1 Stripe Tax computes the real VAT from the
// billing address at checkout, and the webhook checks that what Stripe charged is the net price plus the tax it reports.
// Standard rates of the EU member states, in percent. VERIFY BEFORE GOING LIVE: rates change, and this table is not tax advice.

export const VAT_RATES_DATE = '2026-11-20';
/** The pseudo country for "outside the EU": no EU VAT. */
export const NO_VAT_COUNTRY = 'XX';

export interface VatCountry {
  code: string;
  name: string;
  /** Standard rate in percent (may have a decimal, e.g. 25.5). */
  ratePercent: number;
}

export const VAT_COUNTRIES: readonly VatCountry[] = [
  { code: 'AT', name: 'Austria', ratePercent: 20 },
  { code: 'BE', name: 'Belgium', ratePercent: 21 },
  { code: 'BG', name: 'Bulgaria', ratePercent: 20 },
  { code: 'HR', name: 'Croatia', ratePercent: 25 },
  { code: 'CY', name: 'Cyprus', ratePercent: 19 },
  { code: 'CZ', name: 'Czechia', ratePercent: 21 },
  { code: 'DK', name: 'Denmark', ratePercent: 25 },
  { code: 'EE', name: 'Estonia', ratePercent: 24 },
  { code: 'FI', name: 'Finland', ratePercent: 25.5 },
  { code: 'FR', name: 'France', ratePercent: 20 },
  { code: 'DE', name: 'Germany', ratePercent: 19 },
  { code: 'GR', name: 'Greece', ratePercent: 24 },
  { code: 'HU', name: 'Hungary', ratePercent: 27 },
  { code: 'IE', name: 'Ireland', ratePercent: 23 },
  { code: 'IT', name: 'Italy', ratePercent: 22 },
  { code: 'LV', name: 'Latvia', ratePercent: 21 },
  { code: 'LT', name: 'Lithuania', ratePercent: 21 },
  { code: 'LU', name: 'Luxembourg', ratePercent: 17 },
  { code: 'MT', name: 'Malta', ratePercent: 18 },
  { code: 'NL', name: 'Netherlands', ratePercent: 21 },
  { code: 'PL', name: 'Poland', ratePercent: 23 },
  { code: 'PT', name: 'Portugal', ratePercent: 23 },
  { code: 'RO', name: 'Romania', ratePercent: 21 },
  { code: 'SK', name: 'Slovakia', ratePercent: 23 },
  { code: 'SI', name: 'Slovenia', ratePercent: 22 },
  { code: 'ES', name: 'Spain', ratePercent: 21 },
  { code: 'SE', name: 'Sweden', ratePercent: 25 },
];

/** Rate in percent for a country code: the table's, 0 for 'XX', null for anything else. */
export function vatRatePercent(code: string): number | null {
  if (code === NO_VAT_COUNTRY) return 0;
  return VAT_COUNTRIES.find((c) => c.code === code)?.ratePercent ?? null;
}

/** Is this a code the shop accepts as a display country (an EU member in the table, or 'XX')? */
export function isVatCountry(code: string): boolean {
  return vatRatePercent(code) !== null;
}

/** Any 2-letter country (e.g. a billing country from Stripe) as a display country: EU members stay, everything else is 'XX'. */
export function displayCountryOf(code: string | null | undefined): string | null {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) return null;
  return isVatCountry(code) ? code : NO_VAT_COUNTRY;
}

/** VAT cents on a net amount, rounded to the nearest cent (integer maths on hundredths of a percent). */
export function vatCentsOf(netCents: number, ratePercent: number): number {
  return Math.round((netCents * Math.round(ratePercent * 100)) / 10_000);
}
