import type { OmAsset, OmAssetScope } from 'src/sections/admin/asset-manager/om-assets-api';

import { useRef, useState } from 'react';
import { usePopover } from 'minimal-shared/hooks';

import Button from '@mui/material/Button';
import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';

import { Iconify } from 'src/components/iconify';
import { CustomPopover } from 'src/components/custom-popover';
import { AssetPickerDialog } from 'src/components/asset-picker-dialog/asset-picker-dialog';

// ----------------------------------------------------------------------

type Props = {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  accept?: string;
  /** Scope the "Choose from church storage" browser defaults to. */
  assetScope?: OmAssetScope;
  onLocalFile: (file: File) => void;
  onAssetPicked: (asset: OmAsset) => void;
  variant?: 'outlined' | 'contained' | 'text';
  color?: 'inherit' | 'primary';
  size?: 'small' | 'medium' | 'large';
};

/**
 * Site-wide "where is this file coming from" control. Every upload surface
 * that only offered a native OS file dialog (local computer only) should use
 * this instead, so users can also pick something already stored in their
 * church's OM storage (Asset Manager) without downloading and re-uploading it.
 */
export function FileSourceButton({
  label,
  loading = false,
  disabled = false,
  accept = 'image/*',
  assetScope = 'church',
  onLocalFile,
  onAssetPicked,
  variant = 'outlined',
  color = 'inherit',
  size = 'medium',
}: Props) {
  const menu = usePopover();
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleLocalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onLocalFile(file);
  };

  return (
    <>
      <Button
        variant={variant}
        color={color}
        size={size}
        loading={loading}
        disabled={disabled}
        startIcon={<Iconify icon="solar:camera-add-bold" />}
        endIcon={<Iconify icon="eva:chevron-down-fill" width={16} />}
        onClick={menu.onOpen}
      >
        {label}
      </Button>

      <CustomPopover open={menu.open} anchorEl={menu.anchorEl} onClose={menu.onClose}>
        <MenuList>
          <MenuItem
            onClick={() => {
              menu.onClose();
              inputRef.current?.click();
            }}
          >
            <Iconify icon={"solar:laptop-bold" as any} />
            Upload from my computer
          </MenuItem>
          <MenuItem
            onClick={() => {
              menu.onClose();
              setPickerOpen(true);
            }}
          >
            <Iconify icon={"solar:cloud-bold" as any} />
            Choose from church storage
          </MenuItem>
        </MenuList>
      </CustomPopover>

      <input ref={inputRef} type="file" accept={accept} hidden onChange={handleLocalChange} />

      <AssetPickerDialog
        open={pickerOpen}
        defaultScope={assetScope}
        onClose={() => setPickerOpen(false)}
        onPick={(asset) => {
          setPickerOpen(false);
          onAssetPicked(asset);
        }}
      />
    </>
  );
}
