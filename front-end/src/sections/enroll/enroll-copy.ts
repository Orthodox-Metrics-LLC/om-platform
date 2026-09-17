// ----------------------------------------------------------------------

/**
 * Enrollment copy, taken verbatim from the live Orthodox Metrics translation
 * store (`GET /api/i18n/en`, the `enroll.*` keys) so this page says exactly what
 * the current /enroll wizard says.
 *
 * The canonical source is the database, not this file. If the wording changes
 * there, mirror it here — do not paraphrase.
 */

export const ENROLL_COPY = {
  wizard: {
    title: 'Onboarding Wizard',
    duration: 'about 5 minutes',
    back: 'Back',
    next: 'Next',
    submit: 'Submit Enrollment',
    submitting: 'Submitting…',
    skip: 'Skip for now',
    requiredNotice: 'Please complete the required fields highlighted above before continuing.',
  },
  steps: [
    { key: 'find-parish', label: 'Find Your Parish', title: 'Find Your Parish', description: 'Select your state, then pick your parish on the map or search by name.' },
    { key: 'contact', label: 'Your Contact', title: 'Your Contact', description: 'Who should we reach about this enrollment? Just the basics — we will ask for parish details next.' },
    { key: 'parish', label: 'Parish Info', title: 'Parish Info', description: 'Confirm your church name and add optional details. Jurisdiction and size help us route your request.' },
    { key: 'location', label: 'Location', title: 'Location', description: 'Optional now — add your parish address when you have it, or skip and continue. You can update this after approval.' },
    { key: 'modules', label: 'Record Modules', title: 'Record Modules & Next Steps', description: 'Choose your record types, import approach, and preferred start timeline.' },
  ],
  findParish: {
    state: 'State',
    statePlaceholder: 'Select your state…',
    parishName: 'Parish name',
    parishNamePlaceholder: 'e.g. Holy Trinity',
    parishNameHint: 'Start typing to search Orthodox parishes in your state.',
    notListed: 'I don\'t see my church',
    manualName: 'Enter your parish name',
    manualPlaceholder: 'e.g. SS Peter & Paul Orthodox Church',
    manualHint: 'We\'ll add it to the directory after we verify with you.',
    crmTip: 'Parishes displayed on the map are Orthodox parishes that exist throughout the United States.',
    crmTipAction: 'If yours is not listed, choose I don\'t see my church and we will verify it with you.',
  },
  contact: {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    emailHint: 'We send approval and onboarding updates here.',
  },
  parish: {
    churchName: 'Church name',
    jurisdiction: 'Jurisdiction',
    jurisdictionPlaceholder: 'Select jurisdiction…',
    jurisdictionHint: 'Optional — select if you know it.',
    size: 'Approximate church size',
    sizePlaceholder: 'Select church size…',
    phone: 'Phone',
    website: 'Website',
    referral: 'How did you hear about us?',
  },
  location: {
    street: 'Street address',
    city: 'City',
    state: 'State / Province',
    postal: 'Postal code',
    country: 'Country',
    timezone: 'Timezone',
    timezonePlaceholder: 'Select timezone…',
  },
  modules: {
    selectPrompt: 'Select every sacramental record type you want to manage digitally.',
    importLegend: 'How do you want to import your records?',
    timelineLegend: 'How soon are you interested in getting started?',
    cards: [
      { key: 'baptism', title: 'Baptism Records', desc: 'Digitize baptism registers with sponsors, clergy, dates, and full search across your parish history.', recommended: true },
      { key: 'marriage', title: 'Marriage Records', desc: 'Preserve marriage records including witnesses, dispensations, and crowning details in one secure workspace.', recommended: true },
      { key: 'funeral', title: 'Funeral Records', desc: 'Organize funeral and memorial registers with clergy, burial details, and decades of parish history.', recommended: false },
      { key: 'custom', title: 'Custom Records', desc: 'Select every sacramental record type you want to manage digitally.', recommended: false },
    ],
    importMethods: [
      { value: 'om_full_service', label: 'Have Orthodox Metrics handle everything', description: 'Our team manages digitization, OCR, and onboarding — you focus on approving records.' },
      { value: 'self_service', label: 'Self Service', description: 'Your parish handles scanning records and uploading them through the platform.' },
    ],
    timelines: [
      { value: 'asap', label: 'As Soon As Possible' },
      { value: 'few_weeks', label: 'A few weeks from now' },
      { value: 'month_plus', label: 'A month or more before I\'m ready' },
    ],
  },
  confirm: {
    title: 'We\'ve Received Your Enrollment Request',
    whatNext: 'What Happens Next',
    referenceLabel: 'Reference:',
    returnHome: 'Return to Homepage',
    needHelpTitle: 'Need help before then?',
    needHelpBody: 'If you have questions or would like to share additional details, our team is happy to help.',
    nextSteps: [
      { title: 'Enrollment Request Reviewed', description: 'We review the information you submitted and assess your parish\'s record-management needs.' },
      { title: 'Personal Follow-Up', description: 'A member of our team will contact you within 48 hours to discuss your parish, answer questions, and confirm next steps.' },
      { title: 'Planning & Preparation', description: 'We help determine your records, onboarding approach, and the best setup for your parish.' },
      { title: 'Onboarding Begins', description: 'Once everything is confirmed, we begin the setup and onboarding process with your parish.' },
    ],
  },
} as const;

export const JURISDICTIONS = [
  { value: 'goa', label: 'Greek Orthodox Archdiocese of America' },
  { value: 'oca', label: 'Orthodox Church in America (OCA)' },
  { value: 'antiochian', label: 'Antiochian Orthodox Christian Archdiocese' },
  { value: 'serbian', label: 'Serbian Orthodox Church' },
  { value: 'rocor', label: 'Russian Orthodox Church Outside Russia' },
  { value: 'romanian', label: 'Romanian Orthodox Archdiocese' },
  { value: 'other', label: 'Other' },
] as const;

export const CHURCH_SIZES = [
  { value: 'under_100', label: 'Under 100' },
  { value: '100_200', label: '100–200' },
  { value: '200_500', label: '200–500' },
  { value: '500_1000', label: '500–1000' },
  { value: '1000_plus', label: '1000+' },
] as const;
