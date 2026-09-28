import type { Theme, SxProps } from '@mui/material/styles';
import type { ICalendarEvent, ICalendarFilters } from 'src/types/calendar';

import Calendar from '@fullcalendar/react';
import listPlugin from '@fullcalendar/list';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { useBoolean, useSetState } from 'minimal-shared/hooks';
import { useRef, useMemo, useState, useEffect, startTransition } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import DialogTitle from '@mui/material/DialogTitle';

import { paths } from 'src/routes/paths';
import { useSearchParams } from 'src/routes/hooks';

import { fIsAfter, fIsBetween } from 'src/utils/format-time';

import { DashboardContent } from 'src/layouts/dashboard';
import { CALENDAR_COLOR_OPTIONS } from 'src/_mock/_calendar';
import { useActiveChurchId } from 'src/layouts/components/use-active-church';
import { updateEvent, useGetEvents, refreshEvents } from 'src/actions/calendar';

import { Iconify } from 'src/components/iconify';

import { FileManagerChurchPicker } from 'src/sections/file-manager/file-manager-church-picker';

import { useAuthContext } from 'src/auth/hooks';
import { isPlatformRole } from 'src/auth/context/om-auth';

import { CalendarRoot } from '../styles';
import { useEvent } from '../hooks/use-event';
import { CalendarForm } from '../calendar-form';
import { omCalendarApi } from '../om-calendar-api';
import { useCalendar } from '../hooks/use-calendar';
import { CalendarToolbar } from '../calendar-toolbar';
import { CalendarFilters } from '../calendar-filters';
import { CalendarDayTooltip } from '../calendar-day-tooltip';
import { CalendarEventDetails } from '../calendar-event-details';
import { CalendarSourcesPanel } from '../calendar-sources-panel';
import { CalendarFiltersResult } from '../calendar-filters-result';

// ----------------------------------------------------------------------

