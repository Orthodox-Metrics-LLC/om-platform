import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import { useTheme } from '@mui/material/styles';

import { useRouter } from 'src/routes/hooks';

import { MotivationIllustration } from 'src/assets/illustrations';
import {
  _ecommerceNewProducts,
  _ecommerceBestSalesman,
  _ecommerceSalesOverview,
  _ecommerceLatestProducts,
} from 'src/_mock';

import { Iconify } from 'src/components/iconify';
import { useWalktour } from 'src/components/walktour';

import { EcommerceWelcome } from 'src/sections/overview/e-commerce/ecommerce-welcome';
import { EcommerceNewProducts } from 'src/sections/overview/e-commerce/ecommerce-new-products';
import { EcommerceYearlySales } from 'src/sections/overview/e-commerce/ecommerce-yearly-sales';
import { EcommerceBestSalesman } from 'src/sections/overview/e-commerce/ecommerce-best-salesman';
import { EcommerceSaleByGender } from 'src/sections/overview/e-commerce/ecommerce-sale-by-gender';
import { EcommerceSalesOverview } from 'src/sections/overview/e-commerce/ecommerce-sales-overview';
import { EcommerceWidgetSummary } from 'src/sections/overview/e-commerce/ecommerce-widget-summary';
import { EcommerceLatestProducts } from 'src/sections/overview/e-commerce/ecommerce-latest-products';
import { EcommerceCurrentBalance } from 'src/sections/overview/e-commerce/ecommerce-current-balance';

import { ComponentLayout } from '../../layout';
import { TOUR_IDS, getTourSteps } from './steps';

// ----------------------------------------------------------------------

export function WalktourView() {
  const theme = useTheme();

  const router = useRouter();

  const { Tour } = useWalktour({
    steps: getTourSteps(theme),
  });

  return (
    <>
      {Tour}

      <ComponentLayout
        heroProps={{
          heading: 'Walktour',
          moreLinks: ['https://docs.react-joyride.com/'],
        }}
        containerProps={{ maxWidth: 'lg' }}
      >
        <Box sx={{ mb: 5, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            size="large"
            variant="outlined"
            onClick={() => router.refresh()}
            startIcon={<Iconify icon="solar:restart-bold" />}
          >
            Reload
          </Button>
        </Box>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <EcommerceWelcome
              data-step={`${TOUR_IDS.welcome}`}
              title={`Congratulations 🎉  \n Jaydon Frankie`}
              description="Best seller of the month you have done 57.6% more sales today."
              img={<MotivationIllustration hideBackground />}
              action={
                <Button variant="contained" color="primary">
                  Go now
                </Button>
              }
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <EcommerceNewProducts
              data-step={`${TOUR_IDS.newProducts}`}
              list={_ecommerceNewProducts}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <EcommerceWidgetSummary
              title="Product sold"
              percent={2.6}
              total={765}
              chart={{
                categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
                series: [22, 8, 35, 50, 82, 84, 77, 12],
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <EcommerceWidgetSummary
              data-step={`${TOUR_IDS.totalBalance}`}
              title="Total balance"
              percent={-0.1}
              total={18765}
              chart={{
                colors: [theme.palette.warning.light, theme.palette.warning.main],
                categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
                series: [56, 47, 40, 62, 73, 30, 23, 54],
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <EcommerceWidgetSummary
              title="Sales profit"
              percent={0.6}
              total={4876}
              chart={{
                colors: [theme.palette.error.light, theme.palette.error.main],
                categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
                series: [40, 70, 75, 70, 50, 28, 7, 64],
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 4 }}>
            <EcommerceSaleByGender
              title="Sale by gender"
              total={2324}
              chart={{
                series: [
                  { label: 'Mens', value: 25 },
                  { label: 'Womens', value: 50 },
                  { label: 'Kids', value: 75 },
                ],
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 8 }}>
            <EcommerceYearlySales
              data-step={`${TOUR_IDS.yearlySales}`}
              title="Yearly sales"
              subheader="(+43%) than last year"
              chart={{
                categories: [
                  'Jan',
                  'Feb',
                  'Mar',
                  'Apr',
                  'May',
                  'Jun',
                  'Jul',
                  'Aug',
                  'Sep',
                  'Oct',
                  'Nov',
                  'Dec',
                ],
                series: [
                  {
                    name: '2022',
                    data: [
                      {
                        name: 'Total income',
                        data: [10, 41, 35, 51, 49, 62, 69, 91, 148, 35, 51, 49],
                      },
                      {
                        name: 'Total expenses',
                        data: [10, 34, 13, 56, 77, 88, 99, 77, 45, 13, 56, 77],
                      },
                    ],
                  },
                  {
                    name: '2023',
                    data: [
                      {
                        name: 'Total income',
                        data: [51, 35, 41, 10, 91, 69, 62, 148, 91, 69, 62, 49],
                      },
                      {
                        name: 'Total expenses',
                        data: [56, 13, 34, 10, 77, 99, 88, 45, 77, 99, 88, 77],
                      },
                    ],
                  },
                ],
              }}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 8 }}>
            <EcommerceSalesOverview title="Sales overview" data={_ecommerceSalesOverview} />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 4 }}>
            <EcommerceCurrentBalance
              title="Current balance"
              earning={25500}
              refunded={1600}
              orderTotal={287650}
              currentBalance={187650}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 8 }}>
            <EcommerceBestSalesman
              title="Best salesman"
              tableData={_ecommerceBestSalesman}
              headCells={[
                { id: 'name', label: 'Seller' },
                { id: 'category', label: 'Product' },
                { id: 'country', label: 'Country', align: 'center' },
                { id: 'totalAmount', label: 'Total', align: 'right' },
                { id: 'rank', label: 'Rank', align: 'right' },
              ]}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 6, lg: 4 }}>
            <EcommerceLatestProducts
              data-step={`${TOUR_IDS.latestProducts}`}
              title="Latest products"
              list={_ecommerceLatestProducts}
            />
          </Grid>
        </Grid>
      </ComponentLayout>
    </>
  );
}
