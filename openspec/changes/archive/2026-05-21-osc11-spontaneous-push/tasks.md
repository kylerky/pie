## 1. Core Implementation

- [x] 1.1 Modify `handleTerminalInput()` in `detection.ts`: after the pending-query check, parse spontaneous OSC 11 messages via `parseOsc11Response()`, compute luminance, classify, and return `"dark"` or `"light"` (or `undefined` if parsing fails)
- [x] 1.2 Update JSDoc on `handleTerminalInput()` to reflect that the return value can originate from either DEC 2031 or OSC 11 push events
- [x] 1.3 Modify `registerStdinHandler()` in `index.ts`: change the OSC 11 branch to check `pushEvent !== undefined` and call `handlePush(pushEvent, ctx)` before returning `{ consume: true }`
- [x] 1.4 Verify no changes needed to `handlePush()` or any other functions — confirm debounce and dedup already work correctly for OSC 11 push events

## 2. Verification

- [x] 2.1 Manual smoke test: start pi, verify startup detection still works (DEC 2031 → OSC 11 → COLORFGBG → default chain)
- [x] 2.2 Manual smoke test: verify DEC 2031 push events still trigger theme changes (if terminal supports them)
- [x] 2.3 Manual smoke test: verify OSC 11 query responses still resolve pending queries without triggering duplicate pushes
- [x] 2.4 Commit changes with conventional commit message