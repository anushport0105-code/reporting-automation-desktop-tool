# Version History

## v0.5 - LOCKED WORKING STATE

Stable working state recorded on 2026-07-12. Preserve this exact behavior as the v0.5 baseline.

- Retains the complete v0.4 browser selection, evidence capture, Phish.Report, compact UI, progress, and reset workflow.
- Saves Google Search, Landing Page, and AMP evidence as `1.png`, `2.png`, and `3.png` respectively.
- Captures each evidence image with the browser address bar, Windows taskbar, date, and time.
- Shows provider checkboxes for Phish.Report results and configured Cloudflare/GoDaddy reporting eligibility.
- Generates one professional phishing-report subject and body locally with Ollama `qwen3:4b`.
- Uses only `anushport0105@gmail.com` as the development Gmail recipient; production provider addresses are never inserted into the development draft.
- Opens Gmail in the existing controlled Brave/Chrome profile after visiting Google first.
- Fills recipient, subject, and body and attaches only available evidence files among `1.png`, `2.png`, and `3.png`.
- Maximizes the Gmail Compose panel and saves the completed draft evidence as `4.png`.
- Leaves the Gmail Send action exclusively to the user.
- Detects the Gmail send action using the confirmation notification or Compose closure.
- Opens Gmail Sent directly, refreshes it, opens the newest message, verifies its subject, and saves the opened sent-message evidence as `5.png`.
- Never attaches `4.png`, `5.png`, or unrelated folder files to the email.
- Reports whether Gmail confirmed sending and whether the sent-message screenshot was created; this does not claim recipient delivery.
- Clears provider selection, generated content, Gmail state, and active monitoring when the workspace is reset.
- Provides Windows installer and portable x64 distribution targets.

Do not remove or change this baseline unless a later version is explicitly requested.

## v0.4 - LOCKED WORKING STATE

Stable working state recorded on 2026-07-11. Preserve this exact behavior as the v0.4 baseline.

- Compact 420x590 companion UI with a numbered Browser/Profile, Launch, Case Details, and Capture workflow.
- Selects either Brave or Google Chrome and locks one browser/profile for the complete case.
- Uses normal local Brave profiles and a persistent tool-managed Chrome automation profile compatible with Chrome 136+.
- Opens Google with Indonesian language/region settings and restores results hidden by Brave cosmetic filters.
- Lets the user select and persist an evidence destination, enter a URL, and choose the Google result position.
- Saves evidence under `selected-folder/YYYY-MM-DD - sanitized-url/` with non-overwriting timestamped filenames.
- Captures full-desktop Google Search, Landing Page, and AMP Result images with browser address bar, Windows taskbar, date, and time.
- Hides the Reporting Automation window during desktop capture.
- Search evidence retains red numbered overlays around the Google query and chosen result.
- Shows real backend progress for browser launch, Search, Landing, AMP, Phish.Report analysis, and contact extraction.
- Shows only a green check for a saved screenshot and a red cross for a failed screenshot.
- Preserves successful Search and Landing evidence when a later Landing or AMP step fails.
- Supports Phishing, Cloaking, Stray Domain, and Death fishing case tabs after evidence capture.
- Submits the selected result URL to Phish.Report and extracts only actual `Report abuse to` destinations.
- Includes a header reset action that closes the controlled browser and clears the case while retaining saved preferences.
- Provides both Windows installer and portable distribution targets.

Not included in v0.4: provider checkboxes, configured abuse-email mappings, AI/local-model content generation, and Gmail compose/send preparation.

Do not remove or change this baseline unless a later version is explicitly requested.

### Post-v0.4 development

- Added provider checkboxes, configured Cloudflare/GoDaddy eligibility emails, local Ollama `qwen3:4b` combined report generation, a development-only recipient override, generated-content review, and controlled-browser Gmail draft preparation without automatic sending.

## v0.3 — LOCKED WORKING STATE

Stable working state recorded on 2026-07-11. Preserve this behavior as the v0.3 baseline.

- Retains the complete v0.2 Brave evidence-capture workflow.
- Shows Phishing, Cloaking, Stray Domain, and Death fishing tabs after Search, Landing, and AMP images are saved.
- The Phishing Email action opens a new tab in the same controlled Brave profile and visits Google first.
- Submits the URL from the selected Google search-result position at `https://phish.report/`.
- Waits for the generated Phish.Report analysis page.
- Reads only the “Report this website to” panel and its exact “Report abuse to” footer rows.
- Returns one actual external reporting destination per provider.
- Excludes Phish.Report provider-profile links, provider homepages, logo links, navigation, screenshots, and detection links.
- Displays the extracted provider reporting destinations inside the desktop tool.

