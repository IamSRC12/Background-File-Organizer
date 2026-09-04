const path = require('path');
const fs = require('fs-extra');

// Setup test directories
const testDownloads = path.resolve(__dirname, 'test-downloads');
const testUserData = path.resolve(__dirname, 'test-userdata');

fs.ensureDirSync(testDownloads);
fs.ensureDirSync(testUserData);

console.log(`Setting up test environments:`);
console.log(`  - Downloads: ${testDownloads}`);
console.log(`  - UserData:  ${testUserData}`);

// Clean out folders from previous run
fs.emptyDirSync(testDownloads);
fs.emptyDirSync(testUserData);

// Mock Electron BEFORE requiring main.js
const mockElectron = {
  app: {
    getPath: (name) => {
      if (name === 'downloads') return testDownloads;
      if (name === 'userData') return testUserData;
      if (name === 'documents') return testUserData;
      return __dirname;
    },
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {},
    setLoginItemSettings: (settings) => {
      console.log(`[MOCK ELECTRON] setLoginItemSettings:`, settings);
    }
  },
  BrowserWindow: class {
    constructor() {
      this.webContents = {
        send: (channel, data) => {},
        setWindowOpenHandler: () => {}
      };
    }
    loadFile() {}
    once(event, callback) { if (event === 'ready-to-show') callback(); }
    on() {}
    show() {}
    focus() {}
    hide() {}
  },
  Menu: {
    buildFromTemplate: () => ({})
  },
  Tray: class {
    constructor(icon) {}
    setToolTip() {}
    setContextMenu() {}
    on() {}
  },
  ipcMain: {
    handle: (channel, handler) => {}
  },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true }),
    showSaveDialog: () => Promise.resolve({ filePath: null })
  },
  shell: {
    openPath: () => Promise.resolve(),
    showItemInFolder: () => {}
  },
  Notification: class {
    constructor(opts) {
      this.title = opts.title;
      this.body = opts.body;
    }
    show() {
      console.log(`[MOCK NOTIFICATION] "${this.title}" | "${this.body}"`);
    }
    static isSupported() { return true; }
  }
};

// Inject mock into require cache
require.cache[require.resolve('electron')] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: mockElectron
};

// Require our application files
const settingsManager = require('./settings');
require('./main');

// Get formatted date string: "DD Month YYYY" (e.g. 31 August 2026)
function getFormattedDate() {
  const date = new Date();
  const day = date.getDate();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${day} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
}

const dateStr = getFormattedDate();

