// ==UserScript==
// @name         Wplace Overlay
// @namespace    https://cfp.is-a.dev/wplace
// @version      2.1
// @description  Overlay for Wplace
// @author       cfp
// @match        https://wplace.live/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=wplace.live
// @license      ARR
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==

const IS_TAMPERMONKEY = typeof GM_getValue === "function" && typeof GM_setValue === "function" && typeof unsafeWindow === "object";
let overlayMode = IS_TAMPERMONKEY ? GM_getValue("OVERLAY_MODE", "over") : "over";
const OVERLAY_MODES = ["off", "over", "symbol", "difference", "out", "fill"];
let darken = IS_TAMPERMONKEY ? GM_getValue("DARKEN", false) : false;
const STYLES = ["liberty", "positron", "bright", "dark", "fiord"];
let currentStyle = "liberty";
function getMap() {
	const el = document.querySelector("div.absolute.bottom-3.right-3.z-30 > button")
	return el
		? (el.__click
			? el.__click[3].v
			: null)
		: null;
}

// =============================================================
// Want to add your own image to the overlay?
// We can help you with that on our discord server.
// See our web page on https://cfp.is-a.dev/wplace/ for details.
// =============================================================
const HOST = "cfp.is-a.dev";
const SUBPATH = "/wplace";

// Worker for canvas operations
const WORKER_CODE = `
self.addEventListener("message", async (event) => {
    const { id, originalBlob, overlayBlob, width, height, darken, overlayMode } = event.data;
    const OVERLAY_MODES = {"over": "source-over", "symbol": "source-over", "difference": "difference", "out": "source-out", "fill": "source-over"}
    const originalBitmap = await createImageBitmap(originalBlob);
    let overlayBitmap = await createImageBitmap(overlayBlob);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.imageSmoothingEnabled = false;

    ctx.drawImage(originalBitmap, 0, 0, width, height);
    ctx.globalCompositeOperation = OVERLAY_MODES[overlayMode] || "source-over";

    ctx.drawImage(overlayBitmap, 0, 0, width, height);
    if(darken) {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = "source-over";

    const resultBlob = await canvas.convertToBlob();
    self.postMessage({ id, resultBlob });
})
`

const workerBlob = new Blob([WORKER_CODE], { type: "application/javascript" });
const workerUrl = URL.createObjectURL(workerBlob);
const worker = new Worker(workerUrl);

const pending = new Map();

worker.onmessage = (e) => {
	const { id, resultBlob, error } = e.data;
	if (!pending.has(id)) return;
	if (error) {
		pending.get(id).reject(new Error(error));
	} else {
		pending.get(id).resolve(resultBlob);
	}
	pending.delete(id);
};

function postToWorker(data) {
	return new Promise((resolve, reject) => {
		pending.set(data.id, { resolve, reject });
		worker.postMessage(data);
	});
}

const fallbackSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <rect width="64" height="64" fill="#ccc"/>
  <text x="32" y="37" font-size="24" text-anchor="middle" fill="#333">!</text>
