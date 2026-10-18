const { ipcRenderer, shell } = require('electron');

// ─── App State ───────────────────────────────────────────────────────────────
let currentSettings = null;
let currentLogs = [];
let activeFilter = 'all';
let searchKeyword = '';

// Default Category Fallbacks
const defaultIcons = {
  Music:     'fa-music',
  Videos:    'fa-video',
  Images:    'fa-image',
  Documents: 'fa-file-lines',
  Apks:      'fa-robot',
  Archives:  'fa-file-zipper',
  Code:      'fa-code',
  Design:    'fa-cube',
  Misc:      'fa-box-open'
};

const defaultColors = {
  Music:     'purple-gradient',
  Videos:    'blue-gradient',
  Images:    'teal-gradient',
  Documents: 'orange-gradient',
  Apks:      'green-gradient',
  Archives:  'yellow-gradient',
  Code:      'indigo-gradient',
  Design:    'rose-gradient',
  Misc:      'slate-gradient'
};

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupTabs();
  await loadSettings();
  await loadLogs();
  setupEventListeners();
  setupModal();

  ipcRenderer.on('activity-log-update', (event, logs) => {
    currentLogs = logs;
    renderLogs();
    updateStats();
    renderDistributionBar();
  });

  ipcRenderer.on('watcher-status-changed', (event, isActive) => {
    updateWatcherStatusUI(isActive);
  });

  const watcherActive = await ipcRenderer.invoke('get-watcher-status');
  updateWatcherStatusUI(watcherActive);
});

// ─── Theme ───────────────────────────────────────────────────────────────────
function initTheme() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;
  const icon = btn.querySelector('i');
  const label = btn.querySelector('span');
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    if (icon) icon.className = theme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (label) label.textContent = theme === 'light' ? 'Dark theme' : 'Light theme';
  };
  apply(document.documentElement.dataset.theme || 'dark');
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem('sortify-theme', next); } catch (e) {}
  });
}

// ─── Tab Navigation ──────────────────────────────────────────────────────────
function setupTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = item.getAttribute('data-tab');
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      tabContents.forEach(tab => {
        tab.id === tabId ? tab.classList.add('active') : tab.classList.remove('active');
      });
    });
  });
}

// ─── Load Settings ────────────────────────────────────────────────────────────
async function loadSettings() {
  currentSettings = await ipcRenderer.invoke('get-settings');

  if (!Array.isArray(currentSettings.watchFolders)) {
    currentSettings.watchFolders = currentSettings.watchFolder ? [currentSettings.watchFolder] : [];
  }

  // 1. Settings Tab fields
  renderWatchFoldersList();
  updateDashboardFolders();
  document.getElementById('input-stability-delay').value = currentSettings.stabilityDelay || 2;
  document.getElementById('toggle-startup').checked = !!currentSettings.startupLaunch;
  document.getElementById('toggle-organize-on-launch').checked = !!currentSettings.organizeOnLaunch;
  document.getElementById('toggle-notifications').checked = currentSettings.notificationsEnabled !== false;

  // 2. Organizing Options Tab fields
  const targetMode = currentSettings.targetMode || 'in-place';
  const targetRadio = document.querySelector(`input[name="opt-target-mode"][value="${targetMode}"]`);
  if (targetRadio) targetRadio.checked = true;
  document.getElementById('input-custom-target-path').value = currentSettings.customTargetFolder || '';
  document.getElementById('custom-target-row').style.display = (targetMode === 'custom-folder') ? 'block' : 'none';

  const template = currentSettings.folderTemplate || 'standard';
  const tmplRadio = document.querySelector(`input[name="opt-template"][value="${template}"]`);
  if (tmplRadio) tmplRadio.checked = true;
  document.getElementById('input-custom-template-string').value = currentSettings.customTemplateString || '{category}/{ext}';
  document.getElementById('custom-template-input-row').style.display = (template === 'custom') ? 'block' : 'none';

  document.getElementById('select-date-format').value = currentSettings.dateFormat || 'DD MMMM YYYY';
  document.getElementById('select-date-source').value = currentSettings.dateSource || 'current';

  const dupHandling = currentSettings.duplicateHandling || 'rename';
  const dupRadio = document.querySelector(`input[name="opt-dup-handling"][value="${dupHandling}"]`);
  if (dupRadio) dupRadio.checked = true;

  document.getElementById('input-min-size').value = currentSettings.minFileSizeKB || 0;
  document.getElementById('input-max-size').value = currentSettings.maxFileSizeMB || 0;
  document.getElementById('input-excluded-patterns').value = (currentSettings.excludedFilenamePatterns || []).join(', ');

  document.getElementById('toggle-clean-names').checked = !!currentSettings.cleanFileNames;
  document.getElementById('toggle-lowercase-ext').checked = currentSettings.lowercaseExtensions !== false;
  document.getElementById('toggle-date-prefix').checked = !!currentSettings.autoDatePrefix;

  // 3. Render Rules & Stats
  renderCategoryCards();
  updateStats();
  renderDistributionBar();
}

