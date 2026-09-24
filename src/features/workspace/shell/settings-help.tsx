'use client';

import { InfoIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function SettingsHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const description = useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={label}
          className="ws-icon-button shrink-0 text-stone-500"
          type="button"
        >
          <InfoIcon aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-describedby={description}
        aria-label={label}
        className="ws-popover max-w-[calc(100vw-24px)] text-sm"
        collisionPadding={12}
      >
        <div className="space-y-3 leading-relaxed" id={description}>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
