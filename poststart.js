// CrossCode Ultrawide — poststart.js
// ---------------------------------------------------------------------------
// Surfaces the mod's one user setting — "Ultrawide Width" — on the CCModManager
// "Mod settings" page (Mods list → focus this mod → right-click / controller R2),
// NOT in the native game Options menu. (Suite convention: a mod's settings live on
// its CCModManager page; see cc-mods/cc-agent-tools › crosscode-modding.md.)
//
// HOW THE WIDTH APPLIES
//   The slider is an OBJECT_SLIDER (0–100%, default 100%). CCModManager persists the
//   chosen value to localStorage under "cc-ultrawide-width" (= "<modId>-<key>") and
//   postload.js reads it at the next launch to set the ultrawide render width:
//   100% = the full screen-filling width, lower narrows the field of view toward the
//   native 16:9 width (centred, with letterbox bars). The engine fixes its resolution
//   at boot, so a change takes effect on the next game RESTART — to help you pick a
//   value without restarting repeatedly, every change flashes a live red-bar PREVIEW
//   of the resulting width (drawn by prestart.js via window.CC_ULTRAWIDE.previewWidthPct).
//
// WHERE IT RUNS
//   Only when CCModManager is present (it hosts the settings page). On a setup without
//   CCModManager this is a clean no-op — the width still works, defaulting to 100% (or
//   whatever value is already persisted), it just has no settings UI.
(function () {
	"use strict";

	var TAG = "[cc-ultrawide]";

	var mm = window.modmanager;
	if (!mm || typeof mm.registerAndGetModOptions !== "function") {
		console.log(TAG + " CCModManager not available; Ultrawide Width setting not registered (width still applies; default 100%).");
		return;
	}

	try {
		// OBJECT_SLIDER with min/max/step: CCModManager builds data = {0:0, 1:5, …, 20:100} and stores
		// the VALUE (entries[index]) — so localStorage "cc-ultrawide-width" holds the percentage directly.
		// customNumberDisplay shows that percentage on the thumb. changeEvent fires on every change with
		// `this` = the option; we read the new value and flash the preview bars.
		//
		// IMPORTANT — the localStorage id is "<modId>-<OPTION KEY>" (NOT the header key): CCModManager
		// derives it as `${settings.modId}-${optKey}`. So the option key MUST be "width" to land on
		// "cc-ultrawide-width" — the exact key postload.js reads at boot and changeEvent reads below.
		// (An earlier key of "ultrawideWidth" stored under "cc-ultrawide-ultrawideWidth", so the slider
		// never moved the value postload/preview actually read — the preview bars looked "stuck".)
		mm.registerAndGetModOptions(
			{ modId: "cc-ultrawide", title: "CrossCode Ultrawide" },
			{
				display: {
					settings: { tabIcon: "general", title: "Display" },
					headers: {
						general: {
							width: {
								type: "OBJECT_SLIDER",
								init: 100,
								min: 0,
								max: 100,
								step: 5,
								fill: true,
								name: "Ultrawide Width",
								description: "Width %. Lower clears a notch. Restart.",
								customNumberDisplay: function (index) {
									// index -> percentage for the 0..100 step-5 slider.
									var pct = 0;
									try {
										if (this && this.data && this.data[index] != null) pct = Number(this.data[index]);
										else pct = index * 5;
									} catch (e) { pct = index * 5; }
									return Math.round(pct) + "%";
								},
								changeEvent: function () {
									try {
										var raw = window.localStorage ? window.localStorage.getItem("cc-ultrawide-width") : null;
										var pct = raw == null ? 100 : Number(raw);
										if (!isFinite(pct)) pct = 100;
										if (window.CC_ULTRAWIDE && typeof window.CC_ULTRAWIDE.previewWidthPct === "function") {
											window.CC_ULTRAWIDE.previewWidthPct(pct);
										}
									} catch (e) { /* preview is best-effort */ }
								}
							}
						}
					}
				}
			}
		);
		console.log(TAG + " registered Ultrawide Width setting in CCModManager.");
	} catch (e) {
		// Never let a settings-registration failure surface as a game error.
		console.error(TAG + " failed to register mod settings (non-fatal):", e);
	}
})();
