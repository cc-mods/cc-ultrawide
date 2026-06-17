# Copilot instructions — cc-ultrawide

Part of the **[cc-mods](https://github.com/cc-mods)** CrossCode suite (ultrawide field-of-view mod).

📓 **Read the suite agent docs first:**
**[`cc-mods/cc-agent-tools`](https://github.com/cc-mods/cc-agent-tools)** (private; org members only) is the
source of truth for hard-won findings — start at its
[`AGENTS.md`](https://github.com/cc-mods/cc-agent-tools/blob/main/AGENTS.md). Most relevant here:
- [`cc-ultrawide.md`](https://github.com/cc-mods/cc-agent-tools/blob/main/cc-ultrawide.md) — how the FOV
  works and the two bugs fixed in testing (aspect logic; **size to the game window, not the
  monitor**).
- [`crosscode-modding.md`](https://github.com/cc-mods/cc-agent-tools/blob/main/crosscode-modding.md) —
  CCLoader load stages, the fatal-404 asset rule, valid tags.

**When you learn something durable, add it to `cc-mods/cc-agent-tools`** and keep this pointer intact.

## What this is

A pure-JS CCLoader mod that widens CrossCode's FOV by overriding `window.IG_WIDTH/IG_HEIGHT` in
`postload.js` (before `ig.main`). `prestart.js` adds correctness fixes + the live "Width Shrink"
option. Default mode `fill`: start native (568×320), widen **horizontally only**, and only when the
**game window** (`innerWidth/innerHeight`, not the monitor) is wider than native.

## Must-not-break

- cc-ios compatibility is required: ship **no game assets** (a 404 at game init is fatal), no
  unguarded NW.js/Node APIs, set globals in `postload`/patch classes in `prestart`, wrap in try/catch.
- Ship both `ccmod.json` and `package.json`; keep versions in sync. Valid CCModDB tags only.
  id `cc-ultrawide` == repo name — don't rename.
- No game assets / personal data / secrets in commits. Only bundled binary is the original `icon.png`.

## Release

Push to `main` auto-bumps the patch, tags `vX.Y.Z`, builds `cc-ultrawide-<ver>.ccmod`, and publishes
a Release. **The release bot pushes the bump commit back to `main` — run `git pull --rebase origin
main` before your next push.** Docs-only paths (`**.md`, `.github/**`, `LICENSE`) are excluded from
auto-release. After a release, rebuild `cc-mods/CCModDB` (`python build-db.py`, push `main` and
`main:stable`).

## Verify

`node --check postload.js prestart.js`; validate JSON manifests; for logic, exercise `compute()` in
a fake-`window` harness; boot the real game and confirm no `CRITICAL BUG`.
