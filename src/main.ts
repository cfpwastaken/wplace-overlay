import express from "express";
import sharp, { type Blend } from "sharp";
import path from "path";
import { createClient } from "redis";
import { generateTiles, type Artwork } from "./generate";
import fileUpload from "express-fileupload";
import { checkUser, generateAuthURL } from "./auth";
import { v4 as uuid } from "uuid";
import { sign } from "jsonwebtoken";
import { expressjwt } from "express-jwt";
import { readFile, access } from "fs/promises";
import { constants } from "fs";
import rateLimit from "express-rate-limit";
import { GeospatialConverter } from "./wplace";
import { PNG } from "pngjs";
import slowDown from "express-slow-down";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "wplace";
const JWT_ISSUER = process.env.JWT_ISSUER || "localhost";
const version = process.env.OVERLAY_VERSION || "germany";

if(JWT_SECRET === "wplace") {
	console.warn("WARNING: Using default JWT_SECRET. This is insecure and should be changed in production!");
}

type Auth = {
	coord: { lat: number; lon: number };
	expires: number;
}

let loggingIn: Auth[] = []; 

app.set("trust proxy", 1);

app.use((req, res, next) => {
	console.log(`${req.method} request for '${req.url}'`);
	next();
});

app.use(express.json());
app.use(express.urlencoded());
app.use(express.static(path.join(__dirname, "web")));
app.use("/artworks", express.static(path.join(__dirname, "..", "artworks")));
app.use(fileUpload({
	limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB limit
}));

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/dracula.css", (req, res) => {
	res.sendFile(path.join(__dirname, "dracula.css"));
});

app.get("/bookmark.txt", async (req, res) => {
	const enc = encodeURIComponent(await readFile(path.join(__dirname, "bookmark.js"), "utf-8"));
	res.setHeader("Content-Type", "text/plain");
	res.send("javascript:" + enc);
});

if (version === "vtuber") {
    app.get("/extra/overlay.user.js", async (req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.sendFile(path.join(__dirname, "overlay.js"));
    });

    app.get("/extra/form", async (req, res) => {
        res.redirect("https://forms.gle/U8jZExVP7UfM9jqB9")
    });

    app.get("/extra/list", async (req, res) => {
        res.redirect("https://docs.google.com/spreadsheets/d/1nsrhyaHpBsUPLIfagMM8VQMlTbAyzoYlhKFi2lYY_CU");
    });
}

app.get("/mobile.mp4", (req, res) => {
	res.sendFile(path.join(__dirname, "mobile.mp4"));
});

const redis = await createClient({
	url: process.env.REDIS_URL || "redis://localhost:6379"
}).connect();

const auth = expressjwt({
	algorithms: ["HS256"],
	secret: JWT_SECRET,
	issuer: JWT_ISSUER
});

app.get("/api/alliance", auth, async (req, res) => {
	// @ts-expect-error
	if(!req.auth.sub) {
		return res.status(401).send("Unauthorized: No user ID found in token.");
	}
	// @ts-expect-error
	const alliance = await getAllianceForUser(req.auth.sub);
	if(!alliance) {
		return res.status(403).send("Forbidden: You are not an admin of any alliance.");
	}
	res.json(alliance);
})

app.get("/api/artworks", auth, async (req, res) => {
	// @ts-expect-error
	if(!req.auth.sub) {
		return res.status(401).send("Unauthorized: No user ID found in token.");
	}
	// @ts-expect-error
	const alliance = await getAllianceForUser(req.auth.sub);
	if(!alliance) {
		return res.status(403).send("Forbidden: You are not an admin of any alliance.");
	}
	const keys = await redis.keys(`artwork:${alliance.slug}:*`);
	const rawArtworks = await redis.json.mGet(keys, "$");
	const artworks: Artwork[] = rawArtworks.map((item: any) => {
		// mGet returns an array of arrays (one per key), each containing the result or null
		if (Array.isArray(item) && item.length > 0 && item[0] !== null) {
			return item[0] as Artwork;
		}
		return null;
	}).filter(a => a !== null) as Artwork[];
	res.json(artworks);
});

type Alliance = {
	slug: string;
	name: string;
	admins: number[];
	helpers: number[];
}

