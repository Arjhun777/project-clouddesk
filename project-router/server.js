const fs = require('fs');
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.ROUTER_PORT || 8088;
const HOST = process.env.ROUTER_HOST || '127.0.0.1';
const routesPath = path.join(__dirname, 'routes.json');

const AUTH_USER = process.env.AJ_ROUTER_USER;
const AUTH_PASS = process.env.AJ_ROUTER_PASS;

if (!AUTH_USER || !AUTH_PASS) {
  throw new Error('Missing AJ_ROUTER_USER or AJ_ROUTER_PASS in environment');
}

function loadRoutes() {
  const raw = fs.readFileSync(routesPath, 'utf8');
  return JSON.parse(raw);
}

const routes = loadRoutes();

app.use((req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AJ Secure Router"');
    return res.status(401).send('Authentication required');
  }
  try {
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const [u, p] = decoded.split(':');
    if (u === AUTH_USER && p === AUTH_PASS) return next();
  } catch {}
  res.setHeader('WWW-Authenticate', 'Basic realm="AJ Secure Router"');
  return res.status(401).send('Invalid credentials');
});

app.get('/', (_req, res) => {
  const cards = Object.keys(routes)
    .map((prefix) => {
      const name = prefix.replace(/^\//, '') || 'root';
      const pretty = name.charAt(0).toUpperCase() + name.slice(1);
      const desc = name === 'chat'
        ? 'Realtime chat + video call + screen share'
        : name === 'drive'
          ? 'External-drive browser + secure uploads'
          : 'Project route';
      return `
        <a class="card" href="${prefix}/">
          <div class="title">${pretty}</div>
          <div class="path">${prefix}/</div>
          <div class="desc">${desc}</div>
        </a>
      `;
    })
    .join('\n');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AJ Router Home</title>
  <style>
    :root { --bg:#0b1220; --panel:#111827; --line:#243244; --text:#e5e7eb; --muted:#93a4b8; --accent:#38bdf8; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter,system-ui,Arial,sans-serif; background:radial-gradient(circle at top,#111827,#020617 65%); color:var(--text); }
    .wrap { max-width:960px; margin:32px auto; padding:0 14px; }
    .head { margin-bottom:16px; }
    h1 { margin:0 0 6px; font-size:28px; }
    .sub { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; margin-top:14px; }
    .card { display:block; text-decoration:none; color:inherit; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; transition:.18s ease; }
    .card:hover { transform:translateY(-2px); border-color:#3f5f86; }
    .title { font-size:18px; font-weight:700; margin-bottom:4px; }
    .path { color:var(--accent); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; margin-bottom:8px; }
    .desc { color:var(--muted); font-size:14px; }
    .foot { margin-top:16px; color:var(--muted); font-size:12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <h1>AJ Project Router</h1>
      <div class="sub">Choose a project to open</div>
    </div>
    <div class="grid">${cards}</div>
    <div class="foot">Authenticated session active.</div>
  </div>
</body>
</html>`);
});

for (const [prefix, target] of Object.entries(routes)) {
  app.use(prefix, (req, res, next) => {
    if (req.originalUrl === prefix) return res.redirect(302, `${prefix}/`);
    return next();
  });

  app.use(
    prefix,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      pathRewrite: (pathReq) => pathReq.replace(new RegExp(`^${prefix}`), '') || '/',
      logLevel: 'warn'
    })
  );
}

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'No route configured for this path',
    path: req.path,
    availableRoutes: Object.keys(routes)
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Project router listening at http://${HOST}:${PORT}`);
});
