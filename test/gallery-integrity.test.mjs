// Guards the published libraries themselves: for every site in the repo, each committed
// poster must have the same shape as the entry that describes it. This is the check that
// would have caught the 40 stretched posters, and it needs neither ffmpeg nor network.
//
// It reads sites/*/ directly rather than going through lib/site.mjs, because it is the
// one thing here that deliberately looks at *all* sites at once.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import sharp from "sharp";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sitesDir = path.join(repoRoot, "sites");

// A poster is capped at 480px wide, so its ratio is the entry's ratio give or take a
// rounding error; anything past this is a real shape mismatch, not arithmetic.
const RATIO_TOLERANCE = 0.02;

const sites = readdirSync(sitesDir).filter((name) => statSync(path.join(sitesDir, name)).isDirectory());

test("the repo has sites to check", () => {
	assert.ok(sites.length > 0, "no sites found under sites/");
});

for (const site of sites) {
	describe(site, () => {
		const publicDir = path.join(sitesDir, site, "public");
		const manifest = JSON.parse(readFileSync(path.join(publicDir, "gallery.json"), "utf8"));
		const videos = manifest.filter((e) => e.type === "video");

		test("site.json defines everything the build stamps into the page", () => {
			const config = JSON.parse(readFileSync(path.join(sitesDir, site, "site.json"), "utf8"));
			for (const key of ["domain", "workerName", "r2Bucket", "mediaBaseUrl", "title", "heading", "love", "tagline"]) {
				assert.ok(config[key], `${site}/site.json is missing "${key}"`);
			}
			assert.equal(config.domain, site, "site.json domain should match its directory name");
		});

		test("every video entry's poster matches the shape it claims", async () => {
			const mismatches = [];
			for (const entry of videos) {
				const meta = await sharp(path.join(publicDir, entry.poster)).metadata();
				const claimed = entry.width / entry.height;
				const actual = meta.width / meta.height;
				if (Math.abs(claimed - actual) / claimed > RATIO_TOLERANCE) {
					mismatches.push(
						`${entry.poster}: entry says ${entry.width}x${entry.height} (${claimed.toFixed(3)}) ` +
							`but the poster is ${meta.width}x${meta.height} (${actual.toFixed(3)})`,
					);
				}
			}
			assert.deepEqual(mismatches, [], `\n${mismatches.join("\n")}\n`);
		});

		test("no entry records a placeholder or impossible size", () => {
			for (const entry of videos) {
				assert.ok(Number.isInteger(entry.width) && entry.width > 0, `${entry.poster} has a bad width`);
				assert.ok(Number.isInteger(entry.height) && entry.height > 0, `${entry.poster} has a bad height`);
			}
		});
	});
}
