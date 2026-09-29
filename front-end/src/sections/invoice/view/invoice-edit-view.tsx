import LinearProgress from '@mui/material/LinearProgress';

import { paths } from 'src/routes/paths';
import { useParams } from 'src/routes/hooks';

import { DashboardContent } from 'src/layouts/dashboard';
import { useGetInvoice, type OmInvoice } from 'src/actions/invoice';

import { EmptyContent } from 'src/components/empty-content';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

import { InvoiceCreateEditForm } from '../invoice-create-edit-form';

// ----------------------------------------------------------------------

export function InvoiceEditView() {
  const { id = '' } = useParams();
  const { invoice, canManage, invoiceLoading, invoiceError } = useGetInvoice(id);

  if (invoiceError || (invoice && !canManage)) return <DashboardContent><EmptyContent filled title="Invoice not found" sx={{ py: 10 }} /></DashboardContent>;
  if (invoiceLoading || !invoice) return <DashboardContent><LinearProgress /></DashboardContent>;
  // Form fields: taxes = percent, shipping = amount already paid
  const formInvoice = { ...invoice, taxes: (invoice as OmInvoice & { taxRate?: number }).taxRate ?? 0, shipping: (invoice as OmInvoice).amountPaid ?? 0 };

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading="Edit"
        backHref={paths.dashboard.invoice.root}
        links={[
          { name: 'Dashboard', href: paths.dashboard.root },
          { name: 'Invoice', href: paths.dashboard.invoice.root },
          { name: invoice?.invoiceNumber },
        ]}
        sx={{ mb: { xs: 3, md: 5 } }}
      />

      <InvoiceCreateEditForm currentInvoice={formInvoice} />
    </DashboardContent>
  );
}
