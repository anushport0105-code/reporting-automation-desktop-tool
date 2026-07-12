# Reporting Automation Desktop Tool

Current release: **v0.5**

Local Electron app for capturing phishing-site evidence screenshots for security and takedown reporting.

The tool uses an installed Brave Browser or Google Chrome profile. It does not use bundled Chromium for evidence capture.

## Install

```powershell
npm install
npx playwright install chromium
```

## Run

```powershell
npm run dev
```

## Local report generation

Install Ollama, start it, and install the required model:

```powershell
ollama pull qwen3:4b
```

Generated phishing-report drafts are prepared locally. In the current development build Gmail drafts are always addressed only to `anushport0105@gmail.com`; configured provider emails are used only to determine which providers are eligible. The tool never clicks Gmail's Send button.

## Build

```powershell
npm run build
```

## Create a Windows installer

```powershell
npm run dist:win
```

The distributable files are written to:

- `release/Reporting-Automation-Setup-0.5.0.exe` — installs the application and creates shortcuts.
- `release/Reporting-Automation-Portable-0.5.0.exe` — runs directly without installation.

The recipient must use 64-bit Windows, install Brave Browser or Google Chrome, select one browser and a local profile in the app, and sign into Phish.Report in that profile. User profiles, cookies, logins, evidence, and API credentials are not included in the installer.

Chrome 136 and later do not permit remote debugging of Chrome's normal user-data directory. The Chrome option therefore uses a separate persistent `Reporting Automation Profile`. Sign into Google and Phish.Report once in that controlled Chrome profile; later sessions reuse it. This does not modify or package the user's normal Chrome profiles.

## How To Test

1. Run `npm run dev`.
2. Select Brave or Google Chrome and a profile, then click the Open Browser button.
3. In the controlled browser, manually perform the Google search for the suspected phishing result.
4. Select an evidence destination, enter the URL, and set the Google result position, such as `1`.
5. Click `Capture Search`.
6. Confirm that the Google result screenshot is saved under:

```text
selected-folder/YYYY-MM-DD - website-url/
```

7. Click `Landing + AMP`.
8. Confirm the same folder contains screenshot images:

```text
google-search-YYYY-MM-DDTHH-MM-SS-sssZ.png
landing-page-YYYY-MM-DDTHH-MM-SS-sssZ.png
amp-page-YYYY-MM-DDTHH-MM-SS-sssZ.png
```

If no AMP page is available, the app shows a message and does not save an AMP screenshot.

Each new capture adds a new timestamped image set in the same folder. Existing evidence images are not replaced.

9. Click `Open Folder` and confirm the saved folder opens.

The screenshot should contain the complete desktop display, including the browser address bar and Windows taskbar clock. Search evidence also contains a red box and marker `1` around the Google search input, plus a red box and marker `2` around the selected search result.

If the browser does not open, close all windows for that browser first. Brave and Chrome lock logged-in profiles while running, and Playwright cannot control the same local profile until the lock is released.
