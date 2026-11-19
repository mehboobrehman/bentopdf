const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function createStaticServer(root) {
  const resolvedRoot = path.resolve(root);

  return http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }

    const filePath = path.resolve(resolvedRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, {
        'Content-Length': fileStat.size,
        'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });

      if (request.method === 'HEAD') {
        response.end();
        return;
      }

      const stream = createReadStream(filePath);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        response.writeHead(404).end();
        return;
      }
      console.error('Unable to serve BentoPDF content:', error);
      response.writeHead(500).end();
    }
  });
}

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      shell.openExternal(url.href).catch((error) => {
        console.error('Unable to open external link:', error);
      });
    }
  } catch {
    // Ignore malformed navigation targets.
  }
}

async function startApp() {
  const server = createStaticServer(path.join(__dirname, '..', 'dist'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const appUrl = `http://127.0.0.1:${address.port}`;
  const appOrigin = new URL(appUrl).origin;
  app.on('before-quit', () => server.close());

  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'BentoPDF',
    backgroundColor: '#111827',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  await window.loadURL(appUrl);
}

app.whenReady().then(async () => {
  app.setAppUserModelId('org.bentopdf.desktop');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]));

  try {
    await startApp();
  } catch (error) {
    console.error('Unable to start BentoPDF:', error);
    dialog.showErrorBox('BentoPDF could not start', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
