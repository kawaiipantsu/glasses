import { useEffect, useRef, useState } from 'react';
import { Puzzle, RotateCcw } from 'lucide-react';
import type { Plugin, RequestDraft, TrafficRecord } from './types';
import { CommunityName, Pill, SectionHead } from './components';
import { api } from './utils';
export interface ExtensionContext {
  command: string;
  view: string;
  selection?: string;
  record?: TrafficRecord;
  toolId?: string;
}
export default function PluginView({
  plugin,
  context,
  sendToRepeater,
  transform,
  notify,
}: {
  plugin: Plugin;
  context: ExtensionContext;
  sendToRepeater: (r: RequestDraft) => void;
  transform: (s: string) => void;
  notify: (s: string) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null),
    [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const push = () => {
    const caps = plugin.manifest.capabilities;
    const sanitized = {
      command: context.command,
      view: context.view,
      toolId: context.toolId,
      ...(caps.includes('selection.read')
        ? { selection: (context.selection || '').slice(0, 1048576) }
        : {}),
      ...(caps.includes('traffic.readSelected') ? { record: context.record } : {}),
    };
    ref.current?.contentWindow?.postMessage({ glassesHost: 1, context: sanitized }, '*');
  };
  useEffect(() => {
    let active = true;
    let messages = 0;
    const reset = setInterval(() => (messages = 0), 1000);
    const listener = (event: MessageEvent) => {
      if (
        event.source !== ref.current?.contentWindow ||
        !event.data ||
        event.data.glassesPlugin !== 1 ||
        ++messages > 20
      )
        return;
      const m = event.data,
        caps = plugin.manifest.capabilities;
      if (m.type === 'ready') {
        setReady(true);
        push();
      } else if (
        m.type === 'text' &&
        caps.includes('text.transform') &&
        typeof m.text === 'string' &&
        m.text.length <= 1048576
      ) {
        transform(m.text);
      } else if (m.type === 'repeater' && caps.includes('repeater.write')) {
        api
          .invoke<RequestDraft>('validateDraft', m.request)
          .then((r) => {
            if (active) sendToRepeater(r);
          })
          .catch((e) => notify(e.message));
      }
    };
    window.addEventListener('message', listener);
    if (ready) push();
    return () => {
      active = false;
      clearInterval(reset);
      window.removeEventListener('message', listener);
    };
  }, [plugin.manifest.id, context, generation, ready]);
  return (
    <div className="tool-page plugin-tool">
      <SectionHead
        eyebrow={
          <>
            EXTENSION · <CommunityName name={plugin.manifest.author} />
          </>
        }
        title={
          plugin.manifest.tools.find((t) => t.id === context.toolId)?.label || plugin.manifest.name
        }
        description={plugin.manifest.description}
      >
        <Pill>Isolated extension</Pill>
        <button
          onClick={() => {
            setReady(false);
            setGeneration(generation + 1);
          }}
        >
          <RotateCcw size={15} />
          Reload tool
        </button>
      </SectionHead>
      <div className="extension-permissions">
        <Puzzle size={15} />
        <span>{plugin.manifest.capabilities.join(' · ')}</span>
      </div>
      <iframe
        key={plugin.manifest.id + generation}
        ref={ref}
        title={`${plugin.manifest.name} extension`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={`glasses-plugin://${plugin.manifest.id}/index.html`}
        className="plugin-frame"
      />
      <div className="inline-note">
        This extension has no direct filesystem or network access. It receives only the selected
        data allowed by its capabilities. Sending to Repeater prepares a draft; it does not transmit
        a request.
      </div>
    </div>
  );
}
