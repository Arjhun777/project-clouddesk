const fs = require('fs');
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.ROUTER_PORT || 8088;
const HOST = process.env.ROUTER_HOST || '127.0.0.1';
const routesPath = path.join(__dirname, 'routes.json');

const AUTH_USER = process.env.AJ_ROUTER_USER || 'aj';
const AUTH_PASS = process.env.AJ_ROUTER_PASS || 'Aj@123456';

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
  res.json({ ok: true, message: 'Project router is running', routes });
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
