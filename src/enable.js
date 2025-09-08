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
	const { id, originalBlob, overlayBlob, userOverlayBlob, width, height, darken, overlayMode } = event.data;
	const OVERLAY_MODES = {"over": "source-over", "symbol": "source-over", "difference": "difference", "out": "source-out", "fill": "source-over"}
	const originalBitmap = await createImageBitmap(originalBlob);
	const overlayBitmap = await createImageBitmap(overlayBlob);
	const userOverlayBitmap = userOverlayBlob ? await createImageBitmap(userOverlayBlob) : null;

	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");

	ctx.imageSmoothingEnabled = false;
	
	ctx.drawImage(originalBitmap, 0, 0, width, height);
	ctx.globalCompositeOperation = OVERLAY_MODES[overlayMode] || "source-over";
	ctx.drawImage(overlayBitmap, 0, 0, width, height);
	if(userOverlayBitmap) ctx.drawImage(userOverlayBitmap, 0, 0, width, height);
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
		if(!argList[0]) {
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
			if(overlayMode !== "off") {
				const tileX = url.pathname.split("/")[4];
				let tileY = url.pathname.split("/")[5];
				if (overlayMode !== "over" && overlayMode !== "symbol") {
					tileY = tileY.replace(".png", "_orig.png");
				}

				const userID = getID();
				let overlayUrl = overlayMode === "symbol" ?
					`https://${HOST}${SUBPATH}/tiles/${tileX}/${tileY.replace(".png", "_sym.png")}` : `https://${HOST}${SUBPATH}/tiles/${tileX}/${tileY}`;
				const userOverlayUrl = `https://${HOST}${SUBPATH}/tiles/${userID}/${tileX}/${tileY}`;

				const [originalRes, overlayRes, userOverlayRes] = await Promise.all([
					originalFetch(url),
					originalFetch(overlayUrl),
					originalFetch(userOverlayUrl)
				]);

				if(overlayRes.status !== 200 && userOverlayRes.status !== 200) {
					if(overlayRes.status === 404 && userOverlayRes.status === 404) {
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
				if(originalRes.status !== 200) {
					if(originalRes.status === 404) {
						return overlayRes.status === 200 ? overlayRes : userOverlayRes;
					}
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
					overlayRes.status === 200 ? overlayRes.blob() : fallbackBlob
				]);
				let userOverlayBlob = null;
				if(userOverlayRes.status === 200) {
					userOverlayBlob = await userOverlayRes.blob();
				}

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
					userOverlayBlob,
					width,
					height,
					darken,
					overlayMode
				});

				reloadText.style.display = "none";

				return new Response(resultBlob, {
					status: 200,
					statusText: "OK",
					headers: {
						"Content-Type": resultBlob.type,
						"Cache-Control": originalRes.headers.get("Cache-Control") || "no-cache",
					}
				});
			}
			reloadText.style.display = "none";
		}

		return target.apply(thisArg, argList);
	}
});

function getID() {
	const element = document.querySelector(".text-purple-500");
	if(!element) {
		return -1;
	}
	const idText = element.textContent.replace("#", "").trim();
	if(!idText) {
		return -1;
	}
	const id = parseInt(idText, 10);
	if(isNaN(id)) {
		return -1;
	}
	return id;
}

let reloadText = document.createElement("span");
const symbolList = ["Black", "Dark Gray", "Gray", "Medium Gray", "Light Gray", "White", "Deep Red", "Dark Red", "Red", "Light Red", "Dark Orange", "Orange", "Gold", "Yellow", "Light Yellow", "Dark Goldenrod", "Goldenrod", "Light Goldenrod", "Dark Olive", "Olive", "Light Olive", "Dark Green", "Green", "Light Green", "Dark Teal", "Teal", "Light Teal", "Dark Cyan", "Cyan", "Light Cyan", "Dark Blue", "Blue", "Light Blue", "Dark Indigo", "Indigo", "Light Indigo", "Dark Slate Blue", "Slate Blue", "Light Slate Blue", "Dark Purple", "Purple", "Light Purple", "Dark Pink", "Pink", "Light Pink", "Dark Peach", "Peach", "Light Peach", "Dark Brown", "Brown", "Light Brown", "Dark Tan", "Tan", "Light Tan", "Dark Beige", "Beige", "Light Beige", "Dark Stone", "Stone", "Light Stone", "Dark Slate", "Slate", "Light Slate"];

function patchUI() {
	if (document.getElementById("overlay-blend-button")) {
		return; // Button already exists, no need to patch again
	}
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
		reloadText.style.display = "";
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
		reloadText.style.display = "";
	});

	reloadText.textContent = "Zoom out and in to load the overlay!";
	reloadText.style.color = "red";
	reloadText.style.fontWeight = "bold";
	reloadText.style.maxWidth = "200px";
	reloadText.style.textAlign = "right";
	reloadText.style.backgroundColor = "#ffffff7f";
	reloadText.style.borderRadius = "4px";
	reloadText.style.backdropFilter = "blur(2px)";

	const buttonContainer = document.querySelector("div.gap-4:nth-child(1) > div:nth-child(2)");
	const leftSidebar = document.querySelector("html body div div.disable-pinch-zoom.relative.h-full.overflow-hidden.svelte-6wmtgk div.absolute.right-2.top-2.z-30 div.flex.flex-col.gap-4.items-center");
	const paintMenu = document.querySelector("div.rounded-t-box > div.relative.px-3 > div.mb-4.mt-3 div")
	if (buttonContainer) {
		buttonContainer.appendChild(blendButton);
		buttonContainer.appendChild(darkenMode);
		buttonContainer.appendChild(reloadText);
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

const observer = new MutationObserver(() => {
	patchUI();
});

observer.observe(document.querySelector("div.gap-4:nth-child(1)"), {
	childList: true,
	subtree: true
});

patchUI();
