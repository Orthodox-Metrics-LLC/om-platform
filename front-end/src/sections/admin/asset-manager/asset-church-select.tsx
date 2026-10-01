import { useState, useEffect } from 'react';

import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

type Church = { id: number; name: string };
let cache: Church[] | null = null;

/** Church picker fed by OM's admin churches list (`/api/om-admin/churches`). */
export function AssetChurchSelect({ value, onChange, label = 'Church', allowNone = false, size }: { value: number | null; onChange: (id: number | null) => void; label?: string; allowNone?: boolean; size?: 'small' | 'medium' }) {
  const [churches, setChurches] = useState<Church[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    omApiFetch('/api/om-admin/churches')
      .then((r) => r.json())
      .then((j) => {
        const list: Church[] = (j.churches ?? j.data ?? []).map((c: any) => ({ id: c.id, name: c.church_name || c.name }));
        cache = list;
        setChurches(list);
      })
      .catch(() => {});
  }, []);

  return (
    <TextField select size={size} label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <MenuItem value="">All churches</MenuItem>}
      {churches.map((c) => <MenuItem key={c.id} value={c.id}>{c.name} · #{c.id}</MenuItem>)}
    </TextField>
  );
}
