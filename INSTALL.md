# Installing Folio

Folio runs in two ways. Pick the one that fits your device.

| You want to use Folio on... | Use this | Section |
|---|---|---|
| Desktop Chrome, Edge, Brave, Opera, Vivaldi, Arc (any Chromium browser) | The browser extension | [Desktop extension](#desktop-extension-chromium-browsers) |
| Any computer, including Firefox and Safari | The web app | [Web app on a computer](#web-app-on-a-computer) |
| Android phone or tablet | The web app, added to your home screen | [Android](#android) |
| iPhone or iPad | The web app, added to your home screen | [iPhone and iPad](#iphone-and-ipad) |

There is no Play Store or App Store app. On phones, "installing" the web app puts a Folio icon on your home
screen that opens full screen and works offline. That is the mobile app.

Your library is stored **on the device and browser where you add books**. Each install has its own separate
library. To share books, progress and highlights between devices, turn on [Sync](#keeping-devices-in-sync).

---

## Desktop extension (Chromium browsers)

Works in Google Chrome, Microsoft Edge, Brave, Opera, Vivaldi and Arc. It does **not** work in Firefox or Safari
(use the [web app](#web-app-on-a-computer) there).

### Step 1: get the files

Choose one:

**A. Download the release ZIP (easiest)**
1. Open https://github.com/etrntyy/FolioReader/releases/latest
2. Under **Assets**, click **Folio-v1.3.0.zip** (the file name shows the current version).
3. Right-click the downloaded ZIP and **Extract All** (Windows) or double-click it (Mac). Do not open it from inside the ZIP viewer.
4. Move the extracted folder somewhere permanent, for example `Documents/Folio`. The folder you pick must
   contain a file named `manifest.json` directly inside it.

**B. Without a release: the source ZIP**
On https://github.com/etrntyy/FolioReader click the green **Code** button, then **Download ZIP**, and extract it.

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

## Web app on a computer

Use this on Firefox or Safari, or if you prefer not to load an extension. It works in any modern browser.

1. Open **https://etrntyy.github.io/FolioReader/**
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

1. Open **https://etrntyy.github.io/FolioReader/** in your browser.
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

1. Open **https://etrntyy.github.io/FolioReader/** in Safari.
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

Update checks only fetch the version number from this repository, at most every 12 hours, and can be turned off
on the About & updates page.
