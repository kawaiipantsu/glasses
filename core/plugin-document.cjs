const PLUGIN_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
function pluginDocument(manifest) {
  const ui = manifest.ui;
  if (!ui) throw new Error('Plugin has no UI');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:14px system-ui;background:#17191f;color:#e9ebef;margin:0;padding:28px}h1,h2{letter-spacing:-.03em}p{color:#a5aab8;line-height:1.7}button,input,textarea,select{font:inherit;color:inherit;background:#22252e;border:1px solid #3b3f4b;border-radius:7px;padding:10px}button{cursor:pointer}textarea{display:block;box-sizing:border-box;width:100%;min-height:140px;font-family:monospace}pre{white-space:pre-wrap;word-break:break-word;background:#101216;padding:18px;border-radius:8px}label{display:block;margin:18px 0 8px}${ui.css}</style></head><body>${ui.html}<script>
  for (const name of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel']) { try { Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false}); } catch {} }
  const callbacks=[]; window.glassesPlugin=Object.freeze({
    onContext(fn){callbacks.push(fn);},
    sendToRepeater(request){parent.postMessage({glassesPlugin:1,type:'repeater',request},'*');},
    showText(text){parent.postMessage({glassesPlugin:1,type:'text',text},'*');}
  });
  addEventListener('message',e=>{if(e.source===parent&&e.data?.glassesHost===1){window.glassesContext=e.data.context;for(const fn of callbacks)fn(e.data.context);}});
  parent.postMessage({glassesPlugin:1,type:'ready'},'*');
  </script><script>${ui.javascript}</script></body></html>`;
}
module.exports = { PLUGIN_CSP, pluginDocument };
