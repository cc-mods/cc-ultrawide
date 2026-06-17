/* Headless Node tests for cc-ultrawide (no game, no browser, no window).
 *
 * Loads the three mod scripts in a VM with stubbed globals and asserts:
 *   - postload computes IG_WIDTH from the CCModManager-persisted "cc-ultrawide-width" %, interpolating
 *     native..max, clamped.
 *   - prestart exposes the preview API + a pure preview-geometry helper (bar inset math).
 *   - poststart registers the width OBJECT_SLIDER on the CCModManager mod-settings page (init 100,
 *     min/max/step), and its changeEvent reads the persisted % and flashes the preview.
 *
 * Run: `node test/ultrawide.test.js` (or `npm test`).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + name); } }

function fakeLocalStorage(initial) {
	const store = Object.assign({}, initial);
	return {
		getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
		setItem: (k, v) => { store[k] = String(v); },
		removeItem: (k) => { delete store[k]; },
		_store: store,
	};
}
function runFile(file, sandbox) {
	const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
	vm.createContext(sandbox);
	vm.runInContext(src, sandbox, { filename: file });
	return sandbox;
}

// ---- postload: width % -> IG_WIDTH (reads "cc-ultrawide-width") ----------------------
function postload(opts) {
	const win = {
		innerWidth: opts.innerWidth,
		innerHeight: opts.innerHeight,
		screen: { width: opts.innerWidth, height: opts.innerHeight },
		localStorage: fakeLocalStorage(opts.ls || {}),
		CC_ULTRAWIDE: undefined,
	};
	runFile('postload.js', { console: { log() {}, warn() {}, error() {} }, window: win });
	return win;
}

(function () {
	// 1200x600 -> aspect 2.0 > native 1.775 -> max width even(320*2)=640.
	let w = postload({ innerWidth: 1200, innerHeight: 600 });
	ok('postload: default (no key) = full max width', w.IG_WIDTH === 640 && w.CC_ULTRAWIDE.maxWidth === 640);
	ok('postload: height stays native', w.IG_HEIGHT === 320);
	ok('postload: widthPct defaults to 100', w.CC_ULTRAWIDE.widthPct === 100);

	ok('postload: reads the CCModManager key cc-ultrawide-width',
		postload({ innerWidth: 1200, innerHeight: 600, ls: { 'cc-ultrawide-width': '0' } }).IG_WIDTH === 568);
	ok('postload: 50% interpolates native..max',
		postload({ innerWidth: 1200, innerHeight: 600, ls: { 'cc-ultrawide-width': '50' } }).IG_WIDTH === 604);
	ok('postload: 100% = max',
		postload({ innerWidth: 1200, innerHeight: 600, ls: { 'cc-ultrawide-width': '100' } }).IG_WIDTH === 640);
	ok('postload: bad value -> 100%',
		postload({ innerWidth: 1200, innerHeight: 600, ls: { 'cc-ultrawide-width': 'x' } }).IG_WIDTH === 640);
	ok('postload: ignores the OLD key name',
		postload({ innerWidth: 1200, innerHeight: 600, ls: { 'cc-ultrawide.width': '0' } }).IG_WIDTH === 640);
	ok('postload: non-ultrawide screen stays native',
		postload({ innerWidth: 568, innerHeight: 320, ls: { 'cc-ultrawide-width': '50' } }).IG_WIDTH === 568);
})();

// ---- prestart: preview API + pure geometry ------------------------------------------
function loadPrestart() {
	const win = { CC_ULTRAWIDE: undefined };
	runFile('prestart.js', {
		console: { log() {}, warn() {}, error() {} },
		window: win,
		setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
		ig: undefined,
	});
	return win.CC_ULTRAWIDE;
}
(function () {
	const ccuw = loadPrestart();
	ok('prestart: exposes previewWidthPct()', ccuw && typeof ccuw.previewWidthPct === 'function');
	ok('prestart: previewWidthPct is a safe no-op without ig.gui', (() => {
		try { ccuw.previewWidthPct(50); return true; } catch (_) { return false; }
	})());
	const geo = ccuw._previewGeometry;
	ok('prestart: exposes _previewGeometry()', typeof geo === 'function');

	// applied-pct + restart-needed decision (drives the "leave menu -> offer restart" prompt).
	ok('prestart: exposes _appliedPct()/_restartNeeded()',
		typeof ccuw._appliedPct === 'function' && typeof ccuw._restartNeeded === 'function');
	ok('prestart: _appliedPct defaults to 100 (no boot width)', ccuw._appliedPct() === 100);
	ok('prestart: _restartNeeded false at the default', ccuw._restartNeeded(100) === false);
	ccuw.widthPct = 70; // pretend postload applied 70% at boot
	ok('prestart: _appliedPct reflects the applied width', ccuw._appliedPct() === 70);
	ok('prestart: _restartNeeded false when unchanged', ccuw._restartNeeded(70) === false);
	ok('prestart: _restartNeeded true when moved away', ccuw._restartNeeded(55) === true);
	ccuw.widthPct = undefined; // reset for any later assertions

	// From a full-width canvas (sw=max=640, native=568): 100% -> no inset; 0% -> inset to native.
	ok('geo 100% full canvas: no inset', geo(100, 640, 640, 568).off === 0 && geo(100, 640, 640, 568).futureW === 640);
	const g0 = geo(0, 640, 640, 568);
	ok('geo 0% -> future native width', g0.futureW === 568);
	ok('geo 0% -> centred inset > 0', g0.off === Math.floor((640 * (1 - 568 / 640)) / 2));
	const g50 = geo(50, 640, 640, 568);
	ok('geo 50% -> width between native and max', g50.futureW === 604 && g50.off > 0 && g50.off < g0.off);
	// future wider than the current canvas clamps to the canvas (frac<=1, off=0)
	ok('geo wider-than-canvas clamps to edges', geo(100, 600, 640, 568).off === 0);
	// even width
	ok('geo width is even', geo(37, 640, 640, 568).futureW % 2 === 0);
})();

// ---- poststart: CCModManager registration + changeEvent -----------------------------
function loadPoststart(opts) {
	opts = opts || {};
	let registered = null;
	const previewCalls = [];
	const win = {
		localStorage: fakeLocalStorage(opts.ls || {}),
		CC_ULTRAWIDE: { previewWidthPct: (pct) => previewCalls.push(pct) },
		modmanager: opts.noModmanager ? undefined : {
			registerAndGetModOptions: (info, schema) => { registered = { info, schema }; return {}; },
		},
	};
	runFile('poststart.js', { console: { log() {}, warn() {}, error() {} }, window: win });
	return { registered, previewCalls, win };
}
(function () {
	const { registered } = loadPoststart();
	ok('poststart: registers with CCModManager', !!registered);
	ok('poststart: modId + title', registered && registered.info.modId === 'cc-ultrawide');
	// The localStorage id CCModManager derives is `${modId}-${OPTION KEY}` (NOT the header key), so the
	// option key MUST be "width" to match postload/preview's "cc-ultrawide-width". Guard both keys.
	ok('poststart: header key is "general"',
		registered && Object.keys(registered.schema.display.headers)[0] === 'general');
	ok('poststart: option key is "width" (=> id cc-ultrawide-width)',
		registered && Object.keys(registered.schema.display.headers.general)[0] === 'width');
	const opt = registered && registered.schema.display &&
		registered.schema.display.headers.general.width;
	ok('poststart: registers an OBJECT_SLIDER', !!opt && opt.type === 'OBJECT_SLIDER');
	ok('poststart: default 100, range 0..100 step 5', opt && opt.init === 100 && opt.min === 0 && opt.max === 100 && opt.step === 5);
	ok('poststart: has name + description', opt && /Ultrawide Width/.test(opt.name) && typeof opt.description === 'string');
	ok('poststart: customNumberDisplay renders percent',
		opt && opt.customNumberDisplay.call({ data: { 0: 0, 10: 50, 20: 100 } }, 20) === '100%');

	// changeEvent reads the persisted % and flashes the preview.
	const r2 = loadPoststart({ ls: { 'cc-ultrawide-width': '70' } });
	const opt2 = r2.registered.schema.display.headers.general.width;
	opt2.changeEvent.call(opt2);
	ok('poststart: changeEvent flashes preview with persisted %', r2.previewCalls.length === 1 && r2.previewCalls[0] === 70);

	// No CCModManager -> clean no-op (no throw, nothing registered).
	let threw = false;
	try { loadPoststart({ noModmanager: true }); } catch (_) { threw = true; }
	ok('poststart: no-op without CCModManager', !threw);
})();

console.log((fail === 0 ? 'ok' : 'FAILED') + ' — ultrawide: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