</svg>`;

const fallbackBlob = new Blob([fallbackSVG], { type: "image/svg+xml" });

const originalFetch = window.fetch;

if(!IS_TAMPERMONKEY) {
	unsafeWindow = window;
}

window.fetch = unsafeWindow.fetch = new Proxy(fetch, {
	apply: async (target, thisArg, argList) => {
		if (!argList[0]) {
			throw new Error("No URL provided to fetch");
		}

		const urlString = typeof argList[0] === "object" ? argList[0].url : argList[0];

		let url;
		try {
			url = new URL(urlString);
		} catch (e) {
			throw new Error("Invalid URL provided to fetch");
		}

		if (url.hostname === "backend.wplace.live" && url.pathname.startsWith("/files/")) {
			console.log("Intercepted fetch request to wplace.live");
			if (overlayMode == "difference" || overlayMode == "out") {
				const tileX = url.pathname.split("/")[4];
				let tileY = url.pathname.split("/")[5];
				if (overlayMode !== "over" && overlayMode !== "symbol") {
					tileY = tileY.replace(".png", "_orig.png");
				}

				let overlayUrl = overlayMode === "symbol" ?
					`https://${HOST}${SUBPATH}/tiles/${tileX}/${tileY.replace(".png", "_sym.png")}` : `https://${HOST}${SUBPATH}/tiles/${tileX}/${tileY}`;

				const [originalRes, overlayRes] = await Promise.all([
					originalFetch(urlString),
					originalFetch(overlayUrl)
				])

				if (overlayRes.status !== 200) {
					if (overlayRes.status === 404) {
						return originalRes;
					}
					console.error(`Overlay fetch failed with status ${overlayRes.status}, returning fallback`);
					return new Response(fallbackBlob, {
						status: 200,
						statusText: "OK",
						headers: {
							"Content-Type": fallbackBlob.type,
							"Cache-Control": "no-cache",
						}
					});
				}
				if (originalRes.status !== 200) {
					if (originalRes.status === 404) {
						return overlayRes;
					}
					// throw new Error(`Original fetch failed with status ${originalRes.status}`);
					console.error(`Original fetch failed with status ${originalRes.status}, returning fallback`);
					return new Response(fallbackBlob, {
						status: 200,
						statusText: "OK",
						headers: {
							"Content-Type": fallbackBlob.type,
							"Cache-Control": "no-cache",
						}
					});
				}

				const [originalBlob, overlayBlob] = await Promise.all([
					originalRes.blob(),
					overlayRes.blob()
				]);

				let width, height = 0;

				if (overlayMode !== "symbol") {
					width = 3000;
					height = 3000;
				} else {
					width = 7000;
					height = 7000;
				}

				const id = crypto.randomUUID();

				const resultBlob = await postToWorker({
					id,
					originalBlob,
					overlayBlob,
					width,
					height,
					darken,
					overlayMode
				});

				return new Response(resultBlob, {
					status: 200,
					statusText: "OK",
					headers: {
						"Content-Type": resultBlob.type,
						"Cache-Control": originalRes.headers.get("Cache-Control") || "no-cache",
					}
				});
			}
		}

		return target.apply(thisArg, argList);
	}
});

function updateOverlayMode() {
	const map = getMap();
	if (map.getLayer("overlay")) {
		map.removeLayer("overlay");
	}
	if (map.getSource("overlay")) {
		map.removeSource("overlay");
	}
	if (map.getLayer("darken")) {
		map.removeLayer("darken");
	}
	if (map.getSource("darken")) {
		map.removeSource("darken");
	}

	if(overlayMode === "off" || overlayMode === "difference" || overlayMode === "out") {
		map.refreshTiles("pixel-art-layer");
		return;
	}

	const suffix = (overlayMode === "symbol")
		? "_sym"
		: overlayMode === "fill"
			? "_orig"
			: "";

	map.addSource("overlay", {
		type: "raster",
		maxzoom: 11,
		minzoom: 11,
		tileSize: 550,
		tiles: [`https://${HOST}${SUBPATH}/tiles/{x}/{y}${suffix}.png`]
	});
	map.addLayer({
		id: "overlay",
		type: "raster",
		source: "overlay",
		paint: {
			"raster-resampling": "nearest",
			"raster-opacity": 1
		}
	}, "pixel-hover")

	if(darken) {
		map.addSource("darken", {
			type: "raster",
			maxzoom: 11,
			minzoom: 11,
			tileSize: 550,
			tiles: [`https://${HOST}${SUBPATH}/darken.png`]
		});
		map.addLayer({
			id: "darken",
			type: "raster",
			source: "darken",
			paint: {
				"raster-resampling": "nearest",
				"raster-opacity": 1
			}
		}, "pixel-art-layer");
	}
}

