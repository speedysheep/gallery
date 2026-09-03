const grid = document.getElementById("grid");
const subtitle = document.getElementById("subtitle");
const lightbox = document.getElementById("lightbox");
const mediaStage = document.getElementById("mediaStage");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxVideo = document.getElementById("lightboxVideo");
const counter = document.getElementById("counter");
const shuffleBtn = document.getElementById("shuffleBtn");
const filterBtn = document.getElementById("filterBtn");
const filterIcon = document.getElementById("filterIcon");
const slideshowBtn = document.getElementById("slideshowBtn");
const slideshowToggleBtn = document.getElementById("slideshowToggleBtn");
const slideshowToggleIcon = document.getElementById("slideshowToggleIcon");
const pager = document.getElementById("pager");
const pagePrev = document.getElementById("pagePrev");
const pageNext = document.getElementById("pageNext");
const closeBtn = document.getElementById("closeBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const PAGE_SIZE = 86;

// The only site-specific string the gallery needs at runtime. The build stamps it into
// index.html from site.json, so this file stays identical across every site.
const TAGLINE = (() => {
  const meta = document.querySelector('meta[name="gallery-tagline"]');
  const value = meta?.content?.trim();
  return value ? `, ${value}` : "";
})();

// Everything gallery.json gave us, in its own order.
let allItems = [];
// The same items in a random order, regenerated whenever randomisation is
// switched on — so changing the photo/video filter doesn't reshuffle.
let shuffledItems = [];
// What's actually on screen: the chosen order, then the chosen filter.
let items = [];
// `current` indexes the whole filtered gallery, not the visible page — the
// lightbox walks straight across page boundaries.
let current = 0;
// Which page of thumbnails the grid is showing (0-based).
let page = 0;
let randomize = true;
// Index into FILTERS below. Neither this nor `randomize` is persisted —
// a reload puts both back to "random, everything".
let filterIndex = 0;
// Maps the id in the URL hash back to a gallery index, so a pasted link
// opens straight onto that photo/video.
const idToIndex = new Map();
// True when opening the lightbox pushed a history entry we own, so closing
// it can just go back. False when we landed directly on a shared link and
// there's nothing of ours behind us.
let pushedEntry = false;
// Set while we're closing in response to back/forward, so the close handler
// doesn't try to touch history again.
let closingFromHistory = false;

// Returns a shuffled copy, so the gallery's own order stays available for
// when randomisation is switched back off. (Fisher-Yates.)
function shuffle(array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Stable per-item id: the thumbnail/poster basename. They all live in one
// directory so they're already unique, and unlike a positional index they
// don't shift when new photos are added — old links keep working.
function idFor(item) {
  const file = (item.type === "video" ? item.poster : item.thumb) || item.full;
  return file.split("/").pop().replace(/\.[^.]+$/, "");
}

function hashId() {
  return decodeURIComponent(location.hash.replace(/^#/, ""));
}

function urlFor(index) {
  return `${location.pathname}${location.search}#${encodeURIComponent(idFor(items[index]))}`;
}

/* -------------------------------------------------------------------------
   Preloading

   Two separate jobs, both opt-out on a metered connection:
   the lightbox warms the neighbours you're about to step onto, and the grid
   warms the hover-preview clips of tiles as they come near the viewport.
   ---------------------------------------------------------------------- */

// How many items either side of the lightbox's current one to warm up.
const PRELOAD_RADIUS = 2;

// Full videos average ~3.3MB and run to 6.5MB, so pulling four of them on
// every step would cost more than it saves. Photos are ~0.9MB and worth
// fetching outright; videos only get their immediate neighbour buffered,
// and the ones further out just get metadata (headers + moov), which is
// what costs the visible pause when you land on a clip.
function preloadStrategy(item, distance) {
  if (item.type !== "video") return "image";
  return distance <= 1 ? "auto" : "metadata";
}

// Nobody on a capped data plan asked for 13MB of dog videos they might never
// look at. Also covers Chrome's explicit "Data Saver" switch.
function preloadingWanted() {
  const c = navigator.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/2g/.test(c.effectiveType || "");
}

// url -> the element holding the warmed bytes. Kept alive only while the url
// is still inside the window below; detached <video>s that fall out are
// released so buffers don't accumulate across a long session.
const preloaded = new Map();

function preloadAround(index) {
  if (!preloadingWanted()) return;

  const wanted = new Set();
  for (let d = 1; d <= PRELOAD_RADIUS; d++) {
    for (const i of [index - d, index + d]) {
      const item = items[i];
      if (!item) continue;
      wanted.add(item.full);

      const strategy = preloadStrategy(item, d);
      const existing = preloaded.get(item.full);
      if (existing) {
        // Stepping toward an item moves it closer, and the window is walked
        // outward from d=1, so the first pass to claim a url is always the
        // nearest one. Upgrade metadata -> auto as a clip comes within one
        // step, or the tier below would only ever apply to items that were
        // never seen at distance 2 — i.e. almost never.
        if (strategy === "auto" && existing.tagName === "VIDEO" && existing.preload !== "auto") {
          existing.preload = "auto";
        }
        continue;
      }

      if (strategy === "image") {
        const img = new Image();
        img.decoding = "async";
        img.src = item.full;
        preloaded.set(item.full, img);
      } else {
        const video = document.createElement("video");
        video.preload = strategy;
        video.muted = true;
        video.playsInline = true;
        video.src = item.full;
        preloaded.set(item.full, video);
      }
    }
  }

  // Keep the item on screen too — stepping back and forth shouldn't evict it.
  const currentItem = items[index];
  if (currentItem) wanted.add(currentItem.full);

  for (const [url, el] of preloaded) {
    if (wanted.has(url)) continue;
    if (el.tagName === "VIDEO") {
      el.removeAttribute("src");
      el.load();
    }
    preloaded.delete(url);
  }
}

/* -------------------------------------------------------------------------
   Lightbox
   ---------------------------------------------------------------------- */

function openLightbox(index) {
  current = index;
  showCurrent();
  if (!lightbox.open) {
    history.pushState({ lightbox: true }, "", urlFor(index));
    pushedEntry = true;
    lightbox.showModal();
  } else {
    history.replaceState({ lightbox: true }, "", urlFor(index));
  }
}

function showCurrent() {
  const p = items[current];
  const isVideo = p.type === "video";

  if (isVideo) {
    lightboxVideo.src = p.full;
    lightboxVideo.poster = p.poster;
    lightboxVideo.play().catch(() => {});
  } else {
    lightboxVideo.pause();
    lightboxVideo.removeAttribute("src");
    lightboxVideo.load();
    lightboxImg.src = p.full;
    lightboxImg.alt = `Photo ${current + 1} of ${items.length}`;
  }
  lightboxImg.classList.toggle("is-hidden-media", isVideo);
  lightboxVideo.classList.toggle("is-hidden-media", !isVideo);

  preloadAround(current);
  // Each item decides how long it gets, so the clock restarts as it appears —
  // which also means the dwell no longer excludes the transition time.
  scheduleNextSlide();

  counter.textContent = `${current + 1} / ${items.length}`;
  // No wrap-around: the ends of the gallery are dead ends.
  prevBtn.classList.toggle("is-hidden", current === 0);
  nextBtn.classList.toggle("is-hidden", current === items.length - 1);
}

function step(delta) {
  // Manual navigation always wins over autoplay — treat it as "I'll take it
  // from here" rather than fighting the slideshow timer for control.
  stopSlideshow();
  const next = current + delta;
  if (next < 0 || next >= items.length) return;
  current = next;
  showCurrent();
  // Keep the grid underneath in step, so escaping out of the lightbox
  // leaves you on the page holding the photo you were just looking at.
  showPageFor(current);
  // Replace rather than push: arrowing through 300 photos shouldn't bury
  // the Back button under 300 history entries.
  history.replaceState({ lightbox: true }, "", urlFor(current));
}

// Switch the grid to the page containing a given gallery index.
function showPageFor(index) {
  const wanted = Math.floor(index / PAGE_SIZE);
  if (wanted === page) return;
  page = wanted;
  renderGrid();
}

function closeLightbox() {
  lightbox.close();
}

// On the way out of the lightbox, bring the thumbnail you were just
// looking at into view — after paging around, wherever the grid happens
// to be scrolled is rarely where that photo is.
function scrollCurrentIntoView() {
  const tile = grid.children[current - page * PAGE_SIZE];
  if (tile) tile.scrollIntoView({ block: "center" });
}

// All teardown lives here so the native Escape-closes-a-<dialog> path gets
// the same cleanup as our own close button.
lightbox.addEventListener("close", () => {
  stopSlideshow();
  lightboxVideo.pause();
  scrollCurrentIntoView();
  if (closingFromHistory) {
    closingFromHistory = false;
    return;
  }
  if (pushedEntry) {
    pushedEntry = false;
    history.back();
  } else if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
});

// Back/forward, and pasting a different link into the address bar of an
// already-open tab (that fires hashchange, not a reload).
function syncFromUrl() {
  const index = idToIndex.get(hashId());
  if (index !== undefined) {
    current = index;
    showCurrent();
    showPageFor(current);
    if (!lightbox.open) lightbox.showModal();
    return;
  }
  pushedEntry = false;
  if (lightbox.open) {
    closingFromHistory = true;
    lightbox.close();
  }
}

window.addEventListener("popstate", syncFromUrl);
window.addEventListener("hashchange", syncFromUrl);

closeBtn.addEventListener("click", closeLightbox);
prevBtn.addEventListener("click", () => step(-1));
nextBtn.addEventListener("click", () => step(1));

lightbox.addEventListener("click", (e) => {
  // Click on the backdrop (the dialog element itself, not its content) closes it.
  if (e.target === lightbox) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (!lightbox.open) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") step(-1);
  if (e.key === "ArrowRight") step(1);
});

/* -------------------------------------------------------------------------
   Slideshow
   ---------------------------------------------------------------------- */

// How long a still is held. Also the *minimum* a video is held, so a 0.4s clip
// doesn't flash past before you've registered it.
const SLIDESHOW_INTERVAL_MS = 4500;
// Must match the CSS transition duration on .media-stage img/video.
const TRANSITION_MS = 450;
// One of these is picked at random for every advance — "left"/"right" slide
// past each other, "fade" eases through a slight scale instead.
const TRANSITION_VARIANTS = ["dir-left", "dir-right", "dir-fade"];

const SLIDESHOW_PLAY_ICON = `<path d="M6 4v16l14-8L6 4Z" />`;
const SLIDESHOW_STOP_ICON = `<rect x="6" y="6" width="12" height="12" rx="1.5" />`;

let slideshowActive = false;
let slideshowTimer = null;
// Detaches whatever listeners the current video advance is waiting on. Null
// whenever we're waiting on a plain timer instead.
let slideshowVideoCleanup = null;

function syncSlideshowButton() {
  slideshowToggleBtn.classList.toggle("on", slideshowActive);
  slideshowToggleIcon.innerHTML = slideshowActive ? SLIDESHOW_STOP_ICON : SLIDESHOW_PLAY_ICON;
  const label = slideshowActive ? "Stop slideshow" : "Start slideshow from here";
  slideshowToggleBtn.setAttribute("aria-label", label);
  slideshowToggleBtn.dataset.tip = label;
}

// Swaps to `next` with a random transition, then keeps the grid/URL in step
// exactly like manual step() does.
function transitionToIndex(next) {
  const variant = TRANSITION_VARIANTS[Math.floor(Math.random() * TRANSITION_VARIANTS.length)];
  mediaStage.classList.add("leaving", variant);

  window.setTimeout(() => {
    current = next;
    showCurrent();
    showPageFor(current);
    history.replaceState({ lightbox: true }, "", urlFor(current));

    // Jump the incoming media to its off-screen/faded starting point with no
    // transition, force a layout so the browser commits that before the next
    // line, then drop the class so it eases back to rest — the standard
    // trick for animating a state you just set with JS.
    mediaStage.classList.remove("leaving");
    mediaStage.classList.add("entering");
    void mediaStage.offsetWidth;
    mediaStage.classList.remove("entering", variant);
  }, TRANSITION_MS);
}

function slideshowAdvance() {
  // Autoplay loops back to the start — unlike manual prev/next, a slideshow
  // running out of photos and just stopping would be a strange surprise.
  transitionToIndex((current + 1) % items.length);
}

function clearSlideshowSchedule() {
  window.clearTimeout(slideshowTimer);
  slideshowTimer = null;
  slideshowVideoCleanup?.();
  slideshowVideoCleanup = null;
}

// Decides when the *current* item should give way to the next, and is re-run
// for every item rather than shared.
//
// This used to be one setInterval for the whole slideshow, which handed a
// 100-second video the same 4.5 seconds as a still — and because that budget
// also covered the video's loading time, what you actually saw play was
// whatever was left of it. Videos now advance on their own `ended` event.
function scheduleNextSlide() {
  clearSlideshowSchedule();
  if (!slideshowActive) return;

  const item = items[current];
  if (!item || item.type !== "video") {
    slideshowTimer = window.setTimeout(slideshowAdvance, SLIDESHOW_INTERVAL_MS);
    return;
  }

  const video = lightboxVideo;
  const shownAt = performance.now();

  const detach = () => {
    video.removeEventListener("ended", onEnded);
    video.removeEventListener("error", onUnplayable);
    slideshowVideoCleanup = null;
  };

  // Hold a short clip for at least as long as a still would get.
  const advanceAfter = (ms) => {
    detach();
    slideshowTimer = window.setTimeout(slideshowAdvance, Math.max(0, ms));
  };

  function onEnded() {
    advanceAfter(SLIDESHOW_INTERVAL_MS - (performance.now() - shownAt));
  }

  // A clip that can't play would never fire `ended`, stranding the slideshow on
  // it forever. Fall back to treating it like a still.
  function onUnplayable() {
    advanceAfter(SLIDESHOW_INTERVAL_MS);
  }

  video.addEventListener("ended", onEnded);
  video.addEventListener("error", onUnplayable);
  slideshowVideoCleanup = detach;

  // showCurrent() already asked it to play; this re-ask is for the rejection,
  // which is how a browser refusing to autoplay sound tells us. Without it a
  // blocked video would sit there silently and never end.
  video.play().catch(onUnplayable);
}

function startSlideshow() {
  if (slideshowActive || items.length < 2) return;
  slideshowActive = true;
  syncSlideshowButton();
  scheduleNextSlide();
}

function stopSlideshow() {
  if (!slideshowActive) return;
  slideshowActive = false;
  clearSlideshowSchedule();
  mediaStage.classList.remove("leaving", "entering", ...TRANSITION_VARIANTS);
  syncSlideshowButton();
}

slideshowBtn.addEventListener("click", () => {
  if (items.length === 0) return;
  openLightbox(0);
  startSlideshow();
});

slideshowToggleBtn.addEventListener("click", () => {
  if (slideshowActive) stopSlideshow();
  else startSlideshow();
});

syncSlideshowButton();

/* -------------------------------------------------------------------------
   Thumbnail tiles
   ---------------------------------------------------------------------- */

function buildThumb(src) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}

function buildPhotoTile(p, btn) {
  btn.appendChild(buildThumb(p.thumb));
}

// Warms the hover-preview clips of video tiles as they approach the viewport,
// and drops them again once they are well clear of it.
//
// The clips average ~107KB, so a screenful is cheap — but a page holds up to
// 86 tiles, and creating every <video> up front was the thing the original
// hover-only approach was avoiding. Watching the viewport keeps that property
// (nothing loads for tiles you never scroll to) while still having the bytes
// in hand by the time the pointer arrives. Releasing them on the way out
// bounds memory on a long scroll; R2 serves the clips immutable with a
// one-year max-age, so scrolling back is a cache hit, not a re-download.
const PREVIEW_WARM_MARGIN = "400px";

const previewObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const warm = entry.target.warmPreview;
            const cool = entry.target.coolPreview;
            if (entry.isIntersecting) warm?.();
            else cool?.();
          }
        },
        { rootMargin: PREVIEW_WARM_MARGIN },
      )
    : null;

