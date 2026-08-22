# Branch Policy

`main` is the source of truth.

The browser branches are:

- `chromium`
- `firefox`

They should not carry hand-written feature work. They are target branches refreshed from `main` after changes land, so neither browser branch falls behind shared source.

Run this after committing to `main`:

```powershell
.\scripts\sync-target-branches.ps1
```

On Linux/macOS the bash equivalent is:

```bash
./scripts/sync-target-branches.sh
```

Run it from a clean checkout. With `-Push`, it force-updates the target branches
using `--force-with-lease`.

Use this to build target folders:

```powershell
.\scripts\build-extension.ps1 -Target chromium
.\scripts\build-extension.ps1 -Target firefox
```

The target builds copy shared source and write the correct target manifest as `manifest.json`.
