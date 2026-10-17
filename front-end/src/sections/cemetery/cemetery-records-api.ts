import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

export type CemeteryField = {
  name: string;
  label: string;
  type: string;
  nullable: boolean;
};

export type PartialDateValue = {
  year: number;
  month: number | null;
  day: number | null;
  precision: 'year' | 'month' | 'day';
};

export type CemeteryResource = {
  table: string;
  name: string;
  kind: string;
  fields: CemeteryField[];
};

export type CemeteryRow = {
  row_id: number;
  values: Record<string, unknown>;
  fingerprint: string;
  origin: 'manual' | 'imported';
};

export type CemeterySort = { field: string; direction: 'asc' | 'desc' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatPartialDate(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const date = value as PartialDateValue;
  if (!date.year) return '';
  const month = date.month ? MONTHS[date.month - 1] : '';
  if (date.day && date.month) return `${month} ${date.day}, ${date.year}`;
  if (date.month) return `${month} ${date.year}`;
  return String(date.year);
}

export function formatFieldValue(field: CemeteryField, value: unknown): string {
  if (value == null || value === '') return '';
  if (field.type === 'partial_date') return formatPartialDate(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await omApiFetch('/api/portal/cemetery-records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || 'Cemetery records request failed');
  return data.result as T;
}

export const cemeteryRecordsApi = {
  resources: (churchId: number) =>
    call<{ resources: CemeteryResource[] }>({ action: 'resources', churchId }),
  browse: (churchId: number, query: { table: string; search?: string; page: number; limit: number; sort: CemeterySort[] }) =>
    call<{ rows: CemeteryRow[]; total: number; page: number; page_size: number; resource: CemeteryResource }>({
      action: 'browse',
      churchId,
      query,
    }),
  save: (
    churchId: number,
    query: {
      table: string;
      row_id?: number | null;
      values: Record<string, unknown>;
      note: string;
      request_id: string;
      fingerprint?: string;
    }
  ) => call<{ saved: boolean; row: CemeteryRow; already_saved: boolean }>({ action: 'save', churchId, query }),
};
