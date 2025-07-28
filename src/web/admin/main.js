const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

let authCoords = { lat: 0, lon: 0 };
let token = "";

$("#login-button").addEventListener("click", async () => {
	const res = await fetch("/api/login");
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
	const res = await fetch("/api/alliance", {
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
	const res = await fetch("/api/verifyLogin?lat=" + authCoords.lat + "&lon=" + authCoords.lon);
	const status = res.status;
	const data = await res.json();
	if (status != 200) {
		return void alert(data.message);
	}
	token = data.token;
	$("#login").style.display = "none";
	$("#main").style.display = "";

	await displayArtworks();
	await updateAlliance();
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
				<button class="delete-artwork" data-slug="${artwork.slug}">Delete</button>
			</div>
		`;
		artworksContainer.appendChild(artworkDiv);

		const deleteButton = artworkDiv.querySelector(".delete-artwork");
		deleteButton.addEventListener("click", async () => {
			const artworkSlug = deleteButton.getAttribute("data-slug");
			if (confirm("Are you sure you want to delete this artwork?")) {
				await fetch(`/api/artworks/${artworkSlug}`, {
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

async function submitArtwork(e) {
	e.preventDefault();

	const form = e.target;
	const formData = new FormData(form);

	try {
		const response = await fetch('/upload', {
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
		} else {
			console.error('Upload failed:', response.statusText);
		}
	} catch (error) {
		console.error('Upload error:', error);
	}
}