async function getAllianceForUser(userId: number) {
	// Get all alliance:* (JSON) and check if the user is in the admins key
	const keys = await redis.keys("alliance:*");
	for (const key of keys) {
		const alliance = await redis.json.get(key) as Alliance;
		if (alliance && Array.isArray(alliance.admins) && alliance.admins.includes(userId)) {
			return alliance;
		}
		if (alliance && Array.isArray(alliance.helpers) && alliance.helpers.includes(userId)) {
			return alliance;
		}
	}
	return null;
}

async function getUserRole(userId: number): Promise<"admin" | "helper" | null> {
	const alliance = await getAllianceForUser(userId);
	if (!alliance) {
		return null;
	}
	if (alliance.admins.includes(userId)) {
		return "admin";
	}
	if (alliance.helpers.includes(userId)) {
		return "helper";
	}
	return null;
}

app.post("/api/upload", auth, async (req, res) => {
	if(!req.files || Object.keys(req.files).length === 0) {
		return res.status(400).send("No files were uploaded.");
	}
	if(!req.body.slug || !req.body.posurl) {
		return res.status(400).send("Missing required fields: slug and posurl.");
	}
	if(!req.files.file) {
		return res.status(400).send("No file uploaded.");
	}
	// @ts-expect-error
	if(!req.auth.sub) {
		return res.status(401).send("Unauthorized: No user ID found in token.");
	}
	// @ts-expect-error
	const alliance = await getAllianceForUser(req.auth.sub);
	if(!alliance) {
		return res.status(403).send("Forbidden: You are not an admin of any alliance.");
	}
	const posUrl = new URL(req.body.posurl);
	const lat = parseFloat(posUrl.searchParams.get("lat") || "0");
	const lon = parseFloat(posUrl.searchParams.get("lng") || "0");
	if(isNaN(lat) || isNaN(lon)) {
		return res.status(400).send("Invalid position URL. Must contain valid lat and lng parameters.");
	}
	const file = req.files.file as fileUpload.UploadedFile;
	const newPath = path.join(__dirname, "..", "artworks", file.md5);
	file.mv(newPath, async (err) => {
		if (err) {
			return res.status(500).send(err);
		}

		const artwork: Artwork = {
			slug: req.body.slug,
			author: req.body.author || "Unknown",
			position: {
				lat, lon
			},
			data: file.md5,
			dirty: true,
		};
		await redis.json.set(`artwork:${alliance.slug}:${artwork.slug}`, "$", artwork);
		console.log(`Uploaded artwork: ${artwork.slug} for ${alliance.slug} by ${artwork.author} at position ${artwork.position.lat}, ${artwork.position.lon}`);
		res.status(200).json({
			message: "Artwork uploaded successfully",
			artwork: {
				...artwork,
				url: `/artworks/${file.md5}`
			}
		});
		await generateTiles(redis);
	});
});

app.post("/api/replaceImage", auth, async (req, res) => {
	// @ts-expect-error
	if(!req.auth.sub) {
		return res.status(401).send("Unauthorized: No user ID found in token.");
	}
	// @ts-expect-error
	const alliance = await getAllianceForUser(req.auth.sub);
	if(!alliance) {
		return res.status(403).send("Forbidden: You are not an admin of any alliance.");
	}
	if(!req.body.slug || !req.files || !req.files.file) {
		return res.status(400).send("Missing required fields: slug and file.");
	}
	const slug = req.body.slug;
	const file = req.files.file as fileUpload.UploadedFile;
	const newPath = path.join(__dirname, "..", "artworks", file.md5);
	file.mv(newPath, async (err) => {
		if (err) {
			return res.status(500).send(err);
		}
		const existingArtwork = await redis.json.get(`artwork:${alliance.slug}:${slug}`);
		if (!existingArtwork) {
			return res.status(404).send("Artwork not found.");
		}
		const artwork = existingArtwork as Artwork;
		const updatedArtwork: Artwork = {
			...artwork,
			data: file.md5,
			dirty: true
		};
		await redis.json.set(`artwork:${alliance.slug}:${slug}`, "$", updatedArtwork);
		console.log(`Replaced image for artwork: ${slug}`);
		res.json({ message: "Image replaced successfully", artwork: updatedArtwork });
		await generateTiles(redis);
	});
})