function buildVideoTile(p, btn) {
  btn.appendChild(buildThumb(p.poster));

  const badge = document.createElement("span");
  badge.className = "play-badge";
  btn.appendChild(badge);

  // Created on approach by the observer below, or on first hover if there is
  // no observer (or a metered connection turned the warming off) — either way
  // a page with many videos never kicks off dozens of requests on load.
  let video = null;
  let leaveTimer = null;
  let hovering = false;

  const ensureVideo = () => {
    if (video) return video;
    video = document.createElement("video");
    video.className = "preview";
    video.preload = "auto";
    video.src = p.preview;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    btn.appendChild(video);
    return video;
  };

  btn.warmPreview = () => {
    if (preloadingWanted()) ensureVideo();
  };

  // Scrolled well away: give the buffer back, unless the pointer is sitting
  // on it (which can happen when scrolling by keyboard or trackpad).
  btn.coolPreview = () => {
    if (!video || hovering) return;
    video.pause();
    video.remove();
    video.removeAttribute("src");
    video.load();
    video = null;
  };

  btn.addEventListener("mouseenter", () => {
    clearTimeout(leaveTimer);
    hovering = true;
    const el = ensureVideo();
    btn.classList.add("video-hovering");
    el.currentTime = 0;
    el.play().catch(() => {});
  });

  btn.addEventListener("mouseleave", () => {
    hovering = false;
    btn.classList.remove("video-hovering");
    // Give the fade-out transition a moment before pausing.
    leaveTimer = setTimeout(() => video && video.pause(), 150);
  });

  previewObserver?.observe(btn);
}

