import type { IInvoice } from 'src/types/invoice';

import { useBoolean } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import DialogActions from '@mui/material/DialogActions';

import { paths } from 'src/routes/paths';
import { RouterLink } from 'src/routes/components';

import { fCurrency } from 'src/utils/format-number';

import { omInvoiceApi, refreshInvoice, type OmInvoice, refreshInvoices } from 'src/actions/invoice';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';

import { InvoicePDFViewer, InvoicePDFDownload } from './invoice-pdf';

// ----------------------------------------------------------------------

type Props = {
  invoice?: IInvoice;
  canManage?: boolean;
  canPay?: boolean;
  stripeEnabled?: boolean;
  currentStatus: string;
  statusOptions: { value: string; label: string }[];
  onChangeStatus: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export function InvoiceToolbar({ invoice, currentStatus, statusOptions, onChangeStatus, canManage = false, canPay = false, stripeEnabled = false }: Props) {
  const { value: open, onFalse: onClose, onTrue: onOpen } = useBoolean();
  const paying = useBoolean();
  const sending = useBoolean();

  const handlePay = async () => {
    if (!invoice) return;
    paying.onTrue();
    try {
      const r = await omInvoiceApi.payWithStripe(invoice.id);
      window.location.assign(r.url); // Stripe Checkout (hosted, card)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start payment');
      paying.onFalse();
    }
  };

  const handleSend = async () => {
    if (!invoice) return;
    sending.onTrue();
    try {
      await omInvoiceApi.send(invoice.id);
      toast.success(`Invoice ${invoice.invoiceNumber} sent — the parish has been notified`);
      refreshInvoice(invoice.id); refreshInvoices();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally {
      sending.onFalse();
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}${paths.dashboard.invoice.details(`${invoice?.id}`)}`;
    try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.info(url); }
  };

  const renderDownloadButton = () =>
    invoice ? <InvoicePDFDownload invoice={invoice} currentStatus={currentStatus} /> : null;

  const renderDetailsDialog = () => (
    <Dialog fullScreen open={open}>
      <Box sx={{ height: 1, display: 'flex', flexDirection: 'column' }}>
        <DialogActions sx={{ p: 1.5 }}>
          <Button color="inherit" variant="contained" onClick={onClose}>
            Close
          </Button>
        </DialogActions>
        <Box sx={{ flexGrow: 1, height: 1, overflow: 'hidden' }}>
          {invoice && <InvoicePDFViewer invoice={invoice} currentStatus={currentStatus} />}
        </Box>
      </Box>
    </Dialog>
  );

  return (
    <>
      <Box
        sx={{
          gap: 3,
          display: 'flex',
          mb: { xs: 3, md: 5 },
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'flex-end', sm: 'center' },
        }}
      >
        <Box
          sx={{
            gap: 1,
            width: 1,
            flexGrow: 1,
            display: 'flex',
          }}
        >
          {canManage && currentStatus !== 'paid' && (
            <Tooltip title="Edit">
              <IconButton
                component={RouterLink}
                href={paths.dashboard.invoice.edit(`${invoice?.id}`)}
              >
                <Iconify icon="solar:pen-bold" />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="View">
            <IconButton onClick={onOpen}>
              <Iconify icon="solar:eye-bold" />
            </IconButton>
          </Tooltip>

          {renderDownloadButton()}

          <Tooltip title="Print">
            <IconButton onClick={() => window.print()}>
              <Iconify icon="solar:printer-minimalistic-bold" />
            </IconButton>
          </Tooltip>

          {canManage && ['draft', 'pending', 'overdue'].includes(currentStatus) && (
            <Tooltip title={currentStatus === 'draft' ? 'Send to the church' : 'Re-send notification'}>
              <IconButton onClick={handleSend} disabled={sending.value}>
                <Iconify icon="custom:send-fill" />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title="Copy link">
            <IconButton onClick={handleShare}>
              <Iconify icon="solar:share-bold" />
            </IconButton>
          </Tooltip>

          {canPay && (
            <Button
              variant="contained"
              color="primary"
              loading={paying.value}
              disabled={!stripeEnabled}
              onClick={handlePay}
              startIcon={<Iconify icon="solar:wad-of-money-bold" />}
              sx={{ ml: 'auto' }}
            >
              Pay {fCurrency((invoice as OmInvoice)?.balanceDue ?? invoice?.totalAmount)} by card
            </Button>
          )}
        </Box>

        <TextField
          fullWidth
          select
          label="Status"
          value={currentStatus}
          onChange={onChangeStatus}
          disabled={!canManage || currentStatus === 'paid'}
          sx={{ maxWidth: 180 }}
          slotProps={{
            htmlInput: { id: 'status-select' },
            inputLabel: { htmlFor: 'status-select' },
          }}
        >
          {statusOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {renderDetailsDialog()}
    </>
  );
}
