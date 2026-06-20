# Selector Maintenance Workflow

Use this checklist when a supported site changes markup or a new feed surface needs coverage.

## 1. Reproduce the surface

- Confirm the exact URL, logged-in state, viewport, and browser where the feed or entry point appears.
- Check whether the page should be fully shielded by route logic, only have feed elements hidden, or be left alone.
- Prefer a narrow selector for the distracting surface over a broad container that could hide navigation, messages, settings, or normal content.

## 2. Update source selectors

- Edit `src/constants.js` only for shared selector and route changes.
- Add host coverage to `PRESETS` when a new site belongs in the supported list.
- Add or adjust the matching cases in `scripts/smoke-test.js` for URL-level behavior.
- Keep generated target folders out of hand edits; rebuild them with `scripts/verify.ps1` when PowerShell is available.

## 3. Validate safely

Run the full verification script when possible:

```powershell
.\scripts\verify.ps1
```

On systems without PowerShell, run the portable subset before opening a PR:

```sh
node --check src/constants.js
node --check src/page-lock.js
node --check src/background.js
node --check src/content.js
node --check popup/popup.js
node scripts/smoke-test.js
python3 -m json.tool manifest.json >/dev/null
python3 -m json.tool manifest.chromium.json >/dev/null
python3 -m json.tool manifest.firefox.json >/dev/null
```

## 4. Manual browser check

- Load the extension locally for the affected browser.
- Enable the relevant preset or custom domain.
- Visit a known feed route and confirm the distracting surface is hidden.
- Visit a normal route on the same site and confirm ordinary reading, navigation, and messaging still work.
- If the change touches Shorts/Reels/video surfaces, confirm unrelated media on normal pages is not paused or hidden.

## 5. Document the change

Include the affected site, tested URLs, browser, and verification command output in the PR description. Note any selectors that are intentionally broad and why they are safe.
