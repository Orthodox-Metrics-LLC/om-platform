import type { IInvoice } from 'src/types/invoice';

import { useState, useCallback } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Table from '@mui/material/Table';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import TableRow from '@mui/material/TableRow';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import Typography from '@mui/material/Typography';

import { fDate } from 'src/utils/format-time';
import { fCurrency } from 'src/utils/format-number';

import { omInvoiceApi, refreshInvoice, type OmInvoice, refreshInvoices } from 'src/actions/invoice';

import { Label } from 'src/components/label';
import { toast } from 'src/components/snackbar';
import { Scrollbar } from 'src/components/scrollbar';

import { InvoiceToolbar } from './invoice-toolbar';
import { InvoiceTotalSummary } from './invoice-total-summary';

// ----------------------------------------------------------------------

type Props = {
  invoice?: IInvoice;
  canManage?: boolean;
  canPay?: boolean;
  stripeEnabled?: boolean;
};

// Status transitions available to platform admins (server enforces the rules).
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Sent / pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function InvoiceDetails({ invoice, canManage = false, canPay = false, stripeEnabled = false }: Props) {
  const [currentStatus, setCurrentStatus] = useState(invoice?.status);
  const om = invoice as OmInvoice | undefined;

  const handleChangeStatus = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!invoice) return;
    const next = event.target.value;
    const prev = currentStatus;
    setCurrentStatus(next);
    try {
      if (next === 'pending') await omInvoiceApi.send(invoice.id);
      else if (next === 'paid') await omInvoiceApi.markPaid(invoice.id, { method: 'check' });
      else if (next === 'cancelled') await omInvoiceApi.cancel(invoice.id);
      else if (next === 'draft') await omInvoiceApi.update(invoice.id, { status: 'draft', taxRate: 0, taxes: invoice.taxes, discount: invoice.discount, items: invoice.items, churchId: (invoice as OmInvoice).churchId, createDate: invoice.createDate, dueDate: invoice.dueDate, invoiceNumber: invoice.invoiceNumber });
      toast.success(next === 'pending' ? 'Invoice sent to the church' : next === 'paid' ? 'Marked as paid (check)' : `Status set to ${next}`);
      refreshInvoice(invoice.id); refreshInvoices();
    } catch (e) {
      setCurrentStatus(prev);
      toast.error(e instanceof Error ? e.message : 'Could not change status');
    }
  }, [invoice, currentStatus]);

  const renderFooter = () => (
    <Box
      sx={{
        py: 3,
        gap: 2,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <div>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          NOTES
        </Typography>
        <Typography variant="body2">
          {om?.notes || 'Thank you for partnering with Orthodox Metrics. Please make checks payable to Orthodox Metrics LLC, or pay online by card.'}
        </Typography>
        {om?.paymentTerms && <Typography variant="body2" sx={{ mt: 0.5 }}>{om.paymentTerms}</Typography>}
      </div>

      <Box sx={{ flexGrow: { md: 1 }, textAlign: { md: 'right' } }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Have a question?
        </Typography>
        <Typography variant="body2">info@orthodoxmetrics.com</Typography>
      </Box>
    </Box>
  );

  const renderList = () => (
    <Scrollbar sx={{ mt: 5 }}>
      <Table sx={{ minWidth: 960 }}>
        <TableHead>
          <TableRow>
            <TableCell width={40}>#</TableCell>
            <TableCell sx={{ typography: 'subtitle2' }}>Description</TableCell>
            <TableCell>Qty</TableCell>
            <TableCell align="right">Unit price</TableCell>
            <TableCell align="right">Total</TableCell>
          </TableRow>
        </TableHead>

        <TableBody>
          {invoice?.items.map((row, index) => (
            <TableRow key={index}>
              <TableCell>{index + 1}</TableCell>

              <TableCell>
                <Box sx={{ maxWidth: 560 }}>
                  <Typography variant="subtitle2">{row.title}</Typography>

                  <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>
                    {row.description}
                  </Typography>
                </Box>
              </TableCell>

              <TableCell>{row.quantity}</TableCell>
              <TableCell align="right">{fCurrency(row.price)}</TableCell>
              <TableCell align="right">{fCurrency(row.price * row.quantity)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Scrollbar>
  );

  return (
    <>
      <InvoiceToolbar
        invoice={invoice}
        currentStatus={currentStatus || ''}
        onChangeStatus={handleChangeStatus}
        statusOptions={STATUS_OPTIONS}
        canManage={canManage}
        canPay={canPay}
        stripeEnabled={stripeEnabled}
      />

      <Card sx={{ pt: 5, px: 5 }}>
        <Box
          sx={{
            rowGap: 5,
            display: 'grid',
            alignItems: 'center',
            gridTemplateColumns: { xs: 'repeat(1, 1fr)', sm: 'repeat(2, 1fr)' },
          }}
        >
          <Box
            component="img"
            alt="Invoice logo"
            src="/logo/logo-single.svg"
            sx={{ width: 48, height: 48 }}
          />

          <Stack spacing={1} sx={{ alignItems: { xs: 'flex-start', md: 'flex-end' } }}>
            <Label
              variant="soft"
              color={
                (currentStatus === 'paid' && 'success') ||
                (currentStatus === 'pending' && 'warning') ||
                (currentStatus === 'overdue' && 'error') ||
                'default'
              }
            >
              {currentStatus}
            </Label>

            <Typography variant="h6">{invoice?.invoiceNumber}</Typography>
          </Stack>

          <Stack sx={{ typography: 'body2' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Invoice from
            </Typography>
            {invoice?.invoiceFrom.name}
            <br />
            {invoice?.invoiceFrom.fullAddress}
            <br />
            {invoice?.invoiceFrom.phoneNumber ? `Phone: ${invoice.invoiceFrom.phoneNumber}` : (invoice?.invoiceFrom as any)?.email || ''}
            <br />
          </Stack>

          <Stack sx={{ typography: 'body2' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Invoice to
            </Typography>
            {invoice?.invoiceTo.name}
            <br />
            {invoice?.invoiceTo.fullAddress}
            <br />
            {invoice?.invoiceTo.phoneNumber ? `Phone: ${invoice.invoiceTo.phoneNumber}` : (invoice?.invoiceTo as any)?.email || ''}
            <br />
          </Stack>

          <Stack sx={{ typography: 'body2' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Date create
            </Typography>
            {fDate(invoice?.createDate)}
          </Stack>

          <Stack sx={{ typography: 'body2' }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Due date
            </Typography>
            {fDate(invoice?.dueDate)}
          </Stack>
        </Box>

        {renderList()}

        <Divider sx={{ borderStyle: 'dashed' }} />

        <InvoiceTotalSummary
          taxes={invoice?.taxes}
          subtotal={invoice?.subtotal}
          discount={invoice?.discount}
          shipping={invoice?.shipping}
          totalAmount={invoice?.totalAmount}
        />

        <Divider sx={{ mt: 5, borderStyle: 'dashed' }} />

        {renderFooter()}
      </Card>
    </>
  );
}
