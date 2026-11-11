# Installing Folio

[Back to the README](README.md)

## Quick links

| What | Link |
|---|---|
| **Download the desktop extension (ZIP)** | https://github.com/etrntyy/FolioReader/releases/latest/download/Folio-extension.zip |
| **Download the Firefox add-on (ZIP)** | https://github.com/etrntyy/FolioReader/releases/latest/download/Folio-firefox.zip |
| **Open the web app** (phones, tablets, any browser) | https://etrntyy.github.io/FolioReader/ |
| All releases and release notes | https://github.com/etrntyy/FolioReader/releases |
| Source code (ZIP) | https://github.com/etrntyy/FolioReader/archive/refs/heads/main.zip |
| Project page and README | https://github.com/etrntyy/FolioReader |

Folio runs in two ways. Pick the one that fits your device.
| You want to use Folio on... | Use this | Section |
|---|---|---|
| Desktop Chrome, Edge, Brave, Opera, Vivaldi, Arc (any Chromium browser) | The browser extension | [Desktop extension](#desktop-extension-chromium-browsers) |
| Desktop Firefox | The Firefox add-on | [Firefox](#firefox-extension) |
| Any computer, including Safari | The web app | [Web app on a computer](#web-app-on-a-computer) |
| Android phone or tablet | The web app, added to your home screen | [Android](#android) |
| iPhone or iPad | The web app, added to your home screen | [iPhone and iPad](#iphone-and-ipad) |

There is no Play Store or App Store app. On phones, "installing" the web app puts a Folio icon on your home
screen that opens full screen and works offline. That is the mobile app.

Your library is stored **on the device and browser where you add books**. Each install has its own separate
library. To share books, progress and highlights between devices, turn on [Sync](#keeping-devices-in-sync).

---

## Desktop extension (Chromium browsers)

Works in Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi and Arc. It does **not** run in Firefox (use the [Firefox add-on](#firefox-extension)) or Safari
(use the [web app](#web-app-on-a-computer)).

### Step 1: get the files

Choose one:

**A. Download the release ZIP (easiest)**
1. Click this direct download link: https://github.com/etrntyy/FolioReader/releases/latest/download/Folio-extension.zip
   (It always gives the newest version. All releases are listed at https://github.com/etrntyy/FolioReader/releases)
2. Save the file (about 0.5 MB).
3. Right-click the downloaded ZIP and **Extract All** (Windows) or double-click it (Mac). Do not open it from inside the ZIP viewer.
4. Move the extracted folder somewhere permanent, for example `Documents/Folio`. The folder you pick must
   contain a file named `manifest.json` directly inside it.

**B. Without a release: the source ZIP**
Open https://github.com/etrntyy/FolioReader/archive/refs/heads/main.zip to download the latest source, then extract it. (Or open https://github.com/etrntyy/FolioReader, click the green **Code** button, then **Download ZIP**.)

**C. With Git**
```bash
git clone https://github.com/etrntyy/FolioReader.git
```

> Do not delete or move this folder afterwards. The browser runs Folio straight from it.

### Step 2: load it into your browser

All Chromium browsers work the same way: open the extensions page, switch on **Developer mode**, then choose
**Load unpacked** and select the Folio folder.

**Google Chrome**
1. Type `chrome://extensions` in the address bar and press Enter.
2. Turn on **Developer mode** (switch in the top right).
3. Click **Load unpacked**, select the Folio folder, then **Select Folder**.
4. Click the puzzle-piece icon in the toolbar and pin **Folio**.

**Microsoft Edge**
1. Go to `edge://extensions`.
2. Turn on **Developer mode** (left sidebar, near the bottom).
3. Click **Load unpacked** and select the Folio folder.
4. Click the puzzle-piece icon and pin **Folio**.

**Brave**
1. Go to `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the Folio folder.
4. Click the puzzle-piece icon and pin **Folio**.

**Opera**
1. Go to `opera://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the Folio folder.
4. Click the cube icon in the toolbar (the Extensions menu) and pin **Folio**.

**Vivaldi**
1. Go to `vivaldi://extensions`.
2. Turn on **Developer mode** (top right), click **Load unpacked** and select the Folio folder.

**Arc and other Chromium browsers**
Open the browser's extensions page (usually `<browsername>://extensions`), turn on Developer mode and choose
Load unpacked.

### Step 3: open Folio
Click the Folio icon in the toolbar. The library opens in a new tab. Choose **Add Books** or drag EPUB, PDF
or TXT files onto the page.

### Updating the extension
Open **About & updates** in the sidebar. If a new version is available, press **Update**. The first time, you
are asked to pick the same Folio folder; Folio then downloads the new files into it and reloads itself. Your
library is stored separately and is not touched.

Manual update: download the new ZIP (or `git pull`), replace the files in your Folio folder, then press the
reload icon on Folio's card in your browser's extensions page.

### Uninstalling the extension
Open the extensions page, find Folio and click **Remove**. This also deletes the books stored by the
extension. Export a backup first (**... menu > Export library data**) if you want to keep them.

### If something goes wrong
- **"Manifest file is missing or unreadable":** you picked the wrong folder. Select the folder that has
  `manifest.json` directly inside it, not its parent, and not a folder inside the ZIP-named wrapper.
- **The extension disappeared or shows an error after a restart:** the folder was moved or deleted. Put it
  back, or load the new location with Load unpacked.
- **A banner asks you to turn off developer mode extensions:** keep Developer mode on. This is how Chromium
  browsers treat extensions loaded from a folder.
- **Nothing opens when you click the icon:** make sure the extension is switched on in the extensions page.

---

## Firefox extension

Firefox does not run the Chromium package, so Folio has a separate Firefox build with the same features.
It needs **Firefox 128 or newer** on a computer.

**Download:** https://github.com/etrntyy/FolioReader/releases/latest/download/Folio-firefox.zip
(the same file is also attached as `Folio-firefox.xpi`; an .xpi is just a zip with another name)

Firefox only keeps add-ons that Mozilla has signed, and Folio is not listed on addons.mozilla.org yet. Pick the
option that fits you:

### Option 1: try it now (temporary, any Firefox)
1. Download `Folio-firefox.zip` and extract it (right-click > **Extract All** on Windows, double-click on Mac).
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select the file `manifest.json` inside the extracted folder.
4. Click the puzzle-piece icon in the toolbar to find **Folio** and pin it. Click it to open your library.

Firefox removes temporary add-ons when it closes, so repeat steps 2 and 3 after each restart. Export a backup
first (**... menu > Export library data**) if your library matters.

### Option 2: permanent, unsigned (Firefox Developer Edition, Nightly, ESR or Unbranded)
These editions allow add-ons that Mozilla has not signed. Regular Firefox does not.
1. Open `about:config` and set `xpinstall.signatures.required` to `false`.
2. Open `about:addons`, click the gear icon, choose **Install Add-on From File...** and select
   `Folio-firefox.xpi` (or the zip).

### Option 3: permanent in regular Firefox (signed by Mozilla)
Mozilla signs add-ons for free, even ones you only distribute yourself:
1. Make a free account at https://addons.mozilla.org/developers/ .
2. Choose **Submit a New Add-on**, then **On your own** (unlisted).
3. Upload `Folio-firefox.zip`. Mozilla checks it automatically and returns a signed `.xpi`, usually within minutes.
4. Open the signed `.xpi` in Firefox to install it. It survives restarts.

You repeat step 3 for each new version, because Firefox cannot update unlisted add-ons for you.

### Firefox on Android
Firefox for Android only installs add-ons from Mozilla's approved list, so use the
[web app](#android) instead: open https://etrntyy.github.io/FolioReader/ and choose menu > **Install**.

### Notes for the Firefox add-on
- **Updates:** Firefox cannot replace an installed add-on's files by itself, so on the **About & updates** page the
  button becomes **Download**. Install the new file the same way you installed this one.
- **Folder sync:** the "folder on this computer" sync option is hidden, because Firefox cannot write to folders you
  pick. The cloud and server options (Google Drive, Dropbox, OneDrive, Nextcloud, WebDAV) work as usual.
- **Permissions:** Firefox asks you to allow Folio to contact your sync provider the first time you use it.
- **Uninstall:** open `about:addons`, find Folio and choose **Remove**. This also deletes the books the add-on stores.

### Building the Firefox package yourself
```powershell
git clone https://github.com/etrntyy/FolioReader.git
cd FolioReader
powershell -ExecutionPolicy Bypass -File scripts\build-firefox.ps1
```
This writes `dist/Folio-firefox.zip` and `dist/Folio-firefox.xpi`. (Without PowerShell: copy
`manifest.firefox.json` over `manifest.json` in a copy of the folder, drop `sw.js`, `oauth.html`, `index.html` and
`manifest.webmanifest`, and zip the rest with forward-slash paths.)

---

## Web app on a computer
Use this on Firefox or Safari, or if you prefer not to load an extension. It works in any modern browser.

1. Open **https://etrntyy.github.io/FolioReader/** (direct link: [open Folio](https://etrntyy.github.io/FolioReader/))
2. Optional: install it as an app so it gets its own window and works offline.
   - **Chrome:** click the install icon at the right end of the address bar, or menu (three dots) >
     **Cast, save and share** > **Install page as app**.
   - **Edge:** menu (three dots) > **Apps** > **Install this site as an app**.
   - **Brave:** menu > **Install Folio...** (or the install icon in the address bar).
   - **Opera:** menu > **Install Folio...** if shown; otherwise just bookmark the page.
   - **Safari on Mac:** **File > Add to Dock**.
   - **Firefox:** Firefox on computers does not install web apps; use it in a normal tab or bookmark it.

The web app updates itself whenever a new version is published. The library lives in that browser and is
separate from any extension install.

---

## Android

1. Open **https://etrntyy.github.io/FolioReader/** in your browser (direct link: [open Folio](https://etrntyy.github.io/FolioReader/)).
2. Add it to your home screen:
   - **Chrome:** menu (three dots) > **Add to Home screen** (or **Install app**) > **Install**.
   - **Samsung Internet:** menu > **Add page to** > **Home screen**.
   - **Firefox:** menu > **Install**.
   - **Brave or Opera:** menu > **Add to Home screen**.
3. Open Folio from the new icon. It runs full screen and works without a connection.
4. Tap the menu button in the top left, then **Add Books** to pick files from your phone.

Tips: tap the right or left side of the page to turn it, tap the middle to show or hide the toolbars, swipe to
turn pages, and long-press a word to highlight.

## iPhone and iPad

Use **Safari** (other iOS browsers cannot add web apps to the home screen).

1. Open **https://etrntyy.github.io/FolioReader/** in Safari (direct link: [open Folio](https://etrntyy.github.io/FolioReader/)).
2. Tap the **Share** button (square with an arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open Folio from the new home-screen icon, not from Safari.

Important: open it from the home-screen icon. Safari can clear storage for websites you have not visited for a
while, but not for apps added to the home screen. Even so, turn on [Sync](#keeping-devices-in-sync) or export
backups regularly, because iOS can still remove data if the device is very low on space.

---

## Keeping devices in sync

Open **Sync** in the sidebar (under Cloud) and pick where to store your data: a folder on your computer, Google
Drive, Dropbox, Microsoft OneDrive, Nextcloud, or any WebDAV server. Reading progress, bookmarks, highlights,
notes, ratings and removals are shared between devices. Book files can optionally be shared too.

Sync is off until you connect a provider and a first sync succeeds. Google Drive, Dropbox and OneDrive need
you to register a free app with the provider and paste its client ID (the Sync page shows exactly what to
do). Nextcloud and WebDAV need an app password. On phones, use Google Drive, Dropbox, OneDrive, Nextcloud or
WebDAV; the "folder on this computer" option is for desktop Chromium only.

## Moving your library without Sync

**... menu > Export library data (backup)** saves a file with your progress, bookmarks and highlights.
**Restore from backup...** loads it on another device. Add the same book files first; Folio matches them to
the backup automatically.

## Updating

| Where you use Folio | How it updates |
|---|---|
| Web app and phone app | Automatically. Press **Update** under About & updates if you see the badge. |
| Chromium extension | **About & updates > Update** (pick the Folio folder once), or replace the files by hand and reload the extension. |
| Firefox add-on | **About & updates > Download**, then install the new file the same way as before. |

Update checks only fetch the version number from this repository, at most every 12 hours, and can be turned off
on the About & updates page.

---

[Back to the README](README.md) | [All releases](https://github.com/etrntyy/FolioReader/releases) | [Open the web app](https://etrntyy.github.io/FolioReader/)
