import type { ReactNode } from 'react';
import type { NavItemProps, NavSectionProps } from 'src/components/nav-section';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';

import { NAV_ICONS } from './nav-config-dashboard';

// ----------------------------------------------------------------------

/**
 * Stored menu templates carry serializable values only — icon is a string
 * (a NAV_ICONS key like 'dashboard', or an Iconify name like 'solar:...'),
 * `info` is { label, color, icon }. This rebuilds the real navData array.
 */

type StoredInfo = { label?: string; color?: string; icon?: string } | null;
type StoredItem = {
  title: string;
  path: string;
  icon?: string | null;
  caption?: string | null;
  info?: StoredInfo;
  deepMatch?: boolean;
  disabled?: boolean;
  external?: boolean;
  children?: StoredItem[] | null;
};

function navIcon(icon?: string | null) {
  if (!icon) return undefined;
  const known = (NAV_ICONS as Record<string, ReactNode>)[icon];
  if (known) return known;
  return <Iconify icon={icon as any} />;
}

function navInfo(info?: StoredInfo) {
  if (!info?.label && !info?.icon) return undefined;
  return (
    <Label
      color={(info.color as any) || 'info'}
      variant="inverted"
      startIcon={info.icon ? <Iconify icon={info.icon as any} /> : undefined}
    >
      {info.label}
    </Label>
  );
}

function mapItem(item: StoredItem): NavItemProps {
  return {
    title: item.title,
    path: item.path,
    icon: navIcon(item.icon),
    info: navInfo(item.info),
    caption: item.caption || undefined,
    deepMatch: item.deepMatch,
    disabled: item.disabled,
    children: item.children?.map(mapItem) as any,
  };
}

export function navFromTemplate(nav: StoredItem[] | { subheader: string; items: StoredItem[] }[] | null | undefined): NavSectionProps['data'] | null {
  if (!Array.isArray(nav) || !nav.length) return null;
  return nav.map((section: any) => ({
    subheader: section.subheader,
    items: (section.items || []).map(mapItem),
  }));
}