/* -------------------------------------------------------------------------
   Controls
   ---------------------------------------------------------------------- */

// Icon path data is inline rather than a sprite or icon font, so the toolbar
// needs no extra requests and can restyle with `currentColor`.
const FILTERS = [
  {
    label: "Showing photos and videos",
    tip: "Showing photos and videos — click for photos only",
    keep: () => true,
    icon: `<path d="M18 22H4a2 2 0 0 1-2-2V6" /><rect x="6" y="2" width="16" height="16" rx="2" />
           <circle cx="11" cy="8" r="1.6" /><path d="m22 12-3.3-3.3a2 2 0 0 0-2.8 0L10 15" />`,
  },
  {
    label: "Showing photos only",
    tip: "Showing photos only — click for videos only",
    keep: (p) => p.type !== "video",
    icon: `<rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="1.8" />
           <path d="m21 15-4.6-4.6a2 2 0 0 0-2.8 0L3.5 20.5" />`,
  },
  {
    label: "Showing videos only",
    tip: "Showing videos only — click to show both",
    keep: (p) => p.type === "video",
    icon: `<path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" />`,
  },
];

// aria-label states what the control currently is; data-tip (the hover
// bubble) also says what clicking will do next.
function syncControls() {
  shuffleBtn.classList.toggle("on", randomize);
  shuffleBtn.setAttribute("aria-pressed", String(randomize));
  shuffleBtn.setAttribute("aria-label", randomize ? "Random order (on)" : "Random order (off)");
  shuffleBtn.dataset.tip = randomize
    ? "Random order — click for gallery order"
    : "Gallery order — click to shuffle";

  const filter = FILTERS[filterIndex];
  filterIcon.innerHTML = filter.icon;
  filterBtn.classList.toggle("on", filterIndex !== 0);
  filterBtn.setAttribute("aria-label", filter.label);
  filterBtn.dataset.tip = filter.tip;
}

