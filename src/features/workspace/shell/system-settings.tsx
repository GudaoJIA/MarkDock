'use client';
import {
  KeyboardIcon,
  LanguagesIcon,
  MonitorIcon,
  MoonIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  SunIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EditableDocument } from '../state/editable-document';
import type { HistoryBudget } from '../state/history-budget';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../ui/dialog';
import { useInterface, useT } from '../ui/interface-provider';
import { HistorySettings } from './history-settings';
import { SettingsHelp } from './settings-help';
import { ShortcutSettings } from './shortcut-settings';
export function SystemSettings({
  onClose,
  history,
  document,
}: {
  onClose: () => void;
  history: HistoryBudget;
  document?: EditableDocument;
}) {
  const preferences = useInterface();
  const t = useT();
  const [tab, setTab] = useState('interface');
  const [recordingShortcut, setRecordingShortcut] = useState<string | null>(
    null
  );
  const [visible, setVisible] = useState(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    []
  );
  const close = () => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    setVisible(false);
    // Only retain the settings shell for its exit animation; applying settings is immediate.
    closeTimer.current = setTimeout(onClose, 140);
  };
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open={visible}
    >
      <DialogContent
        className="flex h-[min(85dvh,760px)] flex-col overflow-hidden p-0 sm:max-w-4xl"
        onEscapeKeyDown={(event) => {
          if (recordingShortcut === null) return;
          // The dialog handles Escape in capture, before the recording button.
          event.preventDefault();
          event.stopPropagation();
          setRecordingShortcut(null);
        }}
      >
        <div className="shrink-0 border-stone-200 border-b px-6 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Settings2Icon className="size-5" />
            {t('设置')}
          </DialogTitle>
          <DialogDescription className="mt-2">
            {t('设置保存在当前浏览器。图片与附件请在工作区设置中配置。')}
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label={t('设置分类')}
            className="ws-settings-nav flex shrink-0 gap-1 overflow-x-auto border-stone-200 border-b p-3 sm:w-44 sm:flex-col sm:border-r sm:border-b-0"
          >
            {[
              { id: 'interface', label: '界面偏好', Icon: LanguagesIcon },
              { id: 'editing', label: '编辑', Icon: SlidersHorizontalIcon },
              { id: 'shortcuts', label: '快捷键', Icon: KeyboardIcon },
            ].map(({ id, label, Icon }) => (
              <button
                aria-controls={`settings-${id}`}
                aria-current={tab === id ? 'page' : undefined}
                className={`ws-button ${tab === id ? 'bg-stone-100' : ''}`}
                key={id}
                onClick={() => {
                  setRecordingShortcut(null);
                  setTab(id);
                }}
                type="button"
              >
                <Icon className="size-4 shrink-0" />
                {t(label)}
              </button>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <div
              className="ws-settings-panel space-y-6"
              hidden={tab !== 'interface'}
              id="settings-interface"
            >
              <h2 className="font-medium">{t('界面偏好')}</h2>
              <p className="text-stone-500 text-xs">
                {t('立即生效，仅保存在当前浏览器，不影响文档或其他设备。')}
              </p>
              <label className="flex items-center justify-between gap-3 text-sm">
                {t('界面语言')}
                <select
                  className="ws-input"
                  onChange={(e) =>
                    preferences.update({
                      locale: e.target.value === 'en' ? 'en' : 'zh-CN',
                    })
                  }
                  value={preferences.locale}
                >
                  <option lang="zh-CN" value="zh-CN">
                    简体中文
                  </option>
                  <option lang="en" value="en">
                    English
                  </option>
                </select>
              </label>
              <fieldset>
                <legend className="mb-3 text-sm">{t('外观')}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'light', label: '浅色', Icon: SunIcon },
                      { value: 'dark', label: '深色', Icon: MoonIcon },
                      { value: 'system', label: '跟随系统', Icon: MonitorIcon },
                    ] as const
                  ).map(({ value, label, Icon }) => (
                    <label
                      className="flex cursor-pointer items-center justify-center gap-2 rounded border border-stone-200 p-3 text-sm has-[:checked]:border-stone-500 has-[:checked]:bg-stone-100 has-[:focus-visible]:outline-2"
                      key={value}
                    >
                      <input
                        checked={preferences.appearance === value}
                        className="sr-only"
                        name="appearance"
                        onChange={() =>
                          preferences.update({ appearance: value })
                        }
                        type="radio"
                      />
                      <Icon className="size-4 shrink-0" />
                      {t(label)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-4 border-stone-200 border-t pt-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <label htmlFor="show-resource-folders">
                      {t('显示资源目录')}
                    </label>
                    <SettingsHelp label={t('资源目录显示说明')}>
                      <p>
                        {t(
                          '在文档区查看资源文件，支持图片预览、文件信息与下载。'
                        )}
                      </p>
                    </SettingsHelp>
                  </span>
                  <input
                    checked={preferences.showResourceDirectories}
                    id="show-resource-folders"
                    onChange={(e) =>
                      preferences.update({
                        showResourceDirectories: e.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                </div>
                {(
                  [
                    ['showWords', '显示字数统计'],
                    ['showReadingTime', '显示阅读时间'],
                    ['showWritingGoal', '显示写作目标'],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    className="flex items-center justify-between gap-3 text-sm"
                    key={key}
                  >
                    {t(label)}
                    <input
                      checked={preferences[key]}
                      onChange={(e) =>
                        preferences.update({ [key]: e.target.checked })
                      }
                      type="checkbox"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div
              className="ws-settings-panel"
              hidden={tab !== 'editing'}
              id="settings-editing"
            >
              <HistorySettings document={document} history={history} />
            </div>
            <div
              className="ws-settings-panel"
              hidden={tab !== 'shortcuts'}
              id="settings-shortcuts"
            >
              <ShortcutSettings
                key={preferences.platform}
                recording={recordingShortcut}
                setRecording={setRecordingShortcut}
              />
            </div>
            {!preferences.persistent && (
              <p className="mt-4 text-amber-700 text-xs" role="status">
                {t('浏览器不允许保存偏好，设置仅在本次页面会话中生效。')}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 justify-end border-stone-200 border-t px-5 py-3">
          <button className="ws-button" onClick={close} type="button">
            {t('关闭')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
