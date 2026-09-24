'use client';

import {
  BulletedListRules,
  isOrderedList,
  OrderedListRules,
  TaskListRules,
} from '@platejs/list';
import { ListPlugin } from '@platejs/list/react';
import { KEYS } from 'platejs';

import { IndentKit } from '@/components/plate/plugins/indent-kit';
import { BlockList } from '@/components/ui/block-list';

// Workspace can replace input rules while retaining the shared rendering and behavior.
export function createListKit(
  configure: (plugin: any, config: any) => any = (plugin, config) =>
    plugin.configure(config)
) {
  return [
    ...IndentKit,
    configure(ListPlugin, {
      inputRules: [
        BulletedListRules.markdown({ variant: '-' }),
        BulletedListRules.markdown({ variant: '*' }),
        OrderedListRules.markdown({ variant: '.' }),
        OrderedListRules.markdown({ variant: ')' }),
        TaskListRules.markdown({ checked: false }),
        TaskListRules.markdown({ checked: true }),
      ],
      inject: {
        nodeProps: {
          nodeKey: KEYS.listType,
          query: ({ nodeProps }) => {
            const element = nodeProps.element;

            return !!element?.listStyleType && !isOrderedList(element);
          },
          transformProps: ({ props }) => ({
            ...props,
            role: 'listitem',
            style: {
              ...props.style,
              display: 'list-item',
            },
          }),
        },
        targetPlugins: [
          ...KEYS.heading,
          KEYS.p,
          KEYS.blockquote,
          KEYS.codeBlock,
          KEYS.toggle,
          KEYS.img,
        ],
      },
      render: {
        belowNodes: BlockList,
      },
    }),
  ];
}
