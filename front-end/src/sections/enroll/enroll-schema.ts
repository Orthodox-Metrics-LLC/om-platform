import { z } from 'zod';

// ----------------------------------------------------------------------

/**
 * One schema for the whole wizard, validated a step at a time via
 * `trigger(fieldsForStep)` — so a later step's requirements never block an
 * earlier one.
 *
 * Required-ness mirrors the live /enroll wizard: the parish, contact and module
 * steps are required; Location is explicitly optional ("Optional now — add your
 * parish address when you have it, or skip and continue").
 */
export const EnrollSchema = z.object({
  // Step 1 — Find your parish
  state: z.string().min(1, { message: 'Select your state.' }),
  parishName: z.string().min(1, { message: 'Enter your parish name.' }),
  notListed: z.boolean(),

  // Step 2 — Your contact
  firstName: z.string().min(1, { message: 'First name is required.' }),
  lastName: z.string().min(1, { message: 'Last name is required.' }),
  email: z
    .string()
    .min(1, { message: 'Email is required.' })
    .email({ message: 'Enter a valid email address.' }),

  // Step 3 — Parish info
  churchName: z.string().min(1, { message: 'Church name is required.' }),
  jurisdiction: z.string(),
  size: z.string(),
  phone: z.string(),
  website: z.string(),
  referral: z.string(),

  // Step 4 — Location (all optional)
  street: z.string(),
  city: z.string(),
  locationState: z.string(),
  postal: z.string(),
  country: z.string(),
  timezone: z.string(),

  // Step 5 — Record modules
  modules: z.array(z.string()).min(1, { message: 'Choose at least one record type.' }),
  importMethod: z.string().min(1, { message: 'Choose how you want to import records.' }),
  startTimeline: z.string().min(1, { message: 'Let us know when you would like to start.' }),
});

export type EnrollSchemaType = z.infer<typeof EnrollSchema>;

/** Fields validated when leaving each step, keyed by step index. */
export const STEP_FIELDS: (keyof EnrollSchemaType)[][] = [
  ['state', 'parishName'],
  ['firstName', 'lastName', 'email'],
  ['churchName'],
  [],
  ['modules', 'importMethod', 'startTimeline'],
];

export const ENROLL_DEFAULTS: EnrollSchemaType = {
  state: '',
  parishName: '',
  notListed: false,
  firstName: '',
  lastName: '',
  email: '',
  churchName: '',
  jurisdiction: '',
  size: '',
  phone: '',
  website: '',
  referral: '',
  street: '',
  city: '',
  locationState: '',
  postal: '',
  country: '',
  timezone: '',
  // Baptism and marriage are pre-selected, as they are in the live wizard.
  modules: ['baptism', 'marriage'],
  importMethod: '',
  startTimeline: '',
};

/** Two-letter codes plus names, matching the live wizard's state list. */
export const US_STATES: { code: string; name: string }[] = Object.entries({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}).map(([code, name]) => ({ code, name }));
