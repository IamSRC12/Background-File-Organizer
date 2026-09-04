const { app, BrowserWindow, Menu, Tray, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const chokidar = require('chokidar');
const settingsManager = require('./settings');

let mainWindow = null;
let tray = null;
let watchers = []; // Array of chokidar watchers (one per watched folder)
let watcherActive = true;
let isQuitting = false;

// Command line arguments parsing
const runHidden = process.argv.includes('--hidden');

// Initialize settings
settingsManager.init(app);

function createSettingsWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 860,
    minHeight: 640,
    title: 'Sortify – Background File Organizer',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: false,
    frame: true
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => {
    if (!runHidden) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      const settings = settingsManager.getSettings();
      if (!settings.hasShownTrayNotification) {
        showNotification('Running in Background', 'Sortify is still active in the system tray.');
        settings.hasShownTrayNotification = true;
        settingsManager.saveSettings(settings);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const finalIconPath = fs.existsSync(iconPath) ? iconPath : path.join(__dirname, 'package.json');

  tray = new Tray(finalIconPath);
  tray.setToolTip('Sortify – Background File Organizer');
  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createSettingsWindow();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Sortify – File Organizer', enabled: false },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createSettingsWindow();
        }
      }
    },
    {
      label: watcherActive ? 'Pause Organizer' : 'Resume Organizer',
      click: () => toggleWatcher()
    },
    { type: 'separator' },
    {
      label: 'Organize Existing Files Now',
      click: () => organizeExistingFiles()
    },
    { type: 'separator' },
    {
      label: 'Run on Startup',
      type: 'checkbox',
      checked: settingsManager.getSettings().startupLaunch,
      click: (menuItem) => toggleStartup(menuItem.checked)
    },
    { type: 'separator' },
    {
      label: 'Exit App',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function toggleStartup(shouldStart) {
  const settings = settingsManager.getSettings();
  settings.startupLaunch = shouldStart;
  settingsManager.saveSettings(settings);

  app.setLoginItemSettings({
    openAtLogin: shouldStart,
    path: process.execPath,
    args: ['--hidden']
  });

  settingsManager.logActivity('info', `Startup launch ${shouldStart ? 'enabled' : 'disabled'}.`);
  updateTrayMenu();

  if (mainWindow) {
    mainWindow.webContents.send('settings-updated', settings);
  }
}

// ─── Drive & System Safety Guard ─────────────────────────────────────────────
function isDriveOrSystemRoot(folderPath) {
  if (!folderPath) return true;
  const resolved = path.resolve(folderPath).toLowerCase().replace(/\//g, '\\');
  // Match drive roots like "c:\", "a:\", "d:\"
  if (/^[a-z]:\\?$/.test(resolved)) return true;
  // Match critical system directories
  const sysDirs = ['c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\users'];
  if (sysDirs.includes(resolved)) return true;
  return false;
}

// ─── Watcher Management (multi-folder) ──────────────────────────────────────
function stopAllWatchers() {
  for (const w of watchers) {
    try { w.close(); } catch (e) { /* ignore */ }
  }
  watchers = [];
}

function startWatcher() {
  stopAllWatchers();

  const settings = settingsManager.getSettings();
  const watchFolders = settings.watchFolders || [];

  if (watchFolders.length === 0) {
    settingsManager.logActivity('info', 'No folders configured to watch.');
    return;
  }

  const stability = (settings.stabilityDelay || 2) * 1000;

  for (const watchPath of watchFolders) {
    // Block drive roots & system paths
    if (isDriveOrSystemRoot(watchPath)) {
      settingsManager.logActivity('error', `Blocked: Cannot watch system or drive root "${watchPath}".`);
      continue;
    }

    if (!fs.existsSync(watchPath)) {
      settingsManager.logActivity('error', `Folder not found: "${watchPath}"`);
      continue;
    }

    settingsManager.logActivity('info', `Monitoring: "${watchPath}"`);

    const w = chokidar.watch(watchPath, {
      depth: 0,
      ignoreInitial: true,
      usePolling: true,
      interval: 200,
      awaitWriteFinish: {
        stabilityThreshold: stability,
        pollInterval: 100
      }
    });

    w.on('add', (filePath) => {
      if (watcherActive) {
        // Small delay to ensure any file handle is unlocked
        setTimeout(() => {
          processFile(filePath, watchPath);
        }, 300);
      }
    });

    w.on('error', (error) => {
      settingsManager.logActivity('error', `Watcher error on "${watchPath}": ${error.message}`);
    });

    watchers.push(w);
  }
}

function stopWatcher() {
  stopAllWatchers();
  settingsManager.logActivity('info', 'All file watchers stopped.');
}

function toggleWatcher() {
  watcherActive = !watcherActive;
  updateTrayMenu();

  if (watcherActive) {
    startWatcher();
    settingsManager.logActivity('info', 'File organizer resumed.');
  } else {
    stopWatcher();
    settingsManager.logActivity('info', 'File organizer paused.');
  }

  if (mainWindow) {
    mainWindow.webContents.send('watcher-status-changed', watcherActive);
  }
}

// ─── Category / Extension Detection ─────────────────────────────────────────
function getCategoryForFile(filename, settings) {
  const ext = path.extname(filename).toLowerCase();
  const cats = settings.categories || {};

  for (const [category, extensions] of Object.entries(cats)) {
    if (category === 'Misc') continue;
    if (Array.isArray(extensions) && extensions.includes(ext)) {
      return category;
    }
  }

  return 'Misc';
}

// ─── Date Formatting Helper ──────────────────────────────────────────────────
function formatFolderDate(dateObj, formatType) {
  const date = dateObj instanceof Date && !isNaN(dateObj) ? dateObj : new Date();
  const day = String(date.getDate()).padStart(2, '0');
  const dayNum = date.getDate();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const monthName = monthNames[date.getMonth()];
  const shortMonthName = shortMonthNames[date.getMonth()];
  const year = date.getFullYear();

  let formattedDate = `${dayNum} ${monthName} ${year}`; // default

  switch (formatType) {
    case 'YYYY-MM-DD':
      formattedDate = `${year}-${month}-${day}`;
      break;
    case 'DD-MM-YYYY':
      formattedDate = `${day}-${month}-${year}`;
      break;
    case 'YYYY/MM':
      formattedDate = path.join(String(year), month);
      break;
    case 'Month YYYY':
      formattedDate = `${monthName} ${year}`;
      break;
    case 'DD MMMM YYYY':
    default:
      formattedDate = `${dayNum} ${monthName} ${year}`;
      break;
  }

  return {
    formattedDate,
    year,
    month,
    monthName,
    shortMonthName,
    day: dayNum
  };
}

// ─── Wildcard Matching Helper ────────────────────────────────────────────────
function matchWildcard(str, pattern) {
  if (!pattern) return false;
  const regexPattern = '^' + pattern.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&').replace(/\*/g, '.*') + '$';
  try {
    return new RegExp(regexPattern, 'i').test(str);
  } catch (e) {
    return false;
  }
}

// ─── Destination Path Builder ────────────────────────────────────────────────
function computeDestination(filePath, watchRoot, settings) {
  const baseName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const extName = ext.replace('.', '') || 'misc';
  const category = getCategoryForFile(baseName, settings);

  // Target base root
  let targetRoot = watchRoot;
  if (settings.targetMode === 'custom-folder' && settings.customTargetFolder && fs.existsSync(settings.customTargetFolder)) {
    targetRoot = settings.customTargetFolder;
  }

  // Date selection
  let targetDate = new Date();
  if (settings.dateSource === 'fileDate') {
    try {
      const stat = fs.statSync(filePath);
      targetDate = stat.birthtime || stat.mtime || targetDate;
    } catch (e) {}
  }

  const { formattedDate, year, month, monthName, day } = formatFolderDate(targetDate, settings.dateFormat);

  let subDir = '';
  const template = settings.folderTemplate || 'standard';

  switch (template) {
    case 'clean':
      subDir = category;
      break;
    case 'category-ext':
      subDir = path.join(category, extName);
      break;
    case 'date-category':
      subDir = path.join(formattedDate, category);
      break;
    case 'year-month-category':
      subDir = path.join(String(year), `${month} - ${monthName}`, category);
      break;
    case 'custom':
      let custom = settings.customTemplateString || '{category}/{ext}';
      custom = custom
        .replace(/{category}/gi, category)
        .replace(/{ext}/gi, extName)
        .replace(/{date}/gi, formattedDate)
        .replace(/{year}/gi, String(year))
        .replace(/{month}/gi, String(month))
        .replace(/{monthname}/gi, monthName)
        .replace(/{day}/gi, String(day));
      subDir = custom.split(/[\/\\]+/).filter(Boolean).join(path.sep);
      break;
    case 'standard':
    default:
      subDir = path.join(formattedDate, category, extName);
      break;
  }

  const targetDir = path.join(targetRoot, subDir);

  // Filename formatting
  let finalFileName = baseName;
  const rawExt = path.extname(finalFileName);
  const rawBase = path.basename(finalFileName, rawExt);

  let processedBase = rawBase;
  let processedExt = settings.lowercaseExtensions ? rawExt.toLowerCase() : rawExt;

  if (settings.cleanFileNames) {
    processedBase = processedBase.replace(/[\s\-_]+/g, '_').replace(/[^a-zA-Z0-9_\(\)\.]/g, '');
  }

  if (settings.autoDatePrefix) {
    const prefix = `${year}-${month}-${String(day).padStart(2, '0')}_`;
    if (!processedBase.startsWith(prefix)) {
      processedBase = prefix + processedBase;
    }
  }

  finalFileName = processedBase + processedExt;

  return {
    targetDir,
    targetFileName: finalFileName,
    initialTargetFilePath: path.join(targetDir, finalFileName),
    category,
    extName,
    formattedDate
  };
}

// ─── Duplicate Resolution ────────────────────────────────────────────────────
function resolveDuplicatePath(targetFilePath, duplicateHandling, sourceFilePath) {
  if (!fs.existsSync(targetFilePath)) {
    return { targetPath: targetFilePath, action: 'create' };
  }

  if (duplicateHandling === 'skip') {
    return { targetPath: null, action: 'skip' };
  }

  if (duplicateHandling === 'overwrite') {
    return { targetPath: targetFilePath, action: 'overwrite' };
  }

  if (duplicateHandling === 'smart-match') {
    try {
      const srcStat = fs.statSync(sourceFilePath);
      const dstStat = fs.statSync(targetFilePath);
      if (srcStat.size === dstStat.size) {
        return { targetPath: null, action: 'skip_identical' };
      }
    } catch (e) {}
  }

  // Default: rename
  const dirName = path.dirname(targetFilePath);
  const ext = path.extname(targetFilePath);
  const baseName = path.basename(targetFilePath, ext);

  let counter = 1;
  let newPath = targetFilePath;

  while (fs.existsSync(newPath)) {
    newPath = path.join(dirName, `${baseName}(${counter})${ext}`);
    counter++;
  }

  return { targetPath: newPath, action: 'rename' };
}

// ─── Text Log File ───────────────────────────────────────────────────────────
function logToTrackerFile(fileName, category, extName, finalTargetFilePath) {
  try {
    const documentsPath = app.getPath('documents');
    const txtFilePath = path.join(documentsPath, 'background organizer.txt');

    const now = new Date();
    const timestamp = now.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const line = `[${timestamp}]  Name: ${fileName}  |  Type: ${category} / ${extName}  |  Location: ${finalTargetFilePath}\n`;
    fs.appendFileSync(txtFilePath, line, 'utf8');
  } catch (error) {
    console.error('Failed to write to background organizer.txt:', error.message);
  }
}

// ─── Safe File Move with Retry ───────────────────────────────────────────────
async function safeMoveFile(src, dst, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.ensureDirSync(path.dirname(dst));
      fs.moveSync(src, dst, { overwrite: true });
      return true;
    } catch (err) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 600 * attempt));
      } else {
        throw err;
      }
    }
  }
  return false;
}