function ensureLayerOrder() {
	const map = getMap();
	if (!map.getLayer("overlay")) {
		updateOverlayMode();
		return;
	}
	const layers = map.getStyle().layers;
	const overlayIndex = layers.findIndex(l => l.id === "overlay");
	const hoverIndex = layers.findIndex(l => l.id === "pixel-hover");

	if (overlayIndex === -1 || hoverIndex === -1) {
		return;
	}

	if (hoverIndex - 1 !== overlayIndex) {
		map.moveLayer("overlay", "pixel-hover");
	}
}

const symbolList = ["Black", "Dark Gray", "Gray", "Medium Gray", "Light Gray", "White", "Deep Red", "Dark Red", "Red", "Light Red", "Dark Orange", "Orange", "Gold", "Yellow", "Light Yellow", "Dark Goldenrod", "Goldenrod", "Light Goldenrod", "Dark Olive", "Olive", "Light Olive", "Dark Green", "Green", "Light Green", "Dark Teal", "Teal", "Light Teal", "Dark Cyan", "Cyan", "Light Cyan", "Dark Blue", "Blue", "Light Blue", "Dark Indigo", "Indigo", "Light Indigo", "Dark Slate Blue", "Slate Blue", "Light Slate Blue", "Dark Purple", "Purple", "Light Purple", "Dark Pink", "Pink", "Light Pink", "Dark Peach", "Peach", "Light Peach", "Dark Brown", "Brown", "Light Brown", "Dark Tan", "Tan", "Light Tan", "Dark Beige", "Beige", "Light Beige", "Dark Stone", "Stone", "Light Stone", "Dark Slate", "Slate", "Light Slate"];

