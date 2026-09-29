import type { IAddressItem } from 'src/types/common';
import type { IInvoice, IInvoiceItem } from 'src/types/invoice';

import { useMemo } from 'react';
import useSWR, { mutate } from 'swr';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Invoices on OM's `/api/om/invoices` (prod: server/src/routes/om/invoices.js).
 * Platform admins issue invoices to churches; church roles see and pay theirs.
 */

export type OmInvoice = IInvoice & {
  churchId: number;
  amountPaid: number;
  balanceDue: number;
  currency: string;
  sentAt: string | null;
  paidAt: string | null;
  viewedAt: string | null;
  paidMethod: string | null;
  notes: string;
  paymentTerms: string;
  internalNotes: string | null;
  invoiceTo: IAddressItem & { churchId?: number; email?: string | null };
};

export type InvoiceAnalytics = {
  total_cnt: number; total_amt: number; paid_cnt: number; paid_amt: number; pending_cnt: number; pending_amt: number; overdue_cnt: number; overdue_amt: number; draft_cnt: number; draft_amt: number;
};

export type InvoiceAddress = IAddressItem & { churchId?: number; email?: string | null; provisioned?: boolean };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const I = '/api/om/invoices';

export type InvoicePayload = {
  invoiceNumber?: string;
  churchId?: number;
  invoiceTo?: InvoiceAddress | null;
  createDate?: string | number | Date | null;
  dueDate?: string | number | Date | null;
  status: string;
  /** Tax as a percent of subtotal (server computes tax_amount). */
  taxRate?: number;
  taxes?: number;
  discount: number;
  items: Pick<IInvoiceItem, 'title' | 'description' | 'service' | 'quantity' | 'price'>[];
  notes?: string | null;
  paymentTerms?: string | null;
  internalNotes?: string | null;
  amountPaid?: number | null;
  paidAt?: string | null;
};

/** Minimal's tabs use 'pending' for issued, unpaid invoices (stored as 'sent'). */
const uiStatus = (inv: OmInvoice): OmInvoice => ({ ...inv, status: inv.status === 'sent' ? 'pending' : inv.status });

export const omInvoiceApi = {
  list: (p: { churchId?: number | null; status?: string; q?: string } = {}) => {
    const sp = new URLSearchParams();
    if (p.churchId) sp.set('church_id', String(p.churchId));
    if (p.status) sp.set('status', p.status);
    if (p.q) sp.set('q', p.q);
    const s = sp.toString();
    return call<{ role: string; canManage: boolean; churchId: number | null; invoices: OmInvoice[]; analytics: InvoiceAnalytics }>(`${I}${s ? `?${s}` : ''}`).then((r) => ({ ...r, invoices: r.invoices.map(uiStatus) }));
  },
  get: (id: string | number) => call<{ canManage: boolean; canPay: boolean; stripeEnabled: boolean; invoice: OmInvoice }>(`${I}/${id}`).then((r) => ({ ...r, invoice: uiStatus(r.invoice) })),
  addressBook: () => call<{ from: InvoiceAddress[]; to: InvoiceAddress[] }>(`${I}/address-book`),
  services: () => call<{ services: { service: string; price: number }[] }>(`${I}/services`).then((r) => r.services),
  create: (body: InvoicePayload) => call<{ invoice: OmInvoice }>(I, jsonInit('POST', body)).then((r) => uiStatus(r.invoice)),
  update: (id: string | number, body: InvoicePayload) => call<{ invoice: OmInvoice }>(`${I}/${id}`, jsonInit('PUT', body)).then((r) => uiStatus(r.invoice)),
  send: (id: string | number) => call<{ invoice: OmInvoice }>(`${I}/${id}/send`, jsonInit('POST')).then((r) => uiStatus(r.invoice)),
  markPaid: (id: string | number, body: { method: string; amount?: number; paidAt?: string }) => call<{ invoice: OmInvoice }>(`${I}/${id}/mark-paid`, jsonInit('POST', body)).then((r) => uiStatus(r.invoice)),
  cancel: (id: string | number) => call<{ invoice: OmInvoice }>(`${I}/${id}/cancel`, jsonInit('POST')).then((r) => uiStatus(r.invoice)),
  remove: (id: string | number) => call(`${I}/${id}`, { method: 'DELETE' }),
  payWithStripe: (id: string | number) => call<{ url: string; sessionId: string }>(`${I}/${id}/pay/stripe`, jsonInit('POST')),
  confirmStripe: (id: string | number) => call<{ invoice: OmInvoice }>(`${I}/${id}/pay/stripe/confirm`, jsonInit('POST')).then((r) => uiStatus(r.invoice)),
};

// ----------------------------------------------------------------------

const listKey = (churchId: number | null) => ['om-invoices', churchId] as const;

export function useGetInvoices(churchId: number | null = null) {
  const { data, isLoading, error, isValidating } = useSWR(listKey(churchId), ([, id]) => omInvoiceApi.list({ churchId: id }), { revalidateOnFocus: false });
  return useMemo(() => ({
    invoices: data?.invoices ?? [],
    analytics: data?.analytics ?? null,
    canManage: !!data?.canManage,
    invoicesLoading: isLoading,
    invoicesError: error,
    invoicesValidating: isValidating,
    invoicesEmpty: !isLoading && !isValidating && !data?.invoices.length,
  }), [data, error, isLoading, isValidating]);
}
export const refreshInvoices = (churchId: number | null = null) => mutate(listKey(churchId));

export function useGetInvoice(id: string | undefined) {
  const { data, isLoading, error } = useSWR(id ? ['om-invoice', id] : null, ([, i]) => omInvoiceApi.get(i), { revalidateOnFocus: false });
  return useMemo(() => ({ invoice: data?.invoice, canManage: !!data?.canManage, canPay: !!data?.canPay, stripeEnabled: !!data?.stripeEnabled, invoiceLoading: isLoading, invoiceError: error }), [data, error, isLoading]);
}
export const refreshInvoice = (id: string | number) => mutate(['om-invoice', String(id)]);
