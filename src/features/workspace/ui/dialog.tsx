'use client';

import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import {
  DialogContent as BaseContent,
  DialogClose,
} from '@/components/ui/dialog';
import { useT } from '@/features/workspace/ui/interface-provider';

export {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseContent>) {
  const t = useT();
  return (
    <BaseContent
      {...props}
      className={`ws-popover ${className ?? ''}`}
      showCloseButton={false}
    >
      {children}
      <DialogClose
        aria-label={t('关闭弹窗')}
        className="ws-icon-button absolute top-3 right-3"
      >
        <XIcon />
      </DialogClose>
    </BaseContent>
  );
}
