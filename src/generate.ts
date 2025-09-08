import { fileURLToPath } from "url";
import { GeospatialConverter } from "./wplace";
import { createClient } from "redis";
import { PNG } from "pngjs";
import { readFile } from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { readdir } from "fs/promises";
import { unlink } from "fs/promises";
import { stat } from "fs/promises";
import { copyFile } from "fs/promises";
import { rename } from "fs/promises";
import { rmdir } from "fs/promises";
import { rm } from "fs/promises";
import { join, relative } from "path";

// const redis = await createClient({
// 	url: process.env.REDIS_URL || "redis://localhost:6379"
// }).connect();
const ZOOM = 11; // TODO: figure out why 11

async function renderImageOnImage(
	png: PNG,
	img: PNG,
	x: number,
	y: number,
): Promise<void> {
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

type RenderInfo = {
	srcX: number;
	srcY: number;
	destX: number;
	destY: number;
	width: number;
	height: number;
};

function calculateRenderInfo(
	originalTileX: number,
	originalTileY: number,
	originalPixelX: number,
	originalPixelY: number,
	artworkWidth: number,
	artworkHeight: number,
	currentTileX: number,
	currentTileY: number,
	tileSize: number,
): RenderInfo | null {
	// Calculate the absolute pixel position of the artwork's top-left corner
	const absoluteStartX = originalTileX * tileSize + originalPixelX;
	const absoluteStartY = originalTileY * tileSize + originalPixelY;

	// Calculate the absolute pixel position of the artwork's bottom-right corner
	const absoluteEndX = absoluteStartX + artworkWidth - 1;
	const absoluteEndY = absoluteStartY + artworkHeight - 1;

	// Calculate the bounds of the current tile
	const tileStartX = currentTileX * tileSize;
	const tileStartY = currentTileY * tileSize;
	const tileEndX = tileStartX + tileSize - 1;
	const tileEndY = tileStartY + tileSize - 1;

	// Check if artwork intersects with current tile
	if (
		absoluteEndX < tileStartX || absoluteStartX > tileEndX ||
		absoluteEndY < tileStartY || absoluteStartY > tileEndY
	) {
		return null; // No intersection
	}

	// Calculate the intersection
	const intersectionStartX = Math.max(absoluteStartX, tileStartX);
	const intersectionStartY = Math.max(absoluteStartY, tileStartY);
	const intersectionEndX = Math.min(absoluteEndX, tileEndX);
	const intersectionEndY = Math.min(absoluteEndY, tileEndY);

	return {
		srcX: intersectionStartX - absoluteStartX,
		srcY: intersectionStartY - absoluteStartY,
		destX: intersectionStartX - tileStartX,
		destY: intersectionStartY - tileStartY,
		width: intersectionEndX - intersectionStartX + 1,
		height: intersectionEndY - intersectionStartY + 1,
	};
}

async function renderImagePortionOnImage(
	png: PNG,
	img: PNG,
	renderInfo: RenderInfo,
): Promise<void> {
	for (let yy = 0; yy < renderInfo.height; yy++) {
		for (let xx = 0; xx < renderInfo.width; xx++) {
			const srcIdx =
				((renderInfo.srcY + yy) * img.width + (renderInfo.srcX + xx)) << 2;
			const dstIdx =
				((renderInfo.destY + yy) * png.width + (renderInfo.destX + xx)) << 2;

			// Check bounds to prevent errors
			if (
				srcIdx >= 0 && srcIdx < img.data.length - 3 &&
				dstIdx >= 0 && dstIdx < png.data.length - 3
			) {
				if (img.data[srcIdx + 3] === 0) continue; // Skip fully transparent pixels
				png.data[dstIdx] = img.data[srcIdx]!;
				png.data[dstIdx + 1] = img.data[srcIdx + 1]!;
				png.data[dstIdx + 2] = img.data[srcIdx + 2]!;
				png.data[dstIdx + 3] = img.data[srcIdx + 3]!;
			}
		}
	}
}

export async function generateTile(
	tileX: number,
	tileY: number,
	artworks: Artwork[],
	user: string
) {
	const start = Date.now();
	console.log(
		`[TILEGEN] Generating tile at (${tileX}, ${tileY}) for ${user} with ${artworks.length} artworks`,
	);
	const png = new PNG({
		width: 1000,
		height: 1000,
	});

	const geo = new GeospatialConverter(1000);
	for (const artwork of artworks) {
		try {
			const lat = +Number(artwork.position.lat).toFixed(7);
			const lon = +Number(artwork.position.lon).toFixed(7);
			const pos = geo.latLonToTileAndPixel(lat, lon, 11);
			const originalPixelX = pos.pixel[0]!;
			const originalPixelY = pos.pixel[1]!;
			const originalTileX = pos.tile[0]!;
			const originalTileY = pos.tile[1]!;
	
			const data = await readFile(`./artworks/${artwork.data}`);
			const img = PNG.sync.read(data);
	
			// Calculate the portion of the artwork that should be rendered on this specific tile
			const renderInfo = calculateRenderInfo(
				originalTileX,
				originalTileY,
				originalPixelX,
				originalPixelY,
				img.width,
				img.height,
				tileX,
				tileY,
				geo.tileSize,
			);
	
			if (renderInfo) {
				await renderImagePortionOnImage(png, img, renderInfo);
				console.log(
					`[TILEGEN] Rendered artwork ${artwork.slug} by ${artwork.author} portion at (${renderInfo.destX}, ${renderInfo.destY}) size (${renderInfo.width}x${renderInfo.height})`,
				);
			}
		} catch(e) {
			console.log("[TILEGEN] Failed to render " + artwork.slug, e);
		}
	}

	const userInt = parseInt(user);
	// Save the tile image
	const tilePath = isNaN(userInt) ? `./tiles/temp/${tileX}/${tileY}_orig.png` : `./tiles/temp/${userInt}/${tileX}/${tileY}_orig.png`;
	// Create directory if it doesn't exist
	if(!isNaN(userInt)) {
		if (!existsSync(`./tiles/temp/${user}/${tileX}`)) {
			await mkdir(`./tiles/temp/${user}/${tileX}`, { recursive: true });
		}
	} else {
		if (!existsSync(`./tiles/temp/${tileX}`)) {
			await mkdir(`./tiles/temp/${tileX}`, { recursive: true });
		}
	}
	await copyFile(`./src/border.py`, `./tiles/temp/border.py`);
	await new Promise<void>((resolve) => {
		png.pack().pipe(createWriteStream(tilePath)).on("finish", resolve);
	});
	await runCommand("python3", [
		"border.py",
		isNaN(userInt) ? tileX + "/" + tileY : `${user}/${tileX}/${tileY}`
	], {
		cwd: "tiles/temp",
	});

	// If at least one artwork has the symbol flag, generate the symbol overlay
	if (artworks.some((art) => art.symbol)) {
		await runCommand("python3", ["symbol.py", tileX + "/" + tileY], {
			cwd: "tiles",
		});
	}

	const end = Date.now();
	console.log(`[TILEGEN] Tile (${tileX}, ${tileY}) for ${user} generated in ${end - start} ms`);
}

function runCommand(cmd: string, args: string[] = [], options: any = {}) {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: "inherit", ...options });

		proc.on("close", (code) => {
			if (code === 0) resolve(code);
			else reject(new Error(`[TILEGEN] Process exited with code ${code}`));
		});

		proc.on("error", reject);
	});
}

