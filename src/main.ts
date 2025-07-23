import express from "express";
import sharp, { type Blend } from "sharp";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
	console.log(`${req.method} request for '${req.url}'`);
	next();
});

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

const VALID_BLENDING_MODES: Blend[] = ["over", "difference", "out"];

// Proxy all requests to wplace.live (by fetching the WEBPs and returning the response, leaving room to add more logic later)
app.use(async (req, res) => {
	const query = req.query;
	const blending = (query.blending || "over") as Blend;
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
			const localTilePath = path.join(__dirname, "tiles", x, `${y}${blending != "over" ? "_orig" : ""}.png`);
			
			// Check if local tile overlay exists
			if (fs.existsSync(localTilePath)) {
				console.log(`Using local overlay for tile ${x}/${y}`);
				const overlayBuffer = fs.readFileSync(localTilePath);

				const overlayImage = sharp(overlayBuffer);
				const { width: overlayWidth, height: overlayHeight } = await overlayImage.metadata();

				// Resize original tile to match overlay dimensions using nearest neighbor
				const resizedOriginal = await sharp(webpBuffer)
					.resize(overlayWidth, overlayHeight, { kernel: "nearest" })
					.toBuffer();

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});