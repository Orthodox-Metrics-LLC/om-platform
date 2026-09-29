import { useEffect } from 'react';

import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { useParams, useSearchParams } from 'src/routes/hooks';

import { DashboardContent } from 'src/layouts/dashboard';
import { omInvoiceApi, useGetInvoice, refreshInvoice, refreshInvoices } from 'src/actions/invoice';

import { toast } from 'src/components/snackbar';
import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { InvoiceDetails } from '../invoice-details';

// ----------------------------------------------------------------------

export function InvoiceDetailsView() {
  const { id = '' } = useParams();
  const payment = useSearchParams().get('payment');
  const { invoice, canManage, canPay, stripeEnabled, invoiceLoading, invoiceError } = useGetInvoice(id);

  // Returning from Stripe Checkout: confirm server-side (covers webhook latency).
  useEffect(() => {
    if (!id || payment !== 'success') return;
    omInvoiceApi.confirmStripe(id).then((inv) => {
      if (inv.status === 'paid') toast.success(`Payment received — thank you! Invoice ${inv.invoiceNumber} is paid.`);
      refreshInvoice(id); refreshInvoices();
    }).catch(() => {});
  }, [id, payment]);
  useEffect(() => { if (payment === 'cancelled') toast.info('Payment cancelled — you can pay whenever you are ready.'); }, [payment]);

  if (invoiceError) return <DashboardContent><EmptyContent filled title="Invoice not found" sx={{ py: 10 }} /></DashboardContent>;
  if (invoiceLoading || !invoice) return <DashboardContent><LinearProgress /></DashboardContent>;

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading={invoice?.invoiceNumber}
        backHref={paths.dashboard.invoice.root}
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Invoice', href: paths.dashboard.invoice.root },
          { name: invoice?.invoiceNumber },
        ]}
        sx={{ mb: 3 }}
      />

      <InvoiceDetails invoice={invoice} canManage={canManage} canPay={canPay} stripeEnabled={stripeEnabled} />
    </DashboardContent>
  );
}
