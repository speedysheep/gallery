// Drives the real makePoster() over synthetic clips covering every shape class that has
// ever produced a wrong poster. Two separate bugs live here:
//
//   1. Anamorphic video (non-square pixels): a clip stored 1280x960 with a 9:16 SAR is
//      meant to be shown 720x960. Extracting the frame at coded size stretched it 1.78x.
//   2. Rotated video: ffmpeg auto-applies the display matrix before filters, so pinning
//      the scale to ffprobe's coded dimensions fights the rotation and squashes the frame.
//
// Both are invisible in the video itself — players honour SAR and rotation — so only the
// still poster is ever wrong, which is exactly why it went unnoticed for so long.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

// process-videos.mjs resolves a site when it loads (see lib/site.mjs). Nothing here
// touches that site's files — every fixture is built in a temp directory — but a site
// still has to be chosen, so pin one rather than depending on the caller's environment.
process.env.GALLERY_SITE ??= "booperandwoowoo.com";
const { makePoster, probe } = await import("../scripts/process-videos.mjs");

const execFileAsync = promisify(execFile);
const RATIO_TOLERANCE = 0.02;

let dir;
before(async () => {
	dir = await mkdtemp(path.join(tmpdir(), "poster-geometry-"));
});
after(async () => {
	await rm(dir, { recursive: true, force: true });
});

/** Builds a synthetic clip: `size` is the coded size, `sar` the pixel aspect ratio. */
async function makeClip({ name, size, sar = "1:1", duration = 2, rotate = null }) {
	const out = path.join(dir, `${name}.mp4`);
	await execFileAsync(ffmpegPath, [
		"-y", "-v", "error",
		"-f", "lavfi", "-i", `testsrc=size=${size}:rate=15:duration=${duration}`,
		"-vf", `setsar=${sar.replace(":", "/")}`,
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
		out,
	]);
	if (rotate === null) return out;

	// A rotation has to be written as a display matrix, which is an input-side option.
	const rotated = path.join(dir, `${name}-rot.mp4`);
	await execFileAsync(ffmpegPath, ["-y", "-v", "error", "-display_rotation", String(rotate), "-i", out, "-c", "copy", rotated]);
	return rotated;
}

async function posterRatio(src, name) {
	const out = path.join(dir, `${name}.jpg`);
	await makePoster(src, out, await probe(src));
	const meta = await sharp(out).metadata();
	return { ratio: meta.width / meta.height, width: meta.width, height: meta.height };
}

function assertRatio(got, want, label) {
	const off = Math.abs(got.ratio - want) / want;
	assert.ok(
		off <= RATIO_TOLERANCE,
		`${label}: poster is ${got.width}x${got.height} (ratio ${got.ratio.toFixed(3)}), expected ratio ${want.toFixed(3)}`,
	);
}

describe("poster geometry", () => {
	test("square-pixel landscape is unchanged", async () => {
		const clip = await makeClip({ name: "landscape", size: "848x478" });
		assertRatio(await posterRatio(clip, "landscape"), 848 / 478, "square-pixel landscape");
	});

	test("square-pixel portrait is unchanged", async () => {
		const clip = await makeClip({ name: "portrait", size: "576x768" });
		assertRatio(await posterRatio(clip, "portrait"), 576 / 768, "square-pixel portrait");
	});

	test("anamorphic 1280x960 SAR 9:16 becomes portrait 3:4", async () => {
		const clip = await makeClip({ name: "anamorphic-960", size: "1280x960", sar: "9:16" });
		assertRatio(await posterRatio(clip, "anamorphic-960"), 720 / 960, "anamorphic 9:16");
	});

	test("anamorphic 1280x720 SAR 81:256 becomes portrait 9:16", async () => {
		const clip = await makeClip({ name: "anamorphic-720", size: "1280x720", sar: "81:256" });
		assertRatio(await posterRatio(clip, "anamorphic-720"), 405 / 720, "anamorphic 81:256");
	});

	test("a rotated clip follows the rotation, not the coded dimensions", async () => {
		// Coded 576x768; a 90-degree display matrix means it is really shown 768x576.
		const clip = await makeClip({ name: "rotated", size: "576x768", rotate: 90 });
		assertRatio(await posterRatio(clip, "rotated"), 768 / 576, "rotated 90deg");
	});

	test("a sub-second clip still yields a frame", async () => {
		// 000000000299 is 0.38s. Seeking to a fixed 1s would land past the end and write
		// nothing at all — makePoster seeks to duration/2 instead.
		const clip = await makeClip({ name: "tiny", size: "1280x960", sar: "9:16", duration: 0.4 });
		const got = await posterRatio(clip, "tiny");
		assert.ok(got.width > 0 && got.height > 0, "no frame was extracted from a sub-second clip");
		assertRatio(got, 720 / 960, "sub-second anamorphic");
	});

	test("the poster is written with square pixels", async () => {
		// setsar=1 matters: a JPEG carries no pixel-aspect metadata, so anything downstream
		// would misread a non-square frame.
		const clip = await makeClip({ name: "sar-check", size: "1280x960", sar: "9:16" });
		const out = path.join(dir, "sar-check.jpg");
		await makePoster(clip, out, await probe(clip));
		const meta = await sharp(out).metadata();
		assert.equal(meta.width, 480, "poster should be capped at 480px wide");
		assert.equal(meta.height, 640);
	});
});
