# Anti Scroll

A no-build WebExtension that breaks distracting feeds on selected sites.

The first target is the browser layer: hide feed surfaces while keeping normal pages on the same sites usable.

## Load Locally

### Helium, Chrome, Brave, Edge

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select the cloned repository folder.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose "Load Temporary Add-on".
3. Run `.\scripts\build-extension.ps1 -Target firefox`.
4. Select `dist\firefox\manifest.json`.

## Builds And Branches

Run both target builds:

```powershell
.\scripts\verify.ps1
```

PowerShell is required for that command. On Linux or macOS without PowerShell,
run the local JavaScript checks from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
```

The JavaScript checks do not package the browser builds. `verify.ps1` also
copies each target manifest and source files into `dist/`.

Branch policy is in `BRANCHES.md`: `main` is the source of truth, while `chromium` and `firefox` are kept refreshed from it.

## What It Does

- Uses three clear modes: off, selected sites, or all sites.
- Lets you run blocking for a chosen number of minutes.
- Supports a searchable list of social presets plus custom domains.
- Uses HTTPS-only static access for presets; custom domains and all-sites mode request optional HTTP/HTTPS access when enabled.
- Lets you pause the current selected site for 15 minutes without turning the extension off.
- Hides the feed area on known feed routes such as X home, Instagram/Reels, YouTube Shorts, TikTok, Reddit feeds, LinkedIn feed, Facebook watch/feed, and Threads.
- Includes additional opt-in feed presets for Bluesky, Twitch, Substack, GitHub, and Hacker News.
- Hides common feed entry points and recommendation surfaces such as Shorts/Reels links, suggested sidebars, recent posts, and end-screen recommendations where selectors are known.
- Leaves normal scrolling alone on pages that are not shielded.
- Uses narrow feed selectors and fails open if a page changes, instead of hiding the whole page by accident.
- Allows typing fields by default.
- Allows common DM/messaging pages by default.
- Tracks blocked attempts locally only.
- Research notes and source links for comparable extensions are in `RESEARCH.md`.
- Selector update steps and review checklist are in `SELECTOR_MAINTENANCE.md`.

## Notes

This is intentionally plain JavaScript with no build step. That keeps early extension iteration fast and makes the shipped code easy to inspect.

## Preset metadata

Edit presets in `src/constants.js`, then run `node scripts/generate-manifests.js`.
The runtime and popup share `getDomainMatchPatterns()`. Manifest structure lives
in `scripts/manifest-template.json`, with Firefox overrides in
`scripts/manifest-firefox.json`. Verification rejects stale generated files.

## Browser checks

`pnpm verify` includes a real Chromium extension test with intercepted fixture pages.
It checks popup storage changes, timer controls, activity reset, feed hiding,
SPA navigation and full-page scroll locking. No social site requests are made.
Run it alone with `pnpm test:browser`.

For Firefox, load the temporary add-on and check YouTube feed hiding, a watch
page staying usable, Off/Selected/All mode changes, a five-minute timer,
custom-domain permission grant and removal, typing, and activity reset.
Firefox extension loading is checked manually for now.

## Per-site modes

Each preset row has a mode selector. Default keeps the existing feed behaviour
and respects Hide feeds. Feed explicitly hides known feed routes. Full page
blocks every route except allowed messaging pages. Entry points hides only
known navigation links and recommendation surfaces on any route, without a
page lock or placeholder. Off allows that preset. Presets still need to be
selected, and All sites mode still blocks every site.

Custom domains keep full-page blocking. Sites without known entry-point
selectors fail open in Entry points mode.

## Recurring focus windows

Add up to 20 windows using local weekdays and start/end times. An end time
earlier than the start means the following day. Equal times are rejected.
Windows sync with your settings and use each browser's local time zone.

An explicit manual disable or site pause always wins. During a window, shields
are active for the configured sites even if a one-off timer has ended. Outside
windows normal settings apply. With no timer, Selected sites and All sites stay
on between windows too. To use windows alone, set a short timer and let it end.
An elapsed timer is retained while windows exist so the next window can resume
blocking. Removing all windows restores normal timer expiry.

The badge shows SCH during a window and the popup shows whether a window is
active, overridden by Off, or when the next boundary occurs. Overnight windows
belong to their start day. Browser alarms update the badge at boundaries and
open pages refresh their shields without needing a reload.
