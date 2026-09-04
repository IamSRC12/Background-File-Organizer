const fs = require('fs-extra');
const path = require('path');
const os = require('os');

let app = null;
let settingsFilePath = '';
let logFilePath = '';
let undoFilePath = '';
let currentSettings = null;

// ─── Default Category Sets & Colors ──────────────────────────────────────────
const defaultCategories = {
  Music: [
    '.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac', '.wma',
    '.m4p', '.mid', '.midi', '.aif', '.aiff', '.mpga', '.amr',
    '.mka', '.opus', '.ra', '.rm', '.ape', '.alac'
  ],
  Videos: [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
    '.m4v', '.3gp', '.mpeg', '.mpg', '.vob', '.mts', '.m2ts',
    '.ts', '.3g2', '.divx', '.rmvb', '.asf', '.ogv', '.f4v',
    '.swf', '.hevc', '.h264', '.h265', '.264', '.265'
  ],
  Images: [
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp',
    '.ico', '.tiff', '.tif', '.psd', '.ai', '.heic', '.heif',
    '.raw', '.cr2', '.nef', '.dng', '.arw', '.orf', '.rw2',
    '.xcf', '.sketch', '.fig', '.avif', '.jfif'
  ],
  Documents: [
    '.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls', '.pptx',
    '.ppt', '.csv', '.rtf', '.epub', '.odt', '.pages', '.key',
    '.numbers', '.md', '.html', '.htm', '.odp', '.ods', '.tex',
    '.log', '.json', '.xml', '.yaml', '.yml', '.ini', '.cfg',
    '.conf', '.toml', '.rst', '.nfo', '.mobi', '.azw', '.azw3'
  ],
  Apks: [
    '.apk', '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm',
    '.bat', '.sh', '.bin', '.app', '.run', '.cmd', '.ps1',
    '.jar', '.ipa', '.xapk', '.msix', '.appx', '.appimage'
  ],
  Archives: [
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    '.iso', '.cab', '.tgz', '.zipx', '.lzma', '.lz4', '.zst',
    '.br', '.pak', '.img', '.vhd', '.vmdk', '.tar.gz', '.tar.xz'
  ],
  Code: [
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c',
    '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.sql',
    '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.dart',
    '.lua', '.r', '.m', '.scala', '.sh'
  ],
  Design: [
    '.blend', '.fbx', '.obj', '.stl', '.3ds', '.max', '.c4d',
    '.dae', '.glb', '.gltf', '.step', '.iges', '.dwg', '.dxf',
    '.cdr', '.ai', '.eps', '.indd', '.sketch'
  ],
  Misc: []
};

const defaultCategoryMetadata = {
  Music:     { icon: 'fa-music',         color: 'purple-gradient', custom: false },
  Videos:    { icon: 'fa-video',         color: 'blue-gradient',   custom: false },
  Images:    { icon: 'fa-image',         color: 'teal-gradient',   custom: false },
  Documents: { icon: 'fa-file-lines',    color: 'orange-gradient', custom: false },
  Apks:      { icon: 'fa-robot',         color: 'green-gradient',  custom: false },
  Archives:  { icon: 'fa-file-zipper',   color: 'yellow-gradient', custom: false },
  Code:      { icon: 'fa-code',          color: 'indigo-gradient', custom: false },
  Design:    { icon: 'fa-cube',          color: 'rose-gradient',   custom: false },
  Misc:      { icon: 'fa-box-open',      color: 'slate-gradient',  custom: false }
};

// ─── Default Configuration ───────────────────────────────────────────────────
const getDefaults = () => {
  const downloadsPath = app ? app.getPath('downloads') : path.join(os.homedir(), 'Downloads');

  return {
    watchFolders: [downloadsPath],        // Array of watched folder paths
    targetMode: 'in-place',                // 'in-place' (inside watched folder) or 'custom-folder'
    customTargetFolder: '',               // Dedicated destination path if targetMode === 'custom-folder'
    folderTemplate: 'standard',           // 'standard', 'clean', 'category-ext', 'date-category', 'year-month-category', 'custom'
    customTemplateString: '{category}/{ext}',
    dateFormat: 'DD MMMM YYYY',           // 'DD MMMM YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM', 'Month YYYY'
    dateSource: 'current',                // 'current' (now) or 'fileDate' (file modified/created date)
    mode: 'move',                         // Always move (safe)
    duplicateHandling: 'rename',          // 'rename', 'skip', 'overwrite', 'smart-match'
    stabilityDelay: 2,                    // Stability delay in seconds before organizing
    minFileSizeKB: 0,                     // Ignore files smaller than X KB (0 = disabled)
    maxFileSizeMB: 0,                     // Ignore files larger than X MB (0 = disabled)
    excludedExtensions: ['.part', '.crdownload', '.tmp', '.torrent', '.partial', '.!bt'],
    excludedFilenamePatterns: ['~$*', 'temp_*', '.*'],
    cleanFileNames: false,                // Replace spaces with underscores, strip invalid characters
    lowercaseExtensions: true,            // e.g. .JPG -> .jpg
    autoDatePrefix: false,                // Prepend YYYY-MM-DD_ to filename
    startupLaunch: true,
    organizeOnLaunch: true,
    notificationsEnabled: true,
    soundAlerts: false,
    hasShownTrayNotification: false,
    categories: JSON.parse(JSON.stringify(defaultCategories)),
    categoryMetadata: JSON.parse(JSON.stringify(defaultCategoryMetadata))
  };
};