// ─── Core File Processor ─────────────────────────────────────────────────────
async function processFile(filePath, watchRoot) {
  try {
    if (!fs.existsSync(filePath)) return;

    // Block files directly under drive roots
    const parentDir = path.dirname(path.resolve(filePath));
    if (isDriveOrSystemRoot(parentDir)) return;

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return;

    const baseName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Skip hidden files, system files, desktop.ini
    if (baseName.startsWith('.') || baseName === 'desktop.ini' || baseName === 'thumbs.db') return;

    const settings = settingsManager.getSettings();

    // Excluded extensions
    const excludedExts = settings.excludedExtensions || [];
    if (excludedExts.map(e => e.toLowerCase()).includes(ext)) return;

    // Excluded filename patterns
    const excludedPatterns = settings.excludedFilenamePatterns || [];
    for (const pat of excludedPatterns) {
      if (matchWildcard(baseName, pat)) return;
    }

    // Size filters
    if (settings.minFileSizeKB > 0 && (stats.size / 1024) < settings.minFileSizeKB) return;
    if (settings.maxFileSizeMB > 0 && (stats.size / (1024 * 1024)) > settings.maxFileSizeMB) return;

    const computed = computeDestination(filePath, watchRoot, settings);

    // Don't move a file into itself
    const resolvedSrc = path.resolve(filePath);
    const resolvedDst = path.resolve(computed.initialTargetFilePath);
    if (resolvedSrc === resolvedDst) return;

    const dupResult = resolveDuplicatePath(computed.initialTargetFilePath, settings.duplicateHandling, filePath);

    if (!dupResult.targetPath) {
      settingsManager.logActivity('info', `Skipped duplicate/identical: "${baseName}"`);
      return;
    }

    const finalTargetFilePath = dupResult.targetPath;
    const finalBaseName = path.basename(finalTargetFilePath);

    // Perform the safe move with retry
    await safeMoveFile(filePath, finalTargetFilePath);

    // Record for Undo history
    settingsManager.recordMoveForUndo({
      sourcePath: filePath,
      destinationPath: finalTargetFilePath,
      fileName: baseName,
      category: computed.category,
      ext: computed.extName
    });

    // Write to tracker text file
    logToTrackerFile(baseName, computed.category, computed.extName, finalTargetFilePath);

    // Write to internal activity log
    const relDst = path.relative(watchRoot, finalTargetFilePath);
    settingsManager.logActivity('success', `Moved: "${baseName}" → "${relDst}"`, {
      source: filePath,
      destination: finalTargetFilePath,
      category: computed.category,
      ext: computed.extName
    });

    if (settings.notificationsEnabled !== false) {
      showNotification('File Organized', `"${baseName}" → ${computed.category}/${computed.extName}`);
    }

    if (mainWindow) {
      mainWindow.webContents.send('activity-log-update', settingsManager.getLogs());
    }
  } catch (error) {
    console.error('File organization error:', error);
    settingsManager.logActivity('error', `Failed to organize "${path.basename(filePath)}": ${error.message}`);
  }
}