// ─── Watch Folders List (Settings Tab) ───────────────────────────────────────
function renderWatchFoldersList() {
  const container = document.getElementById('watch-folders-list');
  if (!container) return;
  container.innerHTML = '';

  const folders = currentSettings.watchFolders || [];

  if (folders.length === 0) {
    container.innerHTML = `<div class="empty-folders-hint" style="color:var(--text-muted); padding:10px; font-size:12px;"><i class="fa-solid fa-circle-info"></i> No folders configured. Add one below.</div>`;
    return;
  }

  folders.forEach((folderPath, index) => {
    const item = document.createElement('div');
    item.className = 'watch-folder-item';
    item.innerHTML = `
      <div class="folder-item-icon">
        <i class="fa-solid fa-folder-open"></i>
      </div>
      <div class="folder-item-path" title="${folderPath}">${folderPath}</div>
      <button class="folder-item-remove" onclick="openFolderInExplorer('${folderPath.replace(/\\/g, '\\\\')}')" title="Browse in Explorer" style="color:var(--accent-cyan); margin-right:4px;">
        <i class="fa-regular fa-folder-open"></i>
      </button>
      <button class="folder-item-remove" onclick="removeWatchFolder(${index})" title="Remove this folder">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    container.appendChild(item);
  });
}

function updateDashboardFolders() {
  const el = document.getElementById('stat-watch-path');
  if (!el) return;
  const folders = currentSettings.watchFolders || [];
  if (folders.length === 0) {
    el.textContent = 'No folders configured';
  } else if (folders.length === 1) {
    el.textContent = folders[0];
  } else {
    el.textContent = `${folders.length} folders monitored`;
    el.title = folders.join('\n');
  }
}

window.removeWatchFolder = (index) => {
  if (!currentSettings) return;
  currentSettings.watchFolders.splice(index, 1);
  renderWatchFoldersList();
  updateDashboardFolders();
  updateStats();
  saveSettingsSilently();
};

window.openFolderInExplorer = (folderPath) => {
  shell.openPath(folderPath).catch(err => alert('Could not open folder: ' + err.message));
};

// ─── Category Cards & Rules ──────────────────────────────────────────────────
function renderCategoryCards() {
  const container = document.getElementById('category-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const categories = currentSettings.categories || {};
  const metadata = currentSettings.categoryMetadata || {};

  Object.keys(categories).forEach(category => {
    const extensions = categories[category] || [];
    const meta = metadata[category] || {};
    const iconClass = meta.icon || defaultIcons[category] || 'fa-folder';
    const colorClass = meta.color || defaultColors[category] || 'slate-gradient';
    const isMisc = category === 'Misc';
    const isCustom = meta.custom === true;

    const card = document.createElement('div');
    card.className = 'category-card';

    let cardHtml = `
      <div class="category-card-header">
        <div class="category-title">
          <div class="category-badge-icon ${colorClass}">
            <i class="fa-solid ${iconClass}"></i>
          </div>
          <h3>${category}</h3>
        </div>
        <div class="category-card-actions">
          <span class="ext-count-badge">${extensions.length} types</span>
          ${isCustom ? `
            <button class="btn-card-icon" onclick="deleteCategory('${category}')" title="Delete custom category">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </div>

      <div class="category-card-path">
        <label>Organization Path</label>
        <div class="path-preview">
          <code>${getPreviewPathTemplate(category)}</code>
        </div>
      </div>
    `;

    if (!isMisc) {
      cardHtml += `
        <div class="category-card-tags">
          <label>File Extensions</label>
          <div class="tags-wrapper" id="tags-wrapper-${category}">
            ${extensions.map(ext => `
              <span class="tag">
                ${ext} <i class="fa-solid fa-xmark" onclick="removeExtension('${category}', '${ext}')"></i>
              </span>
            `).join('')}

            <div class="add-tag-group">
              <input type="text" class="input-add-tag" id="input-add-${category}" placeholder="e.g. .ts" onkeydown="handleTagInputKeydown(event, '${category}')">
              <button class="btn-add-tag" onclick="addExtension('${category}')">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      cardHtml += `
        <div class="category-card-tags">
          <label>Default Route</label>
          <p style="font-size:11.5px; color:var(--text-muted); line-height:1.4;">Catches all unrecognized file types and extensions not mapped above.</p>
        </div>
      `;
    }

    card.innerHTML = cardHtml;
    container.appendChild(card);
  });
}

function getPreviewPathTemplate(category) {
  const tmpl = currentSettings.folderTemplate || 'standard';
  switch (tmpl) {
    case 'clean': return `[Root] / ${category} / file.ext`;
    case 'category-ext': return `[Root] / ${category} / [ext] / file.ext`;
    case 'date-category': return `[Root] / [Date] / ${category} / file.ext`;
    case 'year-month-category': return `[Root] / [YYYY] / [Month] / ${category} / file.ext`;
    case 'custom': return `[Root] / ${currentSettings.customTemplateString || '{category}/{ext}'} / file.ext`;
    case 'standard':
    default: return `[Root] / [Date] / ${category} / [ext] / file.ext`;
  }
}

window.removeExtension = (category, ext) => {
  if (!currentSettings) return;
  const index = currentSettings.categories[category].indexOf(ext);
  if (index > -1) {
    currentSettings.categories[category].splice(index, 1);
    renderCategoryCards();
    updateStats();
    saveSettingsSilently();
  }
};

window.addExtension = (category) => {
  if (!currentSettings) return;
  const input = document.getElementById(`input-add-${category}`);
  let ext = input.value.trim().toLowerCase();
  if (!ext) return;
  if (!ext.startsWith('.')) ext = '.' + ext;

  let exists = false;
  Object.keys(currentSettings.categories).forEach(cat => {
    if (currentSettings.categories[cat].includes(ext)) exists = true;
  });

  if (exists) {
    alert(`Extension "${ext}" is already configured!`);
    input.value = '';
    return;
  }

  currentSettings.categories[category].push(ext);
  input.value = '';
  renderCategoryCards();
  updateStats();
  saveSettingsSilently();
};

window.handleTagInputKeydown = (event, category) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    window.addExtension(category);
  }
};

window.deleteCategory = (category) => {
  if (!currentSettings || !confirm(`Delete custom category "${category}"?`)) return;
  delete currentSettings.categories[category];
  delete currentSettings.categoryMetadata[category];
  renderCategoryCards();
  updateStats();
  saveSettingsSilently();
};

// ─── Modal for New Category ──────────────────────────────────────────────────
let selectedModalIcon = 'fa-folder';
let selectedModalColor = 'primary-gradient';

function setupModal() {
  const modal = document.getElementById('modal-create-category');
  const openBtn = document.getElementById('btn-open-create-category');
  const closeBtn = document.getElementById('btn-close-cat-modal');
  const cancelBtn = document.getElementById('btn-cancel-cat-modal');
  const saveBtn = document.getElementById('btn-save-new-category');

  if (!modal) return;

  const openModal = () => {
    modal.classList.add('open');
    document.getElementById('modal-input-cat-name').value = '';
    document.getElementById('modal-input-cat-exts').value = '';
  };
  const closeModal = () => modal.classList.remove('open');

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // Icon picker
  document.querySelectorAll('#modal-icon-picker .icon-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#modal-icon-picker .icon-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedModalIcon = opt.getAttribute('data-icon');
    });
  });

  // Color picker
  document.querySelectorAll('#modal-color-picker .color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#modal-color-picker .color-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedModalColor = opt.getAttribute('data-color');
    });
  });

  // Save new category
  saveBtn.addEventListener('click', () => {
    const nameInput = document.getElementById('modal-input-cat-name');
    const extsInput = document.getElementById('modal-input-cat-exts');
    const catName = nameInput.value.trim();

    if (!catName) {
      alert('Please enter a category name.');
      return;
    }

    if (currentSettings.categories[catName]) {
      alert(`Category "${catName}" already exists.`);
      return;
    }

    const exts = extsInput.value
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
      .map(e => e.startsWith('.') ? e : '.' + e);

    currentSettings.categories[catName] = exts;
    currentSettings.categoryMetadata[catName] = {
      icon: selectedModalIcon,
      color: selectedModalColor,
      custom: true
    };

    closeModal();
    renderCategoryCards();
    updateStats();
    saveSettingsSilently();
  });
}

// ─── Settings & Customization Save ───────────────────────────────────────────
async function saveSettingsSilently() {
  await ipcRenderer.invoke('save-settings', currentSettings);
}

async function saveGeneralSettings() {
  currentSettings.stabilityDelay = parseInt(document.getElementById('input-stability-delay').value, 10) || 2;
  currentSettings.startupLaunch = document.getElementById('toggle-startup').checked;
  currentSettings.organizeOnLaunch = document.getElementById('toggle-organize-on-launch').checked;
  currentSettings.notificationsEnabled = document.getElementById('toggle-notifications').checked;

  const btn = document.getElementById('btn-save-settings');
  await flashButtonSuccess(btn, 'Settings Saved!');
}

async function saveCustomizationSettings() {
  const targetMode = document.querySelector('input[name="opt-target-mode"]:checked').value;
  currentSettings.targetMode = targetMode;
  currentSettings.customTargetFolder = document.getElementById('input-custom-target-path').value.trim();

  const tmpl = document.querySelector('input[name="opt-template"]:checked').value;
  currentSettings.folderTemplate = tmpl;
  currentSettings.customTemplateString = document.getElementById('input-custom-template-string').value.trim();

  currentSettings.dateFormat = document.getElementById('select-date-format').value;
  currentSettings.dateSource = document.getElementById('select-date-source').value;

  const dup = document.querySelector('input[name="opt-dup-handling"]:checked').value;
  currentSettings.duplicateHandling = dup;

  currentSettings.minFileSizeKB = parseFloat(document.getElementById('input-min-size').value) || 0;
  currentSettings.maxFileSizeMB = parseFloat(document.getElementById('input-max-size').value) || 0;

  const patterns = document.getElementById('input-excluded-patterns').value
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);
  currentSettings.excludedFilenamePatterns = patterns;

  currentSettings.cleanFileNames = document.getElementById('toggle-clean-names').checked;
  currentSettings.lowercaseExtensions = document.getElementById('toggle-lowercase-ext').checked;
  currentSettings.autoDatePrefix = document.getElementById('toggle-date-prefix').checked;

  renderCategoryCards();
  const btn = document.getElementById('btn-save-customization');
  await flashButtonSuccess(btn, 'Options Saved!');
}

async function flashButtonSuccess(btn, message) {
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  btn.disabled = true;

  const success = await ipcRenderer.invoke('save-settings', currentSettings);

  setTimeout(() => {
    btn.disabled = false;
    if (success) {
      btn.innerHTML = `<i class="fa-solid fa-check"></i> ${message}`;
      btn.style.background = 'var(--teal-gradient)';
      updateDashboardFolders();
    } else {
      btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Save Failed';
      btn.style.background = 'var(--color-error)';
    }
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.style.background = '';
    }, 2000);
  }, 400);
}

// ─── Category Distribution Breakdown Bar ────────────────────────────────────
function renderDistributionBar() {
  const barTrack = document.getElementById('dist-bar-track');
  const legendGrid = document.getElementById('dist-legend-grid');
  const totalLabel = document.getElementById('dist-total-label');
  if (!barTrack || !legendGrid) return;

  const categories = currentSettings ? currentSettings.categories : {};
  const metadata = currentSettings ? currentSettings.categoryMetadata : {};

  // Count success logs by category
  const counts = {};
  Object.keys(categories).forEach(c => counts[c] = 0);
  let totalOrganized = 0;

  currentLogs.forEach(l => {
    if (l.status === 'success') {
      totalOrganized++;
      const cat = l.category || 'Misc';
      counts[cat] = (counts[cat] || 0) + 1;
    }
  });

  if (totalLabel) totalLabel.textContent = `${totalOrganized} files organized`;

  barTrack.innerHTML = '';
  legendGrid.innerHTML = '';

  const catNames = Object.keys(counts);

  if (totalOrganized === 0) {
    barTrack.innerHTML = `<div class="dist-bar-segment slate-gradient" style="width:100%; opacity:0.3;"></div>`;
    catNames.slice(0, 6).forEach(cat => {
      const meta = metadata[cat] || {};
      const color = meta.color || defaultColors[cat] || 'slate-gradient';
      const item = document.createElement('div');
      item.className = 'dist-legend-item';
      item.innerHTML = `<span class="dist-legend-dot ${color}"></span> ${cat}: <span class="dist-legend-count">0 (0%)</span>`;
      legendGrid.appendChild(item);
    });
    return;
  }

  catNames.forEach(cat => {
    const count = counts[cat] || 0;
    if (count > 0 || catNames.length <= 6) {
      const pct = Math.round((count / totalOrganized) * 100);
      const meta = metadata[cat] || {};
      const color = meta.color || defaultColors[cat] || 'slate-gradient';

      if (count > 0) {
        const seg = document.createElement('div');
        seg.className = `dist-bar-segment ${color}`;
        seg.style.width = `${(count / totalOrganized) * 100}%`;
        seg.title = `${cat}: ${count} files (${pct}%)`;
        barTrack.appendChild(seg);
      }

      const leg = document.createElement('div');
      leg.className = 'dist-legend-item';
      leg.innerHTML = `<span class="dist-legend-dot ${color}"></span> ${cat}: <span class="dist-legend-count">${count} (${pct}%)</span>`;
      legendGrid.appendChild(leg);
    }
  });
}

// ─── Logs & Undo ─────────────────────────────────────────────────────────────
async function loadLogs() {
  currentLogs = await ipcRenderer.invoke('get-logs');
  renderLogs();
}

function renderLogs() {
  const tableBody = document.getElementById('logs-table-body');
  const recentLogsContainer = document.getElementById('dashboard-recent-logs');

  const filteredLogs = currentLogs.filter(log => {
    if (activeFilter !== 'all' && log.status !== activeFilter) return false;
    if (searchKeyword) return (log.message || '').toLowerCase().includes(searchKeyword);
    return true;
  });

  tableBody.innerHTML = '';
  if (filteredLogs.length === 0) {
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="4">
          <div class="empty-state">
            <i class="fa-solid fa-clipboard-list"></i>
            <p>No matching logs found.</p>
          </div>
        </td>
      </tr>
    `;
  } else {
    filteredLogs.forEach(log => {
      const row = document.createElement('tr');
      const canOpen = log.destination || log.source;
      row.innerHTML = `
        <td class="timestamp-col">${formatLogTime(log.timestamp)}</td>
        <td>
          <span class="log-status-badge ${log.status}">
            ${log.status === 'success' ? '<i class="fa-solid fa-circle-check"></i>' : ''}
            ${log.status === 'info'    ? '<i class="fa-solid fa-circle-info"></i>'  : ''}
            ${log.status === 'error'   ? '<i class="fa-solid fa-circle-exclamation"></i>' : ''}
            ${log.status}
          </span>
        </td>
        <td>${log.message}</td>
        <td style="text-align:right;">
          <div class="log-row-actions" style="justify-content:flex-end;">
            ${canOpen ? `
              <button class="btn-table-action" onclick="openPathInFolder('${(log.destination || log.source).replace(/\\/g, '\\\\')}')" title="Open containing folder">
                <i class="fa-regular fa-folder-open"></i>
              </button>
            ` : ''}
            ${log.status === 'success' && log.destination ? `
              <button class="btn-table-action" onclick="undoSpecificMove('${(log.destination).replace(/\\/g, '\\\\')}')" title="Undo this file move" style="color:var(--accent-cyan);">
                <i class="fa-solid fa-rotate-left"></i>
              </button>
            ` : ''}
          </div>
        </td>
      `;
      tableBody.appendChild(row);
    });
  }

  // Dashboard live panel – last 5
  recentLogsContainer.innerHTML = '';
  const recentLogs = currentLogs.filter(l => l.status === 'success' || l.status === 'error').slice(0, 5);

  if (recentLogs.length === 0) {
    recentLogsContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-magnifying-glass"></i>
        <p>No recent file operations yet.</p>
      </div>
    `;
  } else {
    recentLogs.forEach(log => {
      const logDiv = document.createElement('div');
      logDiv.className = 'live-log-item';
      logDiv.innerHTML = `
        <span class="live-log-dot ${log.status}"></span>
        <div class="live-log-content">
          <p class="live-log-msg">${log.message}</p>
          <span class="live-log-time">${formatLogTime(log.timestamp, true)}</span>
        </div>
      `;
      recentLogsContainer.appendChild(logDiv);
    });
  }
}

window.openPathInFolder = (targetPath) => {
  ipcRenderer.invoke('open-path', targetPath);
};

window.undoSpecificMove = async (dstPath) => {
  const history = await ipcRenderer.invoke('get-undo-history');
  const match = history.find(h => h.destinationPath === dstPath && !h.undone);
  if (match) {
    const res = await ipcRenderer.invoke('undo-move', match.id);
    if (res.success) {
      alert(`Restored "${res.fileName}" back to original location.`);
    } else {
      alert(`Undo failed: ${res.message}`);
    }
  } else {
    alert('No active undo record found for this file.');
  }
};

function formatLogTime(isoString, timeOnly = false) {
  try {
    const date = new Date(isoString);
    const timeParts = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (timeOnly) return timeParts;
    const dateParts = date.toLocaleDateString([], { month: 'short', day: '2-digit' });
    return `${dateParts} ${timeParts}`;
  } catch {
    return isoString;
  }
}

function updateStats() {
  const successLogs = currentLogs.filter(log => log.status === 'success');
  document.getElementById('stat-files-count').textContent = successLogs.length;
  document.getElementById('stat-folders-count').textContent =
    (currentSettings && currentSettings.watchFolders) ? currentSettings.watchFolders.length : 0;

  if (currentSettings && currentSettings.categories) {
    const catKeys = Object.keys(currentSettings.categories);
    document.getElementById('stat-categories-count').textContent = catKeys.length;
    let totalExts = 0;
    catKeys.forEach(k => totalExts += (currentSettings.categories[k] || []).length);
    document.getElementById('stat-exts-count').textContent = `${totalExts} total extensions`;
  }

  const lastLog = currentLogs.find(l => l.status === 'success');
  if (lastLog) {
    document.getElementById('stat-last-action').textContent = (lastLog.category || 'Organized') + ' File';
    document.getElementById('stat-last-time').textContent = formatLogTime(lastLog.timestamp);
  } else {
    document.getElementById('stat-last-action').textContent = 'Idle';
    document.getElementById('stat-last-time').textContent = 'Awaiting files';
  }
}

// ─── Watcher Status ───────────────────────────────────────────────────────────
function updateWatcherStatusUI(isActive) {
  const statusDot  = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const toggleBtn  = document.getElementById('btn-toggle-service');

  if (isActive) {
    statusDot.className = 'status-dot online';
    statusText.textContent = 'Organizer Active';
    toggleBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause Service';
    toggleBtn.className = 'status-toggle-btn btn-secondary';
  } else {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Organizer Paused';
    toggleBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume Service';
    toggleBtn.className = 'status-toggle-btn btn-primary';
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  // Add watch folder
  document.getElementById('btn-add-watch-folder').addEventListener('click', async () => {
    const defaultPath = (currentSettings.watchFolders && currentSettings.watchFolders.length > 0)
      ? currentSettings.watchFolders[currentSettings.watchFolders.length - 1]
      : null;
    const selectedPath = await ipcRenderer.invoke('select-folder', defaultPath);
    if (selectedPath) {
      if (!currentSettings.watchFolders) currentSettings.watchFolders = [];
      if (currentSettings.watchFolders.includes(selectedPath)) {
        alert('This folder is already being monitored.');
        return;
      }
      currentSettings.watchFolders.push(selectedPath);
      renderWatchFoldersList();
      updateDashboardFolders();
      updateStats();
      saveSettingsSilently();
    }
  });

  // Dedicated Target Folder select
  document.getElementById('btn-select-target-folder').addEventListener('click', async () => {
    const selectedPath = await ipcRenderer.invoke('select-folder');
    if (selectedPath) {
      document.getElementById('input-custom-target-path').value = selectedPath;
      currentSettings.customTargetFolder = selectedPath;
    }
  });

  // Target Mode radio change
  document.querySelectorAll('input[name="opt-target-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.getElementById('custom-target-row').style.display = (e.target.value === 'custom-folder') ? 'block' : 'none';
    });
  });

  // Template radio change
  document.querySelectorAll('input[name="opt-template"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.getElementById('custom-template-input-row').style.display = (e.target.value === 'custom') ? 'block' : 'none';
    });
  });

  // Save buttons
  document.getElementById('btn-save-settings').addEventListener('click', saveGeneralSettings);
  document.getElementById('btn-save-customization').addEventListener('click', saveCustomizationSettings);

  // Clear Logs
  document.getElementById('btn-clear-logs').addEventListener('click', async () => {
    if (confirm('Clear all activity logs?')) {
      const success = await ipcRenderer.invoke('clear-logs');
      if (success) {
        currentLogs = [];
        renderLogs();
        updateStats();
        renderDistributionBar();
      }
    }
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    await ipcRenderer.invoke('export-logs', 'csv');
  });

  // Export JSON
  document.getElementById('btn-export-json').addEventListener('click', async () => {
    await ipcRenderer.invoke('export-logs', 'json');
  });

  // Toggle Service
  document.getElementById('btn-toggle-service').addEventListener('click', async () => {
    const isActive = await ipcRenderer.invoke('toggle-watcher');
    updateWatcherStatusUI(isActive);
  });

  // Manual Scan
  const triggerManualScan = async (btnId) => {
    const btn = document.getElementById(btnId);
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Organizing...';
    btn.disabled = true;
    await ipcRenderer.invoke('trigger-manual-scan');
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Complete!';
      setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
    }, 1000);
  };

  document.getElementById('btn-manual-scan-dash').addEventListener('click', () => triggerManualScan('btn-manual-scan-dash'));
  document.getElementById('btn-manual-scan-settings').addEventListener('click', () => triggerManualScan('btn-manual-scan-settings'));

  // Undo Last Move on Dashboard
  document.getElementById('btn-undo-last-dash').addEventListener('click', async () => {
    const btn = document.getElementById('btn-undo-last-dash');
    const origHtml = btn.innerHTML;
    const res = await ipcRenderer.invoke('undo-move');
    if (res.success) {
      alert(`Restored "${res.fileName}" back to original location.`);
      renderLogs();
      updateStats();
    } else {
      alert(`Undo: ${res.message}`);
    }
  });

  // Open watch folder
  document.getElementById('btn-open-watch-folder').addEventListener('click', () => {
    const folders = currentSettings && currentSettings.watchFolders;
    if (folders && folders.length > 0) {
      shell.openPath(folders[0]).catch(err => alert('Could not open folder: ' + err.message));
    } else {
      alert('No folder configured.');
    }
  });

  // Open tracker text file
  document.getElementById('btn-open-tracker').addEventListener('click', async () => {
    await ipcRenderer.invoke('open-tracker-file');
  });

  // Logs search
  document.getElementById('input-log-search').addEventListener('input', (e) => {
    searchKeyword = e.target.value.toLowerCase().trim();
    renderLogs();
  });

  // Log filter badges
  const filterBadges = document.querySelectorAll('.filter-badge');
  filterBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      filterBadges.forEach(b => b.classList.remove('active'));
      badge.classList.add('active');
      activeFilter = badge.getAttribute('data-filter');
      renderLogs();
    });
  });
}
