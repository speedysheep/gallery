# gallery

Photo and video galleries for [booperandwoowoo.com](https://booperandwoowoo.com) and
[jeremyandtipsy.com](https://jeremyandtipsy.com). One pipeline, one front-end, two sites.

For everything not covered here — how the pipeline works, file naming, metadata,
troubleshooting — see [DETAILS.md](DETAILS.md).

## Layout

```
app/                     the front-end, shared by every site — the only copy you edit
scripts/                 the media pipeline, shared by every site
test/                    npm test
sites/<domain>/
  site.json              everything that differs between sites
  wrangler.jsonc         that site's Worker
  media-sequence.json    that site's filename counter
  public/                that site's content: gallery.json, pictures/, thumbs/
```

`npm run build` copies `app/` into a site's `public/`, filling the `{{placeholders}}` in
`index.html` from its `site.json`. Those three generated files are git-ignored, so `app/`
stays the single source of truth.

## Choosing a site

Every media command works on exactly one site, chosen with `GALLERY_SITE`. There is no
default — these scripts upload to a site's R2 bucket and rewrite its `gallery.json`, so
guessing would eventually publish the cats to the dog site.

```bash
export GALLERY_SITE=booperandwoowoo.com
```

Run it once per shell, or prefix individual commands.

## Setup (once)

```bash
npm install
npx wrangler login
```

`wrangler login` is needed for anything involving videos (they live in each site's R2
bucket, not in git).

## Added a photo or video?

1. Drop photos into `sites/<site>/public/pictures/`, videos into `sites/<site>/public/videos/`.
2. Run:

   ```bash
   GALLERY_SITE=<site> npm run gallery
   ```

   Files will be transcoded, metadata stripped, and filenames standardised to prevent
   data leakage.

3. Commit and push to `main`.

## Removed a photo or video?

```bash
GALLERY_SITE=<site> npm run deletePicture <name> yes
GALLERY_SITE=<site> npm run deleteVideo <name> yes
```

Leave off the trailing `yes` first to see what it would do without deleting anything.

## Preview it locally

```bash
GALLERY_SITE=<site> npm run dev
```

## Tests

```bash
npm test
```

Covers the poster geometry (including anamorphic and rotated video), and checks every
site's committed posters against the shapes its `gallery.json` claims.

## Deploying

Push to `main`. Each site is its own Cloudflare Worker, built from this repo with its own
**Root directory** — see [DETAILS.md](DETAILS.md).
