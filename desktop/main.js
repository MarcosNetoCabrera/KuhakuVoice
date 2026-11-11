// KuhakuVoice desktop: a locked-down window onto the website, whose only extra power is
// capturing the screen together with the PC's sound (Chrome 157 drops that audio for full screens).
const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const path = require('path');

const SITE = 'https://marcosnetocabrera.github.io/KuhakuVoice/';
const isSite = url => {
  try { const u = new URL(url); return u.origin === new URL(SITE).origin && u.pathname.startsWith('/KuhakuVoice/'); }
  catch { return false; }
};

app.on('web-contents-created', (_, wc) => {
  wc.on('will-navigate', (e, url) => { if (!isSite(url)) e.preventDefault(); });
  wc.on('will-redirect', (e, url) => { if (!isSite(url)) e.preventDefault(); });
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Our own screen/window picker, shown when the site asks to share.
let picker = null;
function pick(parent, sources) {
  return new Promise(resolve => {
    const win = picker = new BrowserWindow({
      parent, modal: true, width: 900, height: 620, title: 'O que compartilhar?', backgroundColor: '#1A1D2B',
      autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), sandbox: true, contextIsolation: true },
    });
    const list = sources.map(s => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumb: s.thumbnail.toDataURL() }));
    const fromPicker = e => e.sender === win.webContents;
    let done = false;
    const finish = id => { if (done) return; done = true; ipcMain.removeHandler('picker-sources'); ipcMain.removeAllListeners('picker-choice'); resolve(id); if (!win.isDestroyed()) win.close(); };
    ipcMain.handle('picker-sources', e => fromPicker(e) ? list : []);
    ipcMain.on('picker-choice', (e, id) => { if (fromPicker(e)) finish(typeof id === 'string' ? id : null); });
    win.on('closed', () => { if (picker === win) picker = null; finish(null); });
    win.once('ready-to-show', () => win.show());
    win.loadFile(path.join(__dirname, 'picker.html'));
  });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  await ses.clearCache(); // always run the latest site, never a stale cached copy

  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(allowed.has(perm) && isSite(wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm) => allowed.has(perm) && !!wc && isSite(wc.getURL()));

  const win = new BrowserWindow({
    width: 1280, height: 800, backgroundColor: '#1A1D2B', autoHideMenuBar: true, title: 'KuhakuVoice',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged },
  });

  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    if (!isSite(req.frame?.url) || picker) return cb({}); // one picker at a time
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    const id = await pick(win, sources);
    const video = sources.find(s => s.id === id);
    if (!video) return cb({}); // cancelled
    // 'loopback' = everything the PC is playing (Firefox, games, …), for screens and windows alike.
    cb(req.audioRequested ? { video, audio: 'loopback' } : { video });
  });

  win.loadURL(SITE);
});

app.on('window-all-closed', () => app.quit());
