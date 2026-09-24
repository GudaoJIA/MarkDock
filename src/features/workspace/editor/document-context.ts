'use client';
import { createContext } from 'react';
import type { ProjectSettings } from '../shared/resource-policy';
export const DocumentContext = createContext<{
  workspaceId: string;
  path: string;
  settings?: ProjectSettings;
}>({ workspaceId: '', path: '' });
