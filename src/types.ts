export type Headers = Record<string, string | string[]>;
export type View =
  | 'traffic'
  | 'intercept'
  | 'repeater'
  | 'timeline'
  | 'tls'
  | 'headers'
  | 'rules'
  | 'plugins'
  | 'community'
  | 'settings'
  | 'extension';
export interface TrafficRecord {
  id: string;
  number: number;
  url: string;
  method: string;
  status: number;
  state: string;
  startedAt: string;
  requestHeaders: Headers;
  responseHeaders: Headers;
  requestBody: string;
  responseBody: string;
  requestBytes: number;
  responseBytes: number;
  duration: number;
  timings: { dns?: number; connect?: number; tls?: number; firstByte?: number; end?: number };
  source: string;
  protocol: string;
  appliedRules: string[];
  error?: string;
  note?: string;
  truncated?: boolean;
  interceptPhase?: 'request' | 'response';
  tls?: { protocol: string; cipher: string; authorized: boolean };
}
export interface SettingsValue {
  theme: 'system' | 'dark' | 'light';
  palette: 'red' | 'violet' | 'ocean' | 'amber';
  density: 'comfortable' | 'compact' | 'custom';
  trafficRowHeight: number;
  sidebarRowHeight: number;
  codeFont: 'system' | 'jetbrains' | 'nerd';
  codeFontSize: number;
  codeLineHeight: number;
  headerRowPadding: number;
  proxyPort: number;
  socksPort: number;
  socksEnabled: boolean;
  maxSessions: number;
  bodyLimitMB: number;
  timeoutSeconds: number;
  interceptTimeoutSeconds: number;
  interceptPhase: 'request' | 'response' | 'both';
  interceptFilter: string;
  bypassList: string;
  relayEnabled: boolean;
  relayHops: {
    id: string;
    type: 'http' | 'https' | 'socks5';
    host: string;
    port: number;
    username: string;
    hasPassword: boolean;
    password?: string;
  }[];
  scope: string;
  exportPath: string;
  autoStart: boolean;
  browserUrl: string;
  communityEnabled: boolean;
}
export interface Status {
  running: boolean;
  intercept: boolean;
  pending: number;
  proxyPort: number;
  socksPort: number;
  socksEnabled: boolean;
  count: number;
}
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  phase: 'request' | 'response';
  match: string;
  action: 'set-header' | 'remove-header';
  header: string;
  value: string;
}
export interface PluginManifest {
  apiVersion: number;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  capabilities: string[];
  rules: Rule[];
  checks: { header: string; when: string; value: string; title: string; advice: string }[];
  tools: { id: string; label: string }[];
  contextMenus: { id: string; label: string; contexts: string[] }[];
  ui?: { html: string; css: string; javascript: string };
}
export interface Plugin {
  manifest: PluginManifest;
  enabled: boolean;
  community?: { keyId: string; sha256: string; installedAt: string };
}
export interface CommunityIntent {
  id: string;
  version: string;
  nonce: string;
}
export interface CommunityEntry {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  kind: 'plugin' | 'extension';
  publisher: { id: string | number; displayName: string };
  capabilities: string[];
  size: number;
  sha256: string;
  publishedAt: string;
  releaseNotes?: string;
}
export interface CommunityCatalog {
  schemaVersion: 1;
  items: CommunityEntry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface CommunityReview {
  ticket: string;
  manifest: PluginManifest;
  sha256: string;
  keyId: string;
  expiresAt: number;
  previousVersion?: string;
  addedCapabilities: string[];
}
export interface Finding {
  header: string;
  level: 'pass' | 'review' | 'warning' | 'info';
  title: string;
  evidence: string;
  advice: string;
  plugin?: string;
}
export interface SystemProxyStatus {
  supported: boolean;
  active: boolean;
  busy: boolean;
  warning: string;
  services: string[];
}
export interface CA {
  source: 'local' | 'custom';
  path: string;
  fingerprint: string;
  subject: string;
  validTo: string;
  pem: string;
}
export interface Bootstrap {
  settings: SettingsValue;
  status: Status;
  records: TrafficRecord[];
  rules: Rule[];
  plugins: Plugin[];
  ca: CA;
  systemProxy: SystemProxyStatus;
  testMode?: boolean;
  dark: boolean;
  platform: string;
  version: string;
  dataPath: string;
  warning?: string;
  installIntent?: CommunityIntent;
  communityProtocolRegistered: boolean;
}
export interface Body {
  text: string;
  base64: string;
  binary: boolean;
  bytes?: number;
  error?: string;
}
export interface RequestDraft {
  url: string;
  method: string;
  headers: Headers;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
}
export interface Job {
  id: string;
  cancelled: boolean;
  completed: number;
  total: number;
  done: boolean;
  results: {
    iteration: number;
    payload: string;
    recordId?: string;
    status?: number;
    bytes?: number;
    duration?: number;
    error?: string;
  }[];
}
export interface MenuAction {
  label: string;
  action?: () => void;
  shortcut?: string;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}
export type Invoke = <T = unknown>(action: string, payload?: unknown) => Promise<T>;
declare global {
  interface Window {
    glasses: {
      invoke: Invoke;
      subscribe: (callback: (event: { type: string; data: any }) => void) => () => void;
    };
  }
}