/* -------------------------------------------------------------------------
   Grid and paging
   ---------------------------------------------------------------------- */

function pageCount() {
  return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
}

// Draws one page of thumbnails plus the pager beneath it. Never touches
// the lightbox — `current` is a gallery-wide index and is independent of
// which page happens to be on screen.
function renderGrid() {
  const start = page * PAGE_SIZE;
  const shown = items.slice(start, start + PAGE_SIZE);

  // These tiles are about to be discarded; drop them from the observer so it
  // isn't holding references to detached nodes for the rest of the session.
  for (const old of grid.children) previewObserver?.unobserve(old);
  grid.innerHTML = "";

  shown.forEach((p, i) => {
    const index = start + i;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", `Open ${p.type === "video" ? "video" : "photo"} ${index + 1}`);
    btn.addEventListener("click", () => openLightbox(index));

    if (p.type === "video") {
      buildVideoTile(p, btn);
    } else {
      buildPhotoTile(p, btn);
    }

    grid.appendChild(btn);
  });

  const pages = pageCount();
  pager.hidden = pages < 2;
  pagePrev.disabled = page === 0;
  pageNext.disabled = page >= pages - 1;
}

function goToPage(next) {
  const clamped = Math.min(Math.max(next, 0), pageCount() - 1);
  if (clamped === page) return;
  page = clamped;
  renderGrid();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  // Hold onto whatever the lightbox is showing so a reorder or a filter
  // change doesn't yank it out from under the viewer.
  const openId = lightbox.open && items.length ? idFor(items[current]) : null;

  const base = randomize ? shuffledItems : allItems;
  items = base.filter(FILTERS[filterIndex].keep);
  idToIndex.clear();
  items.forEach((p, i) => idToIndex.set(idFor(p), i));

  syncControls();

  if (items.length === 0) {
    subtitle.textContent = allItems.length ? "Nothing matches that filter." : "Nothing here yet.";
    grid.innerHTML = '<p class="empty">Check back soon.</p>';
    pager.hidden = true;
    if (lightbox.open) closeLightbox();
    return;
  }

  const photoCount = items.filter((p) => p.type !== "video").length;
  const videoCount = items.length - photoCount;
  const parts = [];
  if (photoCount) parts.push(`${photoCount} photo${photoCount === 1 ? "" : "s"}`);
  if (videoCount) parts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
  subtitle.textContent = parts.join(", ") + TAGLINE;

  // A reorder or filter change reshuffles what lives on which page, so
  // start from the top unless the lightbox anchors us somewhere.
  const stillShown = openId === null ? undefined : idToIndex.get(openId);
  current = stillShown === undefined ? 0 : stillShown;
  page = Math.floor(current / PAGE_SIZE);
  renderGrid();

  if (openId !== null) {
    if (stillShown === undefined) {
      // Filtered away — close rather than jump to some unrelated item.
      closeLightbox();
    } else {
      showCurrent();
      history.replaceState({ lightbox: true }, "", urlFor(current));
    }
  }
}