app.delete("/api/artworks/:slug", auth, async (req, res) => {// @ts-expect-error
	if(!req.auth.sub) {
		return res.status(401).send({ success: false, message: "Unauthorized: No user ID found in token." });
	}
	// @ts-expect-error
	const alliance = await getAllianceForUser(req.auth.sub);
	if(!alliance) {
		return res.status(403).send({ success: false, message: "Forbidden: You are not an admin of any alliance." });
	}
	// @ts-expect-error
	const role = await getUserRole(req.auth.sub);
	if(role !== "admin") {
		return res.status(403).send({ success: false, message: "Forbidden: Only admins can delete artworks." });
	}
	const slug = req.params.slug;
	const artwork = await redis.json.get(`artwork:${alliance.slug}:${slug}`) as Artwork | null;
	if (!artwork) {
		return res.status(404).send({ success: false, message: "Artwork not found." });
	}
	if(artwork.protected) {
		return res.status(403).send({ success: false, message: "Forbidden: This artwork is protected and cannot be deleted." });
	}
	await redis.json.del(`artwork:${alliance.slug}:${slug}`);
	console.log(`Deleted artwork: ${slug}`);
	res.json({ message: "Artwork deleted successfully" });
});

app.get("/api/login", rateLimit({
	windowMs: 5 * 60 * 1000, // 5 minutes
	max: 3, // Limit each IP to 3 requests per windowMs
	message: "Too many login attempts, please try again later."
}), async (req, res) => {
	const auth = await generateAuthURL();
	if('error' in auth) {
		return void res.status(500).json(auth);
	}
	loggingIn.push({
		coord: auth.coord!,
		expires: Date.now() + 1000 * 60 * 5 // 5 minutes expiration
	});
	res.json(auth);
});

setInterval(() => {
	const now = Date.now();
	loggingIn = loggingIn.filter(auth => auth.expires > now);
}, 1000 * 60); // Clean up every minute

app.get("/api/verifyLogin", async (req, res) => {
	const auth = loggingIn.find(a => a.coord.lat === parseFloat(req.query.lat as string) && a.coord.lon === parseFloat(req.query.lon as string));
	if (!auth) {
		return res.status(404).send({
			success: false,
			message: "No login session found for the provided coordinates."
		});
	}
	if (Date.now() > auth.expires) {
		return res.status(403).send({
			success: false,
			message: "Login session expired."
		});
	}
	const user = await checkUser(auth.coord);
	if("error" in user) {
		return res.status(500).json(user);
	}
	// loggingIn = loggingIn.filter(a => a !== auth);
	// const sessionId = uuid();
	// const session: Session = {
	// 	id: sessionId,
	// 	lastUsed: Date.now(),
	// 	wplaceId: user.id,
	// };
	// sessions.set(sessionId, session);
	// console.log(`User logged in with session ID: ${sessionId} for WPlace ID: ${auth.wplaceId}`);
	// res.json({ sessionId, wplaceId: auth.wplaceId });
	if(!user || user.id === 0) {
		return res.status(404).send({
			success: false,
			message: "User not found for the provided coordinates."
		});
	}

	loggingIn = loggingIn.filter(a => a !== auth);

	const payload = {
		sub: user.id,
		preferred_username: user.name
	};
	const token = sign(payload, JWT_SECRET, {
		algorithm: "HS256",
		expiresIn: "1h",
		issuer: JWT_ISSUER
	});

	res.json({
		success: true,
		token
	})
});

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

type RenderInfo = {
	srcX: number;
	srcY: number;
	destX: number;
	destY: number;
	width: number;
	height: number;
};

async function renderImagePortionOnImage(png: PNG, img: PNG, renderInfo: RenderInfo): Promise<void> {
	for (let yy = 0; yy < renderInfo.height; yy++) {
		for (let xx = 0; xx < renderInfo.width; xx++) {
			const srcIdx = ((renderInfo.srcY + yy) * img.width + (renderInfo.srcX + xx)) << 2;
			const dstIdx = ((renderInfo.destY + yy) * png.width + (renderInfo.destX + xx)) << 2;

			// Check bounds to prevent errors
			if (srcIdx >= 0 && srcIdx < img.data.length - 3 && 
				dstIdx >= 0 && dstIdx < png.data.length - 3) {
				png.data[dstIdx] = img.data[srcIdx]!;
				png.data[dstIdx + 1] = img.data[srcIdx + 1]!;
				png.data[dstIdx + 2] = img.data[srcIdx + 2]!;
				png.data[dstIdx + 3] = img.data[srcIdx + 3]!;
			}
		}
	}
}

// app.post("/api/downloadLiveArtwork", async (req, res) => {
// 	const fromPosUrl = req.body.fromPosUrl;
// 	const toPosUrl = req.body.toPosUrl;
// 	if (!fromPosUrl || !toPosUrl) {
// 		return res.status(400).send({ success: false, message: "Missing required fields: fromPosUrl and toPosUrl." });
// 	}
	
