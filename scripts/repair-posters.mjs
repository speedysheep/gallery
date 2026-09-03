// One-off repair for video posters that were extracted before the pipeline understood
// anamorphic video (non-square pixels).
//
// scripts/process-videos.mjs used to extract the poster frame at the video's *coded*
// size and ignore its pixel aspect ratio, so a clip stored 1280x960 with a 9:16 SAR —
// meant to be shown 720x960 — produced a poster stretched 1.78x horizontally. Players
// honour the SAR, so the videos themselves were always fine; only the still was wrong.
//
// Existing entries short-circuit on their hash in process-videos.mjs, so a normal
// `npm run gallery` will never rebuild these posters. Hence this script.
//
// It is deliberately narrow, in the spirit of the rule in lib/media.mjs: it only ever
// OVERWRITES a poster JPG and corrects the width/height of an existing manifest entry.
// It never deletes a file, never adds or removes a manifest entry, and never touches R2.
//
// Usage:
//   npm run repairPosters        # dry run: report what is wrong, change nothing
//   npm run repairPosters yes    # actually rewrite the posters
//
// Videos whose source is not in sites/<site>/public/videos/ are skipped — run `npm run downloadVideos`
// first to pull them back from R2 if you want those repaired too.
import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import sharp from "sharp";

import { displayDims, isVideo, loadCache, loadManifest, saveCache, saveManifest, thumbsDir, videosDir } from "./lib/media.mjs";

const execFileAsync = promisify(execFile);

// Anything within this much of the right shape is treated as already correct, so the
// script is idempotent and rounding in the 480px resize doesn't cause churn.
const RATIO_TOLERANCE = 0.02;
const POSTER_WIDTH = 480; // must match makePoster() in process-videos.mjs

const apply = process.argv.slice(2).includes("yes");

async function probeVideo(filePath) {
	const { stdout } = await execFileAsync(ffprobeStatic.path, [
		"-v",
		"error",
		"-select_streams",
		"v:0",
		"-show_entries",
		"stream=width,height,sample_aspect_ratio",
		"-of",
		"json",
		filePath,
	]);
	const stream = JSON.parse(stdout).streams?.[0];
	if (!stream?.width || !stream?.height) throw new Error("no usable video stream");
	return { ...stream, ...displayDims(stream.width, stream.height, stream.sample_aspect_ratio) };
}

async function main() {
	const manifest = (await loadManifest()) ?? [];
	const videos = manifest.filter((e) => e.type === "video");
	if (videos.length === 0) {
		console.log("No video entries in gallery.json — nothing to do.");
		return;
	}

	// poster stem -> source filename, for whatever happens to be sitting in sites/<site>/public/videos/
	const sources = new Map();
	for (const name of await readdir(videosDir)) {
		if (isVideo(name)) sources.set(path.parse(name).name, name);
	}

	const cache = await loadCache();
	let repaired = 0;
	let alreadyFine = 0;
	let skipped = 0;

	for (const entry of videos) {
		const stem = path.parse(entry.poster).name;
		const source = sources.get(stem);
		if (!source) {
			skipped++;
			continue;
		}

		const posterPath = path.join(thumbsDir, `${stem}.jpg`);
		let info;
		let poster;
		try {
			info = await probeVideo(path.join(videosDir, source));
			poster = await sharp(posterPath).metadata();
		} catch (err) {
			console.warn(`  ! ${stem}: couldn't inspect it (${err.message}) — skipping`);
			skipped++;
			continue;
		}

		const want = info.width / info.height; // display ratio, SAR applied
		const have = poster.width / poster.height;
		if (Math.abs(want - have) / want <= RATIO_TOLERANCE) {
			alreadyFine++;
			continue;
		}

		// The published video keeps its height; only the width was ever misreported, so
		// recover the true width from the display ratio rather than guessing at the
		// encode settings that produced the entry in the first place.
		const fixedWidth = Math.round(entry.height * want);
		console.log(
			`${stem}: poster ${poster.width}x${poster.height} (${have.toFixed(3)}) -> should be ${want.toFixed(3)}` +
				`; entry ${entry.width}x${entry.height} -> ${fixedWidth}x${entry.height}`,
		);

		if (!apply) {
			repaired++;
			continue;
		}

		const framePath = path.join(thumbsDir, `.repair-${stem}.raw.jpg`);
		try {
			await execFileAsync(ffmpegPath, [
				"-y",
				"-v",
				"error",
				"-ss",
				String(Math.min(1, (Number(entry.duration) || 2) / 2)),
				"-i",
				path.join(videosDir, source),
				"-frames:v",
				"1",
				"-vf",
				// Same expression the pipeline uses — see makePoster() in process-videos.mjs.
				"scale=iw*sar:ih,setsar=1",
				"-q:v",
				"2",
				framePath,
			]);
			await sharp(framePath).rotate().resize({ width: POSTER_WIDTH, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(posterPath);
		} catch (err) {
			console.warn(`  ! ${stem}: repair failed (${err.message}) — poster left as it was`);
			skipped++;
			continue;
		} finally {
			await rm(framePath, { force: true });
		}

		entry.width = fixedWidth;

		// Keep .media-cache.json in step with the manifest. sameVideoEntry() compares the
		// cached entry against the live one, so leaving a stale width here would make the
		// next `npm run gallery` decide every repaired video had changed and re-encode and
		// re-upload all of them for no reason.
		const cached = cache[source];
		if (cached?.entry) cached.entry = { ...cached.entry, width: fixedWidth };

		repaired++;
	}

	if (apply && repaired > 0) {
		await saveManifest(manifest);
		await saveCache(cache);
	}

	console.log(
		`\n${apply ? "Repaired" : "Would repair"} ${repaired}; ${alreadyFine} already correct; ${skipped} skipped (no local source or unreadable).`,
	);
	if (!apply && repaired > 0) console.log("Dry run — re-run as `npm run repairPosters yes` to write the changes.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
