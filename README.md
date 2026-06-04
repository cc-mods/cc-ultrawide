# CrossCode Ultrawide

A small [CCLoader](https://github.com/CCDirectLink/CCLoader) mod that makes **CrossCode**
render at an ultrawide aspect ratio (e.g. 3440×1440 / 21:9) with a **genuinely wider field
of view** — you see more of the game world — instead of a stretched 16:9 image. It supports
**pixel-perfect integer scaling** so the image stays crisp.

---

## TL;DR — how to use

1. Install [CCLoader](https://github.com/CCDirectLink/CCLoader) (you already have it).
2. Put this mod's folder at `CrossCode/assets/mods/crosscode-ultrawide/`
   (or run `install.ps1` — see [Installing](#installing)).
3. Launch CrossCode.
4. In **Options → Video**: set **Display Type = Fit** and **Pixel Size = 4**.
5. Recommended Steam launch option (prevents Windows DPI from softening the image):
   `--force-device-scale-factor=1`

You should now have a sharp, wider view that fills your ultrawide monitor.

---

## How CrossCode rendering actually works

CrossCode runs on the **Impact** JS engine inside NW.js (Chromium). Understanding three
pieces explains everything this mod does.

### 1. The internal (logical) resolution

`assets/node-webkit.html` declares, in the page `<head>`:

```js
var IG_WIDTH  = 568;   // internal render WIDTH
var IG_HEIGHT = 320;   // internal render HEIGHT
var IG_GAME_SCALE = 2; // "Pixel Size"
```

`568 × 320` is the **logical resolution**: the coordinate space the game draws into and,
crucially, the **field of view**. `568 / 320 ≈ 1.775`, i.e. ~16:9.

### 2. Where it is consumed

On startup the game calls (in `assets/js/game.compiled.js`):

```js
ig.main("#canvas", "#game", sc.CrossCode, fps,
        window.IG_WIDTH, window.IG_HEIGHT, window.IG_GAME_SCALE, sc.StartLoader);
```

`ig.main` → `new ig.System(...)` → `ig.system.resize(w, h, scale)` which sets
`ig.system.width` / `ig.system.height`. **That is the field of view.** Make it wider and the
camera shows more world horizontally.

### 3. Why "Display Type" alone can't do it

The in-game **Display Type** (Original / Double / Fit / Stretch) runs `_setDisplaySize()`,
which only calls `setCanvasSize()` — it changes the **canvas CSS size** (how the fixed
568×320 image is stretched onto your monitor). It never changes the logical resolution. So:

| Setting        | What it changes              | Ultrawide FOV? |
|----------------|------------------------------|----------------|
| Stretch / Fit  | On-screen stretch of 568×320 | ❌ (distorted / bars) |
| **IG_WIDTH**   | Logical render width (FOV)   | ✅ (true wider view) |

**Conclusion:** to get real ultrawide we must widen `IG_WIDTH` *before* `ig.main` runs.

---

## How this mod hooks in (CCLoader stages)

CCLoader loads mod code at several stages. The relevant ordering for this mod:

```
preload   ── runs BEFORE the game's <head> scripts  → IG_WIDTH not set yet (too early)
            (the game would overwrite us with `var IG_WIDTH = 568`)
            ↓ game <head> runs: IG_WIDTH = 568, game.compiled.js defines startCrossCode
postload  ── runs AFTER head scripts, BEFORE ig.main()  ← we override IG_WIDTH HERE ✅
            ↓ ig.main(... IG_WIDTH ...) starts the game with our resolution
prestart  ── after game classes are defined  ← we patch the GUI layout + add the Video option ✅
main / poststart ── after the game has started (too late to change FOV)
```

So this mod ships:

- `postload.js` — overwrites `window.IG_WIDTH` / `window.IG_HEIGHT` (the ultrawide FOV trick).
- `prestart.js` — applies two resolution-correctness fixes (the environmental edge-tint overlay
  height and title-screen parallax centering — see
  [Resolution-correctness fixes](#resolution-correctness-fixes)) and adds an
  **Ultrawide Width Shrink** option to the Video menu (see
  [Ultrawide Width Shrink](#options--video--ultrawide-width-shrink-notch--bezel-safety)).

A minimal `ccmod.json` wires them up:

```json
{
  "id": "crosscode-ultrawide",
  "version": "1.0.0",
  "postload": "postload.js",
  "prestart": "prestart.js",
  "dependencies": { "ccloader": ">=2.0.0" }
}
```

---

## Integer scaling — and the math for 3440×1440

"Integer scaling" means the small internal image is multiplied by a **whole number** to fill
the screen. If the multiplier is fractional, pixels don't line up 1:1 and you get blur /
shimmer; whole-number scaling stays perfectly sharp. (Good explainer:
<https://tanalin.com/en/articles/lossless-scaling/>.)

This mod has two strategies (set `CONFIG.mode` in `postload.js`):

### `auto-integer` (default) — sharp + ultrawide

Pick the largest integer scale that fills the monitor height:

```
scale  = round(screenHeight / 340)
height = screenHeight / scale
width  = screenWidth  / scale
```

For **3440×1440**:

```
scale  = round(1440 / 340) = 4
height = 1440 / 4 = 360
width  = 3440 / 4 = 860     →  internal 860 × 360
```

`860 × 360` scaled exactly **4×** = `3440 × 1440`: fills the whole monitor, pixel-perfect,
ultrawide, and as a bonus gives ~12.5% more *vertical* view too (360 vs 320). In-game choose
**Display Type = Fit**, **Pixel Size = 4** for a clean 1:1 mapping.

### `aspect` — keep native vertical view

Keep the native 320px height, widen horizontally only:

```
height = 320
width  = round(320 × 3440 / 1440) = 764   →  internal 764 × 320
```

This preserves the exact vanilla vertical zoom but scales at ~4.5× (fractional), so use
**Display Type = Fit** (slightly softer). Use this if you specifically want the original
vertical framing.

---

## Configuration

Open `postload.js` and edit the `CONFIG` object:

| Key                    | Default          | Meaning |
|------------------------|------------------|---------|
| `mode`                 | `'auto-integer'` | `'auto-integer'`, `'aspect'`, or `'manual'`. |
| `targetInternalHeight` | `340`            | auto-integer aims for an internal height near this. |
| `manualWidth/Height`   | `860 / 360`      | used when `mode: 'manual'`. |
| `screenWidth/Height`   | `0` (auto)       | override detection if DPI reports a wrong size. |
| `maxAspect`            | `0` (off)        | cap max width:height (e.g. `2.39`) so tiny rooms don't reveal the void past their edges. |

The chosen values are logged to the dev console (`F12`) and exposed on
`window.CC_ULTRAWIDE` for debugging.

---

## Options → Video → "Ultrawide Width Shrink" (notch / bezel safety)

Some displays crop the rendered image — most commonly an **iPhone's camera "island"** when
mirroring CrossCode to one over AirPlay or similar. The notch leaves a black zone the game would
otherwise try to draw HUD into. To fix that without giving up integer scaling, this option lets
you shrink the **internal render width** (height untouched) so the game renders into a narrower
area with equal letterbox bars on either side — and any UI anchored to the screen edges
automatically follows the new width inward.

| Slider | Result |
|--------|--------|
| **0** (default) | Full ultrawide width (current behaviour). |
| **50**          | Halfway between full ultrawide and native 16:9. |
| **100**         | Back to native 568px width (full 16:9 letterboxing). |

The slider linearly interpolates between the auto-computed ultrawide width and the native
568px, so a small value (e.g. 10–20) gives a small symmetric inset — usually enough to clear an
iPhone-style camera notch. **Takes effect on the next game launch** (postload runs before
`ig.main`, so live resize isn't supported). The chosen value is persisted by `sc.options` and
mirrored to `localStorage` under `cc-ultrawide-shrink` so the next launch can pick it up before
the option system is alive.

---

## Resolution-correctness fixes

These two `prestart.js` patches are **always on**. They simply correct draws that the engine
sizes from the (now taller/wider) live resolution, and are no-ops at native resolution. Both are
gated behind a "bigger than native" check and wrapped in `try/catch` with a vanilla fallback.

### Environmental edge-tint overlay height

The soft black / red / white edge vignette used in caves, hot zones, etc. is drawn by
`ig.OverlayCornerGui` from a `240×320` image, anchored to the **top**, mirrored on the left and
right edges. Its *width* follows `ig.system.width` (the right copy anchors to the right edge),
but its *height* stays the image's native 320px — so on a taller internal resolution the tint
stopped short of the screen bottom (the bottom corners sat too high). We patch
`ig.OverlayCornerGui#updateDrawables` to wrap the two image draws in a **vertical scale
transform** (`scaleY = ig.system.height / gfx.height`) so the tint fills the full height.
(`ig.Image#draw` is crop-only and refuses sizes larger than the source, so a transform — not a
destination size — is required.)

### Title-screen parallax centering

The title background (`ig.ParallaxGui`, parallax `"title"`) is built from `568px`-wide native
art. Left-anchored layers (sky / ground / railings) fill the left 568px, while right-anchored
layers (clouds and the **Lea** character) snap to the far-right screen edge — leaving the scene
off-centre with a black gap. We patch `ig.ParallaxGui#init` for the `"title"` parallax only,
sizing its hook to native width and **centering it**, so the whole scene lands in the middle with
symmetric letterbox bars. The menu buttons, DLC and Changelog entries are separate GUIs and keep
their own edge anchoring.

> The brand-logo intro that plays *before* the title settles still slides in from the sides; that
> animation is left as-is (purely cosmetic, only on first load).

---

## Installing

The mod folder must live in `CrossCode/assets/mods/`.

**Option A — copy:** copy this folder into `…/CrossCode/assets/mods/crosscode-ultrawide/`.

**Option B — symlink (keeps it in sync with this repo):** from an *admin* PowerShell, run:

```powershell
./install.ps1
```

`install.ps1` creates a directory junction from the game's mods folder to this repo so you
can edit here and just relaunch the game. Pass `-GamePath` if CrossCode isn't at the default
Steam location, and `-Uninstall` to remove the link.

---

## Known caveats

- **Small rooms:** widening the view can reveal empty space past the edges of very small
  maps. Use a smaller `width` (e.g. `aspect` mode) or set `maxAspect` if this bothers you.
- **Some fixed-size cutscene framing** was authored for 16:9 and may show slightly more than
  intended at the sides. Gameplay is unaffected.
- **DPI scaling:** if Windows display scaling isn't 100%, `window.screen.width` may not equal
  your true pixel count and integer scaling won't be exact. Add the launch option
  `--force-device-scale-factor=1` (as the [IntegerScaling](https://github.com/Aemony/CrossCode-IntegerScaling)
  mod also recommends).

---

## Why a mod instead of patching `game.compiled.js`?

The [IntegerScaling](https://github.com/Aemony/CrossCode-IntegerScaling) approach edits
`game.compiled.js` directly. That works but breaks on game updates and is hard to uninstall.
A CCLoader `postload` mod is **non-destructive** (it never edits game files), survives
updates, and is trivial to enable/disable.

## Credits & references

- [CCLoader](https://github.com/CCDirectLink/CCLoader) — the mod loader.
- [CrossCode-IntegerScaling](https://github.com/Aemony/CrossCode-IntegerScaling) — prior art on scaling.
- Example mods studied: open-circuits, cc-tips-and-tricks, azures-adjustments, el-crosscode-tweak.

## License

MIT — see [LICENSE](LICENSE).

---

## Releases

Releases are fully automated by [`.github/workflows/release.yml`](.github/workflows/release.yml):

- **Every push to `main`** bumps the **patch** (`z`) in `x.y.z`, creates the matching `vX.Y.Z`
  tag, builds the `.ccmod` package, and publishes a GitHub Release with it attached.
- **Manual dispatch** — go to the repo's **Actions → Release → Run workflow** button and pick
  `minor` (resets patch to 0) or `major` (resets minor + patch to 0). Same packaging + release
  steps as the auto path.

The bump commit is authored by `github-actions[bot]`; GitHub's default `GITHUB_TOKEN` does **not**
re-trigger workflows, so the bot's own commit cannot start an infinite loop. A second-line `if:`
guard in the workflow rejects it anyway. Each release ships only the runtime + docs
(`ccmod.json`, `postload.js`, `prestart.js`, `README.md`, `LICENSE`) — dev-only files like
`install.ps1` and `.github/` are intentionally excluded from the `.ccmod`.
