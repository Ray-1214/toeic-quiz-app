const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const isDev = require('electron-is-dev');
const Store = require('electron-store');
const { OpenAI } = require('openai');

// Load .env if present (works in dev; in packaged app falls back to hardcoded values)
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (_) {}

const store = new Store({ name: 'toeic-drill-data' });

const LLM_BASE_URL = process.env.REACT_APP_LLM_BASE_URL || 'https://api.ithu.tw/v1';
const LLM_API_KEY  = process.env.REACT_APP_LLM_API_KEY  || 'sk-xQ7ZVt_KVcRUO3lvN9J6Rg';
const LLM_MODEL    = process.env.REACT_APP_LLM_MODEL    || 'gpt-oss-120b';

const client = new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY });

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'default',
    backgroundColor: '#F7F6F3',
  });

  win.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );

  if (isDev) win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC: LLM ─────────────────────────────────────────────────────────────────
// Read settings fresh each call so changes in the Settings page take effect immediately
ipcMain.handle('llm:chat', async (_event, { systemPrompt, userPrompt }) => {
  const s       = store.get('apiSettings') || {};
  const apiBase = s.apiBase || LLM_BASE_URL;
  const apiKey  = s.apiKey  || LLM_API_KEY;
  const model   = s.model   || LLM_MODEL;

  const c = new OpenAI({ baseURL: apiBase, apiKey });
  const res = await c.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: 0.8,
  });
  return res.choices[0].message.content;
});

// ── IPC: Storage ──────────────────────────────────────────────────────────────
ipcMain.handle('store:get',    (_e, key)        => store.get(key, null));
ipcMain.handle('store:set',    (_e, key, value) => { store.set(key, value); });
ipcMain.handle('store:delete', (_e, key)        => { store.delete(key); });
ipcMain.handle('store:keys',   ()               => Object.keys(store.store));

// ── IPC: Save file (Anki export) ──────────────────────────────────────────────
ipcMain.handle('file:save', async (_event, { defaultName, content }) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export Anki Cards',
    defaultPath: defaultName,
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, content, 'utf8');
  return { ok: true, filePath };
});
