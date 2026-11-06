(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const input = $('input'), output = $('output'), status = $('status');
  const preview = $('preview'), replay = $('replay');
  const encoder = new TextEncoder();
  const INPUT_LIMIT = 256 * 1024;
  const RESULT_LIMIT = 512 * 1024;
  let context = {}, result = '', lastContextKey = '';

  function clearResult(message) {
    result = '';
    output.textContent = '';
    preview.disabled = true;
    status.textContent = message;
  }

  function receive(next) {
    const key = JSON.stringify([
      next.command, next.view, next.toolId,
      next.record?.id, next.selection || '',
    ]);
    context = next;
    replay.disabled = !next.record || !/^https?:\/\//.test(next.record.url || '');
    $('source').textContent = next.record
      ? `${next.record.method} ${next.record.url}`
      : 'No selected request.';
    if (key === lastContextKey) return;
    lastContextKey = key;
    input.value = next.selection || '';
    clearResult(input.value ? 'Selection loaded. Choose Format JSON.' : 'Ready for JSON.');
  }

  glassesPlugin.onContext(receive);
  if (window.glassesContext) receive(window.glassesContext);
  input.addEventListener('input', () => clearResult('Input changed. Format again.'));

  $('format').addEventListener('click', () => {
    clearResult('Formatting...');
    try {
      if (input.value.length > INPUT_LIMIT ||
          encoder.encode(input.value).length > INPUT_LIMIT) {
        throw new Error('Input exceeds the 256 KiB UTF-8 limit. Select less text.');
      }
      const value = JSON.parse(input.value);
      const formatted = JSON.stringify(value, null, 2);
      if (formatted.length > RESULT_LIMIT) {
        throw new Error('Formatted result exceeds the local size limit.');
      }
      result = formatted;
      output.textContent = result;
      preview.disabled = false;
      status.textContent = 'Formatted locally. Captured traffic is unchanged.';
    } catch (error) {
      // Do not echo parser messages: they can include sensitive input fragments.
      status.textContent = error.message.startsWith('Input exceeds') ||
        error.message.startsWith('Formatted result exceeds')
        ? error.message : 'Invalid JSON. Check quotes, commas and bracket pairs.';
    }
  });

  preview.addEventListener('click', () => {
    if (!preview.disabled && result) glassesPlugin.showText(result);
  });

  replay.addEventListener('click', () => {
    const r = context.record;
    if (!r || replay.disabled) return;
    const headers = Object.create(null);
    const omit = new Set([
      'host', 'content-length', 'connection', 'proxy-connection',
      'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer',
      'proxy-authorization', 'proxy-authenticate',
    ]);
    const connection = Object.entries(r.requestHeaders || {})
      .find(([key]) => key.toLowerCase() === 'connection')?.[1];
    String(connection || '').toLowerCase().split(',')
      .forEach((name) => omit.add(name.trim()));
    for (const [name, value] of Object.entries(r.requestHeaders || {})) {
      if (!omit.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
    }
    glassesPlugin.sendToRepeater({
      url: r.url, method: r.method, headers,
      body: r.requestBody || '', bodyEncoding: 'base64',
    });
    status.textContent = 'Draft requested. Review destination and credentials in Repeater.';
  });

  $('clear').addEventListener('click', () => {
    input.value = '';
    clearResult('Input and result cleared. Source request is still selected.');
    input.focus();
  });
})();
