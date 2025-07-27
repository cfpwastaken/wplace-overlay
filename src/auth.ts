export async function generateAuthURL() {
	let coord = randomAntarcticaCoord();
	let unusedCoord = false;

	while (!unusedCoord) {
		const { tileX, tileY, pixelX, pixelY } = latLonToTileAndPixel(coord.lat, coord.lon);
		const res = await fetch(`https://backend.wplace.live/s0/pixel/${tileX}/${tileY}?x=${pixelX}&y=${pixelY}`);
		if(res.status != 200) {
			return {
				error: res.status + " " + res.statusText
			}
		}
		const data = await res.json() as {
			paintedBy: {
				id: number;
				name: string;
			};
		};
		const id = data.paintedBy.id;
		if (id != 0) {
			unusedCoord = true;
		} else {
			console.log("Coord is already used, generating a new one...");
			coord = randomAntarcticaCoord();
		}
	}


	return {
		url: `https://wplace.live/?lat=${coord.lat}&lng=${coord.lon}&zoom=14.5&season=0&opaque=1`,
		coord
	};
}

function randomAntarcticaCoord(): { lat: number; lon: number } {
  const minLat = -90;
  const maxLat = -60;
  const lat = Math.random() * (maxLat - minLat) + minLat;

  const lon = Math.random() * 360 - 180; // full global range

  return { lat, lon };
}

function latLonToTileAndPixel(lat: number, lon: number) {
	const ZOOM = 11;
	const TILE_SIZE = 1000;
	const SCALE = TILE_SIZE * 2 ** ZOOM;
	const xPixel = (lon + 180) / 360 * SCALE;
	const yPixel = (1 - ((1 + (lat * Math.PI / 180)) / 2) ** 0.5) * SCALE;

	const tileX = xPixel / TILE_SIZE;
	const tileY = yPixel / TILE_SIZE;
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
