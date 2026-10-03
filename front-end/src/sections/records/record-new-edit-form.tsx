import type { OmRecord, RecordType } from './om-records-api';

import * as z from 'zod';
import dayjs from 'dayjs';
import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { toast } from 'src/components/snackbar';
import { Iconify } from 'src/components/iconify';
import { Form, Field } from 'src/components/hook-form';

import { useRecordsChurch } from './use-records-church';
import { omRecordsApi, RECORD_TYPES, RECORD_STATUSES } from './om-records-api';

// ----------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = (label: string, required = false) =>
  z.string().refine((v: string) => (required ? ISO_DATE.test(v) : !v || ISO_DATE.test(v)), required ? `${label} is required` : `${label} must be a valid date`);

const schemas = {
  baptism: z.object({
    first_name: z.string().min(1, 'First name is required'),
    last_name: z.string().min(1, 'Last name is required'),
    birth_date: dateField('Date of birth', true),
    reception_date: dateField('Baptism date'),
    birthplace: z.string().optional(),
    parents: z.string().optional(),
    sponsors: z.string().optional(),
    clergy: z.string().min(1, 'Clergy is required'),
    entry_type: z.string().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
  }),
  marriage: z.object({
    fname_groom: z.string().min(1, "Groom's first name is required"),
    lname_groom: z.string().min(1, "Groom's last name is required"),
    parentsg: z.string().optional(),
    fname_bride: z.string().min(1, "Bride's first name is required"),
    lname_bride: z.string().min(1, "Bride's last name is required"),
    parentsb: z.string().optional(),
    mdate: dateField('Marriage date', true),
    witness: z.string().optional(),
    mlicense: z.string().optional(),
    clergy: z.string().min(1, 'Celebrant is required'),
    status: z.string().optional(),
    notes: z.string().optional(),
  }),
  funeral: z.object({
    name: z.string().min(1, 'First name is required'),
    lastname: z.string().min(1, 'Last name is required'),
    deceased_date: dateField('Date of death', true),
    burial_date: dateField('Burial date'),
    age: z.string().optional(),
    burial_location: z.string().optional(),
    clergy: z.string().min(1, 'Clergy is required'),
    status: z.string().optional(),
    notes: z.string().optional(),
  }),
};

const toDate = (v: unknown) => (v ? dayjs(String(v)).format('YYYY-MM-DD') : '');

function defaults(type: RecordType, r?: OmRecord['raw']) {
  const base = { clergy: r?.clergy ?? '', status: r?.status ?? 'Recorded', notes: r?.notes ?? '' };
  if (type === 'baptism') return { ...base, first_name: r?.first_name ?? '', last_name: r?.last_name ?? '', birth_date: toDate(r?.birth_date), reception_date: toDate(r?.reception_date), birthplace: r?.birthplace ?? '', parents: r?.parents ?? '', sponsors: r?.sponsors ?? '', entry_type: r?.entry_type ?? 'Baptism' };
  if (type === 'marriage') return { ...base, fname_groom: r?.fname_groom ?? '', lname_groom: r?.lname_groom ?? '', parentsg: r?.parentsg ?? '', fname_bride: r?.fname_bride ?? '', lname_bride: r?.lname_bride ?? '', parentsb: r?.parentsb ?? '', mdate: toDate(r?.mdate), witness: r?.witness ?? '', mlicense: r?.mlicense ?? '' };
  return { ...base, name: r?.name ?? '', lastname: r?.lastname ?? '', deceased_date: toDate(r?.deceased_date), burial_date: toDate(r?.burial_date), age: r?.age != null ? String(r.age) : '', burial_location: r?.burial_location ?? '' };
}

// ----------------------------------------------------------------------

