import { fileURLToPath } from "url";
import { GeospatialConverter } from "./wplace";
import { createClient } from "redis";
import { PNG } from "pngjs";
import { readFile } from "fs/promises";
import { createWriteStream } from "fs";

const redis = await createClient({
	url: process.env.REDIS_URL || "redis://localhost:6379"
}).connect();
const ZOOM = 11; // TODO: figure out why 11

async function renderImageOnImage(png: PNG, img: PNG, x: number, y: number): Promise<void> {
	for (let yy = 0; yy < img.height; yy++) {
		for (let xx = 0; xx < img.width; xx++) {
			const srcIdx = (yy * img.width + xx) << 2;
			const dstIdx = ((y + yy) * png.width + (x + xx)) << 2;

			png.data[dstIdx] = img.data[srcIdx]!;
			png.data[dstIdx + 1] = img.data[srcIdx + 1]!;
			png.data[dstIdx + 2] = img.data[srcIdx + 2]!;
			png.data[dstIdx + 3] = img.data[srcIdx + 3]!;
		}
	}
}

export async function generateTile(tileX: number, tileY: number, artworks: Artwork[]) {
	console.log(`Generating tile at (${tileX}, ${tileY}) with ${artworks.length} artworks`);
	const png = new PNG({
		width: 1000,
		height: 1000
	});

	const geo = new GeospatialConverter(1000);
	for (const artwork of artworks) {
		const lat = +Number(artwork.position.lat).toFixed(7);
		const lon = +Number(artwork.position.lon).toFixed(7);
		const pos = geo.latLonToTileAndPixel(lat, lon, 11);
		const pixelX = pos.pixel[0]!;
		const pixelY = pos.pixel[1]!;
		const data = await readFile(`./artworks/${artwork.data}`);
		const img = PNG.sync.read(data);
		await renderImageOnImage(png, img, pixelX, pixelY);
		console.log(`Rendered artwork ${artwork.slug} by ${artwork.author} at (${pixelX}, ${pixelY})`);
	}

	// Save the tile image
	const tilePath = `./${tileX}_${tileY}.png`;
	await new Promise<void>((resolve) => {
		png.pack().pipe(createWriteStream(tilePath)).on("finish", resolve);
	});
}

export type Tile = {
	tileX: number;
	tileY: number;
}

export type Artwork = {
	position: {
		lat: number;
		lon: number;
	}
	slug: string;
	author: string;
	data: string;
};

export async function generateTiles(geo: GeospatialConverter) {
	const keys = await redis.keys("artwork:*");
	const rawArtworks = await redis.json.mGet(keys, "$");
	const artworks: Artwork[] = rawArtworks.map((item: any) => {
		// mGet returns an array of arrays (one per key), each containing the result or null
		if (Array.isArray(item) && item.length > 0 && item[0] !== null) {
			return item[0] as Artwork;
		}
		return null;
	}).filter(a => a !== null) as Artwork[];

	// Group artworks by tile
	const tiles: Map<string, Artwork[]> = new Map();
	for (const artwork of artworks) {
		let { lat, lon } = artwork.position;
		lat = +Number(lat).toFixed(7);
		lon = +Number(lon).toFixed(7);
		// if(artwork.slug == "discord-qr") continue;
		const { tile: tileArr, pixel } = geo.latLonToTileAndPixel(lat, lon, ZOOM);
		const tile = { tileX: tileArr[0]!, tileY: tileArr[1]! };
		console.log(`Artwork ${artwork.slug} at (${lat}, ${lon}) belongs to tile (${tile.tileX}, ${tile.tileY}) at (${pixel[0]}, ${pixel[1]})`);
		const tileKey = `${tileArr[0]}:${tileArr[1]}`;
		if (!tiles.has(tileKey)) {
			tiles.set(tileKey, []);
		}
		tiles.get(tileKey)!.push(artwork);
	}

	// Run generateTile for each tile (passing all artworks in that tile)
	for (const [tileKey, artworksInTile] of tiles.entries()) {
		const [tileX, tileY] = tileKey.split(":").map(Number);
		generateTile(tileX!, tileY!, artworksInTile);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const geo = new GeospatialConverter(1000);
	generateTiles(geo)
}