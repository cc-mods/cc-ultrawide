/*
 * CrossCode Ultrawide — prestart.js
 * --------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 *   postload.js widens IG_WIDTH so the WORLD camera shows more (true ultrawide).
 *   Vanilla CrossCode then lays its menus, HUD and full-screen art out relative
 *   to the live (now wide) screen — and it does this well enough on its own
 *   that we do NOT touch the menu/HUD layout.
 *
 * WHAT THIS FILE DOES (prestart: ig.* / sc.* exist, before the game starts)
 *
 *     1. Environmental edge-tint overlay height fix (ig.OverlayCornerGui) — the
 *        soft edge vignette draws a 320px-tall image anchored to the TOP at native
 *        size; on a taller-than-native internal resolution it stops short of the
 *        bottom. ig.Image#draw is crop-only, so we wrap the two image draws in a
 *        vertical scale transform. No-op at native height.
 *
 *     2. Title-screen parallax centering (ig.ParallaxGui, parallax "title"). The
 *        568px-wide title art is left-anchored while clouds/lea snap right; we size
 *        that parallax to native width and centre it. No-op at native width.
 *
 *     3. "Ultrawide Width" PREVIEW overlay. The actual width is chosen on the
 *        CCModManager "Mod settings" page (see poststart.js) and only takes effect
 *        on the next game RESTART — the engine fixes the logical resolution at boot
 *        and has no safe live-resize path. So while you drag the width slider,
 *        poststart.js calls window.CC_ULTRAWIDE.previewWidthPct(pct) and we flash
 *        two red vertical bars showing where the render edges WOULD be at that width
 *        (a centred, narrower box), so you can pick a value that clears a notch /
 *        Dynamic Island, then restart to apply. The bars draw on top of the menu
 *        (zIndex above the menu layer) and fade out shortly after you stop dragging.
 *        They are purely visual and never change the actual render.
 *
 *        NOTE: the bars are drawn in the engine's render layer, which only spans the
 *        live canvas (the current render). They show a NARROWER future width (edges
 *        moving inward) — the shrink-to-clear-a-notch case. A future width WIDER than
 *        the current render would fall in the letterbox outside the canvas and can't
 *        be drawn here; that would need a native overlay (like the cc-ios FPS marker).
 *
 *   Everything is wrapped in try/catch and gated behind readiness checks, so any
 *   failure falls back to vanilla behaviour rather than breaking the game.
 */