/** Add / edit a sacramental record (Minimal product form pattern) on `/api/{type}-records`. */
export function RecordNewEditForm({ type, currentRecord }: { type: RecordType; currentRecord?: OmRecord }) {
  const router = useRouter();
  const { churchId, platform, canChangeStatus } = useRecordsChurch();
  const meta = RECORD_TYPES.find((t) => t.value === type)!;
  const [clergy, setClergy] = useState<string[]>([]);

  useEffect(() => {
    if (!churchId) return;
    Promise.all([omRecordsApi.clergy(churchId).catch(() => []), omRecordsApi.dropdownOptions(type, 'clergy', churchId).catch(() => [])]).then(([canon, used]) => {
      const set = new Set<string>([...canon.map((c) => c.label || c.value), ...used].map((s) => s.trim()).filter(Boolean));
      if (currentRecord?.raw.clergy) set.add(currentRecord.raw.clergy);
      setClergy([...set].sort());
    });
  }, [churchId, type, currentRecord]);

  const methods = useForm<any>({ resolver: zodResolver(schemas[type]), defaultValues: defaults(type, currentRecord?.raw) });
  const { handleSubmit, formState: { isSubmitting } } = methods;

  const onSubmit = handleSubmit(async (data) => {
    if (!churchId) return;
    const payload: Record<string, unknown> = { ...data, church_id: churchId };
    if (type === 'funeral' && payload.age !== undefined) payload.age = payload.age === '' ? null : Number(payload.age);
    Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
    if (!canChangeStatus) delete payload.status;
    try {
      if (currentRecord) {
        await omRecordsApi.update(type, currentRecord.id, payload);
        toast.success(`${meta.label} record updated`);
        router.push(`${paths.portal.records.details(type, currentRecord.id)}${platform ? `?church=${churchId}` : ''}`);
      } else {
        const r = await omRecordsApi.create(type, payload);
        const id = r.id ?? r.record?.id ?? r.data?.id;
        toast.success(`${meta.label} record created`);
        router.push(id ? `${paths.portal.records.details(type, id)}${platform ? `?church=${churchId}` : ''}` : `${paths.portal.records.list(type)}${platform ? `?church=${churchId}` : ''}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save record');
    }
  });

  const clergySelect = <Field.Autocomplete name="clergy" label={type === 'marriage' ? 'Celebrant' : 'Clergy'} freeSolo options={clergy} getOptionLabel={(o: any) => o} renderOption={(props, option) => <li {...props} key={String(option)}>{String(option)}</li>} />;
  const two = { display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } } as const;

  return (
    <Form methods={methods} onSubmit={onSubmit}>
      <Stack spacing={{ xs: 3, md: 5 }} sx={{ mx: 'auto', maxWidth: { xs: 720, xl: 880 } }}>
        <Card>
          <CardHeader title={type === 'baptism' ? 'Person baptized' : type === 'marriage' ? 'Couple' : 'The departed'} subheader="Names as they should appear on the certificate" sx={{ mb: 3 }} />
          <Stack spacing={3} sx={{ p: 3, pt: 0 }}>
            {type === 'baptism' && (<><Box sx={two}><Field.Text name="first_name" label="First name" /><Field.Text name="last_name" label="Last name" /></Box><Box sx={two}><Field.Text name="birth_date" label="Date of birth" type="date" slotProps={{ inputLabel: { shrink: true } }} /><Field.Text name="birthplace" label="Birthplace" placeholder="City, State" /></Box><Field.Text name="parents" label="Parents" placeholder="Father and mother" /></>)}
            {type === 'marriage' && (<><Typography variant="subtitle2">Groom</Typography><Box sx={two}><Field.Text name="fname_groom" label="First name" /><Field.Text name="lname_groom" label="Last name" /></Box><Field.Text name="parentsg" label="Groom's parents" /><Typography variant="subtitle2" sx={{ mt: 1 }}>Bride</Typography><Box sx={two}><Field.Text name="fname_bride" label="First name" /><Field.Text name="lname_bride" label="Last name" /></Box><Field.Text name="parentsb" label="Bride's parents" /></>)}
            {type === 'funeral' && (<><Box sx={two}><Field.Text name="name" label="First name" /><Field.Text name="lastname" label="Last name" /></Box><Box sx={two}><Field.Text name="deceased_date" label="Date of death" type="date" slotProps={{ inputLabel: { shrink: true } }} /><Field.Text name="age" label="Age" type="number" /></Box></>)}
          </Stack>
        </Card>

        <Card>
          <CardHeader title="Sacrament" subheader={`Where and by whom the ${meta.label.toLowerCase()} was performed`} sx={{ mb: 3 }} />
          <Stack spacing={3} sx={{ p: 3, pt: 0 }}>
            {type === 'baptism' && (<><Box sx={two}><Field.Text name="reception_date" label="Baptism date" type="date" slotProps={{ inputLabel: { shrink: true } }} /><Field.Select name="entry_type" label="Received by"><MenuItem value="Baptism">Baptism</MenuItem><MenuItem value="Chrismation">Chrismation</MenuItem><MenuItem value="Baptism and Chrismation">Baptism and Chrismation</MenuItem></Field.Select></Box><Field.Text name="sponsors" label="Sponsors / godparents" /></>)}
            {type === 'marriage' && (<><Box sx={two}><Field.Text name="mdate" label="Marriage date" type="date" slotProps={{ inputLabel: { shrink: true } }} /><Field.Text name="mlicense" label="License number" /></Box><Field.Text name="witness" label="Witnesses" placeholder="Separate names with commas" /></>)}
            {type === 'funeral' && (<Box sx={two}><Field.Text name="burial_date" label="Burial date" type="date" slotProps={{ inputLabel: { shrink: true } }} /><Field.Text name="burial_location" label="Burial place" /></Box>)}
            {clergySelect}
          </Stack>
        </Card>

        <Card>
          <CardHeader title="Register" subheader="Status and clerical notes" sx={{ mb: 3 }} />
          <Stack spacing={3} sx={{ p: 3, pt: 0 }}>
            <Field.Select name="status" label="Status" disabled={!canChangeStatus} helperText={canChangeStatus ? undefined : 'Only priests and church administrators can change the status'}>
              {[...new Set([...RECORD_STATUSES, ...(currentRecord?.raw.status ? [currentRecord.raw.status] : [])])].map((s) => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</MenuItem>)}
            </Field.Select>
            <Field.Text name="notes" label="Notes" multiline rows={3} />
          </Stack>
        </Card>

        <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
          <Button variant="outlined" color="inherit" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" variant="contained" loading={isSubmitting} startIcon={<Iconify icon={currentRecord ? 'solar:pen-bold' : 'mingcute:add-line'} />}>{currentRecord ? 'Save changes' : `Create ${meta.label.toLowerCase()} record`}</Button>
        </Box>
      </Stack>
    </Form>
  );
}