// 	try {
// 		const fromPos = new URL(fromPosUrl);
// 		const toPos = new URL(toPosUrl);
// 		const fromLat = parseFloat(fromPos.searchParams.get("lat") || "0");
// 		const fromLon = parseFloat(fromPos.searchParams.get("lng") || "0");
// 		const toLat = parseFloat(toPos.searchParams.get("lat") || "0");
// 		const toLon = parseFloat(toPos.searchParams.get("lng") || "0");
		
// 		if (isNaN(fromLat) || isNaN(fromLon) || isNaN(toLat) || isNaN(toLon)) {
// 			return res.status(400).send({ success: false, message: "Invalid position URLs." });
// 		}

// 		console.log(`Generating artwork from ${fromLat}, ${fromLon} to ${toLat}, ${toLon}`);
		
// 		const ZOOM_LEVEL = 11;
// 		const geo = new GeospatialConverter(1000);
		
// 		const from = geo.latLonToPixelsFloor(fromLat, fromLon, ZOOM_LEVEL);
// 		const to = geo.latLonToPixelsFloor(toLat, toLon, ZOOM_LEVEL);
// 		const tileSize = 1000;
// 		console.log(`From: ${from}, To: ${to}`);
// 		const fromTileX = Math.floor(from[0] / tileSize);
// 		const fromTileY = Math.floor(from[1] / tileSize);
// 		const toTileX = Math.floor(to[0] / tileSize);
// 		const toTileY = Math.floor(to[1] / tileSize);

// 		const originTileX = Math.min(fromTileX, toTileX);
// 		const originTileY = Math.min(fromTileY, toTileY);

// 		const tileWidth = Math.abs(toTileX - fromTileX) + 1;
// 		const tileHeight = Math.abs(toTileY - fromTileY) + 1;
// 		console.log(`Downloading tiles from (${fromTileX}, ${fromTileY}) to (${toTileX}, ${toTileY}) with size ${tileWidth}x${tileHeight}`);

// 		const png = new PNG({
// 			width: tileWidth * tileSize,
// 			height: tileHeight * tileSize
// 		});

// 		for (let tileX = originTileX; tileX <= originTileX + tileWidth - 1; tileX++) {
// 			for (let tileY = originTileY; tileY <= originTileY + tileHeight - 1; tileY++) {
// 				const tile = await fetch(`https://backend.wplace.live/files/s0/tiles/${tileX}/${tileY}.png`).then(res => res.ok ? res.arrayBuffer() : null);
// 				if (tile) {
// 					await renderImageOnImage(
// 						png,
// 						PNG.sync.read(Buffer.from(tile)),
// 						(tileX - originTileX) * tileSize,
// 						(tileY - originTileY) * tileSize
// 					);
// 				}
// 			}
// 		}

// 		const cropX1 = Math.min(from[0], to[0]) - originTileX * tileSize;
// 		const cropY1 = Math.min(from[1], to[1]) - originTileY * tileSize;
// 		const cropX2 = Math.max(from[0], to[0]) - originTileX * tileSize;
// 		const cropY2 = Math.max(from[1], to[1]) - originTileY * tileSize;

// 		const cropWidth = cropX2 - cropX1;
// 		const cropHeight = cropY2 - cropY1;

// 		const img = new PNG({ width: cropWidth, height: cropHeight });
// 		await renderImagePortionOnImage(png, img, {
// 			srcX: cropX1,
// 			srcY: cropY1,
// 			destX: 0,
// 			destY: 0,
// 			width: cropWidth,
// 			height: cropHeight
// 		});

// 		const buffer = PNG.sync.write(img);
// 		res.setHeader("Content-Type", "image/png");
// 		res.send(buffer);
// 	} catch (error) {
// 		console.error("Error generating artwork:", error);
// 		res.status(500).send({ success: false, message: "Internal server error while generating artwork." });
// 	}
// });

app.post("/api/generate", rateLimit({
	windowMs: 10 * 60 * 1000, // 10 minutes
	max: 1, // Limit to 1 request per windowMs
	message: "Too many generate requests, please try again later.",
}), auth, async (req, res) => {
	// @ts-expect-error
	const role = await getUserRole(req.auth.sub);
	if(role !== "admin") {
		return res.status(403).send({ success: false, message: "Forbidden: Only admins can trigger tile generation. Tiles generate automatically every 5 minutes." });
	}
	res.json({ success: true, message: "Tiles generation started." });
	await generateTiles(redis);
	cachedMapTiles.clear();
	cachedFinalTiles.clear();
});

