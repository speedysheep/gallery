// Assembles a site's deployable directory.
//
// Content (gallery.json, pictures/, thumbs/) is committed under sites/<domain>/public/.
// The shared shell (index.html, app.js, styles.css) lives once in app/ and is copied in
// here, with index.html's {{placeholders}} filled from that site's site.json. Those three
// generated files are git-ignored inside each site, so app/ stays the only copy anyone edits.
//
// Cloudflare serves sites/<domain>/public/ directly (see the site's wrangler.jsonc), which
// is why this copies a handful of small files rather than staging the whole gallery: the
// photos are hundreds of megabytes and have no business being duplicated on every build.
//
// Usage: node scripts/build-site.mjs [site]   (defaults to $GALLERY_SITE)
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const site = process.argv[2] ?? process.env.GALLERY_SITE;
if (site) process.env.GALLERY_SITE = site;

const { SITE, siteConfig, siteDir, repoRoot } = await import("./lib/site.mjs");

const appDir = path.join(repoRoot, "app");
const outDir = path.join(siteDir, "public");

// Anything referenced by a {{placeholder}} must exist, or the page ships with a literal
// "{{heading}}" on it — which is the sort of thing nobody notices until it is live.
const TEMPLATED = ["title", "heading", "love", "tagline", "mediaBaseUrl"];
const missing = TEMPLATED.filter((key) => !siteConfig[key]);
if (missing.length > 0) {
	throw new Error(`${SITE}/site.json is missing: ${missing.join(", ")}`);
}

const html = await readFile(path.join(appDir, "index.html"), "utf8");
const rendered = html.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
	if (!(key in siteConfig)) throw new Error(`index.html references {{${key}}}, which ${SITE}/site.json does not define`);
	return escapeHtml(String(siteConfig[key]));
});
const leftover = rendered.match(/\{\{\w+\}\}/g);
if (leftover) throw new Error(`Unresolved placeholders in index.html: ${leftover.join(", ")}`);

await writeFile(path.join(outDir, "index.html"), rendered);
for (const file of ["app.js", "styles.css"]) {
	await copyFile(path.join(appDir, file), path.join(outDir, file));
}

console.log(`Built ${SITE} -> ${path.relative(repoRoot, outDir)} (index.html, app.js, styles.css)`);

// site.json values land in text nodes and attribute values, and at least one of them
// already contains an apostrophe.
function escapeHtml(value) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
