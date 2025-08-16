
function getID() {
	const element = document.querySelector("html body div div.disable-pinch-zoom.relative.h-full.overflow-hidden.svelte-6wmtgk div.absolute.right-2.top-2.z-30 div.flex.flex-col.gap-4.items-end div div.dropdown div.dropdown-content.menu.bg-base-100.rounded-box.border-base-300.z-1.relative.right-1.w-[min(100vw-24px,400px)].translate-y-2.border.p-4.shadow-md section.flex.gap-2 div div.flex.items-center.gap-1.5.pr-8.text-lg.font-medium span.text-purple-500");
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