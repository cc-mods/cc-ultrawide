/*
 * CrossCode Ultrawide — prestart.js
 * --------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 *   postload.js widens IG_WIDTH so the WORLD camera shows more (true ultrawide).
 *   But CrossCode lays out its whole GUI relative to the live (now wide) screen
 *   width (ig.system.width). UI that was authored for the native 568px width
 *   therefore anchors to the LEFT, spreads to both edges, or — for full-screen
 *   background art — fails to fill the extra width, leaving a black gap. (On the
 *   title screen the scene + menu cluster on the left while the right-anchored
 *   art/buttons hug the far edge.)
 *
 *   The world is rendered by a separate system, so we can fix the UI without
 *   touching the wide gameplay FOV.
 *
 * WHAT THIS DOES
 *
 *   It patches the GUI layout root (ig.Gui#_updateRecursive) so that, when the
 *   screen is wider than native, the whole GUI is laid out inside a NATIVE-WIDTH
 *   (568) box and then either centered or horizontally stretched to fill the
 *   real screen. The behaviour is chosen from a new native option that lives in
 *   the normal Options -> Video menu ("Ultrawide UI"):
 *
 *     - Off       : vanilla behaviour (UI clusters left).
 *     - Centered  : original 16:9 layout, centered with side bars (default,
 *                   crisp art).
 *     - Stretched : the whole GUI is scaled horizontally to fill the full width.
 *                   Pixel art is stretched, but nothing clusters or leaves a gap.
 *
 *   STRETCH is implemented by laying the top-level GUI out at native width from
 *   the left edge and wrapping the entire render in a single horizontal scale
 *   transform (s = screenWidth / nativeWidth) pushed onto the GUI renderer. The
 *   per-element translate transforms the engine already emits are multiplied by
 *   that scale at draw time, so everything fills the width. We then post-scale
 *   every hook's screenCoords.x / .w by the same factor so mouse hit-testing
 *   lines up with what is drawn.
 *
 *   CENTER lays the top-level GUI out in a native-width box centered on screen
 *   and clamps full-screen-sized hooks back to native width.
 *
 *   Everything is wrapped in try/catch and gated behind the option, so any
 *   failure falls back to vanilla behaviour rather than breaking the game.
 *
 *   prestart runs after the game's classes/modules are defined, which is when
 *   ig.Gui and sc.OPTIONS_DEFINITION exist and can be patched, but before the
 *   game starts — exactly what we want.
 */
