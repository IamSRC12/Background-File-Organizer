# Background-File-Organizer

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
</p>

<p align="center"><b>Your Downloads folder, organized before you look.</b></p>

<p align="center">
  <a href="#-getting-started">🚀 Getting Started</a> · <a href="#-project-structure">📁 Structure</a> · <a href="#-license">📄 License</a>
</p>

---

## Overview

**Sortify** is a silent background watcher that automatically categorizes and moves downloads and desktop files by extension. Built as an Electron desktop app.

## 📥 Download

Grab the latest Windows build from the [**Releases**](https://github.com/IamSRC12/Background-File-Organizer/releases) page:

- **Sortify Setup 1.0.0.exe** — installer (Start Menu / desktop shortcuts)
- **Sortify 1.0.0.exe** — portable, no install

## ✨ Features

- Watches folders in real time and sorts files by extension into categories
- Custom categories, colors and icons with a live path preview
- Configurable folder templates, duplicate handling, filters and renaming
- Activity log with one-click undo and CSV/JSON export
- **Light / dark theme** (warm golden light, near-black dark)
- Runs silently in the background / system tray

## 🚀 Getting Started

```bash
npm install
npm start          # launch Sortify
npm run dist       # build the Windows installer (dist/)
```

## 📁 Project Structure

```
Background-File-Organizer/
├── assets/              # app icon
├── ui/                  # renderer (index.html, renderer.js, style.css)
├── main.js              # Electron main process, file watcher & IPC
├── settings.js          # settings persistence
├── package.json
└── README.md
```

## 📄 License

© 2026 Shlok Chandak ([@IamSRC12](https://github.com/IamSRC12)). All rights reserved.
This repository is public for portfolio and reference purposes.

---

<p align="center">Built by <a href="https://github.com/IamSRC12">@IamSRC12</a></p>