export function CalendarView() {
  const theme = useTheme();

  const openFilters = useBoolean();
  const openSources = useBoolean();
  const { user } = useAuthContext();
  const churchParam = useSearchParams().get('church');
  const activeChurchId = useActiveChurchId();
  const churchId = churchParam ? Number(churchParam) : isPlatformRole(user?.role) ? activeChurchId : null;
  const platformNoChurch = isPlatformRole(user?.role) && !churchId;

  const { events, eventsLoading, canWrite } = useGetEvents(churchId);
  const calendarWrapRef = useRef<HTMLDivElement>(null);
  const [liturgical, setLiturgical] = useState<Map<string, any>>(new Map());
  const [detailsEvent, setDetailsEvent] = useState<any>(null);
  const [litVersion, setLitVersion] = useState(0);

  useEffect(() => {
    if (platformNoChurch) return;
    const start = new Date(); start.setMonth(start.getMonth() - 3, 1);
    const end = new Date(); end.setMonth(end.getMonth() + 12, 1);
    omCalendarApi.liturgical(churchId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
      .then((r) => setLiturgical(new Map(r.days.map((d) => [d.date, d]))))
      .catch(() => setLiturgical(new Map()));
  }, [churchId, platformNoChurch, litVersion]);

  const filters = useSetState<ICalendarFilters>({ colors: [], startDate: null, endDate: null });
  const { state: currentFilters } = filters;

  const dateError = fIsAfter(currentFilters.startDate, currentFilters.endDate);

  const {
    calendarRef,
    /********/
    view,
    title,
    /********/
    onDropEvent,
    onChangeView,
    onSelectRange,
    onClickEvent,
    onResizeEvent,
    onDateNavigation,
    /********/
    openForm,
    onOpenForm,
    onCloseForm,
    /********/
    selectedRange,
    selectedEventId,
    /********/
    onClickEventInFilters,
  } = useCalendar();

  const currentEvent = useEvent(events, selectedEventId, selectedRange, openForm);
  const readonlyIds = useMemo(() => new Set(events.filter((e: any) => e.readonly).map((e) => e.id)), [events]);

  // Synced events open a read-only card instead of the edit form.
  useEffect(() => {
    if (openForm && selectedEventId && readonlyIds.has(selectedEventId)) {
      onCloseForm();
      setDetailsEvent(events.find((e) => e.id === selectedEventId) ?? null);
    }
  }, [openForm, selectedEventId, readonlyIds, events, onCloseForm]);

  const canReset =
    currentFilters.colors.length > 0 || (!!currentFilters.startDate && !!currentFilters.endDate);

  const dataFiltered = applyFilter({
    inputData: events,
    filters: currentFilters,
    dateError,
  });

  const flexStyles: SxProps<Theme> = {
    flex: '1 1 auto',
    display: 'flex',
    flexDirection: 'column',
  };

  const renderCreateFormDialog = () => (
    <Dialog
      aria-hidden={!openForm}
      fullWidth
      maxWidth="xs"
      open={openForm}
      onClose={onCloseForm}
      transitionDuration={{
        enter: theme.transitions.duration.shortest,
        exit: theme.transitions.duration.shortest - 80,
      }}
      slotProps={{
        paper: {
          sx: {
            display: 'flex',
            overflow: 'hidden',
            flexDirection: 'column',
            '& form': { ...flexStyles, minHeight: 0 },
          },
        },
      }}
    >
      <DialogTitle sx={{ minHeight: 76 }}>
        {openForm && <> {currentEvent?.id ? 'Edit' : 'Add'} event</>}
      </DialogTitle>

      <CalendarForm
        currentEvent={currentEvent}
        colorOptions={CALENDAR_COLOR_OPTIONS}
        onClose={onCloseForm}
      />
    </Dialog>
  );

  const renderFiltersDrawer = () => (
    <CalendarFilters
      events={events}
      filters={filters}
      canReset={canReset}
      dateError={dateError}
      open={openFilters.value}
      onClose={openFilters.onFalse}
      onClickEvent={onClickEventInFilters}
      colorOptions={CALENDAR_COLOR_OPTIONS}
    />
  );

  const renderResults = () => (
    <CalendarFiltersResult
      filters={filters}
      totalResults={dataFiltered.length}
      sx={{ mb: { xs: 3, md: 5 } }}
    />
  );

  if (platformNoChurch) return <FileManagerChurchPicker heading="Calendar" basePath={paths.dashboard.calendar} />;

  return (
    <>
      <DashboardContent maxWidth="xl" sx={{ ...flexStyles }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: { xs: 3, md: 5 },
          }}
        >
          <Typography variant="h4">Calendar</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" color="inherit" startIcon={<Iconify icon="solar:calendar-date-bold" />} onClick={openSources.onTrue}>
              Calendars
            </Button>
            {canWrite && (
              <Button variant="contained" startIcon={<Iconify icon="mingcute:add-line" />} onClick={onOpenForm}>
                Add event
              </Button>
            )}
          </Box>
        </Box>

        {canReset && renderResults()}

        <Card sx={{ ...flexStyles, minHeight: '50vh' }}>
          <CalendarRoot ref={calendarWrapRef} sx={{ ...flexStyles }}>
            <CalendarToolbar
              view={view}
              title={title}
              canReset={canReset}
              loading={eventsLoading}
              onChangeView={onChangeView}
              onDateNavigation={onDateNavigation}
              onOpenFilters={openFilters.onTrue}
              viewOptions={[
                { value: 'dayGridMonth', label: 'Month', icon: 'mingcute:calendar-month-line' },
                { value: 'timeGridWeek', label: 'Week', icon: 'mingcute:calendar-week-line' },
                { value: 'timeGridDay', label: 'Day', icon: 'mingcute:calendar-day-line' },
                { value: 'listWeek', label: 'Agenda', icon: 'custom:calendar-agenda-outline' },
              ]}
            />

            <Calendar
              weekends
              editable={canWrite}
              droppable={canWrite}
              selectable={canWrite}
              allDayMaintainDuration
              eventResizableFromStart
              firstDay={1}
              aspectRatio={3}
              dayMaxEvents={3}
              eventMaxStack={2}
              rerenderDelay={10}
              headerToolbar={false}
              eventDisplay="block"
              ref={calendarRef}
              initialView={view}
              events={dataFiltered}
              select={onSelectRange}
              eventClick={onClickEvent}
              businessHours={{
                daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
              }}
              eventDrop={(arg) => {
                startTransition(() => {
                  onDropEvent(arg, updateEvent);
                });
              }}
              eventResize={(arg) => {
                startTransition(() => {
                  onResizeEvent(arg, updateEvent);
                });
              }}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
            />
          </CalendarRoot>
        </Card>
      </DashboardContent>

      {renderCreateFormDialog()}
      {renderFiltersDrawer()}
      <CalendarDayTooltip containerRef={calendarWrapRef} days={liturgical} />
      <CalendarEventDetails event={detailsEvent} onClose={() => setDetailsEvent(null)} />
      <CalendarSourcesPanel open={openSources.value} onClose={openSources.onFalse} churchId={churchId} colorOptions={CALENDAR_COLOR_OPTIONS} onChanged={() => { refreshEvents(); setLitVersion((v) => v + 1); }} />
    </>
  );
}

// ----------------------------------------------------------------------

type ApplyFilterProps = {
  dateError: boolean;
  filters: ICalendarFilters;
  inputData: ICalendarEvent[];
};

function applyFilter({ inputData, filters, dateError }: ApplyFilterProps) {
  const { colors, startDate, endDate } = filters;

  const stabilizedThis = inputData.map((el, index) => [el, index] as const);

  inputData = stabilizedThis.map((el) => el[0]);

  if (colors.length) {
    inputData = inputData.filter((event) => colors.includes(event.color as string));
  }

  if (!dateError) {
    if (startDate && endDate) {
      inputData = inputData.filter((event) => fIsBetween(event.start, startDate, endDate));
    }
  }

  return inputData;
}