(() => {
	'use strict';

	const TAG = '[cc-ultrawide]';

	// Native logical UI width the menus/HUD were authored for (vanilla IG_WIDTH).
	const NATIVE_GUI_WIDTH = 568;

	// Shared state (postload.js already created window.CC_ULTRAWIDE with width/maxWidth/widthPct).
	const ccuw = (window.CC_ULTRAWIDE = window.CC_ULTRAWIDE || {});
	ccuw.guiWidth = NATIVE_GUI_WIDTH;

	function clampPct(n) {
		n = Number(n);
		if (!isFinite(n)) return 100;
		return n < 0 ? 0 : (n > 100 ? 100 : n);
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

	// --- "Ultrawide Width" preview bars ------------------------------------
	const PREVIEW_HOLD_MS = 1200;   // how long the bars stay after the last slider move
	const BAR_COLOR = '#ff3b30';    // red
	const BAR_W = 3;                // logical px per bar

	let _overlay = null;
	let _hideTimer = null;

	// Pure geometry for the preview bars: for a width `pct` (0..100), given the current canvas width
	// `sw`, the max ultrawide width `maxW`, and the native width `nativeW`, return the future render
	// width and the centred left/right inset (in current-canvas px). Clamped so the bars never fall
	// outside the canvas. Exposed for unit tests.
	function previewGeometry(pct, sw, maxW, nativeW) {
		sw = sw | 0; maxW = (maxW | 0) || sw; nativeW = nativeW | 0;
		let futureW = Math.round(nativeW + (maxW - nativeW) * (clampPct(pct) / 100));
		if (futureW % 2) futureW -= 1;
		if (futureW < nativeW) futureW = nativeW;
		if (futureW > maxW) futureW = maxW;
		let frac = sw > 0 ? futureW / sw : 1;
		if (frac > 1) frac = 1;
		if (frac < 0) frac = 0;
		const off = Math.max(0, Math.floor((sw * (1 - frac)) / 2));
		return { futureW, frac, off };
	}

	// Lazily build the overlay the first time it's needed (ig.gui exists only at runtime, after the
	// game starts — not at prestart). Returns the overlay instance or null if unavailable.
	function ensureOverlay() {
		if (_overlay) return _overlay;
		if (!(window.ig && ig.gui && typeof ig.gui.addGuiElement === 'function' &&
			ig.GuiElementBase && ig.ColorGui && ig.system && ig.GUI_ALIGN)) return null;
		try {
			const Overlay = ig.GuiElementBase.extend({
				leftBar: null,
				rightBar: null,
				init() {
					this.parent();
					this.setSize(ig.system.width, ig.system.height);
					this.setAlign(ig.GUI_ALIGN.X_LEFT, ig.GUI_ALIGN.Y_TOP);
					this.hook.zIndex = 9999;     // above the menu layer (game tops out ~1201)
					this.hook.pauseGui = true;   // keep drawing while a menu pauses the game
					this.leftBar = new ig.ColorGui(BAR_COLOR, BAR_W, ig.system.height);
					this.rightBar = new ig.ColorGui(BAR_COLOR, BAR_W, ig.system.height);
					for (const bar of [this.leftBar, this.rightBar]) {
						bar.setAlign(ig.GUI_ALIGN.X_LEFT, ig.GUI_ALIGN.Y_TOP);
						bar.hook.alpha = 0;       // start hidden
						this.addChildGui(bar);
					}
				},
			});
			_overlay = new Overlay();
			ig.gui.addGuiElement(_overlay);
			return _overlay;
		} catch (e) {
			console.warn(`${TAG} preview overlay unavailable (non-fatal):`, e);
			_overlay = null;
			return null;
		}
	}

	// Position + show the bars for the given width percentage (0..100), then schedule a fade-out.
	// Bars are placed at the edges of the centred box the future width would occupy WITHIN the current
	// render (so a narrower width shows the bars moving inward). Purely visual.
	function flashPreview(pct) {
		const ov = ensureOverlay();
		if (!ov) return;
		try {
			const sw = ig.system.width | 0;
			const sh = ig.system.height | 0;
			const maxW = (ccuw.maxWidth | 0) || sw;
			const nativeW = ccuw.guiWidth | 0;

			const geo = previewGeometry(pct, sw, maxW, nativeW);
			const off = geo.off;

			ov.setSize(sw, sh);
			ov.leftBar.setSize(BAR_W, sh);
			ov.rightBar.setSize(BAR_W, sh);
			ov.leftBar.hook.pos.x = off;
			ov.leftBar.hook.pos.y = 0;
			ov.rightBar.hook.pos.x = Math.max(off, sw - off - BAR_W);
			ov.rightBar.hook.pos.y = 0;
			ov.leftBar.hook.alpha = 1;
			ov.rightBar.hook.alpha = 1;

			if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
			_hideTimer = setTimeout(() => {
				_hideTimer = null;
				try {
					if (_overlay) { _overlay.leftBar.hook.alpha = 0; _overlay.rightBar.hook.alpha = 0; }
				} catch (_) { /* ignore */ }
			}, PREVIEW_HOLD_MS);
		} catch (e) {
			if (!ccuw._previewWarned) {
				ccuw._previewWarned = true;
				console.error(`${TAG} width preview failed (non-fatal):`, e);
			}
		}
	}

	// Public API used by poststart.js (safe no-op until ig.gui exists / if the overlay can't build).
	ccuw.previewWidthPct = flashPreview;
	// Pure geometry helper, exposed for unit tests.
	ccuw._previewGeometry = previewGeometry;

	// Install the two render fixes now, retrying briefly if a dependency isn't ready yet. (The preview
	// overlay is created lazily on first use, so it isn't part of this readiness loop.)
	function boot() {
		const overlay = patchOverlayCorners();
		const title = patchTitleParallax();
		if (overlay && title) return;

		let tries = 0;
		const timer = setInterval(() => {
			tries++;
			const ov = ccuw._overlayPatched || patchOverlayCorners();
			const ti = ccuw._titleParallaxPatched || patchTitleParallax();
			if ((ov && ti) || tries > 200) clearInterval(timer); // ~ up to 10s
		}, 50);
	}

	try {
		boot();
	} catch (err) {
		console.error(`${TAG} prestart failed to initialise:`, err);
	}
})();