// Pre-load darken.png into memory for better performance
let darkenBuffer: Buffer | null = null;
const loadDarkenBuffer = async () => {
	try {
		darkenBuffer = await readFile(path.join(__dirname, "darken.png"));
		console.log("Darken buffer loaded into memory");
	} catch (error) {
		console.error("Failed to load darken.png:", error);
	}
};
loadDarkenBuffer();

app.get("/api/stats", (req, res) => {
	const stats = {
		cacheHitCount,
		cacheMissCount,
		cachedMapTilesCount: cachedMapTiles.size,
		cachedFinalTilesCount: cachedFinalTiles.size,
		cachedMapTilesSize: Array.from(cachedMapTiles.values()).reduce((acc, buf) => acc + buf.length, 0), // in bytes
		cachedFinalTilesSize: Array.from(cachedFinalTiles.values()).reduce((acc, buf) => acc + buf.length, 0), // in bytes
		totalRequests,
		averageFetchTime: totalRequests > 0 ? totalFetchTime / totalRequests : 0,
		averageProcessingTime: totalRequests > 0 ? totalProcessingTime / totalRequests : 0,
		averageRequestTime: totalRequests > 0 ? totalRequestTime / totalRequests : 0,
		totalFetchTime,
		totalProcessingTime,
		totalRequestTime
	};
	res.json(stats);
});

// Helper function to check if file exists asynchronously
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

app.use("/symbols", (req, res, next) => {
	res.setHeader("Cache-Control", "public, max-age=6000");
	res.setHeader("Access-Control-Allow-Origin", "https://wplace.live");
	next();
}, express.static("symbols"));

app.use("/tiles", (req, res, next) => {
	res.setHeader("Cache-Control", "public, max-age=600, must-revalidate");
	next();
}, express.static(path.join(__dirname, "..", "tiles")));

const VALID_BLENDING_MODES: Blend[] = ["over", "difference", "out"];

const cachedMapTiles: Map<string, Buffer> = new Map();
const cachedFinalTiles: Map<string, Buffer> = new Map();
let cacheHitCount = 0;
let cacheMissCount = 0;
let totalRequests = 0;
let totalFetchTime = 0;
let totalProcessingTime = 0;
let totalRequestTime = 0;

app.get("/enable.js", (req, res) => {
	res.setHeader("Content-Type", "application/javascript");
	res.sendFile(path.join(__dirname, "enable.js"));
})

app.get("/enable-old.js", (req, res) => {
	res.setHeader("Content-Type", "application/javascript");
	res.sendFile(path.join(__dirname, "enable-old.js"));
});

// app.use(slowDown({
// 	windowMs: 1000 * 5, // 5 seconds
// 	delayAfter: 10, // Delay after 10 requests
// 	delayMs: (hits) => hits * 100, // Delay 100ms for each request after the 10th
// 	maxDelayMs: 1000, // Maximum delay of 1 second
// }), async (req, res) => {
// 	res.sendFile(path.join(__dirname, "update-overlay.png"));
// });

