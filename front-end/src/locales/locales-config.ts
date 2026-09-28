import type { InitOptions } from 'i18next';
import type { Theme, Components } from '@mui/material/styles';

import resourcesToBackend from 'i18next-resources-to-backend';

// MUI Date Pickers Locales
import {
  enUS as enUSDate,
  elGR as elGRDate,
  ruRU as ruRUDate,
  bgBG as bgBGDate,
  roRO as roRODate,
  zhCN as zhCNDate,
  koKR as koKRDate,
  jaJP as jaJPDate,
} from '@mui/x-date-pickers/locales';
// MUI Core Locales
import {
  elGR as elGRCore,
  ruRU as ruRUCore,
  bgBG as bgBGCore,
  srRS as srRSCore,
  roRO as roROCore,
  amET as amETCore,
  arSA as arSACore,
  zhCN as zhCNCore,
  koKR as koKRCore,
  jaJP as jaJPCore,
} from '@mui/material/locale';
// MUI Data Grid Locales
import {
  enUS as enUSDataGrid,
  elGR as elGRDataGrid,
  ruRU as ruRUDataGrid,
  bgBG as bgBGDataGrid,
  roRO as roRODataGrid,
  arSD as arSDDataGrid,
  zhCN as zhCNDataGrid,
  koKR as koKRDataGrid,
  jaJP as jaJPDataGrid,
} from '@mui/x-data-grid/locales';

// ----------------------------------------------------------------------

// Supported languages
/**
 * Languages of the Orthodox world served by OM. English (US) is the only fully
 * translated UI; the others switch flag, number/date formatting and MUI component
 * locales, and fall back to English strings until their `langs/<code>` bundle exists.
 */
export const supportedLngs = [
  'en', 'el', 'ru', 'bg', 'sr', 'ro', 'ka', 'am', 'ar', 'cn', 'ko', 'ja',
] as const;
export type LangCode = (typeof supportedLngs)[number];

// Fallback and default namespace
export const fallbackLng: LangCode = 'en';
export const defaultNS = 'common';

// Storage config
export const storageConfig = {
  cookie: { key: 'i18next', autoDetection: false },
  localStorage: { key: 'i18nextLng', autoDetection: false },
} as const;

// ----------------------------------------------------------------------

/**
 * @countryCode https://flagcdn.com/en/codes.json
 * @adapterLocale https://github.com/iamkun/dayjs/tree/master/src/locale
 * @numberFormat https://simplelocalize.io/data/locales/
 */

export type LangOption = {
  value: LangCode;
  label: string;
  countryCode: string;
  adapterLocale?: string;
  numberFormat: { code: string; currency: string };
  systemValue?: { components: Components<Theme> };
};

export const allLangs: LangOption[] = [
  {
    value: 'en',
    label: 'English',
    countryCode: 'US',
    adapterLocale: 'en',
    numberFormat: { code: 'en-US', currency: 'USD' },
    systemValue: { components: { ...enUSDate.components, ...enUSDataGrid.components } },
  },
  {
    value: 'el',
    label: 'Greek',
    countryCode: 'GR',
    adapterLocale: 'el',
    numberFormat: { code: 'el-GR', currency: 'EUR' },
    systemValue: {
      components: { ...elGRCore.components, ...elGRDate.components, ...elGRDataGrid.components },
    },
  },
  {
    value: 'ru',
    label: 'Russian',
    countryCode: 'RU',
    adapterLocale: 'ru',
    numberFormat: { code: 'ru-RU', currency: 'RUB' },
    systemValue: {
      components: { ...ruRUCore.components, ...ruRUDate.components, ...ruRUDataGrid.components },
    },
  },
  {
    value: 'bg',
    label: 'Bulgarian',
    countryCode: 'BG',
    adapterLocale: 'bg',
    numberFormat: { code: 'bg-BG', currency: 'BGN' },
    systemValue: {
      components: { ...bgBGCore.components, ...bgBGDate.components, ...bgBGDataGrid.components },
    },
  },
  {
    value: 'sr',
    label: 'Serbian',
    countryCode: 'RS',
    adapterLocale: 'sr',
    numberFormat: { code: 'sr-RS', currency: 'RSD' },
    systemValue: { components: { ...srRSCore.components } },
  },
  {
    value: 'ro',
    label: 'Romanian',
    countryCode: 'RO',
    adapterLocale: 'ro',
    numberFormat: { code: 'ro-RO', currency: 'RON' },
    systemValue: {
      components: { ...roROCore.components, ...roRODate.components, ...roRODataGrid.components },
    },
  },
  {
    value: 'ka',
    label: 'Georgian',
    countryCode: 'GE',
    adapterLocale: 'ka',
    numberFormat: { code: 'ka-GE', currency: 'GEL' },
  },
  {
    value: 'am',
    label: 'Amharic',
    countryCode: 'ET',
    adapterLocale: 'am',
    numberFormat: { code: 'am-ET', currency: 'ETB' },
    systemValue: { components: { ...amETCore.components } },
  },
  {
    value: 'ar',
    label: 'Arabic',
    countryCode: 'SA',
    adapterLocale: 'ar-sa',
    numberFormat: { code: 'ar-SA', currency: 'SAR' },
    systemValue: { components: { ...arSACore.components, ...arSDDataGrid.components } },
  },
  {
    value: 'cn',
    label: 'Chinese',
    countryCode: 'CN',
    adapterLocale: 'zh-cn',
    numberFormat: { code: 'zh-CN', currency: 'CNY' },
    systemValue: {
      components: { ...zhCNCore.components, ...zhCNDate.components, ...zhCNDataGrid.components },
    },
  },
  {
    value: 'ko',
    label: 'Korean',
    countryCode: 'KR',
    adapterLocale: 'ko',
    numberFormat: { code: 'ko-KR', currency: 'KRW' },
    systemValue: {
      components: { ...koKRCore.components, ...koKRDate.components, ...koKRDataGrid.components },
    },
  },
  {
    value: 'ja',
    label: 'Japanese',
    countryCode: 'JP',
    adapterLocale: 'ja',
    numberFormat: { code: 'ja-JP', currency: 'JPY' },
    systemValue: {
      components: { ...jaJPCore.components, ...jaJPDate.components, ...jaJPDataGrid.components },
    },
  },
];

// ----------------------------------------------------------------------

/**
 * Languages without a `langs/<code>` bundle yet resolve to the English bundle so
 * switching never leaves untranslated keys or a failed import behind.
 */
export const i18nResourceLoader = resourcesToBackend((lang: LangCode, namespace: string) =>
  import(`./langs/${lang}/${namespace}.json`).catch(() => import(`./langs/en/${namespace}.json`))
);

export function i18nOptions(lang = fallbackLng, namespace = defaultNS): InitOptions {
  return {
    // debug: true,
    supportedLngs,
    fallbackLng,
    lng: lang,
    /********/
    fallbackNS: defaultNS,
    defaultNS,
    ns: namespace,
  };
}

export function getCurrentLang(lang?: string): LangOption {
  const fallbackLang = allLangs.find((l) => l.value === fallbackLng) ?? allLangs[0];

  if (!lang) {
    return fallbackLang;
  }

  return allLangs.find((l) => l.value === lang) ?? fallbackLang;
}
