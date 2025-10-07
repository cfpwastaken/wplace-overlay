const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

const API_ROOT = "../api/";

let authCoords = { lat: 0, lon: 0 };
let token = "";

$("#login-button").addEventListener("click", async () => {
	const res = await fetch(API_ROOT + "login");
	const data = await res.json();
	if (res.status != 200) {
		alert("Error from Wplace: " + data.error);
		console.log("Error from Wplace! " + data.error);
		console.log(data.text);
	}
	console.log(data);
	authCoords = data.coord;
	window.open(data.url);
	$("#confirm-button").style.display = "";
	$("#login-button").style.display = "none";
})

async function updateAlliance() {
	const res = await fetch(API_ROOT + "alliance", {
		headers: {
			"Authorization": "Bearer " + token
		}
	});
	if (res.status != 200) {
		console.error("Failed to fetch alliance data");
		return;
	}
	const data = await res.json();

	const jwt = token.split('.')[1];
	const decoded = JSON.parse(atob(jwt));
	$("#user").textContent = `Logged in as: ${decoded.preferred_username} (${data.name})`;
}

$("#confirm-button").addEventListener("click", async () => {
	const res = await fetch(API_ROOT + "verifyLogin?lat=" + authCoords.lat + "&lon=" + authCoords.lon);
	const status = res.status;
	const data = await res.json();
	if (status != 200) {
		return void alert(data.message || data.error);
	}
	token = data.token;
	$("#login").style.display = "none";
	$("#main").style.display = "";

	await displayArtworks();
	await updateAlliance();
})

async function displayArtworks() {
	const res = await fetch(API_ROOT + "artworks", {
		headers: {
			"Authorization": "Bearer " + token
		}
	});
	if (res.status != 200) {
		const data = await res.json();
		alert("Failed to fetch artworks: " + data.message);
		console.error("Failed to fetch artworks:", data);
		return;
	}
	const artworks = await res.json();
	const artworksContainer = $("#artworks");
	artworksContainer.innerHTML = ""; // Clear previous artworks
	artworks.forEach(artwork => {
		const artworkDiv = document.createElement("div");
		artworkDiv.className = "artwork";
		artworkDiv.innerHTML = `
			<div class="artwork-data">
				<img src="../artworks/${artwork.data}" />
				<div class="artwork-info">
					<h3>${artwork.slug}</h3>
					<p>Position: <a href="https://wplace.live/?lat=${artwork.position.lat}&lng=${artwork.position.lon}&zoom=14.5&season=0&opaque=1&select=1" target="_blank">${artwork.position.lat}, ${artwork.position.lon}</a></p>
				</div>
			</div>
			<div class="artwork-actions">
				<button class="delete-artwork" data-slug="${artwork.slug}">Delete</button>
			</div>
		`;
		artworksContainer.appendChild(artworkDiv);

		const deleteButton = artworkDiv.querySelector(".delete-artwork");
		deleteButton.addEventListener("click", async () => {
			const artworkSlug = deleteButton.getAttribute("data-slug");
			if (confirm("Are you sure you want to delete this artwork?")) {
				const res = await fetch(`${API_ROOT}artworks/${artworkSlug}`, {
					method: "DELETE",
					headers: {
						"Authorization": "Bearer " + token
					}
				});
				if (res.status != 200) {
					alert("Failed to delete artwork: " + (await res.json()).message);
					return;
				}
				displayArtworks(); // Refresh the artworks list
			}
		});
	});
}

async function submitArtwork(e) {
	e.preventDefault();

	const form = e.target;
	const formData = new FormData(form);

	try {
		const response = await fetch(`${API_ROOT}upload`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`
			},
			body: formData
		});

		if (response.ok) {
			console.log('Artwork uploaded successfully');
			form.reset();
			await displayArtworks();
			// document.getElementById('generate-dialog').showModal();
		} else {
			console.error('Upload failed:', response.statusText);
			alert("Uploading artwork failed: " + response.statusText);
		}
	} catch (error) {
		console.error('Upload error:', error);
	}
}

async function generateNow() {
	const res = await fetch(`${API_ROOT}generate`, {
		method: "POST",
		headers: {
			"Authorization": "Bearer " + token
		}
	});
	if (res.ok) {
		// alert("Tiles generation started successfully.");
		document.dispatchEvent(new CustomEvent("basecoat:toast", {
			detail: {
				config: {
					category: "success",
					title: "Rush started",
					description: "Tiles generation has been started. It may take up to 2 minutes.",
					cancel: {
						label: "Dismiss"
					}
				}
			}
		}));
	} else {
		if(res.status == 429) {
			const retryAfter = res.headers.get("Retry-After");
			document.dispatchEvent(new CustomEvent("basecoat:toast", {
				detail: {
					config: {
						category: "error",
						title: "Rush failed",
						description: "You are being rate limited. Please wait " + retryAfter + " seconds before trying again.",
						cancel: {
							label: "Dismiss"
						}
					}
				}
			}));
			console.error("Rate limited. Please wait before trying again.");
			return;
		}


		const data = await res.json();
		// alert("Failed to start tiles generation: " + data.message);
		document.dispatchEvent(new CustomEvent("basecoat:toast", {
			detail: {
				config: {
					category: "error",
					title: "Rush failed",
					description: "Failed to start tiles generation: " + data.message,
					cancel: {
						label: "Dismiss"
					}
				}
			}
		}));
		console.error("Failed to start tiles generation:", data);
		return;
	}
}

$("#generate-now").addEventListener("click", generateNow);
// $("#rush-button").addEventListener("click", async () => {
// 	document.getElementById('generate-dialog').close()
// 	await generateNow();
// });
