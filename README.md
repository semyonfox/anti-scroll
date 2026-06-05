# Anti Scroll

A no-build WebExtension that blocks user scrolling on selected sites.

The first target is the browser layer: stop wheel, touch, and scroll-key loops on social feeds while keeping normal browsing intact elsewhere.

## Load Locally

### Helium, Chrome, Brave, Edge

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this folder: `C:\Users\foxsc\code\personal\anti-scroll`.

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

Branch policy is in `BRANCHES.md`: `main` is the source of truth, while `chromium` and `firefox` are kept refreshed from it.

## What It Does

- Blocks wheel, touchmove, and keyboard scrolling on selected sites.
- Uses three clear modes: off, selected sites, or all sites.
- Lets you run blocking for a chosen number of minutes.
- Supports a searchable list of social presets plus custom domains.
- Allows typing fields by default.
- Allows common DM/messaging pages by default.
- Tracks blocked attempts locally only.

## Notes

This is intentionally plain JavaScript with no build step. That keeps early extension iteration fast and makes the shipped code easy to inspect.
