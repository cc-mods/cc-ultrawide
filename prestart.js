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
 *        ARRAY_SLIDER 0..100. Shrinks the internal render WIDTH only (height
 *        untouched) for displays with a notch / bezel (e.g. AirPlay to an iPhone
 *        with a camera island). UI anchored to ig.system.width automatically
 *        follows the new width inward. The actual shrink is applied by
 *        postload.js (which must run BEFORE ig.main); this file mirrors the
 *        persisted value to a dedicated localStorage key on every change so
 *        postload can read it on the next launch before sc.options exists.
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

	// Persisted localStorage key read by postload.js on the NEXT launch.
	const SHRINK_STORAGE_KEY = 'cc-ultrawide-shrink';

	// Shared state (postload.js may already have created window.CC_ULTRAWIDE).
	const ccuw = (window.CC_ULTRAWIDE = window.CC_ULTRAWIDE || {});
	ccuw.guiWidth = NATIVE_GUI_WIDTH;

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
			'Shrinks the rendered width to add equal letterbox bars on the left ' +
			'and right (height is unchanged). Useful for displays with a notch / ' +
			'bezel (e.g. AirPlay to an iPhone with a camera island). 0 = full ' +
			'ultrawide width; 100 = back to native 16:9 width. UI anchored to the ' +
			'screen edges follows the new width inward. ' +
			'TAKES EFFECT ON THE NEXT GAME LAUNCH.',
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

	// Mirror the persisted "ultrawide-width-shrink" value into a dedicated
	// localStorage key so postload.js (which runs BEFORE sc.options exists) can
	// read it on the next launch and adjust IG_WIDTH accordingly. We patch
	// sc.OptionModel#set to catch live changes, and also seed the key once after
	// sc.options has loaded its values from storage (covers the first launch
	// after the option is added and any "Set to default" path).
	function patchShrinkMirror() {
		if (ccuw._shrinkMirrorPatched) return true;
		if (!(window.sc && sc.OptionModel && sc.OptionModel.prototype)) return false;

		const proto = sc.OptionModel.prototype;
		const origSet = proto.set;
		proto.set = function (key, value) {
			const ret = origSet.apply(this, arguments);
			try {
				if (key === 'ultrawide-width-shrink') {
					localStorage.setItem(SHRINK_STORAGE_KEY, String(clampShrink(value)));
				}
			} catch (_) {
				/* never let storage break the option model */
			}
			return ret;
		};

		// Seed once if sc.options is already loaded; otherwise wait briefly.
		const seed = () => {
			try {
				if (window.sc && sc.options && typeof sc.options.get === 'function') {
					const v = sc.options.get('ultrawide-width-shrink');
					if (typeof v === 'number') {
						localStorage.setItem(SHRINK_STORAGE_KEY, String(clampShrink(v)));
					}
					return true;
				}
			} catch (_) { /* ignore */ }
			return false;
		};
		if (!seed()) {
			let tries = 0;
			const t = setInterval(() => {
				tries++;
				if (seed() || tries > 600) clearInterval(t); // ~30s
			}, 50);
		}

		ccuw._shrinkMirrorPatched = true;
		return true;
	}

	function clampShrink(n) {
		n = Number(n);
		if (!isFinite(n)) return 0;
		if (n < 0) return 0;
		if (n > 100) return 100;
		return n;
	}

	// Install the three patches now, retrying briefly if a dependency isn't
	// ready yet.
	function boot() {
		const overlay = patchOverlayCorners();
		const title = patchTitleParallax();
		const injected = injectOption();
		const shrink = patchShrinkMirror();
		if (overlay && title && injected && shrink) return;

		let tries = 0;
		const timer = setInterval(() => {
			tries++;
			const ov = ccuw._overlayPatched || patchOverlayCorners();
			const ti = ccuw._titleParallaxPatched || patchTitleParallax();
			const o = ccuw._optInjected || injectOption();
			const sh = ccuw._shrinkMirrorPatched || patchShrinkMirror();
			if ((ov && ti && o && sh) || tries > 200) clearInterval(timer); // ~ up to 10s
		}, 50);
	}

	try {
		boot();
	} catch (err) {
		console.error(`${TAG} prestart failed to initialise:`, err);
	}
})();
