/**
 * Same-record missing-field recovery.
 *
 * Before required-field validation, fill blank required values from other
 * fields already extracted on THIS record. Never overwrite a populated
 * field. No cross-record lookup and no AI inference.
 */

export const REQUIRED_FIELDS_BY_TYPE: Record<string, string[]> = {
  baptism: ['child_first_name', 'child_last_name', 'date_of_baptism'],
  marriage: [
    'date_of_marriage',
    'groom_first_name',
    'groom_last_name',
    'bride_first_name',
    'bride_last_name',
  ],
  funeral: ['deceased_first_name', 'deceased_last_name'],
};

export type RecoveredFrom = Record<string, string>;

export interface SameRecordRecoveryResult {
  fields: Record<string, string>;
  recoveredFrom: RecoveredFrom;
}

function isBlank(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

function text(value: unknown): string {
  return String(value ?? '').trim().replace(/\s{2,}/g, ' ');
}

function firstPresent(
  fields: Record<string, unknown>,
  keys: string[],
): { key: string; value: string } | null {
  for (const key of keys) {
    const value = text(fields[key]);
    if (value) return { key, value };
  }
  return null;
}

function splitPersonName(fullName: string): { first: string; last: string } {
  const parts = text(fullName).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * Father surname from a parents string — same-record only.
 * "George Smith and Anna Grabania" → "Smith"
 * "George and Anna Robinson" → "Robinson"
 */
export function surnameFromParents(parentsStr: string): string | null {
  const parents = text(parentsStr);
  if (!parents) return null;

  const halves = parents.split(/\s+(?:and|&)\s+/i);
  if (halves.length < 2) {
    const words = parents.split(/\s+/).filter(Boolean);
    return words.length >= 2 ? words[words.length - 1] : null;
  }

  const fatherWords = halves[0].trim().split(/\s+/).filter(Boolean);
  const motherWords = halves[1].trim().split(/\s+/).filter(Boolean);

  if (fatherWords.length >= 2) return fatherWords[fatherWords.length - 1];
  if (motherWords.length >= 2) return motherWords[motherWords.length - 1];
  return null;
}

function surnameFromPersonField(fullName: string): string | null {
  const last = splitPersonName(fullName).last;
  return last || null;
}

function fill(
  out: Record<string, string>,
  recoveredFrom: RecoveredFrom,
  target: string,
  value: string | null | undefined,
  source: string,
): boolean {
  if (!value || isBlank(value)) return false;
  if (!isBlank(out[target])) return false;
  out[target] = text(value);
  recoveredFrom[target] = source;
  return true;
}

function recoverBaptism(out: Record<string, string>, recoveredFrom: RecoveredFrom): void {
  const childName = firstPresent(out, ['child_name']);
  if (childName) {
    const split = splitPersonName(childName.value);
    fill(out, recoveredFrom, 'child_first_name', split.first, childName.key);
    fill(out, recoveredFrom, 'child_last_name', split.last, childName.key);
  }

  if (isBlank(out.child_last_name)) {
    const fatherLast = firstPresent(out, ['father_last_name']);
    if (fatherLast) {
      fill(out, recoveredFrom, 'child_last_name', fatherLast.value, fatherLast.key);
    }
  }

  if (isBlank(out.child_last_name)) {
    const fatherName = firstPresent(out, ['father_name', 'fatherName']);
    if (fatherName) {
      fill(out, recoveredFrom, 'child_last_name', surnameFromPersonField(fatherName.value), fatherName.key);
    }
  }

  if (isBlank(out.child_last_name)) {
    const parents = firstPresent(out, ['parents']);
    if (parents) {
      fill(out, recoveredFrom, 'child_last_name', surnameFromParents(parents.value), parents.key);
    }
  }

  fill(out, recoveredFrom, 'child_first_name', firstPresent(out, ['first_name', 'firstName'])?.value, 'first_name');
  fill(out, recoveredFrom, 'child_last_name', firstPresent(out, ['last_name', 'lastName'])?.value, 'last_name');

  if (isBlank(out.child_name) && (!isBlank(out.child_first_name) || !isBlank(out.child_last_name))) {
    const composed = [out.child_first_name, out.child_last_name].filter((part) => !isBlank(part)).join(' ');
    const source = recoveredFrom.child_last_name || recoveredFrom.child_first_name || 'child_first_name';
    fill(out, recoveredFrom, 'child_name', composed, source);
  }

  const baptismDate = firstPresent(out, ['reception_date', 'baptism_date', 'dateOfBaptism']);
  if (baptismDate) fill(out, recoveredFrom, 'date_of_baptism', baptismDate.value, baptismDate.key);
  const birthDate = firstPresent(out, ['birth_date', 'dateOfBirth']);
  if (birthDate) fill(out, recoveredFrom, 'date_of_birth', birthDate.value, birthDate.key);
}

function recoverMarriage(out: Record<string, string>, recoveredFrom: RecoveredFrom): void {
  const groomName = firstPresent(out, ['groom_name']);
  if (groomName) {
    const split = splitPersonName(groomName.value);
    fill(out, recoveredFrom, 'groom_first_name', split.first, groomName.key);
    fill(out, recoveredFrom, 'groom_last_name', split.last, groomName.key);
  }

  const brideName = firstPresent(out, ['bride_name']);
  if (brideName) {
    const split = splitPersonName(brideName.value);
    fill(out, recoveredFrom, 'bride_first_name', split.first, brideName.key);
    fill(out, recoveredFrom, 'bride_last_name', split.last, brideName.key);
  }

  if (isBlank(out.groom_last_name)) {
    const parents = firstPresent(out, ['groom_parents']);
    if (parents) {
      fill(out, recoveredFrom, 'groom_last_name', surnameFromParents(parents.value), parents.key);
    }
  }

  if (isBlank(out.bride_last_name)) {
    const parents = firstPresent(out, ['bride_parents']);
    if (parents) {
      fill(out, recoveredFrom, 'bride_last_name', surnameFromParents(parents.value), parents.key);
    }
  }

  if (isBlank(out.groom_name) && (!isBlank(out.groom_first_name) || !isBlank(out.groom_last_name))) {
    const composed = [out.groom_first_name, out.groom_last_name].filter((part) => !isBlank(part)).join(' ');
    fill(out, recoveredFrom, 'groom_name', composed, recoveredFrom.groom_last_name || 'groom_first_name');
  }

  if (isBlank(out.bride_name) && (!isBlank(out.bride_first_name) || !isBlank(out.bride_last_name))) {
    const composed = [out.bride_first_name, out.bride_last_name].filter((part) => !isBlank(part)).join(' ');
    fill(out, recoveredFrom, 'bride_name', composed, recoveredFrom.bride_last_name || 'bride_first_name');
  }

  const marriageDate = firstPresent(out, ['mdate', 'marriage_date', 'marriageDate']);
  if (marriageDate) fill(out, recoveredFrom, 'date_of_marriage', marriageDate.value, marriageDate.key);
}

function recoverFuneral(out: Record<string, string>, recoveredFrom: RecoveredFrom): void {
  const deceasedName = firstPresent(out, ['deceased_name']);
  if (deceasedName) {
    const split = splitPersonName(deceasedName.value);
    fill(out, recoveredFrom, 'deceased_first_name', split.first, deceasedName.key);
    fill(out, recoveredFrom, 'deceased_last_name', split.last, deceasedName.key);
  }

  fill(out, recoveredFrom, 'deceased_first_name', firstPresent(out, ['first_name', 'firstName', 'name'])?.value, 'name');
  fill(out, recoveredFrom, 'deceased_last_name', firstPresent(out, ['last_name', 'lastName', 'lastname'])?.value, 'lastname');

  if (isBlank(out.deceased_name) && (!isBlank(out.deceased_first_name) || !isBlank(out.deceased_last_name))) {
    const composed = [out.deceased_first_name, out.deceased_last_name].filter((part) => !isBlank(part)).join(' ');
    fill(out, recoveredFrom, 'deceased_name', composed, recoveredFrom.deceased_last_name || 'deceased_first_name');
  }

  const deathDate = firstPresent(out, ['deceased_date', 'death_date', 'deathDate', 'dateOfDeath']);
  if (deathDate) fill(out, recoveredFrom, 'date_of_death', deathDate.value, deathDate.key);
  const funeralDate = firstPresent(out, ['date_of_burial', 'burial_date', 'burialDate']);
  if (funeralDate) fill(out, recoveredFrom, 'date_of_funeral', funeralDate.value, funeralDate.key);
  const burialDate = firstPresent(out, ['date_of_funeral', 'burial_date', 'burialDate']);
  if (burialDate) fill(out, recoveredFrom, 'date_of_burial', burialDate.value, burialDate.key);
}

/**
 * Populate missing required values from other fields on the same record.
 * Returns a copy — the input object is never mutated.
 */
export function recoverMissingRequiredFields(
  recordType: string,
  fields: Record<string, unknown> | null | undefined,
): SameRecordRecoveryResult {
  const recoveredFrom: RecoveredFrom = {};
  const out: Record<string, string> = {};

  if (fields && typeof fields === 'object') {
    for (const [key, value] of Object.entries(fields)) {
      if (isBlank(value)) continue;
      out[key] = text(value);
    }
  }

  const type = String(recordType || '').toLowerCase();
  if (type === 'baptism') recoverBaptism(out, recoveredFrom);
  else if (type === 'marriage') recoverMarriage(out, recoveredFrom);
  else if (type === 'funeral') recoverFuneral(out, recoveredFrom);

  return { fields: out, recoveredFrom };
}

export function missingRequiredFields(
  recordType: string,
  fields: Record<string, unknown> | null | undefined,
): string[] {
  const required = REQUIRED_FIELDS_BY_TYPE[String(recordType || '').toLowerCase()] || [];
  return required.filter((key) => isBlank(fields?.[key]));
}

/**
 * Recover first, then report which required fields are still blank.
 */
export function recoverThenFindMissingRequired(
  recordType: string,
  fields: Record<string, unknown> | null | undefined,
): SameRecordRecoveryResult & { missingRequired: string[] } {
  const recovered = recoverMissingRequiredFields(recordType, fields);
  return {
    ...recovered,
    missingRequired: missingRequiredFields(recordType, recovered.fields),
  };
}