function getAffectedTiles(
	baseTileX: number,
	baseTileY: number,
	startPixelX: number,
	startPixelY: number,
	artworkWidth: number,
	artworkHeight: number,
	tileSize: number,
): Array<{ tileX: number; tileY: number }> {
	const affectedTiles: Array<{ tileX: number; tileY: number }> = [];

	// Calculate the pixel bounds of the artwork
	const endPixelX = startPixelX + artworkWidth - 1;
	const endPixelY = startPixelY + artworkHeight - 1;

	// Calculate which tiles are affected
	const startTileOffsetX = Math.floor(startPixelX / tileSize);
	const startTileOffsetY = Math.floor(startPixelY / tileSize);
	const endTileOffsetX = Math.floor(endPixelX / tileSize);
	const endTileOffsetY = Math.floor(endPixelY / tileSize);

	// Add all affected tiles
	for (
		let tileOffsetX = startTileOffsetX;
		tileOffsetX <= endTileOffsetX;
		tileOffsetX++
	) {
		for (
			let tileOffsetY = startTileOffsetY;
			tileOffsetY <= endTileOffsetY;
			tileOffsetY++
		) {
			affectedTiles.push({
				tileX: baseTileX + tileOffsetX,
				tileY: baseTileY + tileOffsetY,
			});
		}
	}

	return affectedTiles;
}

export type Tile = {
	tileX: number;
	tileY: number;
};

export type Artwork = {
	position: {
		lat: number;
		lon: number;
	};
	slug: string;
	author: string;
	data: string;
	priority?: number; // Optional priority field
	protected?: boolean; // Optional protected field
	dirty?: boolean; // Optional dirty field to indicate if the artwork needs reprocessing
	symbol?: boolean;
	key: string; // Key in Redis for the artwork
};

let queue: string[] = [];

