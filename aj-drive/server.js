const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3010;
const HOST = process.env.HOST || '127.0.0.1';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAX_FILES = 20;
const MAX_FILE_SIZE = 1024 * 1024 * 1024 * 2; // 2GB per file
const allowedMimePrefixes = ['image/', 'video/'];

function safeMkdir(p) {
  fs.mkdirSync(p, { recursive: true, mode: 0o750 });
}

function getStorageOptions() {
  let parsed = null;
  try {
    parsed = JSON.parse(execSync('lsblk -J -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS,TRAN,RM,MODEL', { encoding: 'utf8' }));
  } catch {
    return [];
  }

  const out = [];
  function walk(node, parentMeta = {}) {
    const meta = {
      tran: node.tran || parentMeta.tran || '',
      rm: typeof node.rm === 'boolean' ? node.rm : (parentMeta.rm || false),
      model: node.model || parentMeta.model || ''
    };

    if (node.type === 'part' || node.type === 'disk') {
      const mps = (node.mountpoints || []).filter(Boolean);
      const looksExternal = meta.tran === 'usb' || meta.rm === true;

      for (const mp of mps) {
        if (!fs.existsSync(mp)) continue;
        if (mp.startsWith('/snap')) continue;
        if (!looksExternal) continue;
        out.push({
          id: mp,
          label: `${mp} (${node.size || 'unknown'}${node.fstype ? `, ${node.fstype}` : ''}${meta.model ? `, ${meta.model.trim()}` : ''}${meta.tran ? `, ${meta.tran}` : ''})`
        });
      }
    }

    for (const c of node.children || []) walk(c, meta);
  }

  for (const b of parsed.blockdevices || []) walk(b);
  return Array.from(new Map(out.map(x => [x.id, x])).values());
}

function resolveSafePath(storageBase, rel = '') {
  const allowed = getStorageOptions().map(s => s.id);
  if (!allowed.includes(storageBase)) throw new Error('Invalid storage selection');

  const decoded = decodeURIComponent(String(rel || '').replace(/\\/g, '/'));
  const candidate = path.resolve(storageBase, `.${decoded.startsWith('/') ? decoded : '/' + decoded}`);
  const baseResolved = path.resolve(storageBase);
  if (!(candidate === baseResolved || candidate.startsWith(baseResolved + path.sep))) {
    throw new Error('Path traversal blocked');
  }
  return candidate;
}

app.get('/api/storages', (_req, res) => {
  return res.json({ ok: true, storages: getStorageOptions() });
});

app.get('/api/list', (req, res) => {
  try {
    const storage = String(req.query.storage || '').trim();
    const rel = String(req.query.path || '').trim();
    const abs = resolveSafePath(storage, rel);
    const st = fs.statSync(abs);
    if (!st.isDirectory()) throw new Error('Not a directory');

    const items = fs.readdirSync(abs, { withFileTypes: true }).map(d => {
      const full = path.join(abs, d.name);
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      return { name: d.name, type: d.isDirectory() ? 'dir' : 'file', size };
    }).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

    return res.json({ ok: true, storage, path: rel || '/', items });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/file', (req, res) => {
  try {
    const storage = String(req.query.storage || '').trim();
    const rel = String(req.query.path || '').trim();
    const abs = resolveSafePath(storage, rel);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error('Not a file');
    return res.sendFile(abs);
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const storageBase = String(req.body.storage || '').trim();
        const uploadBase = resolveSafePath(storageBase, '/aj-drive-uploads');
        const sessionDir = path.join(uploadBase, new Date().toISOString().slice(0, 10));
        safeMkdir(sessionDir);
        return cb(null, sessionDir);
      } catch (e) {
        return cb(e);
      }
    },
    filename: (_req, file, cb) => {
      const original = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${original}`;
      cb(null, name);
    }
  }),
  limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ok = allowedMimePrefixes.some(prefix => (file.mimetype || '').startsWith(prefix));
    if (!ok) return cb(new Error('Only image/video files are allowed'));
    cb(null, true);
  }
});

app.post('/api/upload', upload.array('files', MAX_FILES), (req, res) => {
  const files = (req.files || []).map(f => ({ name: f.originalname, storedAs: f.filename, size: f.size, path: f.path }));
  res.json({ ok: true, uploaded: files.length, files });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ ok: false, error: err.message || 'Request failed' });
});

app.listen(PORT, HOST, () => {
  console.log(`AJ Drive running at http://${HOST}:${PORT}`);
});
