import type { IInvoice } from 'src/types/invoice';

import * as z from 'zod';
import { useForm } from 'react-hook-form';
import { useBoolean } from 'minimal-shared/hooks';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { today, fIsAfter } from 'src/utils/format-time';

import { omInvoiceApi, refreshInvoices, type InvoicePayload } from 'src/actions/invoice';

import { toast } from 'src/components/snackbar';
import { Form, schemaUtils } from 'src/components/hook-form';

import { InvoiceCreateEditAddress } from './invoice-create-edit-address';
import { InvoiceCreateEditStatusDate } from './invoice-create-edit-status-date';
import { defaultItem, InvoiceCreateEditDetails } from './invoice-create-edit-details';

// ----------------------------------------------------------------------

export type InvoiceCreateSchemaType = z.infer<typeof InvoiceCreateSchema>;

export const InvoiceCreateSchema = z
  .object({
    invoiceTo: schemaUtils.nullableInput(z.custom<IInvoice['invoiceTo']>(), {
      error: 'Invoice to is required!',
    }),
    createDate: schemaUtils.date({ error: { required: 'Create date is required!' } }),
    dueDate: schemaUtils.date({ error: { required: 'Due date is required!' } }),
    items: z.array(
      z.object({
        title: z.string().min(1, { error: 'Title is required!' }),
        service: z.string().min(1, { error: 'Service is required!' }),
        quantity: z.number().int().positive().min(1, { error: 'Quantity must be more than 0' }),
        // Not required
        price: z.number(),
        total: z.number(),
        description: z.string(),
      })
    ),
    // Not required
    taxes: z.number(),
    status: z.string(),
    discount: z.number(),
    shipping: z.number(),
    subtotal: z.number(),
    totalAmount: z.number(),
    invoiceNumber: z.string(),
    invoiceFrom: z.custom<IInvoice['invoiceFrom']>().nullable(),
  })
  .refine((val) => !fIsAfter(val.createDate, val.dueDate), {
    error: 'Due date cannot be earlier than create date!',
    path: ['dueDate'],
  });

// ----------------------------------------------------------------------

type Props = {
  currentInvoice?: IInvoice;
};

export function InvoiceCreateEditForm({ currentInvoice }: Props) {
  const router = useRouter();

  const loadingSave = useBoolean();
  const loadingSend = useBoolean();

  const defaultValues: InvoiceCreateSchemaType = {
    invoiceNumber: '',
    createDate: today(),
    dueDate: null,
    taxes: 0,
    shipping: 0,
    status: 'draft',
    discount: 0,
    invoiceFrom: null,
    invoiceTo: null,
    subtotal: 0,
    totalAmount: 0,
    items: [defaultItem],
  };

  const methods = useForm({
    mode: 'all',
    resolver: zodResolver(InvoiceCreateSchema),
    defaultValues,
    values: currentInvoice,
  });

  const {
    reset,
    handleSubmit,
    formState: { isSubmitting },
  } = methods;

  const toPayload = (data: InvoiceCreateSchemaType, status: string): InvoicePayload => ({
    invoiceNumber: data.invoiceNumber || undefined,
    churchId: Number((data.invoiceTo as any)?.churchId || data.invoiceTo?.id) || undefined,
    invoiceTo: data.invoiceTo as any,
    createDate: data.createDate,
    dueDate: data.dueDate,
    status,
    taxRate: data.taxes,
    discount: data.discount,
    amountPaid: data.shipping || 0,
    items: data.items.map((it) => ({ title: it.title, description: it.description, service: it.service, quantity: it.quantity, price: it.price })),
  });

  const save = async (data: InvoiceCreateSchemaType, status: string, loading: typeof loadingSave) => {
    loading.onTrue();
    try {
      const payload = toPayload(data, status);
      const saved = currentInvoice ? await omInvoiceApi.update(currentInvoice.id, payload) : await omInvoiceApi.create(payload);
      await refreshInvoices();
      toast.success(status === 'draft' ? 'Draft saved' : currentInvoice ? 'Invoice updated and sent' : `Invoice ${saved.invoiceNumber} sent to ${saved.invoiceTo?.name}`);
      reset();
      router.push(paths.dashboard.invoice.details(saved.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save invoice');
    } finally {
      loading.onFalse();
    }
  };

  const handleSaveAsDraft = handleSubmit((data) => save(data, currentInvoice && currentInvoice.status !== 'draft' ? currentInvoice.status : 'draft', loadingSave));

  // Paid invoices keep their status; otherwise create/update sends it to the church.
  const handleCreateAndSend = handleSubmit((data) => save(data, currentInvoice?.status === 'paid' ? 'paid' : 'sent', loadingSend));

  return (
    <Form methods={methods}>
      <Card>
        <InvoiceCreateEditAddress />
        <InvoiceCreateEditStatusDate />
        <InvoiceCreateEditDetails />
      </Card>

      <Box
        sx={{
          mt: 3,
          gap: 2,
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <Button
          color="inherit"
          size="large"
          variant="outlined"
          loading={loadingSave.value && isSubmitting}
          onClick={handleSaveAsDraft}
        >
          {currentInvoice && currentInvoice.status !== 'draft' ? 'Save changes' : 'Save as draft'}
        </Button>

        <Button
          size="large"
          variant="contained"
          loading={loadingSend.value && isSubmitting}
          onClick={handleCreateAndSend}
        >
          {currentInvoice ? 'Update' : 'Create'} & send
        </Button>
      </Box>
    </Form>
  );
}
