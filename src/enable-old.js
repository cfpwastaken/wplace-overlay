let overlayMode = "over";
const OVERLAY_MODES = ["aus", "over", "difference", "out"];
let darken = false;

const HOST = "cfp.is-a.dev";
const SUBPATH = "/wplace";

fetch = new Proxy(fetch, { apply: (target, thisArg, argList) => {
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
			url.host = HOST;
			url.pathname = `${SUBPATH}${url.pathname}`;
			url.searchParams.set("blending", overlayMode);
			url.searchParams.set("darken", darken + "");
			console.log("Modified URL:", url);
			if(typeof argList[0] === "object") {
				argList[0] = new Request(url, argList[0]);
			} else {
				argList[0] = url.toString();
			}
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