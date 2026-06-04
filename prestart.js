/*
 * CrossCode Ultrawide — prestart.js
 * --------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 *   postload.js widens IG_WIDTH so the WORLD camera shows more (true ultrawide).
 *   Vanilla CrossCode then lays its menus, HUD and full-screen art out relative
 *   to the live (now wide) screen — and it does this well enough on its own
 *   that we do NOT touch the menu/HUD layout. (Earlier versions of this mod
 *   shipped a Centered / Stretched layout option; it produced poor results in
 *   menus and has been removed.)
 *
 * WHAT THIS FILE DOES
 *
 *   prestart runs after the game's classes/modules are defined (so ig.* / sc.*
 *   exist and can be patched) but before the game starts. Three things happen:
 *
 *     1. Environmental edge-tint overlay height fix
 *        (ig.OverlayCornerGui). The soft black/red/white edge vignette used in
 *        caves, hot zones, etc. draws a 240x320 image anchored to the TOP at
 *        native pixel size, mirrored on the left/right edges. Its WIDTH follows
 *        ig.system.width (the right copy anchors to the right edge), but its
 *        HEIGHT is the image's native 320px, so on a taller-than-native internal
 *        resolution the tint stops short of the bottom (bottom corners sit too
 *        high). ig.Image#draw is crop-only and refuses sizes larger than the
 *        source, so we wrap the two image draws in a vertical scale transform
 *        instead of requesting a bigger dest size. No-op at native height.
 *
 *     2. Title-screen parallax centering
 *        (ig.ParallaxGui, parallax "title" only). The title background is built
 *        from 568px-wide native art; left-anchored layers fill the left 568px
 *        while right-anchored layers (clouds, the "lea" character) snap to the
 *        far-right edge, leaving the scene off-centre with a black gap. We size
 *        that parallax's hook to native width and centre it, so the whole scene
 *        lands in the middle with symmetric letterbox bars. Menu buttons / DLC /
 *        Changelog are separate GUIs and are untouched. No-op at native width.
 *
 *     3. Native "Ultrawide Width Shrink" option (Options > Video)
 *        ARRAY_SLIDER 0..100. Brings UI anchored to the screen edges inward —
 *        right-side HUD (health, etc.) and menu buttons move closer to the
 *        centre, leaving symmetric empty space at the left/right edges. The
 *        WORLD render (camera FOV) is untouched. Useful for displays with a
 *        notch / bezel (e.g. AirPlay to an iPhone with a camera island). 0 = no
 *        shrink (vanilla). 100 = the GUI is laid out at native 568 width,
 *        centred. Changes take effect LIVE (no relaunch needed) because we
 *        patch the top-level GUI layout pass (ig.Gui#_updateRecursive) and read
 *        the option value each frame.
 *
 *        Full-screen background art / screen-fade overlays / the env edge tint
 *        are kept full-bleed (they still cover the entire screen) so shrinking
 *        only affects elements that anchor to the layout box edges. The shrink
 *        is implemented as a centred narrower top-level box: full-bleed hooks
 *        get their pos.x compensated by -offX so they continue to draw at
 *        screen 0..sw, while every other hook lays out inside the smaller box,
 *        moving X_LEFT/X_RIGHT anchored elements inward by offX automatically.
 *
 *   Everything is wrapped in try/catch and gated behind "bigger than native"
 *   checks where applicable, so any failure falls back to vanilla behaviour
 *   rather than breaking the game.
 */
