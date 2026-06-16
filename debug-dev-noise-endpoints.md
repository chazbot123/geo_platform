# Debug Session: dev-noise-endpoints [OPEN]

## Scope
- Residual noise 1: `http://127.0.0.1:7778/event` returns `ERR_CONNECTION_REFUSED`
- Residual noise 2: external Sina image request returns `ERR_BLOCKED_BY_ORB`

## Expected
- No avoidable local debug/event requests should fail noisily in normal dev flow
- No avoidable third-party image loads should emit browser security noise in routine page checks

## Hypotheses
- H1: `127.0.0.1:7778/event` is an optional local debug sink and current code reports to it unconditionally
- H2: the event request is triggered only from a specific page/workflow branch, not globally
- H3: the Sina image URL comes from remote account/profile data rather than static app assets
- H4: the ORB error is caused by hotlinked third-party image responses lacking browser-safe headers/content type for embedding
- H5: one or both noises can be reduced without changing business behavior by gating optional calls or normalizing image fallback behavior

## Evidence Log
- Pre-fix evidence:
  - Browser console on `/tasks/create` showed `net::ERR_CONNECTION_REFUSED http://127.0.0.1:7778/event`
  - Browser console/network showed `net::ERR_BLOCKED_BY_ORB` for `https://tvax2.sinaimg.cn/...`
  - Code search confirmed browser pages hardcoded `DEBUG_SERVER_URL = "http://127.0.0.1:7778/event"` in `task-planning-workbench.tsx` and `platform-account-center.tsx`
  - Code search confirmed avatar URLs are rendered directly from `account.avatarUrl`, and Weibo profile probing explicitly accepts `sinaimg.cn`
- Fix applied:
  - Browser debug reporting is now opt-in via `localStorage["geo-debug-events"] === "1"` instead of unconditional fetch
  - Inline avatar rendering now blocks `sinaimg.cn` hotlinks and falls back to local platform/default avatar
- Post-fix evidence:
  - Fresh browser tab on `/tasks/create` no longer emits `7778/event` or `sinaimg.cn` requests
  - Fresh browser tab on `/accounts` no longer emits `7778/event` or `sinaimg.cn` requests
  - Remaining observed noise is unrelated dev-mode `@vite/client` abort during Next dev flow

## Status
- Awaiting user verification