// ─── Manual Scan (all watch folders) ────────────────────────────────────────
async function organizeExistingFiles() {
  try {
    const settings = settingsManager.getSettings();
    const watchFolders = settings.watchFolders || [];

    if (watchFolders.length === 0) {
      settingsManager.logActivity('info', 'No folders configured. Add folders in Settings.');
      return;
    }

    let totalCount = 0;

    for (const watchPath of watchFolders) {
      if (isDriveOrSystemRoot(watchPath) || !fs.existsSync(watchPath)) continue;

      settingsManager.logActivity('info', `Scanning: "${watchPath}"...`);

      const entries = fs.readdirSync(watchPath);

      for (const fileName of entries) {
        const filePath = path.join(watchPath, fileName);
        try {
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;

          if (fileName.startsWith('.') || fileName === 'desktop.ini' || fileName === 'thumbs.db') continue;

          await processFile(filePath, watchPath);
          totalCount++;
        } catch (e) { /* skip locked/inaccessible files */ }
      }
    }

    settingsManager.logActivity('info', `Manual scan complete. Processed ${totalCount} file(s).`);
    showNotification('Scan Complete', `Processed ${totalCount} file(s) across ${watchFolders.length} folder(s).`);

    if (mainWindow) {
      mainWindow.webContents.send('activity-log-update', settingsManager.getLogs());
    }
  } catch (error) {
    settingsManager.logActivity('error', `Manual scan failed: ${error.message}`);
  }
}