function patchUI() {
	if (document.getElementById("overlay-button")) {
		return; // Button already exists, no need to patch again
	}
	if (!document.querySelector("#overlay-options")) {
		let overlayOptions = document.createElement("div");
		overlayOptions.id = "overlay-options";
		overlayOptions.style.position = "fixed";
		overlayOptions.style.top = "50%";
		overlayOptions.style.right = "50%";
		overlayOptions.style.transform = "translate(50%, -50%)";
		overlayOptions.style.width = "50%";
		overlayOptions.style.zIndex = "1000";
		overlayOptions.style.display = "none";
		overlayOptions.style.flexDirection = "column";
		overlayOptions.style.gap = "10px";
		overlayOptions.style.backgroundColor = "#0e0e0e7f";
		overlayOptions.style.padding = "10px";
		overlayOptions.style.borderRadius = "8px";
		overlayOptions.style.backdropFilter = "blur(15px)";
		document.body.appendChild(overlayOptions);

		let header = document.createElement("h2");
		header.textContent = "Wplace Overlay";
		header.style.color = "white";
		header.style.fontSize = "1.5em";
		header.style.fontWeight = "bold";
		header.style.display = "flex";
		header.style.alignItems = "center";
		overlayOptions.appendChild(header);

		let closeButton = document.createElement("button");
		closeButton.textContent = "X";
		closeButton.classList = "btn btn-square shadow-md";
		closeButton.style.marginLeft = "auto";
		closeButton.addEventListener("click", async () => {
			overlayOptions.animate([
				{ opacity: 1, transform: "translate(50%, -50%)" },
				{ opacity: 0, transform: "translate(50%, -40%)" }
			], {
				duration: 200,
				easing: "ease-out",
				fill: "forwards"
			});
			await new Promise(resolve => setTimeout(resolve, 200));
			overlayOptions.style.display = "none";
		});
		header.appendChild(closeButton);

		let blendButton = document.createElement("button");
		blendButton.id = "overlay-blend-button";
		blendButton.textContent = "Overlay: " + overlayMode.charAt(0).toUpperCase() + overlayMode.slice(1);
		blendButton.style.backgroundColor = "#0e0e0e7f";
		blendButton.style.color = "white";
		blendButton.style.border = "solid";
		blendButton.style.borderColor = "#1d1d1d7f";
		blendButton.style.borderRadius = "4px";
		blendButton.style.padding = "5px 10px";
		blendButton.style.cursor = "pointer";
		blendButton.style.backdropFilter = "blur(2px)";

		blendButton.addEventListener("click", () => {
			overlayMode = OVERLAY_MODES[(OVERLAY_MODES.indexOf(overlayMode) + 1) % OVERLAY_MODES.length];
			if (IS_TAMPERMONKEY) GM_setValue("OVERLAY_MODE", overlayMode);
			blendButton.textContent = `Overlay: ${overlayMode.charAt(0).toUpperCase() + overlayMode.slice(1)}`;
			console.log("Overlay mode set to:", overlayMode);
			updateOverlayMode();
		});

		let darkenMode = document.createElement("button");
		darkenMode.textContent = `Darken: ${darken ? "On" : "Off"}`;
		darkenMode.style.backgroundColor = "#0e0e0e7f";
		darkenMode.style.color = "white";
		darkenMode.style.border = "solid";
		darkenMode.style.borderColor = "#1d1d1d7f";
		darkenMode.style.borderRadius = "4px";
		darkenMode.style.padding = "5px 10px";
		darkenMode.style.cursor = "pointer";
		darkenMode.style.backdropFilter = "blur(2px)";

		darkenMode.addEventListener("click", () => {
			darken = !darken;
			if(IS_TAMPERMONKEY) GM_setValue("DARKEN", darken);
			darkenMode.textContent = `Darken: ${darken ? "On" : "Off"}`;
			console.log("Darken mode set to:", darken);
			updateOverlayMode();
		});

		let styleButton = document.createElement("button");
		styleButton.textContent = `Style: ${currentStyle.charAt(0).toUpperCase() + currentStyle.slice(1)}`;
		styleButton.style.backgroundColor = "#0e0e0e7f";
		styleButton.style.color = "white";
		styleButton.style.border = "solid";
		styleButton.style.borderColor = "#1d1d1d7f";
		styleButton.style.borderRadius = "4px";
		styleButton.style.padding = "5px 10px";
		styleButton.style.cursor = "pointer";
		styleButton.style.backdropFilter = "blur(2px)";

		styleButton.addEventListener("click", async () => {
			const map = getMap();
			currentStyle = STYLES[(STYLES.indexOf(currentStyle) + 1) % STYLES.length];
			styleButton.textContent = `Style: ${currentStyle.charAt(0).toUpperCase() + currentStyle.slice(1)}`;
			const style = map.getStyle();
			const pixelSource = style.sources["pixel-art-layer"];
			const hoverSource = map.getSource("pixel-hover");
			const pixelLayer = style.layers.find(l => l.id === "pixel-art-layer");
			const hoverLayer = style.layers.find(l => l.id === "pixel-hover");
			map.setStyle(await fetch("https://maps.wplace.live/styles/" + currentStyle).then(res => res.json()));
			console.log(hoverSource, hoverLayer);
			map.once("styledata", () => {
				if (pixelSource && !map.getSource("pixel-art-layer")) {
					map.addSource("pixel-art-layer", pixelSource);
				}
				if (hoverSource && !map.getSource("pixel-hover")) {
					map.addSource("pixel-hover", {
						type: "canvas",
						canvas: hoverSource.canvas,
						coordinates: hoverSource.coordinates,
					});
				}
				if (pixelLayer && !map.getLayer("pixel-art-layer")) {
					map.addLayer(pixelLayer);
				}
				if (hoverLayer && !map.getLayer("pixel-hover")) {
					map.addLayer(hoverLayer);
				}

				updateOverlayMode();
			});
		});

		let refreshTilesButton = document.createElement("button");
		refreshTilesButton.textContent = "Refresh";
		refreshTilesButton.style.backgroundColor = "#0e0e0e7f";
		refreshTilesButton.style.color = "white";
		refreshTilesButton.style.border = "solid";
		refreshTilesButton.style.borderColor = "#1d1d1d7f";
		refreshTilesButton.style.borderRadius = "4px";
		refreshTilesButton.style.padding = "5px 10px";
		refreshTilesButton.style.cursor = "pointer";
		refreshTilesButton.style.backdropFilter = "blur(2px)";

		refreshTilesButton.addEventListener("click", () => {
			const map = getMap();
			if (map.getLayer("pixel-art-layer")) {
				map.refreshTiles("pixel-art-layer");
			}
			if (map.getLayer("overlay")) {
				map.refreshTiles("overlay");
			}
		});

		overlayOptions.appendChild(blendButton);
		overlayOptions.appendChild(darkenMode);
		overlayOptions.appendChild(styleButton);
		overlayOptions.appendChild(refreshTilesButton);
	}

	let overlayButton = document.createElement("button");
	overlayButton.classList = "btn btn-square shadow-md";
	overlayButton.title = "Overlay Options";
	overlayButton.id = "overlay-button";
	overlayButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>';
	overlayButton.addEventListener("click", async () => {
		const overlayOptions = document.getElementById("overlay-options");
		if (overlayOptions.style.display === "none") {
			overlayOptions.style.display = "flex";
			overlayOptions.animate([
				{ opacity: 0, transform: "translate(50%, -40%)" },
				{ opacity: 1, transform: "translate(50%, -50%)" }
			], {
				duration: 200,
				easing: "ease-out",
				fill: "forwards"
			});
		} else {
			overlayOptions.animate([
				{ opacity: 1, transform: "translate(50%, -50%)" },
				{ opacity: 0, transform: "translate(50%, -40%)" }
			], {
				duration: 200,
				easing: "ease-out",
				fill: "forwards"
			});
			await new Promise(resolve => setTimeout(resolve, 200));
			overlayOptions.style.display = "none";
		}
	});

	const buttonContainer = document.querySelector("div.gap-4:nth-child(1) > div:nth-child(2)");
	const leftSidebar = document.querySelector("html body div div.disable-pinch-zoom.relative.h-full.overflow-hidden.svelte-6wmtgk div.absolute.right-2.top-2.z-30 div.flex.flex-col.gap-4.items-center");
	const paintMenu = document.querySelector("div.rounded-t-box > div.relative.px-3 > div.mb-4.mt-3 div")
	if (buttonContainer) {
		buttonContainer.appendChild(overlayButton);
		buttonContainer.classList.remove("items-center");
		buttonContainer.classList.add("items-end");
	}
	if (leftSidebar) {
		leftSidebar.classList.add("items-end");
		leftSidebar.classList.remove("items-center");
	}
	if (paintMenu) {
		symbolList.forEach((color) => {
			let b = paintMenu.querySelector('div[data-tip="' + color + '"] > button');
			if (b) {
				let colorImg = document.createElement("img");
				colorImg.src = `https://${HOST}${SUBPATH}/symbols/` + color + ".png";
				colorImg.style.borderRadius = "4px";
				if (color.startsWith("Light") || color === "White") {
					colorImg.style.borderColor = "black";
					colorImg.style.backgroundColor = "black";
				} else {
					colorImg.style.borderColor = "white";
					colorImg.style.backgroundColor = "white";
				}
				colorImg.style.width = colorImg.style.height = "20px";
				colorImg.style.imageRendering = "pixelated";
				colorImg.style.imageRendering = "-moz-crisp-edges";
				colorImg.style.position = "absolute";
				colorImg.style.top = colorImg.style.left = "-5px";
				colorImg.class = "z-50";
				b.appendChild(colorImg);
			}
		});
	}
}

async function initMap() {
	if(!getMap()) {
		await new Promise(resolve => setTimeout(resolve, 2000));
	}
	const map = getMap();
	if (!map) {
		console.error("Map object not found!");
		return;
	}
	updateOverlayMode();
	map.on("click", () => {
		ensureLayerOrder();
	})
	document.addEventListener("keydown", (e) => {
		if (e.key === " ") { // Space key
			ensureLayerOrder();
		}
	});

	setInterval(() => {
		map.refreshTiles("overlay");
	}, 5 * 60 * 1000); // Refresh every 5 minutes
}

const observer = new MutationObserver(() => {
	patchUI();
});

observer.observe(document.querySelector("div.gap-4:nth-child(1)"), {
	childList: true,
	subtree: true
});

patchUI();
initMap();
