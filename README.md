# AJM Admin (Android)

A native Android app for the **Admin** (registrations) and **Media Office**
panels that already exist as `admin.html` / `media.html` on ajmfamily.site.
It talks to the exact same backend — the Google Apps Script Web App bound to
the "Registrations" sheet — so nothing on the website or the sheet needs to
change. This app is a second client for that backend, not a replacement.

## Project layout

- **`:core`** — plain Kotlin/JVM module, no Android dependency. Models,
  the API client (one function per `action` in the Apps Script, e.g.
  `setStatus`, `bulkDelete`, `mediaSave`), and the business logic ported
  from the two HTML pages: phone-based duplicate detection, CSV export,
  the content-log's per-day cell math, stock-summary math, and the weekly
  content plan. Covered by unit tests (`./gradlew :core:test`).
- **`:app`** — the Android app itself: Jetpack Compose UI, Material 3,
  navigation, and the Android-specific glue (encrypted key storage,
  OkHttp transport, WhatsApp/share intents).

## First-time setup

1. Open this project in Android Studio (Koala or newer) and let it sync.
2. Run the app on a device or emulator (minSdk 26 / Android 8.0+).
3. On the **Settings** screen (gear icon on the home screen), paste the
   deployed Apps Script **Web App URL** — the same `.../exec` URL that
   `js/reglog.js` defines as `REG_LOG_URL` on the website. This is the only
   thing that's configured at build time on the web; here it's a runtime
   setting instead, stored on-device, **so the URL is never hardcoded into
   this public repo**.
4. Open **Admin** or **Media Office** and enter the same key you already
   use on `admin.html` / `media.html` (`ADMIN_KEY` / `MEDIA_KEY` in
   `apps-script.gs`). Unlike the web gate, the key is remembered on this
   device (encrypted with `EncryptedSharedPreferences`) until you tap
   "Log out".

## What's included

**Admin (Registrations)**
- Stats, source filters, the Duplicates view, search and sort
- Per-row status change and delete; multi-select bulk status / delete /
  move-to-history / restore-from-history
- History: every Zoom-link send and every past (archived) event
- "Send Zoom Link": pick Confirmed recipients, edit the `{name}` templated
  message, and step through them one WhatsApp chat at a time, recording
  sent/skipped into the same Meetings history the web page uses
- Export CSV via the Android share sheet

**Media Office**
- Content Log: month-by-month Made/Uploaded entry, autosave, and a
  background refresh every 15s so teammates' edits show up (same as the
  website's polling)
- Content Stock: add/edit/delete content items, status and platform
- Stock Summary: opening stock, made, uploaded, and what's left, by type
  and by month
- Weekly Plan: the team's repeating schedule and the next event countdown.
  This is static data (mirroring `PLAN_ROWS`/`PLAN_EVENT` in `media.html`),
  copied into
  [`core/.../data/WeeklyPlan.kt`](core/src/main/kotlin/site/ajmfamily/admin/core/data/WeeklyPlan.kt) —
  edit that file when the real plan changes; there's no server copy on
  either client.

## Deliberately different from the web version

- **Native print isn't implemented.** The web "Print List" / "Print / PDF"
  buttons rely on the browser. Export CSV (via Android's share sheet)
  covers the same "get the data out" need; if you want an on-device PDF
  too, it can be added with Android's `PrintManager`.
- **The Content Log grid is a scrollable per-category day strip**, not the
  desktop's wide spreadsheet-style table — the same 31-day data, laid out
  for a phone screen. Tap a day to set a count or a status letter.
- **Login is remembered on-device** (encrypted), rather than held in memory
  for the tab's lifetime like the web gate.

## Verifying changes

This project was built in an environment without the Android SDK
available, so **the `:app` module itself has not been compiled here** —
only reviewed carefully by hand. `:core` has no Android dependency and
*is* fully verified: `./gradlew :core:test` runs 33 unit tests covering
the API client (including error handling and the bulk-action chunking)
and all the ported business logic. Before relying on the app, build and
run it once in Android Studio and click through both sections against a
real deployment.
