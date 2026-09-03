// The pixel-aspect maths behind the poster fix. displayDims() turns ffprobe's *coded*
// dimensions into the shape a viewer actually sees, which is what every poster and
// manifest entry is derived from.
import assert from "node:assert/strict";
import { test } from "node:test";

import { displayDims } from "../scripts/lib/geometry.mjs";

test("square pixels are left alone", () => {
	assert.deepEqual(displayDims(1920, 1080, "1:1"), { width: 1920, height: 1080 });
	assert.deepEqual(displayDims(576, 768, "1:1"), { width: 576, height: 768 });
});

test("anamorphic video is widened or narrowed to its display shape", () => {
	// The two shapes that were actually wrong on the site: portrait phone clips stored
	// as landscape. Both must come out portrait.
	assert.deepEqual(displayDims(1280, 960, "9:16"), { width: 720, height: 960 });
	assert.deepEqual(displayDims(1280, 720, "81:256"), { width: 405, height: 720 });

	// A SAR above 1 stretches the other way (classic 4:3 anamorphic DV).
	assert.deepEqual(displayDims(720, 480, "32:27"), { width: 853, height: 480 });
});

test("height is never touched — SAR only ever scales width", () => {
	for (const sar of ["1:1", "9:16", "81:256", "32:27", "4:3"]) {
		assert.equal(displayDims(1280, 960, sar).height, 960, `height changed for SAR ${sar}`);
	}
});

test("unknown or malformed SAR is treated as square pixels", () => {
	// "0:1" is ffprobe for "unknown", and the field is absent entirely on some streams.
	// Guessing here would distort a perfectly good video, so the safe answer is coded dims.
	for (const sar of ["0:1", "N/A", "", null, undefined, "nonsense", "1:0", ":", "16:"]) {
		assert.deepEqual(displayDims(848, 478, sar), { width: 848, height: 478 }, `mishandled SAR ${String(sar)}`);
	}
});

test("results are integers — they become ffmpeg scale arguments and image dimensions", () => {
	const { width, height } = displayDims(1280, 720, "81:256");
	assert.ok(Number.isInteger(width) && Number.isInteger(height));
});
