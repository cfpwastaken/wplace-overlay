import express from "express";
import sharp, { type Blend } from "sharp";
import path from "path";
import fs from "fs";
import { createClient } from "redis";
import { generateTiles, type Artwork } from "./generate";
import fileUpload from "express-fileupload";
import { checkUser, generateAuthURL } from "./auth";
import { v4 as uuid } from "uuid";
import { sign } from "jsonwebtoken";
import { expressjwt, type ExpressJwtRequest } from "express-jwt";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "wplace";

if(JWT_SECRET === "wplace") {
	console.warn("WARNING: Using default JWT_SECRET. This is insecure and should be changed in production!");
}

type Auth = {
	coord: { lat: number; lon: number };
	expires: number;
}

let loggingIn: Auth[] = []; 

app.use((req, res, next) => {
	console.log(`${req.method} request for '${req.url}'`);
	next();
});

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

app.get("/bookmark.txt", (req, res) => {
	res.sendFile(path.join(__dirname, "bookmark.txt"));
});

app.get("/mobile.mp4", (req, res) => {
	res.sendFile(path.join(__dirname, "mobile.mp4"));
});

const redis = await createClient({
	url: process.env.REDIS_URL || "redis://localhost:6379"
}).connect();

const auth = expressjwt({
	algorithms: ["HS256"],
	secret: JWT_SECRET,
	issuer: "https://cfp.is-a.dev/wplace/"
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
}

async function getAllianceForUser(userId: number) {
	// Get all alliance:* (JSON) and check if the user is in the admins key
	const keys = await redis.keys("alliance:*");
	for (const key of keys) {
		const alliance = await redis.json.get(key) as Alliance;
		if (alliance && Array.isArray(alliance.admins) && alliance.admins.includes(userId)) {
			return alliance;
		}
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
		};
		await redis.json.set(`artwork:${alliance.slug}:${slug}`, "$", updatedArtwork);
		console.log(`Replaced image for artwork: ${slug}`);
		res.json({ message: "Image replaced successfully", artwork: updatedArtwork });
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

app.get("/api/login", async (req, res) => {
	const auth = await generateAuthURL();
	if(auth.error) {
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
		issuer: "https://cfp.is-a.dev/wplace/"
	});

	res.json({
		success: true,
		token
	})
});

app.post("/api/generate", auth, async (req, res) => {
	generateTiles(redis);
	res.json({ success: true, message: "Tiles generation started." });
});

const VALID_BLENDING_MODES: Blend[] = ["over", "difference", "out"];

// Proxy all requests to wplace.live (by fetching the WEBPs and returning the response, leaving room to add more logic later)
app.use(async (req, res) => {
	const query = req.query;
	const blending = (query.blending || "over") as Blend;
	const darken = query.darken === "true";
	if (!VALID_BLENDING_MODES.includes(blending)) {
		return res.status(400).send(`Invalid blending mode: ${blending}. Valid modes are: ${VALID_BLENDING_MODES.join(", ")}`);
	}
	const originalUrlWithoutQuery = req.originalUrl.split('?')[0];
	const url = `https://backend.wplace.live${originalUrlWithoutQuery}`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			return void res.status(response.status).send(`Error fetching ${url}: ${response.statusText}`);
		}
		const webpBuffer = await response.arrayBuffer();

		// Parse the request URL to extract tile coordinates
		// Expected format: /files/s0/tiles/X/Y.png
		const urlMatch = req.originalUrl.match(/\/files\/s0\/tiles\/(\d+)\/(\d+)\.png/);
		
		let outputBuffer: Buffer;
		
		if (urlMatch && urlMatch[1] && urlMatch[2]) {
			const x = urlMatch[1] as string;
			const y = urlMatch[2] as string;
			const localTilePath = path.join(__dirname, "..", "tiles", x, `${y}${blending != "over" ? "_orig" : ""}.png`);
			
			// Check if local tile overlay exists
			if (fs.existsSync(localTilePath)) {
				console.log(`Using local overlay for tile ${x}/${y}`);
				const overlayBuffer = fs.readFileSync(localTilePath);

				const overlayImage = sharp(overlayBuffer);
				const { width: overlayWidth, height: overlayHeight } = await overlayImage.metadata();

				// Resize original tile to match overlay dimensions using nearest neighbor
				let resizedOriginal = await sharp(webpBuffer)
					.resize(overlayWidth, overlayHeight, { kernel: "nearest" })
					.toBuffer();
				
				// If darken is true, apply a darkening effect to the overlay
				if (darken) {
					console.log(`Darkening overlay for tile ${x}/${y}`);
					const darkenBuffer = fs.readFileSync(path.join(__dirname, "darken.png"));
					resizedOriginal = await sharp(darkenBuffer)
						.composite([{ input: resizedOriginal }])
						.toBuffer();
				}

				// Composite overlay onto resized original
				outputBuffer = await sharp(resizedOriginal)
					.composite([{ input: overlayBuffer, blend: blending }])
					.toFormat("png")
					.toBuffer();
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

		res.setHeader("Content-Type", "image/png");
		res.send(outputBuffer);
	} catch (error) {
		console.error(`Error processing ${url}:`, error);
		res.status(500).send("Internal Server Error");
	}
});

setInterval(async () => {
	generateTiles(redis);
}, 1000 * 60 * 5); // Run every 5 minutes

generateTiles(redis);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});