// ─── Undo Move Operation ─────────────────────────────────────────────────────
async function undoMoveOperation(undoId) {
  try {
    const history = settingsManager.getUndoHistory();
    const item = undoId ? history.find(h => h.id === undoId) : history.find(h => !h.undone);

    if (!item) {
      return { success: false, message: 'No reversible operation found.' };
    }

    if (item.undone) {
      return { success: false, message: 'This operation has already been undone.' };
    }

    if (!fs.existsSync(item.destinationPath)) {
      return { success: false, message: `File at "${item.destinationPath}" is no longer present.` };
    }

    // Ensure original directory exists
    fs.ensureDirSync(path.dirname(item.sourcePath));

    // Move back
    await safeMoveFile(item.destinationPath, item.sourcePath);

    settingsManager.markUndoComplete(item.id);
    settingsManager.logActivity('info', `Undone: Restored "${item.fileName}" back to "${item.sourcePath}"`);

    if (mainWindow) {
      mainWindow.webContents.send('activity-log-update', settingsManager.getLogs());
    }

    return { success: true, fileName: item.fileName, sourcePath: item.sourcePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ─── Notification Helper ─────────────────────────────────────────────────────
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: path.join(__dirname, 'assets', 'icon.png')
    }).show();
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => settingsManager.getSettings());

