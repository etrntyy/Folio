# Folio

An ebook library and reader for **EPUB, PDF and TXT** with a clean, quiet reading design. It runs entirely in your
browser: a Chromium extension on desktop, and an installable web app (PWA) on phones. No accounts, no server,
no dependencies to build. Everything is stored privately in your browser unless you turn on sync.

**Quick links:** [Download the extension (ZIP)](https://github.com/etrntyy/FolioReader/releases/latest/download/Folio-extension.zip) | [Open the web app](https://etrntyy.github.io/FolioReader/) | [Installation guide](INSTALL.md) | [Releases](https://github.com/etrntyy/FolioReader/releases)

## Features

**Library**
- Grid and list views, search, sort, favourites, ratings, tags, collections and reading status.
- Real covers: EPUB cover images and page 1 of PDFs; a standard centred placeholder otherwise.
- Progress on every book (EPUB and PDF). A **Bookmarks** section lists every bookmark across your library and
  opens the book at that spot.
- Backup and restore of all library data as a JSON file.

**Reader**
- Paged or scrolling layout, two-page spreads, five reader themes plus Auto (follows the browser), font, size,
  spacing and margin controls, optional **page-turn animation** (Slide or Flip).
- **Highlighter** (`H`): six colours plus any custom colour; notes on highlights; export highlights as Markdown.
- **Whole-book search** (`F`) with in-page match highlighting (`N` / `Shift+N`).
- **Bookmarks** (`B`) for EPUB and PDF, and a Notes panel (`M`) with a text filter and a **page / page-range filter**.
- EPUB pages are stable "book pages" that don't change with font size; PDFs use their real page numbers.

**Sync (optional, off by default)**
- Reading position, bookmarks, highlights, notes, ratings, tags and **removals** sync between devices;
  book files can optionally sync too. Most recent change wins per item.
- Providers: a folder on your computer (Drive/OneDrive/Dropbox/iCloud desktop apps), Google Drive, Dropbox,
  Microsoft OneDrive, Nextcloud, or any WebDAV server.
- Google, Dropbox and OneDrive need you to register a free app and paste its client ID (hints are shown in
  Folio's Sync page). Nextcloud/WebDAV need an app password.

**Look and feel**
- Follows the browser's light/dark theme by default, with an override and a custom accent colour.
- Responsive phone layout with tap/swipe page turns.

## Install

Full, step-by-step guides for every browser and device are in **[INSTALL.md](INSTALL.md)**. In short:

| Device | How |
|---|---|
| Chrome, Edge, Brave, Opera, Vivaldi, Arc (desktop) | Download the [latest release ZIP](https://github.com/etrntyy/FolioReader/releases/latest), extract it, open the browser's extensions page, turn on **Developer mode**, click **Load unpacked** and pick the folder. [Details](INSTALL.md#desktop-extension-chromium-browsers) |
| Firefox or Safari (desktop), or no extension wanted | Open **https://etrntyy.github.io/FolioReader/** and optionally install it as an app. [Details](INSTALL.md#web-app-on-a-computer) |
| Android | Open the web app address in Chrome, then menu > **Add to Home screen**. [Details](INSTALL.md#android) |
| iPhone / iPad | Open the web app address in Safari, then Share > **Add to Home Screen**. [Details](INSTALL.md#iphone-and-ipad) |

There is no Play Store or App Store app; the home-screen web app is the mobile app. Each install keeps its own
library on that device, so use **Sync** (or Backup/Restore) to share books and progress between devices.

To host your own copy, serve this folder from any HTTPS static host. For a quick local preview run
`python -m http.server` in this folder and open `http://localhost:8000/app.html` (extension-only features such
as the `identity` sign-in flow need the extension install).
## Updates
Folio checks this repository for a newer version (the `version` in `manifest.json`, at most every 12 hours; can
be switched off) and shows an **Update** badge under *About & updates*.
- **Phone / web app:** *Update* refreshes the offline copy and reloads.
- **Chrome extension (loaded unpacked):** Chrome can't replace an unpacked extension's files by itself, so
  *Update* asks you to pick the extension folder once, downloads the latest files from this repository into it,
  and reloads the extension. Your library is stored separately and is not touched.

To ship a release, bump `version` in `manifest.json` and push to `main`. Updating runs whatever is on `main`,
so only point your copy of Folio at a repository you trust (`REPO` in `js/update.js`).

## Keyboard shortcuts (reader)
`←` `→` / `Space` page · `T` contents · `F` search · `N` / `Shift+N` next / previous match · `H` highlighter ·
`B` bookmark · `M` notes · `Esc` back to library.

## Where the data lives
IndexedDB (`books`, `files`, `highlights`, `bookmarks`, `tombs`, `kv`) plus a few settings in localStorage. The
extension asks for `unlimitedStorage`, plus `identity` and API host access only for the optional cloud
providers.

## Project layout
```
app.html, app.css      library + reader UI
background.js          opens the library tab (extension)
manifest.json          Chromium extension manifest (MV3)
manifest.webmanifest   web-app manifest (phones)
sw.js, oauth.html      offline cache and OAuth pop-up helper (web app)
js/                    app.js, reader.js, pdf.js, epub.js, zip.js, db.js, sync.js, ui.js
lib/                   bundled pdf.js (Apache-2.0)
icons/                 app icons
```

## Third-party
PDF rendering uses [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), bundled in `lib/`.
The cover placeholder and UI use system fonts only.

## Support
Folio is free and open source. If you find it useful, you can [buy me a coffee](https://buymeacoffee.com/etrntyy) (optional).

## Status
Tested in a Chromium browser pane at desktop and phone sizes, and against a Nextcloud-style WebDAV server. Not yet
tested on real phones or in every browser listed above (the steps follow each browser's standard extension and
home-screen flows), and the Google Drive, Dropbox and OneDrive sign-in flows have not been tried against real
accounts.
