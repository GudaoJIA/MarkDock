'use client';

import {
  BlockquoteRules,
  HeadingRules,
  HorizontalRuleRules,
} from '@platejs/basic-nodes';
import {
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
} from '@platejs/basic-nodes/react';
import { ParagraphPlugin } from 'platejs/react';

import { BlockquoteElement } from '@/components/ui/blockquote-node';
import {
  H1Element,
  H2Element,
  H3Element,
  H4Element,
  H5Element,
  H6Element,
} from '@/components/ui/heading-node';
import { HrElement } from '@/components/ui/hr-node';
import { ParagraphElement } from '@/components/ui/paragraph-node';

// Workspace can replace input rules while retaining the shared rendering and behavior.
export function createBasicBlocksKit(
  configure: (plugin: any, config: any) => any = (plugin, config) =>
    plugin.configure(config)
) {
  return [
    ParagraphPlugin.withComponent(ParagraphElement),
    configure(H1Plugin, {
      inputRules: [HeadingRules.markdown()],
      node: {
        component: H1Element,
      },
      rules: {
        break: { empty: 'reset' },
      },
      shortcuts: { toggle: { keys: 'mod+alt+1' } },
    }),
    configure(H2Plugin, {
      inputRules: [HeadingRules.markdown()],
      node: {
        component: H2Element,
      },
      rules: {
        break: { empty: 'reset' },
      },
      shortcuts: { toggle: { keys: 'mod+alt+2' } },
    }),
    configure(H3Plugin, {
      inputRules: [HeadingRules.markdown()],
      node: {
        component: H3Element,
      },
      rules: {
        break: { empty: 'reset' },
      },
      shortcuts: { toggle: { keys: 'mod+alt+3' } },
    }),
    configure(H4Plugin, {
      inputRules: [HeadingRules.markdown()],
      node: {
        component: H4Element,
      },
      rules: {
        break: { empty: 'reset' },
      },
      shortcuts: { toggle: { keys: 'mod+alt+4' } },
    }),
    configure(H5Plugin, {
      inputRules: [HeadingRules.markdown()],
      node: {
        component: H5Element,
      },
      rules: {
        break: { empty: 'reset' },
      },
      shortcuts: { toggle: { keys: 'mod+alt+5' } },
    }),
    configure(H6Plugin, {
      inputRules: [HeadingRules.markdown()],
      node: {
        component: H6Element,
      },
      rules: {
        break: { empty: 'reset' },
      },
      shortcuts: { toggle: { keys: 'mod+alt+6' } },
    }),
    configure(BlockquotePlugin, {
      inputRules: [BlockquoteRules.markdown()],
      node: { component: BlockquoteElement },
      shortcuts: { toggle: { keys: 'mod+shift+period' } },
    }),
    configure(HorizontalRulePlugin, {
      inputRules: [
        HorizontalRuleRules.markdown({ variant: '-' }),
        HorizontalRuleRules.markdown({ variant: '_' }),
      ],
      node: {
        component: HrElement,
      },
    }),
  ];
}
