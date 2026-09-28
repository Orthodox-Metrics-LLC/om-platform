import 'dayjs/locale/en';
import 'dayjs/locale/el';
import 'dayjs/locale/ru';
import 'dayjs/locale/bg';
import 'dayjs/locale/sr';
import 'dayjs/locale/ro';
import 'dayjs/locale/ka';
import 'dayjs/locale/am';
import 'dayjs/locale/ar-sa';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/ko';
import 'dayjs/locale/ja';

import dayjs from 'dayjs';

import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider as Provider } from '@mui/x-date-pickers/LocalizationProvider';

import { useTranslate } from './use-locales';

// ----------------------------------------------------------------------

type Props = {
  children: React.ReactNode;
};

export function LocalizationProvider({ children }: Props) {
  const { currentLang } = useTranslate();

  dayjs.locale(currentLang.adapterLocale);

  return (
    <Provider dateAdapter={AdapterDayjs} adapterLocale={currentLang.adapterLocale}>
      {children}
    </Provider>
  );
}