(() => {
	'use strict';

	const TAG = '[crosscode-ultrawide]';

	// Native logical UI width the menus/HUD were authored for. This is the
	// vanilla IG_WIDTH and is independent of the widened gameplay width.
	const NATIVE_GUI_WIDTH = 568;

	// Shared state (postload.js may already have created window.CC_ULTRAWIDE).
	const ccuw = (window.CC_ULTRAWIDE = window.CC_ULTRAWIDE || {});
	ccuw.guiWidth = NATIVE_GUI_WIDTH;

	const ALIGN = (window.ig && ig.GUI_ALIGN) || { X_LEFT: 4, X_CENTER: 5, X_RIGHT: 6 };

	// Is this hook full-screen background art (as opposed to a menu/HUD piece)?
	function isArt(hook) {
		const g = hook.gui;
		if (!g) return false;
		if (typeof ig.ParallaxGui === 'function' && g instanceof ig.ParallaxGui) return true;
		if (typeof ig.ImageGui === 'function' && g instanceof ig.ImageGui) return true;
		return false;
	}

	function clampShrink(n) {
		n = Number(n);
		if (!isFinite(n)) return 0;
		if (n < 0) return 0;
		if (n > 100) return 100;
		return n;
	}

	// Read the current "Ultrawide Width Shrink" value from sc.options (live).
	function currentShrinkPct() {
		try {
			if (window.sc && sc.options && typeof sc.options.get === 'function') {
				const v = sc.options.get('ultrawide-width-shrink');
				if (typeof v === 'number') return clampShrink(v);
			}
		} catch (_) { /* fall through */ }
		return 0;
	}

	// --- Environmental edge-tint overlay height fix ------------------------
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

	// --- Native "Ultrawide Width Shrink" Video option ----------------------
	// sc.OPTIONS_DEFINITION is iterated when sc.options is created (after
	// prestart), so injecting here means the default is seeded and the value
	// persists like any other native option. ig.Lang#get is wrapped to supply
	// the option's label / description.
	const LANG = {
		'sc.gui.options.ultrawide-width-shrink.name': 'Ultrawide Width Shrink',
		'sc.gui.options.ultrawide-width-shrink.description':
			'Pulls menu buttons and HUD elements (health, etc.) inward from the ' +
			'screen edges, leaving symmetric empty space on the left and right. ' +
			'The game world / FOV is unchanged. Useful for displays with a notch ' +
			'or bezel (e.g. AirPlay to an iPhone with a camera island). 0 = no ' +
			'shrink; 100 = the whole UI is laid out at native 16:9 width, centred. ' +
			'Takes effect live.',
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
			sc.OPTIONS_DEFINITION['ultrawide-width-shrink'] = {
				type: 'ARRAY_SLIDER',
				data: [0, 100],
				init: 0,
				cat: sc.OPTION_CATEGORY.VIDEO,
				fill: true,
			};
			patchLang();
			ccuw._optInjected = true;
			console.log(`${TAG} added "Ultrawide Width Shrink" option to the Video menu.`);
			return true;
		} catch (err) {
			console.warn(`${TAG} could not add native option (using default):`, err);
			ccuw._optInjected = true; // don't retry forever
			return true;
		}
	}

	// --- Live GUI shrink (driven by the option) ----------------------------
	// Patch the top-level GUI layout pass (ig.Gui#_updateRecursive) to lay the
	// whole GUI out in a centred, narrower box when the option is > 0. Elements
	// that are full-bleed (screen-fade overlays, full-screen background art) are
	// kept covering the entire screen; everything else lays out inside the
	// smaller box, so X_LEFT / X_RIGHT anchored UI is pulled inward by offX and
	// X_CENTER stays in the absolute screen centre.
	function restore(touched) {
		for (let i = touched.length - 3; i >= 0; i -= 3) {
			touched[i][touched[i + 1]] = touched[i + 2];
		}
	}

	function prepareForShrink(hooks, sw, newBoxW, offX, touched) {
		for (let i = 0; i < hooks.length; i++) {
			const x = hooks[i];
			if (!x) continue;
			if (x.size.x >= sw - 2) {
				// Full-screen-sized hooks: keep screen-fades and background art
				// covering the whole screen, regardless of the smaller layout box.
				const fullBleed = !!x.screenBlocking || isArt(x);
				if (fullBleed) {
					if (x.align.x === ALIGN.X_LEFT || x.align.x === ALIGN.X_RIGHT) {
						touched.push(x.pos, 'x', x.pos.x);
						x.pos.x = -offX;
					}
					// size.x stays = sw, so the hook still spans 0..sw on screen.
				} else {
					// Generic full-width UI containers: clamp to the new box so
					// their children re-anchor inward.
					touched.push(x.size, 'x', x.size.x);
					x.size.x = newBoxW;
				}
			}
			const kids = x.children;
			if (kids && kids.length) prepareForShrink(kids, sw, newBoxW, offX, touched);
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
				const pct = currentShrinkPct();
				if (pct > 0) {
					try {
						const sw = ig.system.width | 0;
						const nw = ccuw.guiWidth | 0;
						if (sw > nw + 1) {
							// Linearly interpolate the box width between full ultrawide
							// (pct=0 -> sw) and native (pct=100 -> nw). Even-numbered
							// pixels avoid half-pixel seams in pixel-art.
							let shrinkPx = Math.floor((sw - nw) * (pct / 100));
							if (shrinkPx % 2) shrinkPx -= 1;
							if (shrinkPx > 0) {
								const newBoxW = sw - shrinkPx;
								const offX = shrinkPx >> 1;
								const touched = [];
								try {
									prepareForShrink(this.guiHooks, sw, newBoxW, offX, touched);
									return orig.call(this, offX, c, newBoxW, g, h, i, k, q, s, v, y);
								} finally {
									restore(touched);
								}
							}
						}
					} catch (err) {
						if (!ccuw._guiWarned) {
							ccuw._guiWarned = true;
							console.error(`${TAG} UI shrink patch failed, using vanilla layout:`, err);
						}
					}
				}
			}
			return orig.call(this, b, c, f, g, h, i, k, q, s, v, y);
		};

		ccuw._guiPatched = true;
		console.log(`${TAG} UI shrink layout patch installed (native GUI width ${ccuw.guiWidth}).`);
		return true;
	}

	// Install the four patches now, retrying briefly if a dependency isn't
	// ready yet.
	function boot() {
		const overlay = patchOverlayCorners();
		const title = patchTitleParallax();
		const injected = injectOption();
		const gui = patchGui();
		if (overlay && title && injected && gui) return;

		let tries = 0;
		const timer = setInterval(() => {
			tries++;
			const ov = ccuw._overlayPatched || patchOverlayCorners();
			const ti = ccuw._titleParallaxPatched || patchTitleParallax();
			const o = ccuw._optInjected || injectOption();
			const gp = ccuw._guiPatched || patchGui();
			if ((ov && ti && o && gp) || tries > 200) clearInterval(timer); // ~ up to 10s
		}, 50);
	}

	try {
		boot();
	} catch (err) {
		console.error(`${TAG} prestart failed to initialise:`, err);
	}
})();
