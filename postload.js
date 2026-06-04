/*
 * CrossCode Ultrawide — postload.js
 * ---------------------------------
 * WHY THIS WORKS (read the README for the full breakdown):
 *
 *   assets/node-webkit.html sets, in the page <head>:
 *       var IG_WIDTH  = 568;   // internal render width  (~16:9 with 320)
 *       var IG_HEIGHT = 320;   // internal render height
 *
 *   On startup the game runs:
 *       ig.main("#canvas","#game", sc.CrossCode, fps,
 *               window.IG_WIDTH, window.IG_HEIGHT, window.IG_GAME_SCALE, ...)
 *
 *   ig.main -> new ig.System -> ig.system.resize(w, h, scale) which sets
 *   ig.system.width / ig.system.height. THAT is the logical resolution: the
 *   actual coordinate space and field of view the camera renders.
 *
 *   The in-game "Display Type" (Fit / Stretch) only changes the canvas CSS size
 *   via setCanvasSize() — i.e. how the fixed 568x320 image is stretched onto your
 *   monitor. It does NOT add view. So to get TRUE ultrawide we must widen
 *   IG_WIDTH itself, before ig.main runs.
 *
 *   CCLoader injects the `postload` stage AFTER the game's <head> scripts have run
 *   (so IG_WIDTH is already 568) but BEFORE ig.main() is called. That makes
 *   `postload` the correct, reliable place to override the resolution.
 */
(() => {
	'use strict';

	const TAG = '[crosscode-ultrawide]';

	const CONFIG = {
		/*
		 * mode:
		 *   'auto-integer' (default) — Pick the largest INTEGER scale that fills your
		 *       monitor's height. Result is pixel-perfect (no blur/shimmer) AND
		 *       ultrawide. Pair with Display Type = Fit, Pixel Size = 4 in-game.
		 *       e.g. 3440x1440 -> scale 4 -> internal 860x360 -> exactly 4x to fill.
		 *
		 *   'aspect' — Keep the game's native 320px vertical view and only widen
		 *       horizontally to match your monitor aspect. The scale will usually be
		 *       fractional (e.g. 4.5x), so use Display Type = Fit (slightly softer).
		 *       e.g. 3440x1440 -> internal 764x320.
		 *
		 *   'manual' — Use manualWidth / manualHeight exactly.
		 */
		mode: 'auto-integer',

		// CrossCode's native logical resolution. Don't change these.
		nativeWidth: 568,
		nativeHeight: 320,

		// auto-integer: aim for an internal height near this value.
		// scale = round(screenHeight / targetInternalHeight).
		targetInternalHeight: 340,

		// manual mode values.
		manualWidth: 860,
		manualHeight: 360,

		// Force a specific screen size instead of auto-detecting (0 = auto-detect).
		// Useful if Windows DPI scaling reports a wrong size; otherwise leave at 0.
		screenWidth: 0,
		screenHeight: 0,

		// Safety cap on how wide we render, expressed as a max width:height ratio.
		// Going extremely wide can reveal the void past the edges of small rooms.
		// 0 = no cap. (21:9 is ~2.39; 32:9 is ~3.56.)
		maxAspect: 0,
	};

	function detectScreen() {
		const w = CONFIG.screenWidth || (window.screen && window.screen.width) || 1920;
		const h = CONFIG.screenHeight || (window.screen && window.screen.height) || 1080;
		return { w, h };
	}

	// Keep dimensions even — odd render sizes can cause half-pixel seams.
	function even(n) {
		n = Math.round(n);
		return n % 2 ? n + 1 : n;
	}

	function compute() {
		const { w: sw, h: sh } = detectScreen();
		let width, height;

		switch (CONFIG.mode) {
			case 'manual':
				width = CONFIG.manualWidth;
				height = CONFIG.manualHeight;
				break;

			case 'aspect':
				height = CONFIG.nativeHeight;
				width = even(height * (sw / sh));
				break;

			case 'auto-integer':
			default: {
				const scale = Math.max(1, Math.round(sh / CONFIG.targetInternalHeight));
				height = even(sh / scale);
				width = even(sw / scale);
				break;
			}
		}

		// Never go smaller than native — that would letterbox and break HUD layout.
		if (width < CONFIG.nativeWidth) width = CONFIG.nativeWidth;
		if (height < CONFIG.nativeHeight) height = CONFIG.nativeHeight;

		if (CONFIG.maxAspect > 0) {
			const maxW = even(height * CONFIG.maxAspect);
			if (width > maxW) width = maxW;
		}

		return { width, height };
	}

	try {
		const screen = detectScreen();
		const { width, height } = compute();

		window.IG_WIDTH = width;
		window.IG_HEIGHT = height;

		// Expose what we did so other mods / the console can read it.
		window.CC_ULTRAWIDE = {
			width,
			height,
			screen,
			mode: CONFIG.mode,
			nativeWidth: CONFIG.nativeWidth,
			nativeHeight: CONFIG.nativeHeight,
		};

		console.log(
			`${TAG} internal resolution -> ${width}x${height} ` +
			`(native ${CONFIG.nativeWidth}x${CONFIG.nativeHeight}) ` +
			`for screen ${screen.w}x${screen.h}, mode='${CONFIG.mode}'.`,
		);
	} catch (err) {
		console.error(`${TAG} failed to apply, falling back to vanilla resolution:`, err);
	}
})();
