import type { InvoiceCreateSchemaType } from './invoice-create-edit-form';

import { useState, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { useBoolean } from 'minimal-shared/hooks';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';

import { paths } from 'src/routes/paths';

import { omInvoiceApi, type InvoiceAddress } from 'src/actions/invoice';

import { Iconify } from 'src/components/iconify';

import { AddressListDialog } from '../address';

// ----------------------------------------------------------------------

export function InvoiceCreateEditAddress() {
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<InvoiceCreateSchemaType>();

  const mdUp = useMediaQuery((theme) => theme.breakpoints.up('md'));

  const values = watch();

  const addressTo = useBoolean();
  const addressForm = useBoolean();

  const { invoiceFrom, invoiceTo } = values;

  // Issuer (Orthodox Metrics LLC) + every provisioned church, from the server address book.
  const [book, setBook] = useState<{ from: InvoiceAddress[]; to: InvoiceAddress[] }>({ from: [], to: [] });
  useEffect(() => {
    omInvoiceApi.addressBook().then((b) => {
      setBook(b);
      if (!invoiceFrom && b.from[0]) setValue('invoiceFrom', b.from[0]);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Stack
        divider={
          <Divider
            flexItem
            orientation={mdUp ? 'vertical' : 'horizontal'}
            sx={{ borderStyle: 'dashed' }}
          />
        }
        sx={{ p: 3, gap: { xs: 3, md: 5 }, flexDirection: { xs: 'column', md: 'row' } }}
      >
        <Stack sx={{ width: 1 }}>
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ color: 'text.disabled', flexGrow: 1 }}>
              From:
            </Typography>

            {book.from.length > 1 && (
              <IconButton onClick={addressForm.onTrue}>
                <Iconify icon="solar:pen-bold" />
              </IconButton>
            )}
          </Box>

          <Stack spacing={1}>
            <Typography variant="subtitle2">{invoiceFrom?.name}</Typography>
            <Typography variant="body2">{invoiceFrom?.fullAddress}</Typography>
            <Typography variant="body2"> {invoiceFrom?.phoneNumber || (invoiceFrom as InvoiceAddress | null)?.email}</Typography>
          </Stack>
        </Stack>

        <Stack sx={{ width: 1 }}>
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ color: 'text.disabled', flexGrow: 1 }}>
              To:
            </Typography>

            <IconButton onClick={addressTo.onTrue}>
              <Iconify icon={invoiceTo ? 'solar:pen-bold' : 'mingcute:add-line'} />
            </IconButton>
          </Box>

          {invoiceTo ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2">{invoiceTo?.name}</Typography>
              <Typography variant="body2">{invoiceTo?.fullAddress}</Typography>
              <Typography variant="body2"> {invoiceTo?.phoneNumber || (invoiceTo as InvoiceAddress)?.email}</Typography>
            </Stack>
          ) : (
            <Typography variant="caption" sx={{ color: 'error.main' }}>
              {errors.invoiceTo?.message}
            </Typography>
          )}
        </Stack>
      </Stack>

      <AddressListDialog
        title="Issuer"
        open={addressForm.value}
        onClose={addressForm.onFalse}
        selected={(selectedId: string) => invoiceFrom?.id === selectedId}
        onSelect={(address) => setValue('invoiceFrom', address)}
        list={book.from}
      />

      <AddressListDialog
        title="Churches"
        open={addressTo.value}
        onClose={addressTo.onFalse}
        selected={(selectedId: string) => invoiceTo?.id === selectedId}
        onSelect={(address) => setValue('invoiceTo', address, { shouldValidate: true })}
        list={book.to}
        action={
          <Button
            size="small"
            href={paths.dashboard.user.list}
            startIcon={<Iconify icon="mingcute:add-line" />}
            sx={{ alignSelf: 'flex-end' }}
          >
            Manage churches
          </Button>
        }
      />
    </>
  );
}