// Proxy all requests to wplace.live (by fetching the WEBPs and returning the response, leaving room to add more logic later)
app.use("/files", slowDown({
	windowMs: 1000 * 5, // 5 seconds
	delayAfter: 10, // Delay after 10 requests
	delayMs: (hits) => hits * 100, // Delay 100ms for each request after the 10th
	maxDelayMs: 1000, // Maximum delay of 1 second
}), async (req, res) => {
	const start = Date.now();
	const query = req.query;
	const blending = (query.blending || "over") as Blend;
	const darken = query.darken === "true";
	const update = !query.tag; // If there is no tag, render the update message
	if (!VALID_BLENDING_MODES.includes(blending)) {
		return res.status(400).send(`Invalid blending mode: ${blending}. Valid modes are: ${VALID_BLENDING_MODES.join(", ")}`);
	}
	const originalUrlWithoutQuery = req.originalUrl.split('?')[0];
	let url = `https://backend.wplace.live${originalUrlWithoutQuery}`;
    url = url.replace("_sym","")

	try {
		const fetchStart = Date.now();
		const response = await fetch(url);
		const fetchTime = Date.now() - fetchStart;
		
		if (!response.ok) {
			if(response.status !== 404) console.error(`Error fetching ${url}:`, response.status, response.statusText);
			return void res.status(response.status).send(`Error fetching ${url}: ${response.statusText}`);
		}
		
		const bufferStart = Date.now();
		const webpBuffer = Buffer.from(await response.arrayBuffer());
		if (cachedMapTiles.has(req.originalUrl)) {
			if (cachedMapTiles.get(req.originalUrl)?.equals(webpBuffer) && cachedFinalTiles.has(req.originalUrl)) {
				console.log(`Cache hit for ${req.originalUrl}`);
				cacheHitCount++;
				return res.send(cachedFinalTiles.get(req.originalUrl));
			}
		}
		cacheMissCount++;
		cachedMapTiles.set(req.originalUrl, webpBuffer);
		const bufferTime = Date.now() - bufferStart;

		// Parse the request URL to extract tile coordinates
		const urlMatch = req.originalUrl.match(/\/files\/s0\/tiles\/(\d+)\/(\d+)\.png/);
		
		let outputBuffer: Buffer;
		const processingStart = Date.now();
		
		if (urlMatch && urlMatch[1] && urlMatch[2]) {
			const x = urlMatch[1] as string;
			const y = urlMatch[2] as string;
			const localTilePath = path.join(__dirname, "..", "tiles", x, `${y}${blending != "over" ? "_orig" : ""}.png`);
			
			// Check if local tile overlay exists
			if (await fileExists(localTilePath)) {
				console.log(`Using local overlay for tile ${x}/${y}`);
				const overlayBuffer = await readFile(localTilePath);

				const overlayImage = sharp(overlayBuffer);
				const { width: overlayWidth, height: overlayHeight } = await overlayImage.metadata();

				// Resize original tile to match overlay dimensions using nearest neighbor
				let resizedOriginal = await sharp(webpBuffer)
					.resize(overlayWidth, overlayHeight, { kernel: "nearest" })
					.toBuffer();
				
				// If darken is true, apply a darkening effect to the overlay
				if (darken) {
					console.log(`Darkening overlay for tile ${x}/${y}`);
					if (darkenBuffer) {
						resizedOriginal = await sharp(darkenBuffer)
							.composite([{ input: resizedOriginal }])
							.toBuffer();
					} else {
						console.warn("Darken buffer not loaded, skipping darkening effect");
					}
				}

				const updateOverlayImage = await readFile(path.join(__dirname, "update-overlay-transparent.png"));

				// Composite overlay onto resized original
				outputBuffer = await sharp(resizedOriginal)
					.composite([{ input: overlayBuffer, blend: blending }])
					.toFormat("png")
					.toBuffer();
				if (update) {
					console.log(`Applying update overlay for tile ${x}/${y}`);
					outputBuffer = await sharp(outputBuffer)
						.composite([{ input: updateOverlayImage, blend: "over" }])
						.toFormat("png")
						.toBuffer();
				}
			} else {
				console.log(`No local overlay found for tile ${x}/${y}, returning original`);
				outputBuffer = await sharp(webpBuffer)
					.toFormat("png")
					.toBuffer();
			}
		} else {
			// This shouldn't happen, just return the original image
			outputBuffer = await sharp(webpBuffer)
				.toFormat("png")
				.toBuffer();
		}

		const processingTime = Date.now() - processingStart;

		// Cache the final output tile
		cachedFinalTiles.set(req.originalUrl, outputBuffer);
		
		res.setHeader("Content-Type", "image/png");
		res.send(outputBuffer);
		
		// Detailed timing breakdown
		const totalTime = Date.now() - start;
		console.log(`Tile ${urlMatch?.[1]}/${urlMatch?.[2]}: Total=${totalTime}ms, Fetch=${fetchTime}ms, Buffer=${bufferTime}ms, Processing=${processingTime}ms`);

		totalRequests++;
		totalFetchTime += fetchTime;
		totalProcessingTime += processingTime;
		totalRequestTime += totalTime;
	} catch (error) {
		console.error(`Error processing ${url}:`, error);
		res.status(500).send("Internal Server Error");
	}
});

setInterval(async () => {
	generateTiles(redis, false);
	cachedMapTiles.clear();
	cachedFinalTiles.clear();
	console.log("Cache cleared and tiles regenerated.");
}, 1000 * 60 * 30); // Run every 30 minutes

generateTiles(redis, false);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});