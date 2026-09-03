// Pure geometry helpers. Deliberately free of any site or filesystem knowledge, so the
// unit tests can import them without first choosing which site they are operating on.

/**
 * ffprobe reports *coded* dimensions, which for anamorphic video are the wrong shape.
 * Phone footage often stores a portrait clip as 1280x960 with a 9:16 pixel aspect ratio,
 * so it decodes 1280 wide but is meant to be shown 720 wide. Video players honour the
 * SAR and get this right on their own; a still frame extracted with ffmpeg does not, and
 * comes out horizontally stretched. Everything the viewer sees should use these numbers.
 */
export function displayDims(width, height, sar) {
	const [num, den] = String(sar ?? "1:1")
		.split(":")
		.map(Number);
	// "0:1" is ffprobe for "unknown"; treat anything non-sensible as square pixels.
	if (!num || !den || num === den) return { width, height };
	return { width: Math.round((width * num) / den), height };
}