Not included in v0.3: provider checkboxes, configured abuse-email mappings, AI/local-model content generation, and Gmail compose/send preparation. These were discussed only and remain unimplemented.

Distribution packaging produces a 64-bit Windows NSIS installer with desktop and Start Menu shortcuts plus a portable executable that runs without installation. Personal Brave profiles, cookies, logins, and evidence are never packaged.

Do not remove or change this baseline unless a later version is explicitly requested.

### Post-v0.3 development

- Added a real-time progress indicator for opening Brave, capturing search evidence, capturing the landing page, checking AMP, analyzing with Phish.Report, and extracting reporting contacts.
- Added a persistent evidence-path selector and replaced the case-name field with URL input. Evidence is saved under `selected-folder/YYYY-MM-DD - sanitized-url/`.
- Rebuilt the interface as a responsive three-stage workspace for Browser, Evidence, and Reporting, with compact cards, correct action gating, connection state, responsive resizing, and room for future modules.
- Resized the interface into a compact 420×590 companion window with internal scrolling for expanded results.
- Brave now opens the clean Google Indonesia homepage instead of an empty `/search?q=` route, preventing blank manually submitted result pages.
- Added a Google-only workaround for Brave cosmetic-filter lists that hide the complete `#rcnt` results wrapper with a user-agent `display: none !important` rule.
- Google Search, Landing Page, and AMP Result evidence now capture the complete desktop display containing Brave, including the Windows taskbar clock; the tool window is hidden during capture.
- Added a finished-result screenshot checklist using only `✓` for saved and `×` for failed. AMP failures no longer discard or mislabel a successful Landing capture.
- Added a browser selector before profile selection with Brave and Google Chrome support. One browser/profile is locked and used for the complete case.
- Chrome uses a persistent tool-managed profile in a non-standard user-data directory to comply with Chrome 136+ remote-debugging restrictions. Launch errors now retain their underlying technical reason.
- The Capture button now states whether browser connection, save path, or URL is missing instead of appearing silently disabled.
- Added a compact header reset action that closes the controlled browser, clears the active case and results, unlocks browser/profile selection, and retains saved user preferences.

## v0.2 — LOCKED WORKING STATE

Stable working state recorded on 2026-07-10. Preserve this behavior as the v0.2 baseline.

- Uses installed Brave only, with a selectable local Brave profile.
- Opens Google using Indonesian language and region settings.
- Captures Google search-result evidence with red numbered overlays.
- Captures landing-page evidence after the search-result capture.
- Captures the tested AMP page when AMP is available.
- Shows a clear tool message when no AMP screenshot can be captured.
- Every saved evidence image includes the complete Brave window, including the tab strip and address bar.
- Saves screenshot images only; metadata JSON files are not created.
- Adds timestamped screenshot sets to the same case folder without replacing earlier evidence.
- Saves evidence under `Documents/Reporting-Automation/google-search/YYYY-MM-DD/case-name/`.

Do not remove or change this baseline unless a later version is explicitly requested.

### Post-v0.2 development

- After Search, Landing, and AMP images are all saved, the result panel shows four selectable tabs: Phishing, Cloaking, Stray Domain, and Death fishing.
- The Phishing tab provides an Email action that opens a new tab in the controlled Brave session, visits Google first, submits the selected Google-result URL at `phish.report`, and displays all reporting websites and abuse emails shown by the generated analysis.
- Phish.Report extraction is restricted to the “Report this website to” provider panel and its “Report abuse to” rows.
- Provider profile links under `phish.report/contacts/` are excluded so each provider produces only its actual external reporting destination.
- Extraction starts at each exact “Report abuse to” label and stays within that footer row, excluding provider homepage and logo links.

## v0.1

Stable working stage recorded on 2026-07-09.

- Uses installed Brave with selectable local Brave profile.
- Opens Google in Indonesian language/region settings.
- Captures Google search result evidence.
- Captures landing page evidence after the search result capture.
- Captures AMP page screenshot from Google AMP Test when AMP is available.
- Shows a tool message when no AMP screenshot can be captured.
- Saves screenshot images only; metadata JSON files are not needed.
- Adds new timestamped screenshot sets in the same folder without replacing older evidence.
