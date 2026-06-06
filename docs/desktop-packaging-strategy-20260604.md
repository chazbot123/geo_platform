# GEO Desktop Packaging Strategy

Date: 2026-06-04

## Conclusion

The long packaging delay was not caused by normal code compilation. It was caused by three blockers stacking together:

1. `.next` contained stale dev cache, so `next build` looked stuck during Next initialization.
2. Running `next build` inside the sandbox can fail with `spawn EPERM`, because the Next worker process cannot start reliably there.
3. The default `electron-builder` installer path downloads Electron/NSIS-related assets from GitHub. When network access is restricted or unstable, that step can hang or fail for a long time.

## Adopted Packaging Route

Use the unpacked Windows directory build as the default production packaging route:

```powershell
npm run dist
```

The current `dist` script is intentionally configured as:

```json
"dist": "npm run build:web && electron-builder --win dir --config.electronDist=node_modules/electron/dist --config.win.signAndEditExecutable=false"
```

This route:

- builds the Next web app first;
- uses the locally installed Electron runtime from `node_modules/electron/dist`;
- skips Windows executable signing/editing;
- outputs an unpacked executable directory instead of an NSIS installer;
- avoids the GitHub/NSIS download path that caused repeated hangs.

Expected output:

```text
dist/win-unpacked/GEO桌面版.exe
```

## Installer Route

Keep the installer command for later, but do not use it as the default while network and permission conditions are unstable:

```powershell
npm run dist:installer
```

The installer route may still need network access for NSIS or related builder assets. Use it only when network access is reliable and the builder cache is already warm.

## Operational Rules

- If `next build` appears stuck at initialization, remove stale `.next` cache and retry.
- Do not treat a sandbox `spawn EPERM` as a source-code build failure. Re-run the packaging command outside the sandbox.
- Do not run plain installer packaging as the first choice. Use `npm run dist` for a production usable EXE directory.
- If a build command is interrupted, check for leftover `node.exe` processes before starting another package run. Do not kill unknown processes without confirming their command line or ownership.
- Keep generated `.next`, `dist`, runtime `data`, and local session artifacts out of commits unless explicitly requested.

## Verified Baseline

Previous verified result:

- `.next` stale cache was cleared.
- `next build` completed outside the sandbox in about 47 seconds.
- `npm run dist` completed successfully.
- The usable executable was produced at `D:\geo\dist\win-unpacked\GEO桌面版.exe`.