// Test Execution Flow
async function runTests() {
  console.log('\n--- 1. Testing Basic File Detection & Categorization (Move Mode) ---');

  // Create sample files
  const songFile = path.join(testDownloads, 'cool_song.mp3');
  const videoFile = path.join(testDownloads, 'epic_movie.mp4');
  const docFile = path.join(testDownloads, 'notes.txt');
  const codeFile = path.join(testDownloads, 'app.js');
  const designFile = path.join(testDownloads, 'model.blend');
  const unknownFile = path.join(testDownloads, 'database.db');

  console.log('Writing test files...');
  fs.writeFileSync(songFile, 'dummy mp3 data');
  fs.writeFileSync(videoFile, 'dummy mp4 data');
  fs.writeFileSync(docFile, 'dummy txt data');
  fs.writeFileSync(codeFile, 'console.log("hello");');
  fs.writeFileSync(designFile, 'dummy blend 3d data');
  fs.writeFileSync(unknownFile, 'dummy database data');

  console.log('Waiting 3.5 seconds for organizer to detect and process...');
  await new Promise(resolve => setTimeout(resolve, 3500));

  // Verify paths: [testDownloads]/[dateStr]/[Category]/[Extension]/[File]
  const expectedSongPath = path.join(testDownloads, dateStr, 'Music', 'mp3', 'cool_song.mp3');
  const expectedVideoPath = path.join(testDownloads, dateStr, 'Videos', 'mp4', 'epic_movie.mp4');
  const expectedDocPath = path.join(testDownloads, dateStr, 'Documents', 'txt', 'notes.txt');
  const expectedCodePath = path.join(testDownloads, dateStr, 'Code', 'js', 'app.js');
  const expectedDesignPath = path.join(testDownloads, dateStr, 'Design', 'blend', 'model.blend');
  const expectedUnknownPath = path.join(testDownloads, dateStr, 'Misc', 'db', 'database.db');

  const songMoved = fs.existsSync(expectedSongPath);
  const videoMoved = fs.existsSync(expectedVideoPath);
  const docMoved = fs.existsSync(expectedDocPath);
  const codeMoved = fs.existsSync(expectedCodePath);
  const designMoved = fs.existsSync(expectedDesignPath);
  const unknownMoved = fs.existsSync(expectedUnknownPath);

  console.log(`Verifications:`);
  console.log(`  - Music organized: ${songMoved ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Video organized: ${videoMoved ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Document organized: ${docMoved ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Code organized: ${codeMoved ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Design organized: ${designMoved ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Misc organized: ${unknownMoved ? '✅ YES' : '❌ NO'}`);

  if (!songMoved || !videoMoved || !docMoved || !codeMoved || !designMoved || !unknownMoved) {
    console.error('❌ Basic categorization test failed!');
    process.exit(1);
  }

  console.log('\n--- 2. Testing Duplicate Handling (Rename) ---');
  console.log('Creating duplicate video file: epic_movie.mp4');
  fs.writeFileSync(videoFile, 'different mp4 content');

  console.log('Waiting 3.5 seconds for duplicate to process...');
  await new Promise(resolve => setTimeout(resolve, 3500));

  const expectedDuplicatePath = path.join(testDownloads, dateStr, 'Videos', 'mp4', 'epic_movie(1).mp4');
  const duplicateExists = fs.existsSync(expectedDuplicatePath);
  console.log(`  - Duplicate renamed to (1): ${duplicateExists ? '✅ YES' : '❌ NO'}`);

  if (!duplicateExists) {
    console.error('❌ Duplicate handling test failed!');
    process.exit(1);
  }

  console.log('\n--- 3. Testing Incomplete Download Ignoring ---');
  const tempDownloadFile = path.join(testDownloads, 'big_file.zip.crdownload');
  console.log('Creating Chrome incomplete download file: big_file.zip.crdownload');
  fs.writeFileSync(tempDownloadFile, 'downloading chunk 1...');

  console.log('Waiting 3 seconds (should ignore it)...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  const tempOrganizedExists = fs.existsSync(path.join(testDownloads, dateStr, 'Misc', 'crdownload', 'big_file.zip.crdownload'));
  console.log(`  - Temp crdownload file ignored: ${!tempOrganizedExists ? '✅ YES' : '❌ NO'}`);

  if (tempOrganizedExists) {
    console.error('❌ Incomplete download ignoring failed!');
    process.exit(1);
  }

  console.log('\n--- 4. Testing Undo History Recording ---');
  const undoHistory = settingsManager.getUndoHistory();
  console.log(`  - Undo history contains ${undoHistory.length} recorded operations: ${undoHistory.length > 0 ? '✅ YES' : '❌ NO'}`);

  if (undoHistory.length === 0) {
    console.error('❌ Undo history tracking failed!');
    process.exit(1);
  }

  console.log('\n--- 5. Testing Logs Verification ---');
  const logs = settingsManager.getLogs();
  console.log(`Total logs in system: ${logs.length}`);
  const hasSuccessLogs = logs.some(log => log.status === 'success');
  console.log(`  - Log backend contains success entries: ${hasSuccessLogs ? '✅ YES' : '❌ NO'}`);

  if (!hasSuccessLogs) {
    console.error('❌ Logging backend test failed!');
    process.exit(1);
  }

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');

  // Clean up and exit
  console.log('\nCleaning up test folders...');
  fs.removeSync(testDownloads);
  fs.removeSync(testUserData);

  console.log('Done. Exiting process.');
  process.exit(0);
}

setTimeout(() => {
  runTests().catch(err => {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  });
}, 1000);
