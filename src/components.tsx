import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, X, ChevronDown, Glasses, Search } from 'lucide-react';
import type { MenuAction } from './types';
import { api, copy, transform, transformations } from './utils';
import glassesMark from '../build/glasses-mark.svg';
export function CommunityName({ name = 'THUGSred' }: { name?: string }) {
  return name === 'THUGSred' ? (
    <span className="community-name">
      THUGS<span>red</span>
    </span>
  ) : (
    <>{name}</>
  );
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <div className="brand-mark" aria-hidden="true">
        <img src={glassesMark} width="58" height="28" alt="" />
      </div>
      <div>
        {!compact && <strong>Glasses</strong>}
        <div className="wordmark">
          THUGS<span>red</span>
        </div>
      </div>
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Glasses size={34} />}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Pill({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
export function Method({ value }: { value: string }) {
  return <span className={`method method-${value.toLowerCase()}`}>{value}</span>;
}
export function StatusCode({ value }: { value: number }) {
  return (
    <span
      className={`status-code ${value >= 400 ? 'bad' : value >= 300 ? 'warn' : value ? 'good' : ''}`}
    >
      {value || '—'}
    </span>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search">
      <Search size={16} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item}
          role="tab"
          aria-selected={value === item}
          className={value === item ? 'active' : ''}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
export function Code({
  text,
  onContextMenu,
}: {
  text: string;
  onContextMenu?: React.MouseEventHandler;
}) {
  const lines = text.slice(0, 200000).split('\n');
  const limited = text.length > 200000 || lines.length > 2000;
  return (
    <>
      {limited && (
        <div className="inline-note">
          Text preview limited to 200,000 characters / 2,000 lines. Save the original body to
          inspect all captured bytes.
        </div>
      )}
      <pre className="code" tabIndex={0} onContextMenu={onContextMenu}>
        {lines.slice(0, 2000).map((line, i) => (
          <div className="code-line" key={i}>
            <span className="line-number" aria-hidden="true">
              {i + 1}
            </span>
            <span>
              {(line.length > 4096 || text.length > 64000
                ? [line]
                : line.split(
                    /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b)/g,
                  )
              ).map((part, j) => (
                <span
                  key={j}
                  className={
                    /^".*:\s*$/.test(part)
                      ? 'syntax-key'
                      : /^"/.test(part)
                        ? 'syntax-string'
                        : /^(?:\d|true|false|null)/.test(part)
                          ? 'syntax-number'
                          : ''
                  }
                >
                  {part}
                </span>
              )) || ' '}
            </span>
          </div>
        ))}
      </pre>
    </>
  );
}
export function ContextMenu({
  x,
  y,
  title,
  items,
  close,
}: {
  x: number;
  y: number;
  title: string;
  items: MenuAction[];
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (e: MouseEvent) => {
      if (!el?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, []);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={title}
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 278)),
        top: Math.max(8, Math.min(y, window.innerHeight - (items.length * 35 + 48))),
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const buttons = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[
            (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          ]?.focus();
        }
      }}
    >
      <div className="menu-title">{title}</div>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={item.danger ? 'danger-text' : ''}
            onClick={() => {
              close();
              item.action?.();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <small>{item.shortcut}</small>}
          </button>
        ),
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button,input,textarea,select')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const nodes = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,textarea,select,[tabindex="0"]',
          ),
        ];
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-title">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={close}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export function TransformModal({
  input,
  replace,
  close,
  notify,
}: {
  input: string;
  replace?: (text: string) => void;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [source, setSource] = useState(input),
    [operation, setOperation] = useState<string>('URL decode');
  let result = '',
    error = '';
  try {
    result = transform(source, operation);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <Modal title="Transform selection" close={close} wide>
      <div className="modal-content">
        <div className="transform-toolbar">
          <label>
            Operation{' '}
            <select value={operation} onChange={(e) => setOperation(e.target.value)}>
              {transformations.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <span className="muted">UTF-8 · original preserved</span>
        </div>
        <div className="transform-grid">
          <label>
            Input
            <textarea
              spellCheck={false}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <ArrowRight size={20} />
          <label>
            Preview
            <textarea readOnly value={error || result} className={error ? 'error-text' : ''} />
          </label>
        </div>
        <div className="modal-actions">
          <button
            disabled={!!error}
            onClick={() => copy(result).then(() => notify('Copied transformed text'))}
          >
            <Copy size={15} />
            Copy result
          </button>
          <button
            disabled={!!error}
            onClick={() =>
              api
                .invoke('saveText', { name: 'transformed.txt', text: result })
                .catch((e) => notify(e.message))
            }
          >
            Save result
          </button>
          {replace && (
            <button
              className="primary"
              disabled={!!error}
              onClick={() => {
                replace(result);
                close();
              }}
            >
              <Check size={15} />
              Replace selection
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function SectionHead({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="toolbar-actions">{children}</div>
    </div>
  );
}
