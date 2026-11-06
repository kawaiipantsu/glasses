import type { CSSProperties } from 'react';
import type { SettingsValue } from './types';

export type WorkspaceSpacing = Pick<
  SettingsValue,
  'trafficRowHeight' | 'sidebarRowHeight' | 'codeFontSize' | 'codeLineHeight' | 'headerRowPadding'
>;
export const spacingPresets: Record<'comfortable' | 'compact', WorkspaceSpacing> = {
  comfortable: {
    trafficRowHeight: 28,
    sidebarRowHeight: 30,
    codeFontSize: 12,
    codeLineHeight: 17,
    headerRowPadding: 4,
  },
  compact: {
    trafficRowHeight: 24,
    sidebarRowHeight: 26,
    codeFontSize: 11,
    codeLineHeight: 15,
    headerRowPadding: 2,
  },
};
export const codeFonts = {
  system: "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
  jetbrains: "'Glasses JetBrains Mono', monospace",
  nerd: "'JetBrainsMono Nerd Font Mono', 'JetBrainsMono NFM', 'Glasses JetBrains Mono', monospace",
};
export function effectiveSpacing(s: SettingsValue): WorkspaceSpacing {
  return s.density === 'custom' ? s : spacingPresets[s.density];
}
export function workspaceStyle(s: SettingsValue): CSSProperties {
  const v = effectiveSpacing(s);
  return {
    '--line-height': `${v.trafficRowHeight}px`,
    '--sidebar-row-height': `${v.sidebarRowHeight}px`,
    '--code-font': codeFonts[s.codeFont],
    '--code-font-size': `${v.codeFontSize}px`,
    '--code-line-height': `${v.codeLineHeight}px`,
    '--header-row-padding': `${v.headerRowPadding}px`,
  } as CSSProperties;
}
