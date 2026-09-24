'use client';

import { CodeBlockRules } from '@platejs/code-block';
import {
  CodeBlockPlugin,
  CodeLinePlugin,
  CodeSyntaxPlugin,
} from '@platejs/code-block/react';
import { all, createLowlight } from 'lowlight';

import {
  CodeBlockElement,
  CodeLineElement,
  CodeSyntaxLeaf,
} from '@/components/ui/code-block-node';

const lowlight = createLowlight(all);

// Workspace can replace input rules while retaining the shared rendering and behavior.
export function createCodeBlockKit(
  configure: (plugin: any, config: any) => any = (plugin, config) =>
    plugin.configure(config)
) {
  return [
    configure(CodeBlockPlugin, {
      inputRules: [CodeBlockRules.markdown({ on: 'match' })],
      node: { component: CodeBlockElement },
      options: { lowlight },
      shortcuts: { toggle: { keys: 'mod+alt+8' } },
    }),
    CodeLinePlugin.withComponent(CodeLineElement),
    CodeSyntaxPlugin.withComponent(CodeSyntaxLeaf),
  ];
}
