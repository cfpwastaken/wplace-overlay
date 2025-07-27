const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

let authCoords = {lat: 0, lon: 0};
let token = "";

$("#login-button").addEventListener("click", async () => {
	const res = await fetch("/api/login");
	const data = await res.json();
	if(res.status != 200) {
		alert("Error from Wplace: " + data.error);
	}
	authCoords = data.coords;
	window.open(data.url);
	$("#confirm-button").style.display = "";
	$("#login-button").style.display = "none";
})

$("#confirm-button").addEventListener("click", async () => {
	const res = await fetch("/api/verifyLogin?lat=" + coords.lat + "&lon=" + coords.lon);
	const status = res.status;
	const data = await res.json();
	if(status != 200) {
		return void alert(data.message);
	}
	token = data.token;
	$("#login").style.display = "none";
	$("#main").style.display = "";

	await displayArtworks();
})

async function displayArtworks() {
	const artworks = await fetch("/api/artworks", {
		headers: {
			"Authorization": "Bearer " + token
		}
	}).then(res => res.json());
	const artworksContainer = $("#artworks");
	artworksContainer.innerHTML = ""; // Clear previous artworks
	artworks.forEach(artwork => {
		const artworkDiv = document.createElement("div");
		artworkDiv.className = "artwork";
		artworkDiv.innerHTML = `
			<div class="artwork-data">
				<img src="/artworks/${artwork.data}" />
				<div class="artwork-info">
					<h3>${artwork.slug}</h3>
					<p>Artist: ${artwork.author}</p>
					<p>Position: <a href="https://wplace.live/?lat=${artwork.position.lat}&lng=${artwork.position.lon}&zoom=14.5&season=0&opaque=1" target="_blank">${artwork.position.lat}, ${artwork.position.lon}</a></p>
				</div>
			</div>
			<div class="artwork-actions">
				<button class="delete-artwork" data-id="${artwork.id}">Delete</button>
			</div>
		`;
		artworksContainer.appendChild(artworkDiv);

		const deleteButton = artworkDiv.querySelector(".delete-artwork");
		deleteButton.addEventListener("click", async () => {
			const artworkId = deleteButton.getAttribute("data-id");
			if (confirm("Are you sure you want to delete this artwork?")) {
				await fetch(`/api/artworks/${artworkId}`, {
					method: "DELETE",
					headers: {
						"Authorization": "Bearer " + token
					}
				});
				displayArtworks(); // Refresh the artworks list
			}
		});
	});
}
