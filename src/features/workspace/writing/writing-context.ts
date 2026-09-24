'use client';
import { createContext } from 'react';
import type { WritingModel } from '@/features/workspace/writing/writing';
export const WritingContext = createContext<{
  model: WritingModel | null;
  locked: boolean;
  flash?: string;
  preview: (source: string, alt: string) => void;
}>({ model: null, locked: false, preview: () => {} });