export async function generateTiles(redis: ReturnType<typeof createClient>, ignoreDirty = false) {
	const jobId = crypto.randomUUID();
	queue.push(jobId);
	if (queue.length > 1) {
		console.log("[GENERATE] Another generateTiles request is already in progress, waiting for it to finish");
		await new Promise((resolve) => {
			const interval = setInterval(() => {
				if (queue.length === 0 || queue[0] === jobId) {
					clearInterval(interval);
					resolve(null);
				}
			}, 1000);
		});
	}

	const geo = new GeospatialConverter(1000);
	const keys = await redis.keys("artwork:*");
	const rawArtworks = await redis.json.mGet(keys, "$");
	const artworks: Artwork[] = rawArtworks.map((item: any, index: number) => {
		// mGet returns an array of arrays (one per key), each containing the result or null
		if (Array.isArray(item) && item.length > 0 && item[0] !== null) {
			return { ...item[0], key: keys[index] } as Artwork;
		}
		return null;
	}).filter((a) => a !== null) as Artwork[];

	// Group artworks by tile, considering artwork dimensions
	const tiles: Map<string, Artwork[]> = new Map();
	for (const artwork of artworks) {
		let { lat, lon } = artwork.position;
		lat = +Number(lat).toFixed(7);
		lon = +Number(lon).toFixed(7);

		// Load artwork to get its dimensions
		try {
			const data = await readFile(`./artworks/${artwork.data}`);
			const img = PNG.sync.read(data);

			const { tile: tileArr, pixel } = geo.latLonToTileAndPixel(lat, lon, ZOOM);
			const startPixelX = pixel[0]!;
			const startPixelY = pixel[1]!;

			// Calculate which tiles this artwork spans
			const affectedTiles = getAffectedTiles(
				tileArr[0]!,
				tileArr[1]!,
				startPixelX,
				startPixelY,
				img.width,
				img.height,
				geo.tileSize,
			);

			const key = artwork.key;
			const user = key.split(":")[1];

			console.log(
				`[GENERATE] Artwork ${artwork.slug} (${img.width}x${img.height}) for ${user} at (${lat}, ${lon}) spans ${affectedTiles.length} tiles`,
			);

			// Add this artwork to all affected tiles
			for (const affectedTile of affectedTiles) {
				const tileKey = `${user}:${affectedTile.tileX}:${affectedTile.tileY}`;
				if (!tiles.has(tileKey)) {
					tiles.set(tileKey, []);
				}
				tiles.get(tileKey)!.push(artwork);
			}
		} catch (error) {
			console.error(`[GENERATE] Error processing artwork ${artwork.slug}:`, error);
			// Fallback to old behavior if artwork can't be loaded
			const { tile: tileArr, pixel } = geo.latLonToTileAndPixel(lat, lon, ZOOM);
			const tileKey = `${tileArr[0]}:${tileArr[1]}`;
			if (!tiles.has(tileKey)) {
				tiles.set(tileKey, []);
			}
			tiles.get(tileKey)!.push(artwork);
		}
	}

	for (const artworksInTile of tiles.values()) {
		artworksInTile.sort((a, b) => (b.priority || 0) - (a.priority || 0));
	}

	// Run generateTile for each tile (passing all artworks in that tile)
	for (const [tileKey, artworksInTile] of tiles.entries()) {
		const splitter = tileKey.split(":");
		const [_, tileX, tileY] = splitter.map(Number);
		const user = splitter[0]!;
		if (ignoreDirty && artworksInTile.every((artwork) => !artwork.dirty)) {
			console.log(`[GENERATE] Skipping tile (${tileX}, ${tileY}) for ${user} as all artworks are clean`);
			continue;
		}
		await generateTile(tileX!, tileY!, artworksInTile, user);
		for (const artwork of artworksInTile) {
			artwork.dirty = false; // Reset dirty flag
			await redis.json.set(artwork.key, "$", artwork);
		}
	}

	// Swap folders
	const tilesTemp = "./tiles/temp";
	const tilesFolder = "./tiles/stage";
	console.log(`[GENERATE] Swapping tiles from ${tilesTemp} to ${tilesFolder}`);
	await swapDirs(tilesFolder, tilesTemp, "./tiles/backup");

	queue = queue.filter((id) => id !== jobId);
	console.log(`[GENERATE] Tile generation completed, queue length is now ${queue.length}`);
}

async function swapDirs(realDir: string, tempDir: string, backupDir: string) {
  // Remove old backup if it exists
  try { await rm(backupDir, { recursive: true, force: true }); } catch {}

  // Rename real → backup
  await rename(realDir, backupDir);

  // Rename temp → real
  await rename(tempDir, realDir);

  // Optionally clean up backup
  await rm(backupDir, { recursive: true, force: true });
}

// if (process.argv[1] === fileURLToPath(import.meta.url)) {
// 	const geo = new GeospatialConverter(1000);
// 	generateTiles(geo)
// }
