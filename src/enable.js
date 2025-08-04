let overlayMode = "over";
const OVERLAY_MODES = ["aus", "over", "difference", "out", "fill"];
let darken = false;

const HOST = "cfp.is-a.dev";
const SUBPATH = "/wplace";

// Worker for canvas operations
const WORKER_CODE = `
self.addEventListener("message", async (event) => {
	const { id, originalBlob, overlayBlob, width, height, darken, overlayMode } = event.data;
	const OVERLAY_MODES = {"over": "source-over", "difference": "difference", "out": "source-out", "fill": "source-over"}
	const originalBitmap = await createImageBitmap(originalBlob);
	const overlayBitmap = await createImageBitmap(overlayBlob);

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

const originalFetch = fetch;

fetch = new Proxy(fetch, { apply: async (target, thisArg, argList) => {
	console.log(target, thisArg, argList);

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
		if(overlayMode !== "aus") {
			// url.host = HOST;
			// url.pathname = `${SUBPATH}${url.pathname}`;
			// url.searchParams.set("blending", overlayMode);
			// url.searchParams.set("darken", darken + "");
			// console.log("Modified URL:", url);
			// if(typeof argList[0] === "object") {
			// 	argList[0] = new Request(url, argList[0]);
			// } else {
			// 	argList[0] = url.toString();
			// }
			// backend.wplace.live/files/s0/tiles/X/Y.png
			const tileX = url.pathname.split("/")[4];
			let tileY = url.pathname.split("/")[5];
			if(overlayMode !== "over") {
				tileY = tileY.replace(".png", "_orig.png");
			}
			const overlayUrl = `https://${HOST}${SUBPATH}/tiles/${tileX}/${tileY}`;
			const [originalRes, overlayRes] = await Promise.all([
				originalFetch(url),
				originalFetch(overlayUrl)
			])

			if(overlayRes.status !== 200) {
				if(overlayRes.status === 404) {
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

			const width = 3000;
			const height = 3000;

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
} });

let reloadText = document.createElement("span");

function patchUI() {
	if(document.getElementById("overlay-blend-button")) {
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
		blendButton.textContent = `Overlay: ${overlayMode.charAt(0).toUpperCase() + overlayMode.slice(1)}`;
		console.log("Overlay mode set to:", overlayMode);
		reloadText.style.display = "";
	});

	let darkenMode = document.createElement("button");
	darkenMode.textContent = "Darken: " + (darken ? "An" : "Aus");
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
		darkenMode.textContent = `Darken: ${darken ? "An" : "Aus"}`;
		console.log("Darken mode set to:", darken);
		reloadText.style.display = "";
	});
	
	reloadText.textContent = "Rein und wieder raus zoomen, um das Overlay zu sehen!";
	reloadText.style.color = "red";
	reloadText.style.fontWeight = "bold";
	reloadText.style.maxWidth = "200px";
	reloadText.style.textAlign = "right";
	reloadText.style.backgroundColor = "#ffffff7f";
	reloadText.style.borderRadius = "4px";
	reloadText.style.backdropFilter = "blur(2px)";
	
	const buttonContainer = document.querySelector("div.gap-4:nth-child(1) > div:nth-child(2)");
	const leftSidebar = document.querySelector("html body div div.disable-pinch-zoom.relative.h-full.overflow-hidden.svelte-6wmtgk div.absolute.right-2.top-2.z-30 div.flex.flex-col.gap-4.items-center");
	
	if(buttonContainer) {
		buttonContainer.appendChild(blendButton);
		buttonContainer.appendChild(darkenMode);
		buttonContainer.appendChild(reloadText);
		buttonContainer.classList.remove("items-center");
		buttonContainer.classList.add("items-end");
	}
	if(leftSidebar) {
		leftSidebar.classList.add("items-end");
		leftSidebar.classList.remove("items-center");
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