shuffleBtn.addEventListener("click", () => {
  randomize = !randomize;
  // Deal a fresh order each time it's turned on.
  if (randomize) shuffledItems = shuffle(allItems);
  render();
});

filterBtn.addEventListener("click", () => {
  filterIndex = (filterIndex + 1) % FILTERS.length;
  render();
});

pagePrev.addEventListener("click", () => goToPage(page - 1));
pageNext.addEventListener("click", () => goToPage(page + 1));

/* -------------------------------------------------------------------------
   Boot
   ---------------------------------------------------------------------- */

// Draw the icons before the gallery lands (and if it never does).
syncControls();

fetch("gallery.json")
  .then((r) => r.json())
  .then((data) => {
    allItems = data;
    shuffledItems = shuffle(allItems);
    render();

    // Arrived on a shared link: open that item immediately. No pushState —
    // there's no page-of-ours behind us to go back to, so closing strips
    // the hash instead.
    const deepLink = idToIndex.get(hashId());
    if (deepLink !== undefined) {
      current = deepLink;
      showCurrent();
      // So closing the shared link drops you on that photo's page.
      showPageFor(current);
      lightbox.showModal();
    }
  })
  .catch((err) => {
    console.error(err);
    subtitle.textContent = "Couldn't load the gallery.";
  });