ipcMain.handle('save-settings', (event, newSettings) => {
  if (newSettings.watchFolders && Array.isArray(newSettings.watchFolders)) {
    for (const f of newSettings.watchFolders) {
      if (isDriveOrSystemRoot(f)) {
        settingsManager.logActivity('error', `Blocked: Cannot watch system or drive root "${f}".`);
        return false;
      }
    }
  }

  const result = settingsManager.saveSettings(newSettings);
  if (result) {
    if (watcherActive) startWatcher();
    app.setLoginItemSettings({
      openAtLogin: newSettings.startupLaunch,
      path: process.execPath,
      args: ['--hidden']
    });
    updateTrayMenu();
  }
  return result;
});

ipcMain.handle('get-logs', () => settingsManager.getLogs());
ipcMain.handle('clear-logs', () => settingsManager.clearLogs());

ipcMain.handle('get-undo-history', () => settingsManager.getUndoHistory());
ipcMain.handle('undo-move', (event, undoId) => undoMoveOperation(undoId));

ipcMain.handle('get-watcher-status', () => watcherActive);
ipcMain.handle('toggle-watcher', () => {
  toggleWatcher();
  return watcherActive;
});

ipcMain.handle('select-folder', async (event, defaultPath) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: defaultPath || os.homedir()
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('trigger-manual-scan', async () => {
  await organizeExistingFiles();
  return true;
});

ipcMain.handle('simulate-path', (event, filename, sampleFolder) => {
  try {
    const settings = settingsManager.getSettings();
    const folder = sampleFolder || (settings.watchFolders && settings.watchFolders[0]) || path.join(os.homedir(), 'Downloads');
    const fakePath = path.join(folder, filename);
    const computed = computeDestination(fakePath, folder, settings);
    return {
      success: true,
      category: computed.category,
      extName: computed.extName,
      targetDir: computed.targetDir,
      targetFileName: computed.targetFileName,
      fullTargetPath: path.join(computed.targetDir, computed.targetFileName)
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-tracker-file', () => {
  try {
    const documentsPath = app.getPath('documents');
    const txtFilePath = path.join(documentsPath, 'background organizer.txt');
    if (!fs.existsSync(txtFilePath)) {
      fs.writeFileSync(txtFilePath, '=== Sortify – Background Organizer Log ===\n\n', 'utf8');
    }
    shell.openPath(txtFilePath);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('open-path', (event, targetPath) => {
  try {
    if (fs.existsSync(targetPath)) {
      shell.showItemInFolder(targetPath);
      return true;
    } else {
      shell.openPath(path.dirname(targetPath));
      return true;
    }
  } catch (e) {
    return false;
  }
});

ipcMain.handle('export-logs', async (event, format) => {
  try {
    const logs = settingsManager.getLogs();
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Activity Logs',
      defaultPath: path.join(app.getPath('documents'), `sortify_logs_${Date.now()}.${format}`),
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });

    if (!filePath) return false;

    if (format === 'json') {
      fs.writeJsonSync(filePath, logs, { spaces: 2 });
    } else if (format === 'csv') {
      let csv = 'Timestamp,Status,Message\n';
      logs.forEach(l => {
        csv += `"${l.timestamp}","${l.status}","${(l.message || '').replace(/"/g, '""')}"\n`;
      });
      fs.writeFileSync(filePath, csv, 'utf8');
    } else {
      let txt = logs.map(l => `[${l.timestamp}] [${l.status.toUpperCase()}] ${l.message}`).join('\n');
      fs.writeFileSync(filePath, txt, 'utf8');
    }
    return true;
  } catch (e) {
    return false;
  }
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  createSettingsWindow();
  startWatcher();

  const settings = settingsManager.getSettings();
  app.setLoginItemSettings({
    openAtLogin: settings.startupLaunch,
    path: process.execPath,
    args: ['--hidden']
  });

  if (settings.organizeOnLaunch) {
    setTimeout(() => organizeExistingFiles(), 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSettingsWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  stopAllWatchers();
});
