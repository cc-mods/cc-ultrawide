# CrossCode Ultrawide

A small [CCLoader](https://github.com/CCDirectLink/CCLoader) mod that makes **CrossCode**
render at an ultrawide aspect ratio (e.g. 3440×1440 / 21:9) with a **genuinely wider field
of view** — you see more of the game world — instead of a stretched 16:9 image. It supports
**pixel-perfect integer scaling** so the image stays crisp.

---

## TL;DR — how to use

1. Install [CCLoader](https://github.com/CCDirectLink/CCLoader) (you already have it).
2. Put this mod's folder at `CrossCode/assets/mods/cc-ultrawide/`
   (or junction it for live dev — see [Installing](#installing)).
3. Launch CrossCode.
4. In **Options → Video**: set **Display Type = Fit**. The mod keeps the native vertical view and
   widens horizontally only as far as your screen actually is — so a 16:9 display looks native and a
   21:9 display gains the extra side view. (For pixel-perfect integer scaling, switch
   `CONFIG.mode = 'auto-integer'` and use **Pixel Size = 4** — see
   [How the internal resolution is chosen](#how-the-internal-resolution-is-chosen).)
5. Recommended Steam launch option (prevents Windows DPI from softening the image):
   `--force-device-scale-factor=1`

You should now have a wider view that fills the empty space on the sides of your monitor — without
distorting or zooming the image on screens that are already native aspect.

> **One-click install:** this mod is part of the [**cc-mods**](https://github.com/cc-mods) suite.
> On the [**cc-ios**](https://github.com/cc-mods/cc-ios) iPhone wrapper it shows up in the in-game
> **Mods** tab automatically. On desktop, add the `@cc-mods/CCModDB/stable` repository in
> CCModManager → Settings → Repositories for one-click install, or just drop the `.ccmod` from
> [Releases](https://github.com/cc-mods/cc-ultrawide/releases) into `assets/mods/`.

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
prestart  ── after game classes are defined  ← we patch the GUI fixes + the width preview ✅
poststart ── after the game has started       ← we register the CCModManager setting ✅
            (too late to change FOV — that's why the width applies on the next restart)
```

So this mod ships:

- `postload.js` — overwrites `window.IG_WIDTH` / `window.IG_HEIGHT` (the ultrawide FOV trick), reading
  the chosen **Ultrawide Width** % from `localStorage` at startup.
- `prestart.js` — applies two resolution-correctness fixes (the environmental edge-tint overlay
  height and title-screen parallax centering — see
  [Resolution-correctness fixes](#resolution-correctness-fixes)) and draws the live **width preview
  bars** while you adjust the setting.
- `poststart.js` — registers the **Ultrawide Width** slider on the mod's **CCModManager “Mod settings”**
  page (see [Ultrawide Width](#ultrawide-width-mod-settings--notch--dynamic-island)).

A minimal `ccmod.json` wires them up:

```json
{
  "id": "cc-ultrawide",
  "version": "1.0.0",
  "postload": "postload.js",
  "prestart": "prestart.js",
  "poststart": "poststart.js",
  "dependencies": { "crosscode": "^1.1.0 || 1.0.2" }
}
```

---

## How the internal resolution is chosen

The default is **`fill`**: start at the native resolution and **only widen the field of view
horizontally, and only when your screen is wider than native** (16:9 ≈ `568/320 = 1.775`). If the
screen is the native aspect or *taller/narrower*, the mod leaves the resolution at native — it never
invents an ultrawide image when there is no empty space on the sides to fill. The native vertical
view is always preserved.

```
nativeAspect = 568 / 320 ≈ 1.775
screenAspect = screenWidth / screenHeight
height = 320                                  (always native vertical view)
width  = screenAspect > nativeAspect          (screen is wider than native?)
           ? round(320 × screenAspect)         → widen to fill the side space
           : 568                                → not wider → stay exactly native
```

| Screen | screenAspect | Result | Why |
|--------|-------------:|--------|-----|
| 3440×1440 (21:9) | 2.389 | **764 × 320** | wider than native → widen to fill the sides |
| 2560×1080 (21:9) | 2.370 | **758 × 320** | wider than native → widen |
| 1920×1080 (16:9) | 1.778 | **~568 × 320** | ≈ native, already fills → no ultrawide |
| 1920×1200 (16:10) | 1.600 | **568 × 320** | narrower than native → stay native |
| portrait / 4:3 | < 1.775 | **568 × 320** | no side space → stay native (never ultrawide) |

In-game choose **Display Type = Fit** so the image scales to fill without distortion.

### Optional: `auto-integer` (pixel-perfect, fills both axes)

"Integer scaling" means the small internal image is multiplied by a **whole number** to fill the
screen, so pixels line up 1:1 (no blur/shimmer — good explainer:
<https://tanalin.com/en/articles/lossless-scaling/>). Set `CONFIG.mode = 'auto-integer'` to pick the
largest integer scale of your monitor height and fill **both** axes:

```
scale  = round(screenHeight / 340)
height = screenHeight / scale
width  = screenWidth  / scale
```

For **3440×1440**: `scale = 4 → 860 × 360`, scaled exactly **4×** to fill, pixel-perfect, with ~12.5%
more *vertical* view too. The trade-off: because it derives from the screen, it also adds vertical
FOV (a slight zoom-out) even on non-ultrawide screens — which is why it is **no longer the default**.
Pair it with **Display Type = Fit**, **Pixel Size = 4**.

---

## Configuration

Open `postload.js` and edit the `CONFIG` object:

| Key                    | Default          | Meaning |
|------------------------|------------------|---------|
| `mode`                 | `'fill'`         | `'fill'` (native + widen only if the screen is wider), `'auto-integer'`, `'aspect'` (alias of fill), or `'manual'`. |
| `targetInternalHeight` | `340`            | auto-integer aims for an internal height near this. |
| `manualWidth/Height`   | `860 / 360`      | used when `mode: 'manual'`. |
| `screenWidth/Height`   | `0` (auto)       | override detection if DPI reports a wrong size. |
| `maxAspect`            | `0` (off)        | cap max width:height (e.g. `2.39`) so tiny rooms don't reveal the void past their edges. |

The chosen values are logged to the dev console (`F12`) and exposed on
`window.CC_ULTRAWIDE` for debugging.

---

## Ultrawide Width (Mod settings — notch / Dynamic Island)

How wide the ultrawide view renders is a single setting on the mod's **CCModManager “Mod settings”**
page — **not** in the native game Options menu. To open it: **Options → Mods**, focus **CrossCode
Ultrawide** in the list, then **right-click** (mouse) or press **R2** (controller) to open its
**Mod settings**; the **Ultrawide Width** slider is under **Display**.

| Slider | Result |
|--------|--------|
| **100%** (default) | Full screen-filling ultrawide width (max field of view). |
| **lower** | Narrower field of view, centred, with symmetric letterbox bars on the left/right — so the render can clear a notch / **iPhone Dynamic Island**. |
| **0%** | Native 16:9 width (no ultrawide). |

**It applies on the next game restart.** CrossCode fixes its logical resolution at boot (there is no
safe live-resize path), so the chosen width is persisted to `localStorage` and read by `postload.js` on
the next launch. To avoid restarting repeatedly just to find the right value, **dragging the slider
flashes two red preview bars** showing where the render edges would be at that width; pick the value
that clears your notch, then **restart** (on cc-ios, the in-game **Restart** title button) to apply.

The preview bars are drawn in the engine's render layer (above the menu) and only show a *narrower*
future width — the shrink-to-clear-a-notch case. The native **FPS counter** (from
[cc-iosux](https://github.com/cc-mods/cc-iosux)) stays anchored to the real canvas edge: it doesn't
move while you preview, and repositions to the new edge once the width actually changes on restart.

> Requires **CCModManager** (it hosts the settings page) — always present on cc-ios, and the standard
> manager on desktop. Without it the width still works (defaults to 100% or the last saved value); it
> just has no settings UI.

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

**Option A — copy:** copy this folder into `…/CrossCode/assets/mods/cc-ultrawide/`.

**Option B — junction (keeps it in sync with this repo, for local dev):** from PowerShell, run the
suite installer (it reads this mod's id from `ccmod.json`):

```powershell
cc-agent-tools\scripts\windows\install-mod.ps1 -ModPath .
```

It creates a directory junction from the game's mods folder to this repo so you can edit here and
just relaunch the game. Pass `-GamePath` if CrossCode isn't at the default Steam location, and
`-Uninstall` to remove the link.

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
(`ccmod.json`, `package.json`, `postload.js`, `prestart.js`, `icon.png`, `README.md`, `LICENSE`) —
dev-only files like `.github/` are intentionally excluded from the `.ccmod`.
