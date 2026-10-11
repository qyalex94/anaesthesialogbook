# Clinical Case Logbook

A static personal logbook hosted on GitHub Pages.

- `index.html`: opens the Anaesthesia Log directly, preserving section links.
- `navigation.js`: shared bottom navigation for Log, Entries, Census and Export.
- `anaesthesia.html`: original Anaesthesia form and existing storage/sync identifiers.
- `critical-care.html`: separate ICU log with case details, interventions, procedures, learning outcomes and optional images.
- `regional-anaesthesia.html`: future-development placeholder.

Each active logbook supports case editing, search, date filters, CSV export, full JSON backup/import and Google Drive sync. Critical Care uses its own local storage, image database, backup format and Drive folder. Existing Anaesthesia records remain available on the same origin; no clearing or migration is required. Census reflects the current device; open Export in each logbook to connect Drive and sync other devices. Switching bottom sections keeps unsaved form values and Entries filters. The top navigation switches logbooks, retaining the selected section; save a case before changing logbooks.

Serve the directory with a static HTTP server to preview. Google OAuth uses the existing public Client ID; localhost sync requires an authorized origin configured in Google Cloud. No patient records belong in this repository.