// ─── Init ────────────────────────────────────────────────────────────────────
function init(appInstance) {
  app = appInstance;
  const userDataPath = app.getPath('userData');
  settingsFilePath = path.join(userDataPath, 'config.json');
  logFilePath = path.join(userDataPath, 'activity.log');
  undoFilePath = path.join(userDataPath, 'undo_history.json');

  fs.ensureDirSync(userDataPath);
  loadSettings();

  if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '', 'utf8');
  }
  if (!fs.existsSync(undoFilePath)) {
    fs.writeJsonSync(undoFilePath, []);
  }
}

// ─── Load Settings ────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const data = fs.readJsonSync(settingsFilePath);
      const defaults = getDefaults();

      currentSettings = { ...defaults, ...data };

      // Migrate old single watchFolder to watchFolders array
      if (data.watchFolder && !data.watchFolders) {
        currentSettings.watchFolders = [data.watchFolder];
        delete currentSettings.watchFolder;
      }

      // Ensure watchFolders is always an array
      if (!Array.isArray(currentSettings.watchFolders)) {
        currentSettings.watchFolders = [defaults.watchFolders[0]];
      }

      // Merge categories (keep defaults + user additions, no duplicates)
      currentSettings.categories = {};
      const userCategories = data.categories || {};
      for (const [cat, defaultExts] of Object.entries(defaults.categories)) {
        const userExts = userCategories[cat] || [];
        currentSettings.categories[cat] = [...new Set([...defaultExts, ...userExts])];
      }

      // Include any user-added custom categories
      for (const [cat, exts] of Object.entries(userCategories)) {
        if (!currentSettings.categories[cat]) {
          currentSettings.categories[cat] = exts;
        }
      }

      // Merge category metadata
      currentSettings.categoryMetadata = { ...defaults.categoryMetadata, ...(data.categoryMetadata || {}) };
      for (const cat of Object.keys(currentSettings.categories)) {
        if (!currentSettings.categoryMetadata[cat]) {
          currentSettings.categoryMetadata[cat] = {
            icon: 'fa-folder',
            color: 'teal-gradient',
            custom: true
          };
        }
      }
    } else {
      currentSettings = getDefaults();
      saveSettings(currentSettings);
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
    currentSettings = getDefaults();
  }

  return currentSettings;
}

// ─── Save Settings ────────────────────────────────────────────────────────────
function saveSettings(settings) {
  try {
    currentSettings = settings;
    fs.writeJsonSync(settingsFilePath, currentSettings, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    logActivity('error', `Failed to save settings: ${error.message}`);
    return false;
  }
}

function getSettings() {
  if (!currentSettings) return getDefaults();
  return currentSettings;
}

// ─── Activity Log ────────────────────────────────────────────────────────────
function logActivity(status, message, meta = {}) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, status, message, ...meta };
    const logLine = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(logFilePath, logLine, 'utf8');

    // Trim log to last 2000 lines if it grows too large
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    const lines = logContent.trim().split('\n');
    if (lines.length > 3000) {
      const keepLines = lines.slice(lines.length - 1500);
      fs.writeFileSync(logFilePath, keepLines.join('\n') + '\n', 'utf8');
    }

    return logEntry;
  } catch (error) {
    console.error('Failed to write activity log:', error);
    return null;
  }
}

function getLogs() {
  try {
    if (!fs.existsSync(logFilePath)) return [];
    const logContent = fs.readFileSync(logFilePath, 'utf8').trim();
    if (!logContent) return [];

    return logContent
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { timestamp: new Date().toISOString(), status: 'info', message: line };
        }
      })
      .reverse();
  } catch (error) {
    console.error('Failed to read logs:', error);
    return [];
  }
}

function clearLogs() {
  try {
    fs.writeFileSync(logFilePath, '', 'utf8');
    logActivity('info', 'Activity log cleared.');
    return true;
  } catch (error) {
    console.error('Failed to clear logs:', error);
    return false;
  }
}

// ─── Undo / Rollback Stack ───────────────────────────────────────────────────
function recordMoveForUndo(item) {
  try {
    let history = [];
    if (fs.existsSync(undoFilePath)) {
      history = fs.readJsonSync(undoFilePath);
    }
    history.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      fileName: item.fileName,
      category: item.category,
      ext: item.ext,
      undone: false
    });
    // Keep max 200 undo operations
    if (history.length > 200) history = history.slice(0, 200);
    fs.writeJsonSync(undoFilePath, history, { spaces: 2 });
  } catch (e) {
    console.error('Failed to record undo operation:', e);
  }
}

function getUndoHistory() {
  try {
    if (fs.existsSync(undoFilePath)) {
      return fs.readJsonSync(undoFilePath);
    }
    return [];
  } catch (e) {
    return [];
  }
}

function markUndoComplete(id) {
  try {
    if (!fs.existsSync(undoFilePath)) return;
    const history = fs.readJsonSync(undoFilePath);
    const item = history.find(h => h.id === id);
    if (item) {
      item.undone = true;
      fs.writeJsonSync(undoFilePath, history, { spaces: 2 });
    }
  } catch (e) {}
}

module.exports = {
  init,
  getDefaults,
  getSettings,
  saveSettings,
  logActivity,
  getLogs,
  clearLogs,
  recordMoveForUndo,
  getUndoHistory,
  markUndoComplete
};
