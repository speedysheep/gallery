// Which site the media scripts are operating on.
//
// This repo holds several galleries that share one pipeline. Every script reads and
// writes exactly one of them, chosen by the GALLERY_SITE environment variable:
//
//   GALLERY_SITE=booperandwoowoo.com npm run gallery
//
// There is deliberately no default when more than one site exists. These scripts upload
// to a site's R2 bucket and rewrite its gallery.json; picking one by guesswork would
// eventually publish somebody's cats to the dog site.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.join(__dirname, "..", "..");
export const sitesDir = path.join(repoRoot, "sites");

/** Every directory under sites/ that carries a site.json, sorted for stable messages. */
export function availableSites() {
	return readdirSync(sitesDir)
		.filter((name) => {
			const dir = path.join(sitesDir, name);
			return statSync(dir).isDirectory() && existsQuietly(path.join(dir, "site.json"));
		})
		.sort();
}

function existsQuietly(p) {
	try {
		statSync(p);
		return true;
	} catch {
		return false;
	}
}

function resolveSite() {
	const available = availableSites();
	if (available.length === 0) {
		throw new Error(`No sites found in ${sitesDir} — each site needs its own site.json.`);
	}

	const requested = process.env.GALLERY_SITE;
	if (requested) {
		if (!available.includes(requested)) {
			throw new Error(`Unknown GALLERY_SITE "${requested}". Available: ${available.join(", ")}`);
		}
		return requested;
	}

	if (available.length === 1) return available[0];
	throw new Error(`This repo holds several sites. Set GALLERY_SITE to one of: ${available.join(", ")}`);
}

export const SITE = resolveSite();
export const siteDir = path.join(sitesDir, SITE);
export const siteConfig = JSON.parse(readFileSync(path.join(siteDir, "site.json"), "utf8"));
