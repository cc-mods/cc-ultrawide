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

	const TAG = '[cc-ultrawide]';

	const CONFIG = {
		/*
		 * mode:
		 *   'fill' (default) — Start from the game's NATIVE resolution and only widen the
		 *       field of view HORIZONTALLY, and only when your screen is actually wider than
		 *       native (i.e. when vanilla would show pillarbox bars on the left/right). The
		 *       native vertical view is always preserved, and screens at or below the native
		 *       aspect render exactly native — so the mod never invents an ultrawide image
		 *       where there is no empty space to fill. Pair with Display Type = Fit in-game.
		 *       e.g. 3440x1440 (21:9) -> internal 764x320;  1920x1080 (16:9) -> ~native.
		 *
		 *   'auto-integer' — Pick the largest INTEGER scale of your monitor height (pixel-
		 *       perfect, no blur) and fill BOTH axes. This also adds vertical view, so it can
		 *       zoom out a little even on non-ultrawide screens. Pair with Pixel Size = 4.
		 *       e.g. 3440x1440 -> scale 4 -> internal 860x360 -> exactly 4x to fill.
		 *
		 *   'aspect' — Alias of 'fill' (kept for back-compat).
		 *
		 *   'manual' — Use manualWidth / manualHeight exactly.
		 */
		mode: 'fill',

		// CrossCode's native logical resolution. Don't change these.
		nativeWidth: 568,
		nativeHeight: 320,

		// auto-integer: aim for an internal height near this value.
		// scale = round(screenHeight / targetInternalHeight).
		targetInternalHeight: 340,

		// manual mode values.
		manualWidth: 860,
		manualHeight: 360,

		// Force a specific viewport size instead of auto-detecting (0 = auto-detect).
		// Useful if DPI scaling reports a wrong size, or to pin a target regardless of the
		// current window. Otherwise leave at 0 and the mod uses the live game window size.
		screenWidth: 0,
		screenHeight: 0,

		// Safety cap on how wide we render, expressed as a max width:height ratio.
		// Going extremely wide can reveal the void past the edges of small rooms.
		// 0 = no cap. (21:9 is ~2.39; 32:9 is ~3.56.)
		maxAspect: 0,
	};

	// What drawable area should we fill? Usually the actual game WINDOW (innerWidth/innerHeight) is
	// right: on an ultrawide monitor a *windowed* 16:9 game must NOT get an ultrawide FOV squished
	// into it, and on cc-ios window.screen.* is wrong (portrait) while innerWidth is the true
	// landscape viewport. So innerWidth is the default.
	//
	// THE EXCEPTION — desktop FULLSCREEN: NW.js starts the window at a small default size (~1134x628)
	// and only switches to fullscreen AFTER this postload stage runs, but the logical resolution is
	// locked here (before ig.main). So innerWidth would be the tiny pre-fullscreen window and the FOV
	// would never reach the ultrawide monitor the game is about to fill. In that one case we read the
	// MONITOR (window.screen.*) instead. The game persists its fullscreen choice to localStorage as
	// "IG_FULLSCREEN" before postload, so it's readable here; cc-ios (a WKWebView, never NW.js
	// fullscreen) is excluded so its innerWidth path is untouched. A manual CONFIG override still wins.
	function isCCIos() {
		return !!(window.webkit && window.webkit.messageHandlers &&
			window.webkit.messageHandlers.cccontrol);
	}
	function wantsFullscreen() {
		if (isCCIos()) return false;
		try {
			return !!(window.localStorage &&
				window.localStorage.getItem('IG_FULLSCREEN') === 'true');
		} catch (_) {
			return false;
		}
	}
	function detectViewport() {
		const screenW = (window.screen && window.screen.width) || 0;
		const screenH = (window.screen && window.screen.height) || 0;
		const innerW = window.innerWidth > 0 ? window.innerWidth : 0;
		const innerH = window.innerHeight > 0 ? window.innerHeight : 0;
		// Desktop fullscreen → fill the monitor; otherwise → fill the window. Each still falls back
		// to the other (then a sane default) if its primary source is unavailable.
		const preferScreen = wantsFullscreen() && screenW > 0 && screenH > 0;
		const w = CONFIG.screenWidth
			|| (preferScreen ? screenW : (innerW || screenW || 1920));
		const h = CONFIG.screenHeight
			|| (preferScreen ? screenH : (innerH || screenH || 1080));
		return { w, h };
	}

	// Keep dimensions even — odd render sizes can cause half-pixel seams.
	function even(n) {
		n = Math.round(n);
		return n % 2 ? n + 1 : n;
	}

	function compute() {
		const { w: sw, h: sh } = detectViewport();
		const nativeAspect = CONFIG.nativeWidth / CONFIG.nativeHeight;
		let width, height;

		switch (CONFIG.mode) {
			case 'manual':
				width = CONFIG.manualWidth;
				height = CONFIG.manualHeight;
				break;

			case 'auto-integer': {
				const scale = Math.max(1, Math.round(sh / CONFIG.targetInternalHeight));
				height = even(sh / scale);
				width = even(sw / scale);
				break;
			}

			case 'fill':
			case 'aspect':
			default: {
				// Start from native and ONLY widen horizontally, and only when the screen is
				// genuinely wider than native. If the screen is the native aspect or taller/
				// narrower, vanilla already fills it (or letterboxes top/bottom), so widening
				// would just invent an ultrawide image with no empty side space to fill. The
				// native vertical FOV is always preserved.
				height = CONFIG.nativeHeight;
				const screenAspect = sw / sh;
				width = screenAspect > nativeAspect
					? even(height * screenAspect)
					: CONFIG.nativeWidth;
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

	// Read the persisted "Ultrawide Width" percentage (0..100) the CCModManager mod-settings slider
	// writes to localStorage (key "cc-ultrawide-width" = "<modId>-<key>"). 100 = full/max ultrawide
	// width (default), lower narrows the field of view toward native. We read it here (not from
	// modmanager.options, which doesn't exist yet at postload) because the logical resolution must be
	// set before ig.main(). Absent key (first launch, before poststart registers it) => default 100.
	function readWidthPct() {
		try {
			const ls = window.localStorage;
			const raw = ls ? ls.getItem('cc-ultrawide-width') : null;
			if (raw == null) return 100;
			const n = Number(raw);
			if (!isFinite(n)) return 100;
			return n < 0 ? 0 : (n > 100 ? 100 : n);
		} catch (_) {
			return 100;
		}
	}

	try {
		const viewport = detectViewport();
		const { width: maxWidth, height } = compute();

		// Apply the user's width percentage: 100% = the full auto-detected ultrawide width (max),
		// 0% = native. Interpolate linearly between native and max, keep it even, never below native.
		const pct = readWidthPct();
		let width = even(CONFIG.nativeWidth + (maxWidth - CONFIG.nativeWidth) * (pct / 100));
		if (width < CONFIG.nativeWidth) width = CONFIG.nativeWidth;
		if (width > maxWidth) width = maxWidth;

		window.IG_WIDTH = width;
		window.IG_HEIGHT = height;

		// Expose what we did so other mods / the console can read it.
		window.CC_ULTRAWIDE = Object.assign(window.CC_ULTRAWIDE || {}, {
			width,
			height,
			maxWidth,
			widthPct: pct,
			viewport,
			screen: viewport,
			mode: CONFIG.mode,
			nativeWidth: CONFIG.nativeWidth,
			nativeHeight: CONFIG.nativeHeight,
		});

		console.log(
			`${TAG} internal resolution -> ${width}x${height} ` +
			`(native ${CONFIG.nativeWidth}x${CONFIG.nativeHeight}, max ${maxWidth}, width ${pct}%) ` +
			`for window ${viewport.w}x${viewport.h}, mode='${CONFIG.mode}'.`,
		);
	} catch (err) {
		console.error(`${TAG} failed to apply, falling back to vanilla resolution:`, err);
	}
})();
