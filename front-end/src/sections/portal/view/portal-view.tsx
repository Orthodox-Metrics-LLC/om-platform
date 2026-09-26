import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';

import { AnalyticsNews } from 'src/sections/overview/analytics/analytics-news';
import { AnalyticsTasks } from 'src/sections/overview/analytics/analytics-tasks';
import { AnalyticsCurrentVisits } from 'src/sections/overview/analytics/analytics-current-visits';
import { AnalyticsOrderTimeline } from 'src/sections/overview/analytics/analytics-order-timeline';
import { AnalyticsWebsiteVisits } from 'src/sections/overview/analytics/analytics-website-visits';
import { AnalyticsWidgetSummary } from 'src/sections/overview/analytics/analytics-widget-summary';
import { AnalyticsCurrentSubject } from 'src/sections/overview/analytics/analytics-current-subject';
import { AnalyticsConversionRates } from 'src/sections/overview/analytics/analytics-conversion-rates';

import { PortalResources } from '../portal-resources';
import {
  PORTAL_NEWS,
  PORTAL_TASKS,
  PORTAL_EVENTS,
  usePortalData,
  PORTAL_MINISTRIES,
  PORTAL_AGE_GROUPS,
  PORTAL_ATTENDANCE,
  PORTAL_SACRAMENTAL,
} from '../portal-data';

// ----------------------------------------------------------------------

const SPARKLINE_CATEGORIES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

export function PortalView() {
  const { churchName, summary } = usePortalData();

  return (
    <DashboardContent maxWidth="xl">
      <Typography variant="h4">Hi, Welcome back 👋</Typography>
      <Typography variant="subtitle1" sx={{ mt: 0.5 }}>
        {churchName ? `${churchName} | Parish Portal` : 'Parish Portal'}
      </Typography>
      <Typography variant="body2" sx={{ mb: { xs: 3, md: 5 }, color: 'text.secondary' }}>
        Serving our parish family through faithful stewardship of our records
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AnalyticsWidgetSummary
            title="New Parishioners"
            percent={20}
            total={summary.newParishioners}
            icon={<Iconify icon="solar:users-group-rounded-bold-duotone" width={48} />}
            chart={{
              categories: SPARKLINE_CATEGORIES,
              series: [22, 8, 35, 50, 82, 84, 77, 12],
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AnalyticsWidgetSummary
            title="Baptisms"
            percent={14}
            total={summary.baptisms}
            color="secondary"
            icon={<Iconify icon="solar:cup-star-bold" width={48} />}
            chart={{
              categories: SPARKLINE_CATEGORIES,
              series: [56, 47, 40, 62, 73, 30, 23, 54],
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AnalyticsWidgetSummary
            title="Marriages"
            percent={50}
            total={summary.marriages}
            color="warning"
            icon={<Iconify icon="solar:heart-bold" width={48} />}
            chart={{
              categories: SPARKLINE_CATEGORIES,
              series: [40, 70, 50, 28, 70, 75, 7, 64],
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <AnalyticsWidgetSummary
            title="Funerals"
            percent={25}
            total={summary.funerals}
            color="error"
            icon={<Iconify icon="custom:cross-bold" width={48} />}
            chart={{
              categories: SPARKLINE_CATEGORIES,
              series: [56, 30, 23, 54, 47, 40, 62, 73],
            }}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsCurrentVisits
            title="Parishioners by Age Group"
            chart={{ series: PORTAL_AGE_GROUPS }}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsWebsiteVisits
            title="Attendance by Month"
            subheader="(+18%) than last year"
            chart={PORTAL_ATTENDANCE}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsConversionRates
            title="Sacramental Activity"
            subheader="(+12%) than last year"
            chart={PORTAL_SACRAMENTAL}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsCurrentSubject title="Parish Ministries" chart={PORTAL_MINISTRIES} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsNews title="Parish News" list={PORTAL_NEWS} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <AnalyticsOrderTimeline title="Upcoming Events" list={PORTAL_EVENTS} />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <PortalResources />
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <AnalyticsTasks title="My Tasks" list={PORTAL_TASKS} />
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
