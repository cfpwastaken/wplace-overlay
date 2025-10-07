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
) {
	const start = Date.now();
	console.log(
		`Generating tile at (${tileX}, ${tileY}) with ${artworks.length} artworks`,
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
					`Rendered artwork ${artwork.slug} portion at (${renderInfo.destX}, ${renderInfo.destY}) size (${renderInfo.width}x${renderInfo.height})`,
				);
			}
		} catch(e) {
			console.log("Failed to render " + artwork.slug, e);
		}
	}

	// Save the tile image
	const tilePath = `./tiles/${tileX}/${tileY}_orig.png`;
	// Create directory if it doesn't exist
	if (!existsSync(`./tiles/${tileX}`)) {
		await mkdir(`./tiles/${tileX}`, { recursive: true });
	}
	await new Promise<void>((resolve) => {
		png.pack().pipe(createWriteStream(tilePath)).on("finish", resolve);
	});
	await runCommand("python3", ["border.py", tileX + "/" + tileY], {
		cwd: "tiles",
	});

	// If at least one artwork has the symbol flag, generate the symbol overlay
	if (artworks.some((art) => art.symbol)) {
		await runCommand("python3", ["symbol.py", tileX + "/" + tileY], {
			cwd: "tiles",
		});
	}

	const end = Date.now();
	console.log(`Tile (${tileX}, ${tileY}) generated in ${end - start} ms`);
}

function runCommand(cmd: string, args: string[] = [], options: any = {}) {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, { stdio: "inherit", ...options });

		proc.on("close", (code) => {
			if (code === 0) resolve(code);
			else reject(new Error(`Process exited with code ${code}`));
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
	data: string;
	priority?: number; // Optional priority field
	protected?: boolean; // Optional protected field
	dirty?: boolean; // Optional dirty field to indicate if the artwork needs reprocessing
	symbol?: boolean;
};

export async function generateTiles(redis: ReturnType<typeof createClient>, ignoreDirty = false) {
	const geo = new GeospatialConverter(1000);
	const keys = await redis.keys("artwork:*");
	const rawArtworks = await redis.json.mGet(keys, "$");
	const artworks: (Artwork & { key: string })[] = rawArtworks.map((item: any, index: number) => {
		// mGet returns an array of arrays (one per key), each containing the result or null
		if (Array.isArray(item) && item.length > 0 && item[0] !== null) {
			return { ...item[0], key: keys[index] } as (Artwork & { key: string });
		}
		return null;
	}).filter((a) => a !== null) as (Artwork & { key: string })[];

	// Group artworks by tile, considering artwork dimensions
	const tiles: Map<string, (Artwork & { key: string })[]> = new Map();
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

			console.log(
				`Artwork ${artwork.slug} (${img.width}x${img.height}) at (${lat}, ${lon}) spans ${affectedTiles.length} tiles`,
			);

			// Add this artwork to all affected tiles
			for (const affectedTile of affectedTiles) {
				const tileKey = `${affectedTile.tileX}:${affectedTile.tileY}`;
				if (!tiles.has(tileKey)) {
					tiles.set(tileKey, []);
				}
				tiles.get(tileKey)!.push(artwork);
			}
		} catch (error) {
			console.error(`Error processing artwork ${artwork.slug}:`, error);
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
		const [tileX, tileY] = tileKey.split(":").map(Number);
		if (ignoreDirty && artworksInTile.every((artwork) => !artwork.dirty)) {
			console.log(`Skipping tile (${tileX}, ${tileY}) as all artworks are clean`);
			continue;
		}
		await generateTile(tileX!, tileY!, artworksInTile);
		for (const artwork of artworksInTile) {
			artwork.dirty = false; // Reset dirty flag
			await redis.json.set(artwork.key, "$", artwork);
		}
	}

	// Clean up stale tiles that no longer have artworks
	const activeTileKeys = new Set(tiles.keys());

	try {
		if (existsSync("./tiles")) {
			const tileDirs = await readdir("./tiles");

			for (const tileXDir of tileDirs) {
				const tileXPath = `./tiles/${tileXDir}`;

				try {
					const tileYFiles = await readdir(tileXPath);

					for (const file of tileYFiles) {
						// Extract tileY from filename (e.g., "123_orig.png" -> "123")
						const match = file.match(/^(\d+)_orig\.png$/);
						if (match) {
							const tileY = match[1];
							const tileKey = `${tileXDir}:${tileY}`;

							if (!activeTileKeys.has(tileKey)) {
								console.log(`Removing stale tile: ${tileKey}`);
								// Remove both the original and processed files
								const origFile = `${tileXPath}/${tileY}_orig.png`;
								const processedFile = `${tileXPath}/${tileY}.png`;

								try {
									if (existsSync(origFile)) {
										await unlink(origFile);
									}
									if (existsSync(processedFile)) {
										await unlink(processedFile);
									}
								} catch (error) {
									console.error(
										`Error removing tile files for ${tileKey}:`,
										error,
									);
								}
							}
						}
					}

					// Check if directory is empty and remove it
					const remainingFiles = await readdir(tileXPath);
					if (remainingFiles.length === 0) {
						await import("fs/promises").then((fs) => fs.rmdir(tileXPath));
						console.log(`Removed empty tile directory: ${tileXDir}`);
					}
				} catch (error) {
					console.error(`Error processing tile directory ${tileXDir}:`, error);
				}
			}
		}
	} catch (error) {
		console.error("Error cleaning up stale tiles:", error);
	}
}

// if (process.argv[1] === fileURLToPath(import.meta.url)) {
// 	const geo = new GeospatialConverter(1000);
// 	generateTiles(geo)
// }
