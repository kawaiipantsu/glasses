const http = require('node:http');
async function createDemo() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('server', 'Glasses local lab');
    if (url.pathname === '/lab/inert-html') {
      res.setHeader('content-type', 'text/html');
      res.setHeader('x-lab-payload', '<img src=x onerror=globalThis.__glassesInjected=true>');
      res.end(
        '<script>globalThis.__glassesInjected=true;window.glasses?.invoke("clear")</script><img src=x onerror="globalThis.__glassesInjected=true"><svg onload="globalThis.__glassesInjected=true"></svg><iframe src="file:///etc/passwd"></iframe><a href="javascript:globalThis.__glassesInjected=true">payload</a>',
      );
      return;
    }
    if (url.pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
      res.end(
        '<!doctype html><title>Glasses local lab</title><style>body{font:18px system-ui;background:#15171c;color:#eee;max-width:760px;margin:12vh auto}h1{color:#f35d61}code{color:#84d4b1}button{padding:12px;border-radius:8px;cursor:pointer}</style><h1>Glasses local research lab</h1><p>This page and its API run on your computer. Inspect their traffic in Glasses.</p><button onclick="load()">Make sample requests</button><pre id="result"></pre><script>async function load(){for(const path of ["/api/products","/api/profile","/api/search?q=glasses","/api/slow","/api/missing"]){const r=await fetch(path);document.getElementById("result").textContent+=path+" → "+r.status+"\\n";}await fetch("/api/cart",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({product:"glasses",quantity:1})});}load();</script>',
      );
    } else {
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/api/slow') await new Promise((r) => setTimeout(r, 240));
      if (url.pathname === '/api/missing') res.statusCode = 404;
      if (url.pathname === '/api/cart') res.statusCode = 201;
      if (url.pathname === '/api/profile')
        res.setHeader('set-cookie', 'lab_session=example; Path=/; SameSite=Lax');
      res.end(
        JSON.stringify(
          url.pathname === '/api/products'
            ? {
                products: [{ id: 'prod_001', name: 'Demo product', price: 49, currency: 'DKK' }],
                total: 1,
              }
            : {
                path: url.pathname,
                query: Object.fromEntries(url.searchParams),
                method: req.method,
                received: body || null,
                lab: true,
              },
          null,
          2,
        ),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
module.exports = { createDemo };
