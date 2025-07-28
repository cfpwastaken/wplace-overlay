export async function generateAuthURL() {
	let coord = randomAntarcticaCoord();
	let unusedCoord = false;

	while (!unusedCoord) {
		const { tileX, tileY, pixelX, pixelY } = latLonToTileAndPixel(coord.lat, coord.lon);
		console.log("Checking coord:", coord, "Tile:", tileX, tileY, "Pixel:", pixelX, pixelY);
		const res = await fetch(`https://backend.wplace.live/s0/pixel/${tileX}/${tileY}?x=${pixelX}&y=${pixelY}`);
		if(res.status != 200) {
			const text = await res.text();
			return {
				error: res.status + " " + res.statusText,
				text
			}
		}
		const data = await res.json() as {
			paintedBy: {
				id: number;
				name: string;
			};
		};
		const id = data.paintedBy.id;
		if (id === 0) {
			unusedCoord = true;
		} else {
			console.log("Coord is already used, generating a new one...");
			coord = randomAntarcticaCoord();
			await new Promise(resolve => setTimeout(resolve, 500)); // wait 500 milliseconds before trying again
		}
	}


	return {
		url: `https://wplace.live/?lat=${coord.lat}&lng=${coord.lon}&zoom=14.5&season=0&opaque=1&select=1`,
		coord
	};
}

function randomAntarcticaCoord(): { lat: number; lon: number } {
  const minLat = -85;
  const maxLat = -60;
  const lat = Math.random() * (maxLat - minLat) + minLat;

  const lon = Math.random() * 360 - 180; // full global range

  return { lat, lon };
}

function latLonToTileAndPixel(lat: number, lon: number) {
	const ZOOM = 11;
	const TILE_SIZE = 1000;
	const SCALE = TILE_SIZE * 2 ** ZOOM;
	const xPixel = Math.floor((lon + 180) / 360 * SCALE);
	
	const latRad = lat * Math.PI / 180;
	const yPixel = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * SCALE);

	const tileX = Math.floor(xPixel / TILE_SIZE);
	const tileY = Math.floor(yPixel / TILE_SIZE);
	const pixelX = xPixel % TILE_SIZE;
	const pixelY = yPixel % TILE_SIZE;

	return { tileX, tileY, pixelX, pixelY };
}

export async function checkUser(coord: { lat: number; lon: number }) {
	const { tileX, tileY, pixelX, pixelY } = latLonToTileAndPixel(coord.lat, coord.lon);
	const res = await fetch(`https://backend.wplace.live/s0/pixel/${tileX}/${tileY}?x=${pixelX}&y=${pixelY}`, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	}).then(res => res.json()) as {
		paintedBy: {
			id: number;
			name: string;
		};
	};
	return {
		id: res.paintedBy.id,
		name: res.paintedBy.name,
	}
}
