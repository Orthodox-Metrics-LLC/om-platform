import React from 'react';
/**
 * SearchConfigurationPage — Search performance, filters, and results display settings.
 * Persists via /api/parish-settings/:churchId/search using useParishSettingsWithLocal.
 */

import { Box } from '@mui/material';

import { useParishSettingsWithLocal } from './use-parish-settings';
import { SettingsFieldGroupCard, type SettingsFieldGroupDef } from './settings-field-group';
import { BoltOutlinedIcon, SearchOutlinedIcon, FilterListOutlinedIcon } from './parish-icons';
import { SettingsErrorAlert, SettingsPageHeader, SettingsLoadingSpinner } from './settings-card-section';

interface SearchSettings {
  fastSearch: boolean;
  fuzzyMatching: boolean;
  dateRangeFilter: boolean;
  recordTypeFilter: boolean;
  parishFilter: boolean;
  highlightMatches: boolean;
  minSearchLength: number;
  resultsPerPage: number;
}

const DEFAULTS: SearchSettings = {
  fastSearch: true,
  fuzzyMatching: true,
  dateRangeFilter: true,
  recordTypeFilter: true,
  parishFilter: false,
  highlightMatches: true,
  minSearchLength: 3,
  resultsPerPage: 25,
};

const SearchConfigurationPage: React.FC = () => {
  const {
    data: serverData,
    loading,
    saving,
    error,
    dirty,
    updateLocal,
    save,
  } = useParishSettingsWithLocal<SearchSettings>('search');

  const settings: SearchSettings = { ...DEFAULTS, ...(serverData ?? {}) };

  const setField = <K extends keyof SearchSettings>(key: K, value: SearchSettings[K]) => {
    updateLocal((prev) => ({ ...DEFAULTS, ...(prev ?? {}), [key]: value }));
  };

  const groups: SettingsFieldGroupDef<keyof SearchSettings>[] = [
    {
      title: 'Search Performance',
      icon: BoltOutlinedIcon,
      items: [
        { type: 'toggle', label: 'Enable Fast Search', description: 'Use indexed search for faster results', key: 'fastSearch' },
        { type: 'toggle', label: 'Fuzzy Matching', description: 'Find results even with typos or misspellings', key: 'fuzzyMatching' },
        { type: 'slider', label: 'Minimum Search Length', key: 'minSearchLength', min: 1, max: 5, step: 1, formatValue: (v) => `${v} characters` },
      ],
    },
    {
      title: 'Available Filters',
      icon: FilterListOutlinedIcon,
      items: [
        { type: 'toggle', label: 'Date Range Filter', key: 'dateRangeFilter' },
        { type: 'toggle', label: 'Record Type Filter', key: 'recordTypeFilter' },
        { type: 'toggle', label: 'Parish Filter', key: 'parishFilter' },
      ],
    },
    {
      title: 'Results Display',
      icon: SearchOutlinedIcon,
      items: [
        { type: 'slider', label: 'Results Per Page', key: 'resultsPerPage', min: 10, max: 100, step: 5, formatValue: (v) => `${v} results` },
        { type: 'toggle', label: 'Highlight Matches', description: 'Show matching text in search results', key: 'highlightMatches' },
      ],
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 880, mx: 'auto' }}>
      <SettingsPageHeader
        title="Search Configuration"
        subtitle="Configure global search behavior and performance settings"
        saving={saving}
        dirty={dirty}
        loading={loading}
        onSave={() => { void save(); }}
      />

      <SettingsErrorAlert error={error} />

      {loading ? (
        <SettingsLoadingSpinner />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {groups.map((group) => (
            <SettingsFieldGroupCard key={group.title} group={group} settings={settings} setField={setField} />
          ))}
        </Box>
      )}
    </Box>
  );
};

export default SearchConfigurationPage;