(() => {
	'use strict';

	const TAG = '[crosscode-ultrawide]';

	// Native logical UI width the menus/HUD were authored for. This is the
	// vanilla IG_WIDTH and is independent of the widened gameplay width.
	const NATIVE_GUI_WIDTH = 568;

	// UI modes (kept in sync with sc.ULTRAWIDE_UI below).
	const MODE = { OFF: 0, CENTER: 1, STRETCH: 2 };
	const DEFAULT_MODE = MODE.OFF;

	// Shared state (postload.js may already have created window.CC_ULTRAWIDE).
	const ccuw = (window.CC_ULTRAWIDE = window.CC_ULTRAWIDE || {});
	ccuw.guiWidth = NATIVE_GUI_WIDTH;
	// Fallback used before sc.options is ready (and if the option is missing).
	const fallback = (ccuw.uiConfig = ccuw.uiConfig || {});
	if (typeof fallback.defaultMode !== 'number') fallback.defaultMode = DEFAULT_MODE;

	const ALIGN = (window.ig && ig.GUI_ALIGN) || { X_LEFT: 4, X_CENTER: 5, X_RIGHT: 6 };

	// Resolve the active UI mode. Reads the native Video option once sc.options
	// exists, otherwise falls back to the default so early frames still behave.
	function currentMode() {
		try {
			if (window.sc && sc.options && typeof sc.options.get === 'function') {
				const v = sc.options.get('ultrawide-ui');
				if (v === MODE.OFF || v === MODE.CENTER || v === MODE.STRETCH) return v;
			}
		} catch (e) {
			/* ignore and fall back */
		}
		return fallback.defaultMode;
	}

	// The brand-logo intro (ig.GUI.IntroScreen) and the main menu both live under
	// sc.TitleScreenGui as a single top-level GUI. We always center that screen,
	// even when the global mode is Off, because its background/menu otherwise
	// cluster to the left on an ultrawide screen. (Gameplay has no TitleScreenGui,
	// so this leaves normal play untouched.)
	function isTitleScreenActive(hooks) {
		if (!(window.sc && sc.TitleScreenGui)) return false;
		for (let i = 0; i < hooks.length; i++) {
			const x = hooks[i];
			if (x && x.gui instanceof sc.TitleScreenGui) return true;
		}
		return false;
	}

	// Is this hook full-screen background art (as opposed to a menu/HUD piece)?
	function isArt(hook) {
		const g = hook.gui;
		if (!g) return false;
		if (typeof ig.ParallaxGui === 'function' && g instanceof ig.ParallaxGui) return true;
		if (typeof ig.ImageGui === 'function' && g instanceof ig.ImageGui) return true;
		return false;
	}

	function restore(touched) {
		// touched is a flat [obj, key, value, obj, key, value, ...] list.
		for (let i = touched.length - 3; i >= 0; i -= 3) {
			touched[i][touched[i + 1]] = touched[i + 2];
		}
	}

	// --- STRETCH ------------------------------------------------------------
	// Clamp every full-screen-sized hook back to native width so it lays out at
	// the original internal width; the global scale transform then stretches it
	// to fill the screen.
	function clampForStretch(hooks, sw, nw, touched) {
		for (let i = 0; i < hooks.length; i++) {
			const x = hooks[i];
			if (!x) continue;
			if (x.size.x >= sw - 2) {
				touched.push(x.size, 'x', x.size.x);
				x.size.x = nw;
			}
			const kids = x.children;
			if (kids && kids.length) clampForStretch(kids, sw, nw, touched);
		}
	}

	// After layout, the engine has filled in absolute screenCoords in native
	// space. Multiply x / w by the horizontal scale so mouse hit-testing matches
	// the scaled render. Vertical is untouched.
	function scaleScreenCoords(hooks, scale) {
		for (let i = 0; i < hooks.length; i++) {
			const x = hooks[i];
			if (!x) continue;
			const sc = x.screenCoords;
			if (sc) {
				sc.x = sc.x * scale;
				sc.w = sc.w * scale;
			}
			const kids = x.children;
			if (kids && kids.length) scaleScreenCoords(kids, scale);
		}
	}

	// --- CENTER -------------------------------------------------------------
	// Prepare each full-screen-sized hook for a centered native-width layout.
	function prepareForCenter(hooks, sw, nw, offX, touched) {
		for (let i = 0; i < hooks.length; i++) {
			const x = hooks[i];
			if (!x) continue;

			if (x.size.x >= sw - 2) {
				// Keep genuinely full-screen elements (screen fades AND background
				// art) spanning the whole width so centering the menu doesn't
				// reintroduce black side bars. Everything else (menus/HUD) is
				// clamped to native width and centered.
				const fullBleed = !!x.screenBlocking || isArt(x);
				if (fullBleed) {
					if (x.align.x === ALIGN.X_LEFT || x.align.x === ALIGN.X_RIGHT) {
						touched.push(x.pos, 'x', x.pos.x);
						x.pos.x = -offX;
					}
				} else {
					touched.push(x.size, 'x', x.size.x);
					x.size.x = nw;
				}
			}

			const kids = x.children;
			if (kids && kids.length) prepareForCenter(kids, sw, nw, offX, touched);
		}
	}

	function patchGui() {
		if (ccuw._guiPatched) return true;
		if (!(window.ig && ig.Gui && ig.Gui.prototype && ig.Gui.prototype._updateRecursive)) {
			return false;
		}

		const proto = ig.Gui.prototype;
		const orig = proto._updateRecursive;

		proto._updateRecursive = function (b, c, f, g, h, i, k, q, s, v, y) {
			// Only intercept the top-level pass (k is the root hook array).
			if (k === this.guiHooks) {
				let mode = currentMode();
				if (mode !== MODE.OFF) {
					try {
						const sw = ig.system.width | 0;
						const nw = ccuw.guiWidth | 0;
						if (sw > nw + 1) {
							if (mode === MODE.STRETCH) {
								const scale = sw / nw;
								const touched = [];
								try {
									clampForStretch(this.guiHooks, sw, nw, touched);
									// Wrap the whole GUI render in a horizontal scale.
									const tr = this.renderer.addTransform();
									tr.setScale(scale, 1);
									try {
										orig.call(this, 0, c, nw, g, h, i, k, q, s, v, y);
									} finally {
										this.renderer.undoTransform();
									}
									// Match mouse hit-testing to the scaled render.
									scaleScreenCoords(this.guiHooks, scale);
									return;
								} finally {
									restore(touched);
								}
							} else {
								// CENTER
								const offX = Math.floor((sw - nw) / 2);
								const touched = [];
								try {
									prepareForCenter(this.guiHooks, sw, nw, offX, touched);
									return orig.call(this, offX, c, nw, g, h, i, k, q, s, v, y);
								} finally {
									restore(touched);
								}
							}
						}
					} catch (err) {
						if (!ccuw._warned) {
							ccuw._warned = true;
							console.error(`${TAG} UI layout patch failed, using vanilla layout:`, err);
						}
					}
				}
			}
			return orig.call(this, b, c, f, g, h, i, k, q, s, v, y);
		};

		ccuw._guiPatched = true;
		console.log(`${TAG} UI layout patch installed (native GUI width ${ccuw.guiWidth}).`);
		return true;
	}

	// --- Environmental edge-tint overlay height fix ------------------------
	// The environmental overlay (ig.OverlayCornerGui — the soft black/red/white
	// edge tint used in caves, hot zones, etc.) draws a 240x320 image anchored
	// to the TOP at native pixel size, mirrored on the left/right edges. Its
	// width follows ig.system.width (right copy anchors to the right edge), but
	// its HEIGHT is the image's native 320px, so on a taller-than-native internal
	// resolution the tint stops short of the bottom (the bottom corners sit too
	// high). ig.Image#draw is crop-only and refuses sizes larger than the source,
	// so we can't just request a bigger height; instead we wrap the two image
	// draws in a vertical scale transform so the tint stretches to fill the real
	// screen height. No-op at native height. Independent of the UI mode above.
	function patchOverlayCorners() {
		if (ccuw._overlayPatched) return true;
		if (!(window.ig && ig.OverlayCornerGui && ig.OverlayCornerGui.prototype)) return false;

		const proto = ig.OverlayCornerGui.prototype;
		const origUpdateDrawables = proto.updateDrawables;

		proto.updateDrawables = function (renderer) {
			try {
				if (ig.perf.overlay && this.gfx && this.gfx.height > 0) {
					const sy = ig.system.height / this.gfx.height;
					if (sy > 1.001) {
						const tr = renderer.addTransform();
						tr.setScale(1, sy);
						try {
							renderer.addGfx(this.gfx, 0, 0);
							renderer.addGfx(
								this.gfx,
								this.hook.size.x - this.gfx.width,
								0,
								0,
								0,
								void 0,
								void 0,
								true,
							);
						} finally {
							renderer.undoTransform();
						}
						return;
					}
				}
			} catch (err) {
				if (!ccuw._overlayWarned) {
					ccuw._overlayWarned = true;
					console.error(`${TAG} overlay height fix failed, using vanilla draw:`, err);
				}
			}
			return origUpdateDrawables.call(this, renderer);
		};

		ccuw._overlayPatched = true;
		console.log(`${TAG} environmental edge-tint overlay height fix installed.`);
		return true;
	}

	// --- Title-screen parallax centering -----------------------------------
	// The title background (ig.ParallaxGui with parallax "title") is built from
	// 568px-wide native art. Left-anchored layers (sky/ground/railings) fill the
	// left 568px while right-anchored layers (clouds1, the "lea" character) snap
	// to the far-right screen edge, leaving the scene off-centre with a black gap
	// on the right. We size the parallax hook to the native 568px and centre it
	// horizontally, so the whole scene (including lea) lands in the middle with
	// symmetric letterbox bars. The menu buttons / DLC / Changelog are separate
	// GUIs and keep their own edge anchoring, untouched. Title parallax only.
	function patchTitleParallax() {
		if (ccuw._titleParallaxPatched) return true;
		if (!(window.ig && ig.ParallaxGui && ig.ParallaxGui.prototype)) return false;

		const proto = ig.ParallaxGui.prototype;
		const origInit = proto.init;

		proto.init = function (b, a) {
			origInit.call(this, b, a);
			try {
				if (b && b.parallax === 'title') {
					const w = ccuw.guiWidth || 568;
					if (ig.system.width > w) {
						this.hook.size.x = w;
						this.hook.pos.x = Math.floor((ig.system.width - w) / 2);
					}
				}
			} catch (err) {
				if (!ccuw._titleParallaxWarned) {
					ccuw._titleParallaxWarned = true;
					console.error(`${TAG} title parallax centering failed:`, err);
				}
			}
		};

		ccuw._titleParallaxPatched = true;
		console.log(`${TAG} title parallax centering installed.`);
		return true;
	}

	// --- Native Options > Video entry --------------------------------------
	// Adds an "Ultrawide UI" BUTTON_GROUP (Off / Centered / Stretched) to the
	// native VIDEO options category and supplies its localization by wrapping
	// ig.Lang#get. sc.OPTIONS_DEFINITION is iterated when sc.options is created
	// (after prestart), so injecting here means the default is seeded and the
	// value persists like any other native option.
	const LANG = {
		'sc.gui.options.ultrawide-ui.name': 'Ultrawide UI',
		'sc.gui.options.ultrawide-ui.description':
			'How menus, HUD and background art fill an ultrawide screen. ' +
			'Off keeps the vanilla layout (clusters left). ' +
			'Centered keeps the original layout centered with side bars. ' +
			'Stretched scales the UI to fill the whole width.',
		'sc.gui.options.ultrawide-ui.group': ['Off', 'Centered', 'Stretched'],
	};

	function patchLang() {
		if (ccuw._langPatched) return;
		if (!(window.ig && ig.Lang && ig.Lang.prototype && ig.Lang.prototype.get)) return;
		const proto = ig.Lang.prototype;
		const origGet = proto.get;
		proto.get = function (key) {
			if (Object.prototype.hasOwnProperty.call(LANG, key)) return LANG[key];
			return origGet.call(this, key);
		};
		ccuw._langPatched = true;
	}

	function injectOption() {
		if (ccuw._optInjected) return true;
		if (!(window.sc && sc.OPTIONS_DEFINITION && sc.OPTION_CATEGORY)) return false;
		try {
			sc.ULTRAWIDE_UI = { OFF: MODE.OFF, CENTER: MODE.CENTER, STRETCH: MODE.STRETCH };
			sc.OPTIONS_DEFINITION['ultrawide-ui'] = {
				type: 'BUTTON_GROUP',
				data: sc.ULTRAWIDE_UI,
				init: DEFAULT_MODE,
				cat: sc.OPTION_CATEGORY.VIDEO,
			};
			patchLang();
			ccuw._optInjected = true;
			console.log(`${TAG} added "Ultrawide UI" option to the Video menu.`);
			return true;
		} catch (err) {
			console.warn(`${TAG} could not add native option (using default mode):`, err);
			ccuw._optInjected = true; // don't retry forever
			return true;
		}
	}

	// Install the GUI patch and inject the native option now, retrying briefly
	// if a dependency isn't ready yet.
	function boot() {
		const patched = patchGui();
		const injected = injectOption();
		const overlay = patchOverlayCorners();
		const title = patchTitleParallax();
		if (patched && injected && overlay && title) return;

		let tries = 0;
		const timer = setInterval(() => {
			tries++;
			const p = ccuw._guiPatched || patchGui();
			const o = ccuw._optInjected || injectOption();
			const ov = ccuw._overlayPatched || patchOverlayCorners();
			const ti = ccuw._titleParallaxPatched || patchTitleParallax();
			if ((p && o && ov && ti) || tries > 200) clearInterval(timer); // ~ up to 10s
		}, 50);
	}

	try {
		boot();
	} catch (err) {
		console.error(`${TAG} prestart failed to initialise:`, err);
	}
})();
