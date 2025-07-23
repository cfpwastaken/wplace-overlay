import { readFile } from "fs/promises";

const script = await readFile(new URL("./enable.js", import.meta.url), "utf-8");

console.log(`javascript:(function(){${encodeURIComponent(script)}})();`);