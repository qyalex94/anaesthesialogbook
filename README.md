# Clinical Case Logbook

A static personal logbook hosted on GitHub Pages.

- `index.html`: opens the Anaesthesia Log directly, preserving section links.
- `navigation.js`: shared bottom navigation for Log, Entries, Census and Export.
- `anaesthesia.html`: original Anaesthesia form and existing storage/sync identifiers.
- `critical-care.html`: ICU log with its existing case details, interventions, procedures, learning outcomes, images and storage identifiers.
- `aps-pain.html`: pain services, diagnosis, management, interventions, learning notes and place; incomplete records can be saved as drafts.
- `cme.html`: attended/presented sessions, title and place, and role.
- `duties-rotation.html`: one-tap duty logging, monthly counts, and an optional rotation/posting; saved duties can be edited.
- `activity-logbook.js` / `activity-sync.js`: shared forms, entries, exports, revision history, backups and Drive sync for the three additional logbooks.
- `regional-anaesthesia.html`: legacy future-development placeholder, accessible by direct link. The top navigation now uses the five active logbooks.

Each active logbook supports case editing, search, date filters, CSV export, full JSON backup/import and Google Drive sync. Critical Care uses its own local storage, image database, backup format and Drive folder. Existing Anaesthesia records remain available on the same origin; no clearing or migration is required. Census reflects the current device. The shared Export page lets you select any combination of the five logbooks for one CSV or full backup, and one Google connection syncs all five categories. Existing Drive folders, revision histories and image stores are preserved. Auto-sync runs on opening or returning to the logbook, after saving, and after reconnection while Google access is valid. A SharedWorker keeps short-lived access in memory across supported open pages; access is never saved in browser storage. After access expires or the browser closes, Google may require one reconnect for all categories. Browsers without SharedWorker support retain the connection for the current page only. Switching bottom sections keeps unsaved form values and Entries filters. The top navigation switches logbooks, retaining the selected section; save a case before changing logbooks.

Serve the directory with a static HTTP server to preview. Google OAuth uses the existing public Client ID; localhost sync requires an authorized origin configured in Google Cloud. No patient records belong in this repository.

The APS & Pain, CME, and Duties starting fields are adapted from Syazie’s logbook (https://syazie93.github.io/anaes.logbook/), with the existing white theme and soft colour accents. Each new logbook uses its own storage key, backup format and Drive folder marker.

Run `node tests/activity-logbooks.test.cjs` for save, simulated two-device sync, concurrent edits, backup round-trips and category isolation checks. Tests use fictional data and a local Drive substitute; they do not access a Google account.

Additional sync checks: `node tests/unified-sync.test.cjs` and `node tests/drive-session.test.cjs`. These tests use fictional entries and a simulated Drive; they never access a Google account.
