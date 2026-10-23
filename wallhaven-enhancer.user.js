// ==UserScript==
// @name         naXim Labs — Wallhaven Enhancer
// @namespace    https://github.com/0naXim0
// @author       naXim Labs (0naXim0)
// @homepageURL  https://github.com/0naXim0
// @downloadURL  https://cdn.jsdelivr.net/gh/0naXim0/wallhaven-enhancer@main/wallhaven-enhancer.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/0naXim0/wallhaven-enhancer@main/wallhaven-enhancer.user.js
// @supportURL   https://github.com/0naXim0
// @version      8.1.0
// @description  Byte-accurate downloads, instant previews, persistent HD Mode that zooms in true full resolution with an honest progress bar that never stalls (download, render and retry are always distinct states, with live MB counts and a watchdog that never lets a transfer or a decode hang), tags on the very first open, a 1:1 native-pixel zoom, smooth zoom & pan, unified cards, adaptive scanning, a floating one-tap pill that queues every wallpaper you have scrolled to load into the classic download manager — its number always equals exactly what one tap will queue, page range included; on scan grids the same pill queues every batch from batch 1 to the batch on screen, live partial included — plus a download button beside every page number (search, latest, hot, toplist, uploads, favorites, collections and every scan batch page) that queues that page only, a server-verified favorite/collection system with true add/remove semantics, a per-collection Quick-Save target and a hold-to-open collection picker, and a crash-proof persistent download queue with cross-tab sync, retry, tunable parallelism, pause/resume and speed/ETA telemetry — plus the v7.9.1 scan engine exactly as it was: favorites searches inside a date window are collected as a ranked window (upload order, one exact pass) and served top-♥-first per batch; only the pages each batch needs are ever fetched, with persistent job ledgers, crash-safe checkpoints and one-click resume; every batch saves as its own sub-history page inside the session's card, served as a separate grid page — Continue starts the next batch inside the same session and never repeats a wallpaper, and the pill's Back and Forward buttons walk the saved batch pages in both directions; the Continue pill floats on screen — always one tap away, never a scroll; every new batch opens at the very top of the page while an interrupted batch resumes exactly where you left it; the scan progress bar always resolves (every terminal path fills, fades and clears it); and big scans are rate-limit-proof: every request the script makes flows through one rolling rate gate that stays under Wallhaven's limit, honors the server's Retry-After, and waits out any 403/429 with an escalating backoff instead of erroring. A naXim Labs product.
// @match        https://wallhaven.cc/*
// @run-at       document-end
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant GM_download
// @grant GM_addValueChangeListener
// @grant GM_notification
// @connect      wallhaven.cc
// @connect      w.wallhaven.cc
// @connect      th.wallhaven.cc
// ==/UserScript==

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  v8.1.0 — THE v7.9.1 SCANNER, KEPT — and the upgrades that were
//            never about the query, ported onto it.
//
//    • THE BASE IS v7.9.1, VERBATIM — its scan engine (the
//      binary-search date bounds, the ranked-window collection, the
//      walk-vs-rank strategy sampling, the per-batch pages with
//      served-id ledgers, the query as a plain q parameter) is the
//      engine this build ships, untouched. Nothing from the later
//      experimental lines is here: no Fav/day fields, no Fav/day
//      sort, no query redesign, no turbo pipeline — exactly as
//      requested.
//
//    • BACK & FORWARD IN BATCH — the Continue pill gains two quiet
//      arrow buttons: Back reopens the previous batch's page, Forward
//      the next saved one — payloads straight from the ledger, the
//      live session's cursor never touched, never offered mid-scan.
//      From the newest saved batch, Forward hands the future back to
//      Continue; the LIVE in-progress batch is a page too (its
//      crash-safe partial, written at every checkpoint, is its
//      payload). Every button names the exact batch it opens.
//
//    • THE PILL LEARNS BATCHES — on a scan grid the floating pill
//      queues EVERY batch from batch 1 to the batch on screen:
//      reach batch 2 and it reads "batches 1–2" and queues both,
//      exactly the way it queues "pages 1–4" on the listing; the live
//      partial is included while it serves. The per-batch chip beside
//      "Batch N" still queues that batch only, so single-batch and
//      whole-range downloads live side by side — pages and batches,
//      one design.
//
//    • THE HD BAR, HONEST — the green HD progress bar could sit at
//      100% forever, progress could read wrong on fast links, and HD
//      Mode could silently stop converting after a few quick
//      navigations. Every root cause, fixed at the root:
//      (1) THE POOL LEAK — the blob pool never marked a running
//      transfer as started, so cancelling it in name only never
//      aborted the transfer and never freed its slot; three leaks
//      and the pool was dead until refresh — HD stopped converting.
//      A running job now reports itself: cancel aborts the transfer
//      and frees the slot, always.
//      (2) THE BAR — it never reads 100% while bytes still flow
//      (99.2% cap — a full bar that does nothing is the oldest lie
//      in progress UIs), narrates live MB counts, handles unknown
//      totals with the indeterminate shimmer instead of freezing,
//      and switches to a distinct green "Rendering" shimmer the
//      moment the blob lands: download, render and done are three
//      visibly different states.
//      (3) THE HANGS — a stall watchdog aborts transfers that stop
//      moving for 12 s (or hold every byte for 5 s without
//      finalizing) and feeds them to the retry ladder instead of
//      hanging for the full 45 s timeout; the decode is raced
//      against a hard 8 s bound so an exotic codec can never wedge
//      the pipeline; a second-chance decode checks img.complete
//      first (an already-settled image resolves instantly instead
//      of burning the timeout); and the blob is pinned for the
//      whole decode, so a cache eviction can no longer revoke its
//      URL mid-decode and kill the conversion. An aborted attempt
//      re-arms through the retry ladder instead of dying silently.
//
//    • THE SCAN BAR, ALWAYS RESOLVED — a job that completed entirely
//      inside its first batch (a ranked window whose whole pool fit
//      in batch 1) left the thin scan progress bar frozen mid-way:
//      the "batch filled" path resolved it, but the exhausted /
//      paused / error / empty-window / no-results paths never did.
//      Every terminal path now fills, fades and clears the bar, and
//      a catch-all after every scan entry point guarantees no future
//      path can regress it.
//
//    • ALSO — the per-batch chip follows the visible bar when a
//      scan-mode section hides its native header (a /search?page=2+
//      URL), so "Batch N" always carries its single-batch button.
//
//  v7.9.1 — TRUE-PIXEL HD ZOOM & TAGS ON THE FIRST OPEN:
//
//    • THE 8K BUG — HD Mode always downloaded the full file, but
//      the preview <img> was laid out at screen-fit size, so the
//      browser clamped its decode to that small box and zooming
//      only blew up a low-resolution raster — an 8K wallpaper
//      never looked 8K in the lightbox, while the downloaded file
//      was perfect in any OS viewer. The HD layer is now laid out
//      at its TRUE natural pixel size (7680 CSS px for an 8K) and
//      scaled to fit by the transform itself: the browser keeps a
//      full-quality decode, and every zoom level samples DOWN
//      from native pixels, never up from a downscaled one. Same
//      translate, same pan, same gestures — the pixels are just
//      real now.
//
//    • 1:1 BUTTON — the zoom cluster gains a "1:1" jump (and the
//      "1" key): one tap renders the active layer at exactly one
//      image pixel per screen pixel — the honest way to inspect
//      quality, HD or preview.
//
//    • TAGS, INSTANTLY — the lightbox sometimes opened without
//      its tags and needed a second click to show them: page-sync
//      and scans seed the metadata cache with partial records
//      (path, date, resolution — no tags), and the first open
//      rendered that partial record while ignoring the full
//      record the click itself fetched. The bar now merges every
//      arrival — cached partial first, the fresh full record the
//      moment it lands — and re-renders its chips idempotently, so
//      the tags are on screen at first open, always.
//
//    • HOVER PRIME — a 300 ms dwell over any thumbnail fires (at
//      most) the same metadata fetch the click itself would
//      trigger — deduped by the cache, paced by the rate shield,
//      free for anything already fetched. By the time you click,
//      the tags and the HD path are already local: the first open
//      is instant, with zero extra requests for what you actually
//      open.

//  v7.9.0 — TRUE PAGE MATH & PER-PAGE BUTTONS — the pill's number
//    finally equals what it downloads, and every page gets its own
//    button:
//
//    • THE BUG — on an endless-scroll listing the pill kept saying
//      the count from page load ("24") while a tap actually queued
//      EVERY page loaded below it — 72 after three pages. The label
//      lied; the download was right. Now the number is recomputed
//      from the live DOM every time wallhaven appends a page (one
//      rAF-coalesced childList observer on the listing — no
//      polling, no layout reads), and the tap harvests the very
//      same list, so the two can never disagree again.
//
//    • MULTI-PAGE BY DESIGN — that everything-loaded behavior is
//      now the feature: want four pages? Scroll until four pages
//      sit on screen — the pill reads "96 · pages 1–4" — and one
//      tap queues all 96 through the classic manager, exactly as
//      if you had clicked every wallpaper one by one. The tag
//      always names the exact range.
//
//    • PAGE BUTTONS — every loaded page now carries its own small
//      download chip beside its page number ("Page 4 / 9876"): one
//      tap queues THAT page only — 24, never 72. The chip lives in
//      wallhaven's own header on every appended page, and the
//      page-1 section (which wallhaven leaves headerless) gets a
//      matching bar injected so every page is equal. Search,
//      latest, hot, toplist, uploads, favorites and collections
//      all carry them — account favorites included.
//
//    • SCAN BATCH PAGES — while the panel's search grid owns the
//      listing, the first section's bar becomes "Batch N" with the
//      batch's live count; the stale native header steps aside
//      (hidden, never destroyed) until Clear grid restores the
//      listing and brings it back.
//
//    • Both buttons ride the EXACT classic download manager —
//      DL.add per wallpaper, the same queue N single clicks fill:
//      concurrency, pacing, byte-accurate transfers, names,
//      dedupe, retry, pause/resume, cross-tab sync, telemetry.
//      Zero requests at tap time; the unified rate shield stays
//      untouched.
//
//    • Both are separately switchable in the panel's Downloads
//      section ("Floating page button", "Page download buttons").
//
//  v7.8.1 — THE CLASSIC QUEUE, ONE TAP — the batch download rides
//    the download manager you already trust, and the extra
//    machinery goes away:
//
//    • PAGE PILL — a single minimalist button that floats on
//      screen (turn it off in the panel's Downloads section).
//      One tap queues EVERY wallpaper on the current page into
//      the exact same download manager a single click uses —
//      identical concurrency, pacing, byte-accurate transfers,
//      names, dedupe, retry, pause/resume, cross-tab sync and
//      telemetry. It is literally the same as clicking every
//      wallpaper's download button one by one, in one click.
//      The label always tells the truth: how many wallpapers the
//      page holds (live with the grid — the panel's own number)
//      and which page it is. Zero requests at tap time — all
//      network work happens inside the queue, behind the rate
//      shield.
//
//    • REMOVED, BY DESIGN — the ZIP batch system (page + all-
//      pages + collection walkers) and the hot ♥/day ratio sort
//      with its Min/Max/≈Target fields. The classic sort menu,
//      the classic queue and every pre-7.8 behavior are exactly
//      as they were.
//
//    • KEPT — top-of-page Continue for genuinely-new batches
//      (interrupted resumes keep your position) and the unified
//      rate shield (every request paced, Retry-After honored).
//
//  v7.8.0 — HOT RATIO SORT · BULK ZIP · TOP-OF-PAGE CONTINUE
//
//    • HOT — ♥ PER DAY — a third sort that ranks wallpapers by how
//      FAST they gain favorites, not how many they have. The window
//      is collected once in upload order, every match is scored as
//      favorites / days-since-release (age floored at two days, so
//      a brand-new upload can never score infinity), and each batch
//      serves the hottest first — the 95-♥ wallpaper from last week
//      now outranks the 100-♥ wallpaper from 2015. Min ♥/day and
//      Max ♥/day FILTER the range; ≈ Target RANKS by closeness to an
//      exact ratio instead of by size; every card wears its score.
//      The Sort dropdown sorts; the chips filter — clearly separated,
//      one compact row, only visible for the hot sort.
//
//    • BULK ZIP — batch downloads, done right: one tap on "Page"
//      zips everything on screen; "All pages" walks the listing you
//      are on — any search, latest/hot/toplist, a user's uploads,
//      your own favorites, or another account's public collections
//      (private ones stay private) — and zips it all. Chunked STORE
//      ZIPs (40 files each) keep memory flat, three concurrent
//      fetches keep the CDN happy, every wallhaven.cc request rides
//      the rate shield, ids are deduped per job and per session,
//      failed items retry twice then report with a one-tap Retry,
//      and the original wallhaven-{id} names and exact bytes are
//      preserved. Big jobs (>300) show a size estimate and ask for
//      one confirming tap before a single byte moves.
//
//    • CONTINUE FROM THE TOP — starting the NEXT batch now scrolls
//      to the very top of the fresh page, exactly when the batch
//      begins loading; resuming an interrupted batch (pause, error,
//      deep scan) keeps your position instead — state-based, never
//      timing-based. Viewing a saved batch page opens at the top
//      too, like every page should.
//
//    • SHARPENED — light metadata for bulk adds (a cached path
//      answers instantly instead of one API call per wallpaper), a
//      long-standing Continue-pill CSS typo, and honest version
//      stamps everywhere.
//
//  v7.7.3 — UNIFIED RATE SHIELD — the 429 that survived v7.7.2:
//    one gate for EVERY request, not just scan pages.
//
//    • THE HOLE — v7.7.2 paced the scan's page requests, but
//      wallpaper metadata (/w/ lookups), page-sync and the HTML
//      fallback still fired unpaced. Worse: a throttled lookup
//      CASCADEd into up to three extra requests (keyed API, then
//      keyless API, then an HTML scrape) — exactly while the server
//      was already saying slow down. The shared window stayed
//      saturated, so big scans STILL met 429s.
//
//    • ONE GATE — the rate gate now lives in the network layer
//      itself. Every request the script sends to wallhaven.cc —
//      scan pages, /w/ metadata, page-sync, the /w/ HTML fallback —
//      passes the SAME rolling 60-second window: 36-request budget
//      (20% headroom; 20 while any tab's cooldown is live), 250 ms
//      spacing, waits sliced so Pause stays instant. One budget,
//      one IP — the math can no longer lie.
//
//    • RETRY-AFTER IS LAW — 429/403 answers now carry the server's
//      own wait time: the network layer publishes it as the
//      cross-tab cooldown, and every backoff (the scan ladder and
//      metadata retries alike) honors it instead of guessing.
//
//    • DEEPER LADDER, CALMER FETCHES — the scan ladder now runs
//      2s → 64s (six rungs, past a full limit window); metadata
//      lookups back off and retry their own lane instead of
//      cascading, and the HTML fallback is skipped entirely during
//      a storm. Favorites page walks back off on 429 too.
//
//  v7.7.2 — RATE-LIMIT SHIELD — "API 403" during big scans is
//    gone, at the root:
//
//    • WHY IT HAPPENED — Wallhaven's API allows ~45 requests a
//      minute; big scans (multi-batch continues, ranked-window
//      collection) burst past it, and the engine treated the 403
//      reply as a hard error and parked the job.
//
//    • PREVENTION (PACING) — every scan request now passes a
//      rate-limit gate: a rolling 60-second window with a
//      36-request budget (20% headroom) and 250 ms spacing. Big
//      scans flow at the maximum the API actually allows — instead
//      of sprinting into a wall. Pace waits are sliced so Pause
//      always responds instantly.
//
//    • RECOVERY (403 = "WAIT", NOT "DIE") — if a rate-limit reply
//      still slips through, the page is retried with an exponential
//      backoff (2s, 4s, 8s, 16s, 32s — a full limit window) and a
//      live status, so the scan finishes by itself. Only a limit
//      that never lifts parks the job — state saved, one Continue
//      resumes it once the limit resets.
//
//    • CROSS-TAB — when any tab hits the limit it publishes a
//      cooldown; every tab tightens its pacing until it expires,
//      so parallel tabs can't keep re-triggering it.
//
//  v7.7.1 — FLOATING CONTINUE PILL — the final polish: the
//    Continue button never lives at the bottom of the page again.
//
//    • ALWAYS ON SCREEN — the Continue pill is now a fixed,
//      bottom-center floating element: one tap away at any scroll
//      position, on every screen size. No scrolling down to reach
//      it, ever. Professional, minimalist, unobtrusive — dark glass
//      that matches the download manager, a single compact accent
//      button, and nothing else.
//
//    • THREE CALM STATES — go (accent, clickable), load (spinner
//      while scanning), done (a check, then the pill fades itself
//      away after six seconds — informational states never linger
//      on your screen).
//
//    • NO LOST CLICKS — a fresh state instantly revives a pill that
//      was mid-fade; screen readers get role=status announcements;
//      reduced-motion users get no animation; on phones the pill
//      anchors left of the download manager so the two never
//      collide.
//
//  v7.7.0 — BATCH PAGES & SUB-HISTORY — the final layer on the
//    true-batch engine, exactly as requested:
//
//    • EVERY BATCH IS ITS OWN PAGE — serving a fresh batch starts
//      from a clean grid (a page of its own), never a continuous
//      stream. The DOM stays small — one batch, not the whole job —
//      so rendering stays fast no matter how deep the job goes.
//
//    • SUB-HISTORY CARDS — each session card in Settings → Search
//      history expands into one sub-card per completed batch
//      (chevron + count badge). "View" opens that batch as its own
//      separate page: only that batch's wallpapers, in serve order.
//      The active session starts expanded; your toggles stick for
//      the tab's lifetime.
//
//    • PER-BATCH PAYLOADS — every completed batch is persisted as
//      its own ledger record + page payload (gf_bpage_<job>_<n>),
//      including the final partial batch of an exhausted job. The
//      in-progress batch keeps its crash-safe partial in the
//      session key, so pause/refresh/resume never loses a page.
//
//    • CONTINUE = NEXT BATCH, SAME SESSION, ZERO REPEATS — the
//      next batch scans on (e.g. 200 more) inside the exact same
//      session, and the persistent served-id ledger guarantees it
//      never includes a wallpaper any previous batch already
//      served. Viewing an old batch page never disturbs the
//      cursor; Continue rebuilds the live page first.
//
//    • BATCH LIMIT = SPEED — the engine stops at exactly the batch
//      limit (default 200), fetching only the pages that batch
//      needs; ranked windows serve instantly from memory. The
//      count pill now counts the page you are looking at; the job
//      strip keeps the job totals.
//
//  v7.6.2 — SERVE FIX — repairs three v7.6.1 defects:
//
//    • CRASH ON PAGE 2 OF COLLECTION — the ranked-window's
//      one-page-ahead prefetch was stored as a raw Promise and
//      never awaited, so every ranked job threw "r.data is not
//      iterable" right after starting and served nothing.
//      Fixed: the prefetch is awaited (a rejected probe falls
//      back to a fresh, retried fetch) — ranked windows collect
//      and serve again, fast and exactly like v7.5.1.
//
//    • PAUSE DURING COLLECTION — a pause that lands between
//      awaits now parks the job paused with its state saved,
//      instead of falsely completing the window and draining a
//      partial pool.
//
//    • v7.5 SESSION RECOVERY — loading an old buffered session
//      and pressing Continue no longer throws "bufLoad is not
//      defined"; the unserved-tail recovery works as designed.
//
//    • SHARED PAGE CACHE — locator probes, collection pages and
//      walk pages cache per sorting lane, so a page the binary
//      search already probed is never fetched again during
//      collection. Fewer requests, faster windows, kinder to
//      the API rate limit.
//
//  v7.6.1 — RANKED WINDOW — fixes the v7.6.0 regression:
//    favorites-sorted searches with a date window stopped
//    serving anything. The v7.6 engine always walked the
//    favorites-ordered index, where a date window is sparse
//    (the top-favorites pages are years old) — so it skipped
//    everything, hit the 50-page sparse limit and parked.
//
//    • RANKED WINDOW STRATEGY RESTORED — bounded favorites
//      searches now collect the contiguous date window ONCE in
//      upload order (every page inside winTop..winBot is already
//      in range — the minimum possible discovery), rank the
//      matches by ♥, and serve the top N of each batch instantly
//      from memory. This is the v7.5.1 behavior — fast, exact and
//      batch-first — now with the full v7.6 safety layer.
//
//    • STRATEGY SAMPLING RESTORED — windows over 60 pages sample
//      the favorites region first (two probes): when the walk is
//      clearly cheaper for the batch size it still walks;
//      windows over 2,500 pages always walk. Small windows rank.
//
//    • RANK JOBS ARE FULL JOBS — crash-safe per-page checkpoints
//      during collection, pause/resume mid-collection, retry
//      after API errors, history ledger with collecting phase,
//      and a persisted unserved-tail so Continue after a refresh
//      is instant. A tail that outgrows its ledger cap
//      re-verifies the window instead of lying "complete" —
//      served wallpapers never repeat either way.
//
//    • v7.5 buffered sessions now convert into ranked-window
//      jobs, recovering their unserved matches instead of
//      re-walking from page one.
//
//  v7.6.0 — TRUE BATCH ENGINE — the scan finally respects the batch:
//
//    • ONLY THE PAGES EACH BATCH NEEDS — the old favorites-order
//      strategy collected the entire date window (up to 2,500
//      pages) before showing anything. That buffer is gone: the
//      walk itself is favorites-descending, so batch 1 fetches
//      just the pages that fill it (plus binary-search boundary
//      probes that read a single item each), then stops mid-page
//      with a resumable cursor. "Continue — next N" walks the
//      next N eligible wallpapers and nothing else.
//
//    • NEVER PROCESSES A WALLPAPER TWICE — every job keeps a
//      persistent ledger of served wallpaper ids (stable ids, not
//      positions) that survives refreshes and browser restarts.
//      Continue, resume, retry-after-error — and even Wallhaven
//      re-ordering its results — can't make a served id re-serve.
//
//    • JOB LEDGER IN HISTORY — every entry records batch number,
//      served/skipped counts, last activity, phase (awaiting ·
//      paused · sparse · complete · error), the last served
//      wallpaper and the resume cursor. Load inspects and resumes
//      a job; the ↻ button restarts it from the beginning as a
//      fresh entry; Delete wipes it completely.
//
//    • CRASH-SAFE CHECKPOINTS — cursor and counters persist after
//      every page, not just at batch end. A crash or refresh
//      mid-batch loses nothing.
//
//    • PAUSE IS REAL — the Stop button is now Pause: state saved
//      after the current page, the button becomes Resume. API
//      errors park the job retry-ready with the error recorded.
//
//    • SOURCE-SHIFT DETECTION — on resume after a refresh the
//      engine verifies the page at the cursor still holds the
//      last served wallpaper; if Wallhaven's results shifted it
//      says so and continues safely (no duplicates, order may
//      differ).
//
//    • LIVE JOB STRIP + DYNAMIC BATCH SIZE — the panel shows job,
//      batch, in-batch progress, served/skipped/dupes and an
//      estimate of what is left. Changing the Batch field between
//      batches is respected on the very next Continue.
//
//  v7.5.1 — CONTROL POLISH — every button, working perfectly:
//
//    • SETTINGS MOVED TO THE TOP PANEL — a "Downloads" section in
//      the naXim Labs panel (parallel downloads stepper, notify
//      toggle, lifetime stats). The queue pane is action-only now:
//      pause/resume, retry-all, clear-failed, clear-all. (The
//      v7.5.0 drawer also had a dead toggle — its class landed on
//      the wrong element, so it could never open.)
//
//    • TRUE PAUSE — Pause now actually stops the world: in-flight
//      transfers are ABORTED and requeued at their FIFO position,
//      in every tab, the instant you click. Files already in the
//      save step (fully downloaded) land rather than restart, and
//      resume picks the queue back up in order. The pill ring goes
//      amber; rows say "paused".
//
//    • CLEAR-ALL — a trash button on the queue bar with a two-click
//      inline confirm (arms red, times out — no modal, no clutter).
//      Confirming removes EVERYTHING: rows, store, and executing
//      transfers in every tab (tombstones ride the shared store).
//      Lifetime stats survive; the queue restarts empty.
//
//  v7.5.0 — PARALLEL SETTINGS & TELEMETRY — the queue you can tune.
//
//  SETTINGS live in their own tiny store (gf_dlq_cfg_v1), separate
//    from the queue envelope — changing a preference never churns
//    queue revisions or disturbs executing transfers:
//    • Parallel downloads: 1 by default (strictly one-by-one, FIFO);
//      raise it live (up to 6) and the pump fills the new slots the
//      same instant; lower it and in-flight transfers finish out
//      naturally. The setting survives refresh and browser restarts
//      and syncs across every open tab through its own value-change
//      listener.
//    • Pause / Resume holds the whole queue in every tab at once —
//      adding a new download while paused auto-resumes (a fresh
//      click is intent).
//    • Notify when finished — one desktop notification (via
//      GM_notification) the moment the queue drains, only when the
//      page is hidden — never per-file spam. Off switch in settings.
//    • Lifetime counters — files saved & bytes moved, all-time.
//
//  TELEMETRY, in the rows and the header: live per-file speed
//    (smoothed EMA) with ETA and bytes moved, queue position for
//    waiting items ("waiting — 3 of 9"), backoff countdowns for
//    retries, error text inline on failed rows, an aggregate
//    "N of M running · MB/s · %" status line, and an amber ring
//    while paused.
//
//  BULK CONTROLS: Retry-all-failed and Clear-failed act on every
//    failed row at once; the success UX is byte-for-byte unchanged.
//
//  v7.4.1 — INSTANT REFRESH FAILOVER — fixes restored downloads
//    stuck on "wait" forever after a page refresh.
//
//    ROOT CAUSE: the dying page's pagehide requeue-write rides
//    Tampermonkey's ASYNC storage bridge and can be dropped — the
//    committed store then still shows items OWNED by the dead tab.
//    Hydrate only healed meta/down/retry behind a STALE (75 s)
//    registry entry, never a QUEUED item that still carried an
//    owner, and the scheduler only claims OWNERLESS work. Result:
//    every restored row sat on "wait" with no code path ever
//    looking at it again.
//
//    FIX (layered, each layer independently sufficient):
//    • Death notes — pagehide also drops a synchronous localStorage
//      note (commits during unload even when the GM bridge dies);
//      successors prove the predecessor dead INSTANTLY at hydrate.
//    • Hydrate + watchdog now heal owned-QUEUED items too, and
//      accept death via the ring or registry silence — a live
//      heartbeat always vetoes, so a throttled background tab is
//      never robbed mid-transfer.
//    • Dead-owner items are claimable at pump time.
//    • Livelocks exterminated: the claim timer is armed BEFORE the
//      write whose same-tab echo re-enters pump; claims are capped
//      by MAX_LIVE; a lost verify timer is unstuck by the
//      watchdog; an unreadable store at verify keeps claims.
//
//  v7.4.0 — PERSISTENT DOWNLOAD QUEUE
//
//  THE download queue is no longer volatile. It lives in GM storage
//    (gf_dlq_v1) as one versioned envelope — { v, rev, base, seq,
//    items[], gone{} } — and is rebuilt on every load, so refreshes,
//    tab closures and browser restarts no longer lose pending work.
//
//  ORDER is global and chronological: items serialize in (seq, id)
//    order, the exact order wallpapers were added in across tabs;
//    every append persists immediately before any await, so a crash
//    between click and write can no longer swallow an add.
//
//  OWNERSHIP: the adding tab executes the transfer. Orphaned items
//    (dead owner = no heartbeat for 75 s) are re-queued by a 20 s
//    watchdog and claimed write-then-verify by a live tab, so exactly
//    one tab ever moves a given file. pagehide requeues a tab's own
//    in-flight items instantly (fast failover); pageshow reclaims
//    them after a bfcache restore.
//
//  CROSS-TAB: GM_addValueChangeListener broadcasts every write;
//    remote items are adopted (progress, state, order), executing
//    items stay immune to stale snapshots (rev/base guard), and
//    dismissals travel as tombstones so a removal is never mistaken
//    for a lost update — or vice versa.
//
//  FAILURE: transient errors keep the auto-retry ladder (4 tries,
//    700/1800/4200 ms); real failures PERSIST — red row, error
//    detail, Retry and Dismiss. The direct-URL courtesy only fires
//    when the SAVE step itself broke. Success behavior is exactly
//    as before: the previewer fades out gracefully on completion.
//
//  EFFICIENCY: progress coalesces to >=1 s / >=5% deltas over a
//    250 ms debounce; heartbeats only tick while a tab owns work;
//    idle cost is one lightweight watchdog read. Object URLs are
//    revoked on every exit path; nothing executable is ever
//    persisted; the store is capped and TTL-pruned.
//
//  SELF-HEALING: corrupt JSON is backed up and reset; invalid or
//    duplicate entries are dropped; done entries expire; stalled
//    entries are detected and re-queued — the script never crashes
//    or hangs on damaged storage.
//
// ════════════════════════════════════════════════════════════════
//  v7.3.1 — GLOBAL KILL: WALLHAVEN'S NATIVE CORNER STAR
//
//  THE glitch: wallhaven renders its own corner anchor — a.thumb-btn —
//    on every thumbnail for signed-in users. Any wallpaper you have
//    favorited gets the .thumb-btn-unfav variant: a solid GREEN (#490)
//    rounded square with a white star, pinned to the TOP-RIGHT corner
//    at opacity 1, straight from the server HTML. It is ALWAYS visible
//    — Latest, Top, Hot, and every account collections tab — before
//    any hover happens.
//
//  WHY it flickered: the enhancer already replaces wallhaven's per-card
//    chrome with its own (the hover nx-tools rail + the .nx-fav star in
//    the bottom info bar), but the card sanitizer only ran LAZILY, on a
//    card's first pointerenter. So an un-hovered card kept showing the
//    native green corner star; the moment you hovered, it was sanitized
//    away and stayed hidden until the page was reloaded — and since only
//    favorited wallpapers render it, its appearance looked random.
//
//  THE fix: one universal stylesheet rule, injected with the script's
//    very first init step, kills the native corner star pair (.thumb-btn
//    -fav / .thumb-btn-unfav) on every wallhaven page, for every card —
//    present at load or added later by infinite scroll — before any
//    hover, with no dependence on the sanitizer. The enhancer's own star
//    remains the single favorite affordance, and the removal engine is
//    untouched (it scrapes quickDelete links from FETCHED documents,
//    which display:none on the live page cannot reach).
//
// ════════════════════════════════════════════════════════════════
//  v7.3.0 — FAVORITE ENGINE: TRUE ADD/REMOVE SEMANTICS
//
//  THE core fix: removal no longer depends on the Quick-Save target.
//    Every earlier version scraped the removal link from the ACTIVE
//    Quick-Save collection only — if the wallpaper actually lived in
//    a different one, tapping the star failed with "did not return
//    the real removal link". Removal now resolves the wallpaper's
//    real collections first (the favorite index, or an exhaustive
//    paginated walk when the index does not know) and removes it
//    from every collection that holds it.
//
//  THE star is a toggle again: already-favorited + tap = remove,
//    immediately — no picker, no Quick-Save destination involved.
//    The collection picker now belongs exclusively to the ADD flow
//    (not favorited + no Quick-Save target, or a deliberate hold).
//
//  ONE source of truth (FavState): "is it favorited?" has a single
//    answer — server .faved seeds plus a cached, count-validated,
//    fully paginated account index — instead of five DOM
//    heuristics. Every mutation runs through a per-wallpaper lock
//    (rapid taps serialize and coalesce; a late response can never
//    overwrite newer state), and favRender() is the only DOM writer
//    for star state, so every card instance of a wallpaper agrees.
//
//  FIXED under the hood:
//    • The old boot-time account scan only read page 1 of each
//      collection, so it overwrote TRUE server state with
//      incomplete data — wallpapers on page 2+ of their collection
//      lost their star. It is replaced by the index, which never
//      downgrades a server marker.
//    • Scan cards now show real account state (they always rendered
//      un-favorited before), refreshed by the background index.
//    • The dead gf_favs local mirror (write-only since v7.1.3) is
//      deleted — one store, one truth.
//    • FAV_URL now matches the site's real /wallpaper/fav/{id}
//      contract (was /favorites/fav/, a route the site never
//      renders on its cards).
//    • A rotated CSRF token (HTTP 419) is retried exactly once with
//      a fresh catalog; add and quickDelete links embed fresh
//      tokens resolved at operation time.
//    • Quick-Save target changes made in other tabs propagate live
//      (GM_addValueChangeListener).
//    • Restored snapshot grids re-render stars from live state
//      (clearGrid), and the star's error path always restores the
//      tooltip (it could stick at the last error message).
//    • Space activates the star like a button, and picker rows show
//      a "Saved" chip for collections already holding the wallpaper.
//
//  v7.2.0 — QUICK-SAVE & COLLECTION PICKER UX REWORK
//
//  NEW: Per-collection Quick-Save controls
//    Every collection row in the picker now carries its own ⚡
//    Quick-Save control. Exactly ONE collection may be the target
//    at any time — a single stored value is the only source of
//    truth (quickLoad/quickSave), activating one automatically
//    displaces the previous one, and the whole UI is re-derived
//    from that value (refreshQuickStates), so two rows can never
//    appear active or disagree with what a tap on ★ will do.
//    Tapping the active ⚡ turns Quick-Save off.
//
//  NEW: The hold opens the picker the moment the threshold is hit
//    The deliberate-hold threshold drops from 650 ms to 400 ms,
//    and the picker opens WHILE the star is still held — an
//    instant shell with a loading state first, the collection rows
//    as soon as the account catalog answers. The release that
//    follows can never fire the normal tap action (time-boxed
//    suppression window), and a 9 px movement slop plus
//    pointercancel handling keeps drags, scrolls and ghost clicks
//    from being mistaken for a deliberate hold.
//
//  FIXED: Picker close button behaved like selectable text
//    The custom modal's close control showed the I-beam cursor
//    (wallhaven's own CSS omits cursor:pointer on .overlay-close
//    and its :hover rule targets the icon's children). It is now a
//    36×36 px pointer-cursor hit area with hover, active and
//    focus-visible states — and the fix also covers wallhaven's
//    own overlay dialogs that reuse the same class.
//
//  FIXED: Picker content rendered behind the title bar
//    The modal skipped wh-core's .overlay-content wrapper, whose
//    51 px top padding clears the absolutely-flowed title bar —
//    the intro and the first rows sat underneath it. The picker
//    now mirrors wh-core's scaffold exactly (header + content),
//    gains Escape-to-close, keyboard-operable controls and a
//    retry path on load errors.
//
//  REMOVED: the settings icon beside the star
//    The whole feature is gone — icon, handlers, state and CSS.
//    Its job now lives where it belongs: inside the picker, as
//    the per-collection ⚡ controls plus the status line that
//    names the active Quick-Save target. (It was also visually
//    dead weight: sanitizeCard hid it on every native card.)
//
//  FIXED under the hood:
//    • Restored snapshot cards (clearGrid) lost their star
//      listeners — cloneNode copies the bound flag but not the
//      handlers; binding is now guarded by a WeakSet and re-runs
//      after the native listing is restored.
//    • The stale data-nxLong DOM flag could swallow one unrelated
//      click later; suppression is now a short time window instead.
//    • Star tooltips reflect the live Quick-Save target, and a
//      quick-save shows loading/success/error feedback on the star.
//    • Anonymous sessions get an accurate log-in message instead
//      of a doomed catalog fetch.
//    • Dead v7.1.1 fallback chain removed (favOnAnchorClick,
//      favToggleFallback, favRequest, showFavOverlay, unused
//      helpers) — nothing could reach it since 7.1.3.
// ════════════════════════════════════════════════════════════════
//  v7.1.1 — CHANGES FROM v7.1.0 (TRUE ACCOUNT-COLLECTION FAVORITES)
//
//  FIX: The favorite modal showed the wrong thing and nothing was
//    saved to the account's collections
//    v7.1.0 still spoke its own protocol: it fetched the fav
//    endpoint itself, decided the new state from the button's local
//    "desired" flag (forcing the count ±1 even when the server
//    actually did the opposite) and re-displayed whatever HTML came
//    back. Depending on wallhaven's reply that could show the
//    "public collections" panel instead of the user's own
//    collections — and the account was never reliably updated.
//
//    Fix — the star now IS wallhaven's own star. The upgraded
//    favorite control is no longer a custom <button>: it is the very
//    element wallhaven renders for its own cards
//      <a class="jsAnchor overlay-anchor wall-favs"
//         data-href="https://wallhaven.cc/wallpaper/fav/{id}">
//    restyled to keep the v7.0.8 look. A click runs wh-core's own
//    delegated handler — the exact mechanism v5.4.1 used and the
//    site's native star still uses:
//      $.get(data-href) → the server toggles the favorite → the
//      server's own modal opens in #overlay ("Add to collection…"
//      with the USER'S OWN collections — Default, custom ones,
//      "Manage collections") — and choosing a collection there is
//      executed by wallhaven's own handlers, really saving the
//      wallpaper into that account collection. This script performs
//      no favorite network request of its own on modern wallhaven
//      pages, so the modal and the account state can no longer
//      diverge from the site's native behavior.
//
//  FIX: The favorite number is no longer forced
//    The star count/state only change after wallhaven's overlay
//    proves the toggle was accepted (the modal that appears IS the
//    server's answer). The new state is derived from the server
//    outcome — the pre-click server-rendered state inverted — and
//    the count moves by exactly one from its server-rendered value.
//    Failed toggles change nothing and shake instead.
//
//  FIX: The star now reflects the account truth on load
//    wallhaven server-renders .faved on the card star when the
//    wallpaper is already in the logged-in account's collections
//    (wh-core css: .thumb>.thumb-info>.faved). That marker now wins
//    over the local mirror at boot: wallpapers already present in
//    the account show the favorited star immediately, stale local
//    entries self-heal, and the local mirror remains only for
//    script-generated scan cards (which have no server markup).
//
//  KEPT: removal (second click un-favorites, natively), the picker's
//  own per-collection add/remove, multi-instance sync, gf_favs
//  persistence with the pagehide flush, the login short-circuit
//  (anonymous users get an accurate tooltip and no doomed request),
//  the yellow-glow fixes from v7.1.0, and a v7.1.0-style custom
//  request path kept purely as a fallback for pages without
//  wallhaven's overlay stack.
// ════════════════════════════════════════════════════════════════
//  v7.1.0 — CHANGES FROM v7.0.9 (COLLECTION PICKER + GLITCH FIX)
//
//  FIX: The "choose a collection" modal never appeared
//    wallhaven's /wallpaper/fav/{id} reply carries { view } — the
//    HTML of the site's own collections overlay (the same modal the
//    native card star opens via wh-core: T.html(view) + removal of
//    #overlay's .overlay-hidden class). v7.0.9 fetched the endpoint,
//    validated the reply, then threw the view away — so the favorite
//    toggled but the collection picker never showed and nothing was
//    ever added to the account's collections.
//
//    Fix: on success the returned view is injected into the native
//    #overlay (.overlay-inner) and the overlay is unhidden — wh-core's
//    exact show sequence. The close button, backdrop click and every
//    delegated handler inside the returned HTML (collection rows,
//    confirm links) are run by wallhaven's own bundle; a dedicated
//    Escape-to-close binding is added (wh-core only binds its own from
//    its show path), so ticking a collection there updates the
//    account's collections exactly like the site's own star.
//
//  FIX: Yellow glow blob across the card's bottom bar
//    Root cause: the shared card-reset rule forced .nx-fav to
//    position:static !important, defeating its own position:relative
//    — so the star's ::after glow (inset:-5px, border-radius:50%)
//    anchored to the whole .thumb-info bar and rendered as a
//    ~300x40px yellow ellipse. Worse, the favorited ring animation
//    used fill-mode:forwards, whose final keyframe (opacity:0,
//    scale:1.35) permanently overrode the :hover glow and replayed
//    the ellipse on every favorited card mount (and under
//    prefers-reduced-motion it stayed visible permanently).
//
//    Fix: .nx-fav keeps position:relative !important (the glow hugs
//    the star again) and the ring animation no longer uses forwards
//    — it plays once and returns the ::after to its invisible base
//    state, so the hover glow works again and nothing lingers.
//
//  FIX: Panel footer version string was stale ("v7.0.2").
//
//  Everything else — UI, icon design, animations, downloads,
//  preview, panel, search, scanning — is untouched.
//  v7.0.9 — CHANGES FROM v7.0.8 (FAVORITE SYSTEM REPAIR ONLY)
//
//  FIX: Favorite icon click did nothing
//    Root cause: favRequest() scraped the wallpaper page for
//    '#fav-button' / 'a.add-fav' and POSTed its href. That markup
//    belonged to the OLD wallhaven design and no longer exists in
//    any current wallhaven page, so every favorite request rejected
//    immediately ("login required") — the star pulsed, shook, and
//    reverted, nothing was ever saved. The UI was fine; the wire
//    protocol underneath it was dead.
//
//    Fix: favRequest() now uses the exact mechanism v5.4.1 relied
//    on (and wallhaven's own card star still uses): an AJAX GET of
//    https://wallhaven.cc/wallpaper/fav/{id} — the same endpoint
//    the site's native .overlay-anchor handler fires — which
//    toggles the wallpaper in the logged-in account's favorites
//    server-side and answers with the { view, status } JSON
//    contract wallhaven's wh-core bundle defines (view present and
//    status !== false ⇒ success).
//
//    Login detection no longer depends on the dead '#fav-button'
//    scraper: the header's Login/Join buttons (only rendered for
//    anonymous sessions) short-circuit the request with an
//    accurate "Log in to Wallhaven to favorite" tooltip instead of
//    a guaranteed-to-fail network round-trip.
//
//  FIX: Favorite state is now synchronized across every card
//    instance of the same wallpaper (grid card + scan-result
//    card), not just the button that was clicked.
//
//  FIX: A favorite added/removed within the 800 ms debounced
//    write window could be lost on tab close/reload — the pagehide
//    flush now also flushes the favorites store (gf_favs).
//
//  Everything else — UI, icon design, animations, downloads,
//  preview, panel, search, scanning — is untouched.
// ════════════════════════════════════════════════════════════════

(function () {
    'use strict';
    console.info('[naXim Labs] v8.1.0 executing');

    /* ═══ PAGE DETECTION & BOOT GUARD ══════════════════════════════ */

    const PATH = location.pathname;
    const PAGE_TYPE = (() => {
        if (PATH === '/' || PATH === '')                           return 'home';
        if (PATH === '/latest')                                    return 'latest';
        if (PATH === '/hot')                                       return 'hot';
        if (PATH === '/toplist')                                   return 'toplist';
        if (PATH === '/random')                                    return 'random';
        if (PATH === '/search')                                    return 'search';
        if (/^\/user\/[^/]+\/uploads/.test(PATH))                 return 'user-uploads';
        if (/^\/user\/[^/]+\/(favorites|collections)/.test(PATH)) return 'user-favorites';
        return null;
    })();

    function getSection () {
        return document.querySelector('section.thumb-listing-page') || document.querySelector('#thumbs');
    }
    if (!getSection()) { console.info('[naXim Labs] no wallpaper grid on this page — skipped'); return; }

    /* ═══ CONFIG ═══════════════════════════════════════════════════ */

    const S = (k, d) => ({ get: () => GM_getValue(k, d), set: v => GM_setValue(k, v) });
    const cfg = {
        apiKey    : S('gf_key',    ''),
        dateFrom  : S('gf_df',     ''),
        dateTo    : S('gf_dt',     ''),
        minFavs   : S('gf_mf',     50),
        maxFavs   : S('gf_xf',     0),
        maxFavsOn : S('gf_xf_on',  false),
        batchSize : S('gf_bs',     200),
        query     : S('gf_q',      ''),
        categories: S('gf_cat',    '111'),
        purity    : S('gf_pur',    '100'),
        atleast   : S('gf_res',    ''),
        ratios    : S('gf_rat',    ''),
        sortMode  : S('gf_sort',   'favorites'),
        panelOpen : S('gf_open',   false),
        maxHistory: S('gf_mh',     20),
        hdMode    : S('gf_hdmode', false),
        pagePill  : S('gf_pagepill', true),
        pageBars  : S('gf_pagebars', true),
    };
    const get = k => cfg[k].get();
    const set = (k, v) => cfg[k].set(v);

    (() => {  // one-time migrations
        try {
            if (!GM_getValue('gf_df', '')) {
                const yf = GM_getValue('gf_yf', 2024);
                const yt = GM_getValue('gf_yt', new Date().getFullYear());
                set('dateFrom', yf + '-01-01');
                set('dateTo',   yt + '-12-31');
            }
            GM_deleteValue('gf_favs');   // v7.3.0: write-only mirror retired
            if (!GM_getValue('gf_sortmig', 0)) {
                GM_setValue('gf_sortmig', 1);
                if (GM_getValue('gf_sort', 'favorites') === 'date_added') GM_setValue('gf_sort', 'favorites');
            }
        } catch (e) { console.error('[naXim Labs] migration failed', e); }
    })();

    /* ═══ UTILITIES ════════════════════════════════════════════════ */

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isNaN(n) ? d : Math.min(hi, Math.max(lo, n)); };
    const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const todayStr = () => ymd(new Date());
    const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function fmtDate (d) {
        if (!d) return '';
        const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
        return isNaN(dt) ? String(d) : dt.getDate() + ' ' + MON[dt.getMonth()] + ' ' + dt.getFullYear();
    }

    const deriveFullUrl = (id, ext) => 'https://w.wallhaven.cc/full/' + id.slice(0, 2) + '/wallhaven-' + id + '.' + ext;
    const deriveLarge   = id => 'https://th.wallhaven.cc/large/' + id.slice(0, 2) + '/' + id + '.jpg';
    const deriveThumb   = id => 'https://th.wallhaven.cc/small/' + id.slice(0, 2) + '/' + id + '.jpg';

    const IC = (() => {
        const w = (p, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 2.1}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
        return {
            dl:     w('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
            eye:    w('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
            open:   w('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
            x:      w('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', 2.4),
            ok:     w('<polyline points="20 6 9 17 4 12"/>', 2.5),
            left:   w('<polyline points="15 18 9 12 15 6"/>'),
            right:  w('<polyline points="9 18 15 12 9 6"/>'),
            bolt:   w('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
            play:   w('<polygon points="6 4 20 12 6 20 6 4"/>'),
            stop:   w('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
            sync:   w('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>'),
            chev:   w('<polyline points="6 9 12 15 18 9"/>'),
            hd:     w('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
            fit:    w('<polyline points="4 9 4 4 9 4"/><polyline points="20 9 20 4 15 4"/><polyline points="4 15 4 20 9 20"/><polyline points="20 15 20 20 15 20"/>'),
            plus:   w('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
            minus:  w('<line x1="5" y1="12" x2="19" y2="12"/>'),
            retry:  w('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
            pause:  w('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
            trash:  w('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>', 1.9),
            help:   w('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
            star:   '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 1.7l3.1 6.5 7.1.9-5.2 4.9 1.3 7-6.3-3.4-6.3 3.4 1.3-7L1.8 9.1l7.1-.9z"/></svg>',
            github: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
        };
    })();

    /* ═══ PERSISTENT CACHES ════════════════════════════════════════ */

    const DATE_CAP = 4000, META_CAP = 3000, FAV_CAP = 4000;
    function safeParse (k) { try { const v = JSON.parse(GM_getValue(k, '{}')); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
    function trimMap (m, cap) { while (m.size > cap) m.delete(m.keys().next().value); }

    const _dates = new Map(Object.entries(safeParse('gf_dates')));
    const _meta  = new Map(Object.entries(safeParse('gf_meta')));

    let _persistT = 0;
    let favFlush = null;   // wired up by the FAVORITES module below
    function flushPersist () {
        clearTimeout(_persistT);
        if (favFlush) { try { favFlush(); } catch {} }
        try {
            trimMap(_dates, DATE_CAP); GM_setValue('gf_dates', JSON.stringify(Object.fromEntries(_dates)));
            trimMap(_meta,  META_CAP); GM_setValue('gf_meta',  JSON.stringify(Object.fromEntries(_meta)));
        } catch {}
    }
    const persistSoon = () => { clearTimeout(_persistT); _persistT = setTimeout(flushPersist, 2500); };
    addEventListener('pagehide', flushPersist);

    const setDate = (id, d) => { _dates.set(id, d); persistSoon(); };

    function makePool (n) {
        let active = 0; const q = [];
        const next = () => { while (active < n && q.length) { active++; q.shift()(); } };
        return fn => new Promise((res, rej) => {
            q.push(() => { fn().then(res, rej).finally(() => { active--; next(); }); });
            next();
        });
    }

    /* ═══ NETWORK LAYER ════════════════════════════════════════════ */

    /* ── v7.7.3 UNIFIED RATE SHIELD ─────────────────────────────────
       Wallhaven's API allows ~45 requests a minute — counted across
       EVERYTHING the tab sends, not just scan pages. v7.7.2 paced the
       scan walk only; wallpaper metadata (/w/), page-sync and the
       HTML fallback still fired unpaced, and a throttled lookup
       cascaded into up to three extra requests — keeping the shared
       window saturated so the scan kept meeting 429s anyway. THE FIX:
       the gate lives HERE, at the network layer — every request to
       wallhaven.cc (API JSON or wallpaper-page HTML) passes the SAME
       rolling 60-second window (36-request budget, 20% headroom; 20
       while any tab's cooldown is live) with 250 ms spacing, and every
       403/429 answer publishes the cross-tab cooldown and carries its
       Retry-After into the callers' backoffs. Waits are sliced so a
       scan Pause always responds instantly. */
    const PACE_WINDOW      = 60000;       /* rolling rate-limit window */
    const PACE_BUDGET      = 36;          /* requests per window — 20% under the 45/min limit */
    const PACE_MIN_GAP     = 250;         /* ms between consecutive sends */
    const PACE_COOL_BUDGET = 20;          /* tighter budget while the cross-tab cooldown is active */
    const _paceLedger      = [];          /* timestamps of this tab's wallhaven.cc requests */
    function paceBudgetNow () {
        let b = PACE_BUDGET;
        const until = parseInt(GM_getValue('gf_rl_until', '0'), 10) || 0;
        if (Date.now() < until) b = Math.min(b, PACE_COOL_BUDGET);
        return b;
    }
    async function paceGate (stopHook) {
        for (let guard = 0; guard < 260; guard++) {
            if (stopHook && stopHook()) return 'stopped';   /* a pause always beats pacing */
            const now = Date.now();
            while (_paceLedger.length && now - _paceLedger[0] > PACE_WINDOW) _paceLedger.shift();
            if (_paceLedger.length < paceBudgetNow()) {
                const gap = _paceLedger.length ? now - _paceLedger[_paceLedger.length - 1] : Infinity;
                if (gap < PACE_MIN_GAP) await sleep(PACE_MIN_GAP - gap);
                _paceLedger.push(Date.now());
                return;
            }
            if (guard % 4 === 0)
                setStatus('⏳ Pacing requests — ~' + Math.ceil(((_paceLedger[0] + PACE_WINDOW) - Date.now()) / 1000) + 's to stay under the API rate limit…');
            await sleep(Math.max(Math.min((_paceLedger[0] + PACE_WINDOW) - Date.now() + 150, 1000), 250));
        }
        _paceLedger.push(Date.now());   /* clock frozen (tests / hostile env) — proceed, never spin */
    }
    function pacePublishRL (retryAfterSec) {
        const ms = Math.max(60000, ((retryAfterSec || 0) * 1000) + 500);
        try { GM_setValue('gf_rl_until', String(Date.now() + ms)); } catch (e) {}
    }

    function apiRaw (url, opts) {
        const preGated = opts && opts.preGated;   /* the scan engine gates itself — count once */
        return (async () => {
            if (!preGated && (await paceGate()) === 'stopped') return { _httpError: -3 };
            return new Promise((res) => {
                GM_xmlhttpRequest({
                    method: 'GET', url,
                    headers: { Accept: 'application/json', Referer: 'https://wallhaven.cc/' },
                    timeout: 20000,
                    onload (r) {
                        if (r.status >= 400) {
                            const out = { _httpError: r.status };
                            const ra = (String(r.responseHeaders || '').match(/retry-after:\s*(\d+)/i) || [])[1];
                            if (ra) out._retryAfter = Math.min(120, parseInt(ra, 10) || 0);
                            if (r.status === 403 || r.status === 429) pacePublishRL(out._retryAfter);
                            res(out); return;
                        }
                        try { res(JSON.parse(r.responseText)); } catch { res({ _httpError: 0 }); }
                    },
                    onerror  : () => res({ _httpError: -1 }),
                    ontimeout: () => res({ _httpError: -2 }),
                });
            });
        })();
    }
    function apiSearch (params, opts) {
        const p = { ...params };
        const key = get('apiKey');
        if (key && !p.apikey) p.apikey = key;
        return apiRaw('https://wallhaven.cc/api/v1/search?' + new URLSearchParams(p), opts);
    }

    const _inflight = new Map();
    function once (key, make) {
        if (_inflight.has(key)) return _inflight.get(key);
        const p = Promise.resolve().then(make).finally(() => _inflight.delete(key));
        _inflight.set(key, p);
        return p;
    }

    const RX_IMG = /<img[^>]+\bid="wallpaper"[^>]*>/i;
    const RX_TAG = /class="tagname"[^>]*>([^<]+)</g;
    function scrapeDate (html) {
        const m = html.match(/datetime=["'](\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/) ||
                  html.match(/title=["'](\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/) ||
                  html.match(/"created_at"\s*:\s*"?(\d{4}-\d{2}-\d{2})/) ||
                  html.match(/(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}:\d{2}/);
        return m ? m[1] : '';
    }
    async function scrapeWallPage (id) {
        await paceGate();                     /* v7.7.3: the HTML fallback is paced too — one gate for everything */
        return new Promise((res) => {
            GM_xmlhttpRequest({
                method: 'GET', url: 'https://wallhaven.cc/w/' + id, timeout: 20000,
                headers: { Accept: 'text/html', Referer: 'https://wallhaven.cc/' },
                onload (r) {
                    try {
                        const html = r.responseText || '';
                        const imgTag = (html.match(RX_IMG) || [])[0] || '';
                        const src = (imgTag.match(/\bsrc="([^"]+)"/) || [])[1] ||
                                    (imgTag.match(/\bdata-src="([^"]+)"/) || [])[1] ||
                                    (html.match(/["'](https:\/\/w\.wallhaven\.cc\/full\/[^"'\s]+)["']/) || [])[1] || '';
                        RX_TAG.lastIndex = 0;
                        const tags = []; let m;
                        while ((m = RX_TAG.exec(html)) !== null) tags.push(m[1].trim());
                        res(src ? { path: src, ext: ((src.match(/\.(\w+)(?:\?|$)/) || [])[1] || 'jpg').toLowerCase(),
                                    tags, created: scrapeDate(html) } : null);
                    } catch { res(null); }
                },
                onerror  : () => res(null),
                ontimeout: () => res(null),
            });
        });
    }

    function fetchWallData (id) {
        const cached = _meta.get(id);
        if (cached && cached.path && cached.tagsFetched === true) return Promise.resolve(cached);
        return once('meta:' + id, async () => {
            /* v7.7.3 lane machine: keyed API → keyless API → /w/ HTML.
               A rate-limited lane is RETRIED in place (Retry-After
               aware) and NEVER cascades — the old chain fired up to
               three requests per wallpaper exactly while the server
               was already saying slow down, which is what kept big
               scans tripping the limit. */
            let d = null;
            const key = get('apiKey');
            let lane = key ? 0 : 1, rl = 0;
            while (lane <= 2 && !d) {
                if (lane < 2) {
                    const r = await apiRaw('https://wallhaven.cc/api/v1/w/' + id + (lane === 0 ? '?apikey=' + encodeURIComponent(key) : ''));
                    if (!r._httpError) {
                        if (r.data && r.data.path) d = r.data;
                    } else if (r._httpError === 403 || r._httpError === 429) {
                        if (rl < 2) {                     /* same-lane backoff, server-timed */
                            rl++;
                            await sleep(Math.max(1500 * rl * rl, r._retryAfter ? r._retryAfter * 1000 + 250 : 0));
                            continue;
                        }
                        break;                            /* hard rate limit: wait it out, never hammer */
                    }
                } else {
                    const s = await scrapeWallPage(id);
                    if (s) d = { path: s.path, file_type: s.ext, resolution: '', tags: s.tags, created_at: s.created, thumbs: null };
                    break;
                }
                if (!d) lane++;
            }
            if (!d) return null;
            const ft = String(d.file_type || '');
            const rec = {
                path: d.path,
                ext: (ft.includes('/') ? ft.split('/')[1] : ft) || 'jpg',
                resolution: d.resolution || (d.dimension_x ? d.dimension_x + 'x' + d.dimension_y : ''),
                tags: Array.isArray(d.tags) ? d.tags.map(t => t && (t.name || t)).filter(Boolean).slice(0, 12) : [],
                tagsFetched: true,
                created: (d.created_at || '').slice(0, 10),
                preview: (d.thumbs && d.thumbs.large) || deriveLarge(id),
            };
            _meta.set(id, rec); trimMap(_meta, META_CAP); persistSoon();
            if (rec.created) setDate(id, rec.created);
            return rec;
        });
    }

    function registerSearchItem (w) {
        if (!w || !w.id || !w.created_at) return;
        const prev = _meta.get(w.id);
        const ft = String(w.file_type || '');
        const rec = {
            path: w.path || (prev && prev.path) || '',
            ext: (ft.includes('/') ? ft.split('/')[1] : ft) || (prev && prev.ext) || 'jpg',
            resolution: w.resolution || (prev && prev.resolution) ||
                        (w.dimension_x ? w.dimension_x + 'x' + w.dimension_y : ''),
            tags: (prev && prev.tags) || [],
            tagsFetched: false,
            created: w.created_at.slice(0, 10),
            preview: (w.thumbs && w.thumbs.large) || (prev && prev.preview) || deriveLarge(w.id),
        };
        _meta.set(w.id, rec); trimMap(_meta, META_CAP);
        setDate(w.id, rec.created);
        if (rec.path) persistSoon();
    }

    /* ═══ ImagePool — HD preview blob loader ══════════════════════ */

    const ImagePool = (() => {
        const MAX_RUNNING = 3;
        const MAX_CACHED  = 4;
        const MAX_BYTES   = 64 << 20;
        /* v8.1: stall watchdog — a transfer that stops moving (no bytes
           for STALL_MS) or that has received every byte but never gets
           its onload (COMPLETE_MS — the bridge lost the response) is
           aborted and rejected with {stalled:true} so callers can retry
           immediately instead of waiting out the full 45 s timeout. */
        const STALL_MS    = 12000;
        const COMPLETE_MS = 5000;
        const ABORT = () => Object.assign(new Error('aborted'), { aborted: true });

        const cache   = new Map();
        const pinned  = new Set();
        const running = new Map();
        const queue   = [];
        let totalBytes = 0;

        const touch = k => { const e = cache.get(k); if (e) { cache.delete(k); cache.set(k, e); } };
        const queuedJob = k => queue.find(j => j.key === k);

        function evict () {
            for (const k of cache.keys()) {
                if (cache.size <= MAX_CACHED && totalBytes <= MAX_BYTES) break;
                if (pinned.has(k)) continue;
                const e = cache.get(k);
                cache.delete(k); totalBytes -= e.bytes;
                try { URL.revokeObjectURL(e.url); } catch {}
            }
        }
        function settleResolve (job, url) { if (job.wd) { clearInterval(job.wd); job.wd = 0; } running.delete(job.key); job.resolve(url); pump(); }
        function settleReject  (job, err) { if (job.wd) { clearInterval(job.wd); job.wd = 0; } running.delete(job.key); job.reject(err);  pump(); }

        function startJob (job) {
            job.started = true;               /* v8.1 CRITICAL FIX: a running job MUST report itself as
                                                  started, or cancel() takes the queue-removal branch, never
                                                  aborts the transfer and never frees the slot — three fast
                                                  HD navigations leaked all three pool slots and HD Mode
                                                  stopped converting until a page refresh. */
            job.loaded = 0; job.total = 0; job.lastMove = Date.now();
            job.wd = setInterval(() => {
                if (job.aborted) { clearInterval(job.wd); job.wd = 0; return; }
                const idle = Date.now() - job.lastMove;
                const completeHang = job.total > 0 && job.loaded >= job.total && idle > COMPLETE_MS;
                if (idle > STALL_MS || completeHang) {
                    clearInterval(job.wd); job.wd = 0;
                    try { job.req && job.req.abort && job.req.abort(); } catch {}
                    settleReject(job, Object.assign(new Error('stalled'), { stalled: true }));
                }
            }, 1500);
            job.req = GM_xmlhttpRequest({
                method: 'GET', url: job.url, responseType: 'blob',
                headers: { Referer: 'https://wallhaven.cc/' },
                timeout: 45000,
                onprogress (r) {
                    job.lastMove = Date.now();
                    job.loaded = r.loaded || 0; job.total = r.total || 0;
                    if (!job.aborted && job.onprogress) job.onprogress(r.loaded || 0, r.total || 0);
                },
                onload (r) {
                    if (job.aborted) return;
                    if (r.status !== 200 || !r.response) { settleReject(job, Object.assign(new Error('HTTP ' + r.status), { status: r.status })); return; }
                    try {
                        const url = URL.createObjectURL(r.response);
                        const b = r.response.size || 0;
                        cache.set(job.key, { url, bytes: b }); totalBytes += b;
                        touch(job.key); evict();
                        settleResolve(job, url);
                    } catch (e) { settleReject(job, e); }
                },
                onerror  () { if (!job.aborted) settleReject(job, new Error('network error')); },
                ontimeout() { if (!job.aborted) settleReject(job, new Error('timeout')); },
            });
        }

        function pump () {
            while (running.size < MAX_RUNNING && queue.length) {
                let bi = 0;
                for (let i = 1; i < queue.length; i++) if (queue[i].priority > queue[bi].priority) bi = i;
                const job = queue.splice(bi, 1)[0];
                if (job.aborted) { settleReject(job, ABORT()); continue; }
                running.set(job.key, job);
                startJob(job);
            }
        }

        function makeRoomForMain (keep) {
            for (const j of [...running.values()]) if (j !== keep && j.kind === 'main') j.cancel();
        }

        function request (key, url, opts = {}) {
            const priority = opts.priority == null ? 2 : opts.priority;
            const kind = opts.kind || 'main';
            const hit = cache.get(key);
            if (hit) { touch(key); return Promise.resolve(hit.url); }

            const cur = running.get(key) || queuedJob(key);
            if (cur) {
                if (priority > cur.priority) cur.priority = priority;
                if (opts.onprogress) cur.onprogress = opts.onprogress;
                return cur.promise;
            }

            const job = { key, url, priority, kind, onprogress: opts.onprogress || null, started: false, aborted: false };
            job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
            job.cancel = () => {
                if (job.aborted) return;
                job.aborted = true;
                if (job.started) { try { job.req && job.req.abort && job.req.abort(); } catch {} settleReject(job, ABORT()); }
                else { const i = queue.indexOf(job); if (i !== -1) queue.splice(i, 1); job.reject(ABORT()); }
            };
            queue.push(job);
            if (kind === 'main') makeRoomForMain();
            pump();
            return job.promise;
        }

        function abortKind (...kinds) {
            for (const j of [...queue]) if (kinds.includes(j.kind)) j.cancel();
            for (const j of [...running.values()]) if (kinds.includes(j.kind)) j.cancel();
        }

        return { request, abortKind, pin: k => { pinned.add(k); touch(k); }, unpin: k => pinned.delete(k) };
    })();

    /* ═══ DATE SOURCE ══════════════════════════════════════════════ */

    let _syncP = null, _syncFailUntil = 0;
    function pageSync () {
        if (_syncP) return _syncP;
        if (Date.now() < _syncFailUntil) return Promise.resolve();
        const p = (async () => {
            let p2 = {};
            const sp = new URLSearchParams(location.search);
            for (const k of ['q','categories','purity','sorting','order','topRange','atleast','resolutions','ratios','colors','seed','page']) {
                const v = sp.get(k); if (v) p2[k] = v;
            }
            if (PAGE_TYPE === 'latest') p2.sorting = 'date_added';
            else if (PAGE_TYPE === 'hot' || PAGE_TYPE === 'home') p2.sorting = p2.sorting || 'hot';
            else if (PAGE_TYPE === 'toplist') { p2.sorting = 'toplist'; if (!p2.topRange) p2.topRange = '1M'; }
            else if (PAGE_TYPE !== 'search') return;
            if (!p2.page) p2.page = '1';
            const resp = await apiSearch(p2);
            if (resp._httpError || !Array.isArray(resp.data)) throw new Error('sync failed');
            resp.data.forEach(registerSearchItem);
        })();
        p.then(() => { _syncP = Promise.resolve(true); },
               () => { _syncFailUntil = Date.now() + 30000; });
        return p;
    }

    const datePool = makePool(4);
    async function resolveDate (id) {
        if (_dates.has(id)) return _dates.get(id);
        try { await pageSync(); } catch {}
        if (_dates.has(id)) return _dates.get(id);
        try {
            const m = await datePool(() => fetchWallData(id));
            return (m && m.created) || null;
        } catch { return null; }
    }

    /* ═══ FAVORITES & COLLECTIONS — Quick-Save engine ══════════════ */

    /* ─── v7.3.0 favorite / collection engine ─────────────────────
     *
     * ARCHITECTURE — exactly one authority per question:
     *
     *   "Is this wallpaper favorited?"      → FavState.isOn(id)
     *   "Which collections hold it?"        → FavState.locsDisplay(id)
     *   "Where does a NEW save go?"         → the Quick-Save target (quickLoad)
     *   "Which favorite gets REMOVED?"      → the wallpaper's ACTUAL
     *                                         collections — never the
     *                                         Quick-Save target
     *   "What the star looks like"          → favRender(id) — the only
     *                                         DOM writer for star state
     *   "What runs a mutation"              → favRun(id, fn) — strict
     *                                         per-wallpaper serialization
     *
     * Wallhaven contracts this engine is built on (all verified
     * against the live site):
     *   • card star <a class="… wall-favs" data-href="/wallpaper/fav/{id}">
     *     — wh-core GETs that URL, the server toggles the account
     *       favorite and answers {view, status}.
     *   • the account's /favorites page renders the collections
     *     sidebar: .collection[data-collection-id] / #collection-{id}
     *     with a <small>count</small> each, plus a CSRF _token link.
     *   • "Default" is an ordinary numeric collection (wallhaven's
     *     own API lists it first: {id, label:"Default", count}).
     *   • add    → POST /favorites/add?wallHashid={id}&collectionId=
     *              {cid}&_token={csrf}
     *   • remove → GET the /favorites/quickDelete link the
     *              collection page renders next to the wallpaper.
     *
     * v7.3.0 fixes over every earlier version:
     *   1. Removal no longer consults the Quick-Save target. It
     *      resolves the wallpaper's real collections (index first,
     *      exhaustive walk as fallback) and removes it from every
     *      one that holds it, so it can never fail with "did not
     *      return the real removal link" just because the active
     *      Quick-Save collection differs.
     *   2. The collection picker belongs to the ADD flow only. A
     *      tap on an already-favorited star removes immediately —
     *      no modal, no destination selection, whatever Quick-Save
     *      is set to.
     *   3. Star state has one source (FavState + favRender) instead
     *      of five DOM heuristics. Every mutation passes through
     *      the per-wallpaper lock, so rapid taps serialize instead
     *      of racing, and no late response can overwrite a newer
     *      one.
     *   4. The old boot-time account scan only ever read page 1
     *      of each collection, so it overwrote true server state
     *      with incomplete data (wallpapers further down a
     *      collection lost their star). It is replaced by a cached,
     *      count-validated, fully paginated index that never
     *      downgrades the server's own .faved markers.
     *   5. The local gf_favs mirror (write-only since v7.1.3) is
     *      deleted — duplicated state without a reader.
     */
    const FAV_URL = id => 'https://wallhaven.cc/wallpaper/fav/' + encodeURIComponent(id);

    // Wallhaven renders its header Login/Join buttons only for
    // anonymous sessions — that is the reliable logged-out signal on
    // every wallhaven page.
    function favLoggedOut () {
        try {
            return !!document.querySelector('a.button[href$="/login"], a.button[href$="/join"]');
        } catch { return false; }
    }

    function favParseCount (el) {
        if (!el) return 0;
        const n = el.querySelector('.nx-fav-n');
        const v = parseInt(((n ? n.textContent : el.textContent) || '').replace(/[^\d]/g, ''), 10);
        return isNaN(v) ? 0 : v;
    }

    /* Star tooltip — what a tap will ACTUALLY do. The remove wording
     * deliberately does not name the Quick-Save collection: removal
     * targets wherever the wallpaper really is. */
    function favTitleFor (on) {
        const q = quickLoad();
        if (on) return 'Remove from favorites · hold to change';
        return q ? 'Quick-save to “' + (q.name || 'collection') + '” · hold to change'
                 : 'Save to a collection · hold for Quick-Save';
    }

    /* ────────────────────────────────────────────────────────────
     * FAVSTATE — the single source of favorite truth.
     *
     *   loc:      wallpaperId → { cols:Set<cid>, ts }   — where it lives
     *   seeds:    server-rendered .faved hints (fast, in-memory; the
     *             server marker is never downgraded by our own scans)
     *   catalog:  { list:[{id,name,count}], token, ts }  — account shape
     *   counts:   cid → wallpapers observed on the last full walk of
     *             that collection (the cache-validation key)
     *   loaded:   a complete, count-consistent walk finished (this
     *             session or restored from cache)
     *
     * isOn(id) = the server said .faved  OR  a known collection holds it.
     * A completed removal clears both, so the answer can not stick at
     * "on". Nothing is ever written before the server confirms, so a
     * failed request can not corrupt state either.
     * ──────────────────────────────────────────────────────────── */
    const FAV_INDEX_KEY  = 'gf_fav_index_v30';
    const FAV_INDEX_CAP  = 20000;
    const FavState = (() => {
        let loaded = false, loadP = null;
        const seeds = new Set();
        const loc   = new Map();
        const counts = new Map();                 // cid → observed count
        let persistT = 0;

        function readIndex () {
            try {
                const v = JSON.parse(GM_getValue(FAV_INDEX_KEY, 'null'));
                if (!v || v.v !== 3 || typeof v.loc !== 'object' || !v.loc) return;
                for (const [id, cols] of Object.entries(v.loc)) {
                    if (/^[a-z0-9]{6}$/i.test(id) && Array.isArray(cols))
                        loc.set(id, { cols: new Set(cols.map(String)), ts: v.ts || 0 });
                }
                if (v.counts && typeof v.counts === 'object')
                    for (const [cid, n] of Object.entries(v.counts))
                        if (Number.isFinite(n)) counts.set(String(cid), n);
                loaded = !!v.complete;
            } catch {}
        }
        function flush () {
            clearTimeout(persistT);
            if (loc.size > FAV_INDEX_CAP) {
                [...loc.keys()].slice(0, loc.size - FAV_INDEX_CAP).forEach(k => loc.delete(k));
            }
            try {
                GM_setValue(FAV_INDEX_KEY, JSON.stringify({
                    v: 3, ts: Date.now(), complete: loaded,
                    loc: Object.fromEntries([...loc].map(([id, r]) => [id, [...r.cols]])),
                    counts: Object.fromEntries([...counts]),
                }));
            } catch {}
        }
        const persistSoon = () => { clearTimeout(persistT); persistT = setTimeout(flush, 1200); };
        readIndex();

        /* server .faved hint — the freshest possible signal from the
         * page itself; wins over an older walk, never downgraded */
        const markSeed = (id, on) => { id = String(id); if (on) seeds.add(id); else seeds.delete(id); };
        const isOn = id => { id = String(id); if (seeds.has(id)) return true; const r = loc.get(id); return !!(r && r.cols.size > 0); };
        /* locations for display (picker chips): known record, else
         * null when we simply do not know yet */
        function locsDisplay (id) {
            id = String(id);
            const r = loc.get(id);
            return r ? [...r.cols] : (loaded ? [] : null);
        }
        /* locations trusted for REMOVAL: only once a complete walk
         * has finished (records alone may be partial) */
        function locsFull (id) {
            id = String(id);
            if (!loaded) return null;
            const r = loc.get(id);
            return r ? [...r.cols] : [];
        }
        function setCols (id, cols) {          // authoritative post-op truth
            id = String(id);
            const clean = (cols || []).map(String).filter(Boolean);
            if (!clean.length) { loc.delete(id); seeds.delete(id); }
            else loc.set(id, { cols: new Set(clean), ts: Date.now() });
            persistSoon();
        }
        function addCol (id, cid) {            // presence seen/confirmed (walks, ops)
            id = String(id); cid = String(cid);
            const r = loc.get(id) || { cols: new Set(), ts: 0 };
            r.cols.add(cid); r.ts = Date.now();
            loc.set(id, r);                    // never touches seeds — a later
            persistSoon();                     // diff may drop this again
        }
        const noteWalk = (cid, n) => { counts.set(String(cid), n); persistSoon(); };
        const walkCount = cid => counts.get(String(cid));
        const hasCache  = () => loaded || loc.size > 0;

        /* Full index build / validation: fresh catalog → walk every
         * collection whose observed count no longer matches. The
         * walk records every membership it sees and drops cid from
         * records it no longer sees (presence is only ever learned
         * from a page that rendered the wallpaper). */
        async function ensureIndex () {
            if (loadP) return loadP;
            loadP = (async () => {
                const cat = await favGetCatalog();     // TTL cache is fine for validation
                for (const c of cat.list) {
                    const cid = String(c.id);
                    if (c.count != null && walkCount(cid) === c.count) continue;   // unchanged
                    const seen = new Set();
                    await favWalkCollection(cid, { count: c.count, onPage: figs => figs.forEach(f => seen.add(f.getAttribute('data-wallpaper-id'))) });
                    for (const [wid, rec] of [...loc]) {
                        if (rec.cols.has(cid) && !seen.has(wid)) {
                            rec.cols.delete(cid);
                            if (!rec.cols.size) loc.delete(wid); else loc.set(wid, rec);
                        }
                    }
                    seen.forEach(wid => addCol(wid, cid));
                    noteWalk(cid, seen.size);
                }
                loaded = true;
                flush();
                favRenderAll();
            })().catch(e => { console.warn('[naXim Labs] favorite index refresh failed', e); })
                 .finally(() => { loadP = null; });
            return loadP;
        }
        let ensureT = 0;
        function ensureIndexSoon (ms) {
            clearTimeout(ensureT);
            ensureT = setTimeout(() => { ensureIndex(); }, ms == null ? 2500 : ms);
        }

        return { markSeed, isOn, locsDisplay, locsFull, setCols, addCol,
                 noteWalk, walkCount, hasCache, ensureIndex, ensureIndexSoon, flush };
    })();
    favFlush = () => FavState.flush();     // wired into the pagehide flush

    /* ─── network helpers ─────────────────────────────────────── */

    async function favHtml (url) {
        /* v7.7.3: collection pages can throttle under heavy walks —
           back off on 429/403 (Retry-After aware) instead of failing
           the whole index build. Website pages are a separate budget
           from the API, so this ladder only heals; it never slows
           saves, and it publishes nothing. */
        for (let rl = 0; ; rl++) {
            const r = await fetch(url, { credentials: 'same-origin',
                headers: { Accept: 'text/html,application/xhtml+xml' },
                signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined });
            const ra = parseInt((r.headers && r.headers.get && r.headers.get('retry-after')) || '', 10) || 0;
            if ((r.status === 429 || r.status === 403) && rl < 3) {
                await sleep(Math.max(2000 << rl, ra ? ra * 1000 + 250 : 0));
                continue;
            }
            if (!r.ok) throw new Error('Wallhaven could not load the account collection page');
            return r.text();
        }
    }
    async function favRequestMethod (url, method) {
        const r = await fetch(url, { method, credentials: 'same-origin',
            headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' },
            signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined });
        const text = await r.text(); let data = null;
        try { data = JSON.parse(text); } catch {}
        if (!r.ok || (data && data.status === false)) {
            const err = new Error((data && (data.msg || data.message)) || 'Wallhaven rejected the request');
            err.status = r.status;
            throw err;
        }
        return data || { status: true };
    }

    /* Account catalog: the /favorites page carries the CSRF token,
     * the collection list and each collection's count. Cached for a
     * short TTL so rapid multi-tap saves do not re-scrape it, and
     * fetched at most once concurrently no matter how many callers
     * race on it. */
    const FAV_CAT_TTL = 45000;
    let _catCache = null, _catP = null;
    function favParseCatalog (html) {
        const d = document.implementation.createHTMLDocument('catalog'); d.body.innerHTML = html;
        const tokenLink = d.querySelector('a[href*="_token="]');
        const token = tokenLink && new URL(tokenLink.getAttribute('href'), location.origin).searchParams.get('_token');
        const seen = new Set(), list = [];
        [...d.querySelectorAll('a[href]')].forEach(a => {
            const m = new URL(a.getAttribute('href'), location.origin).pathname.match(/^\/favorites\/(\d+)$/);
            if (!m) return;
            const cid = m[1];
            const name = a.textContent.replace(/^\s*\d+\s*/, '').replace(/\s+/g, ' ').trim();
            if (!name || seen.has(cid)) return;
            seen.add(cid);
            list.push({ id: cid, name });
        });
        /* wh-core's own drag-and-drop reads #collection-{id} small —
         * the same nodes carry each collection's count */
        list.forEach(c => {
            const box = d.querySelector('#collection-' + c.id);
            const sm = box && box.querySelector('small');
            if (sm) { const n = parseInt((sm.textContent || '').replace(/[^\d]/g, ''), 10); if (!isNaN(n)) c.count = n; }
        });
        if (!token || !list.length) throw new Error('No account collections were returned');
        return { list, token, ts: Date.now() };
    }
    function favGetCatalog (fresh) {
        if (!fresh && _catCache && Date.now() - _catCache.ts < FAV_CAT_TTL) return Promise.resolve(_catCache);
        if (_catP) return _catP;
        _catP = (async () => {
            const cat = favParseCatalog(await favHtml('https://wallhaven.cc/favorites'));
            _catCache = cat;
            return cat;
        })().finally(() => { _catP = null; });
        return _catP;
    }

    /* Walks one collection's pages (/favorites/{cid}?page=n).
     * The page size is learned from the first page; the walk stops on
     * an empty page, a short page, or when the server's own count has
     * been reached — so it is correct for any listing size wallhaven
     * chooses, and collections with a known count cost one request
     * instead of a probe for an empty last page. Two duties at once:
     *   • wid given → find-mode: stops paging once wid is located
     *     and returns its quickDelete link (the find check runs
     *     before the stop checks, so a wid on the final page is
     *     always seen)
     *   • onPage → records every figure seen (index building)
     * Returns { pages, found, delLink, complete, count } —
     * complete=true when the walk reached the listing's end. */
    const FAV_WALK_POOL = makePool(2);
    async function favWalkCollection (cid, opts = {}) {
        const res = { pages: 0, found: false, delLink: null, complete: false, count: 0 };
        let pageSize = 0;
        for (let page = 1; page <= 400; page++) {
            const html = await FAV_WALK_POOL(() => favHtml('https://wallhaven.cc/favorites/' + encodeURIComponent(cid) + (page > 1 ? '?page=' + page : '')));
            const d = document.implementation.createHTMLDocument('walk'); d.body.innerHTML = html;
            const figs = [...d.querySelectorAll('figure.thumb[data-wallpaper-id]')];
            res.pages++; res.count += figs.length;
            if (page === 1) pageSize = Math.max(1, figs.length);
            if (opts.onPage) opts.onPage(figs, page);
            if (opts.wid != null) {
                const f = figs.find(x => x.getAttribute('data-wallpaper-id') === String(opts.wid));
                if (f) {
                    res.found = true;
                    const a = f.querySelector('a.thumb-btn-unfav[href*="/favorites/quickDelete"]');
                    if (a) res.delLink = new URL(a.getAttribute('href'), location.origin).href;
                    return res;                       // located — stop paging this collection
                }
            }
            if (!figs.length) { res.complete = true; return res; }                        // listing exhausted
            if (opts.count != null && res.count >= opts.count) { res.complete = true; return res; }   // server count reached
            if (figs.length < pageSize) { res.complete = true; return res; }              // short page
        }
        return res;
    }

    /* ─── rendering — the only DOM writers for star state ──────── */

    function favRender (id, opts = {}) {
        id = String(id);
        const on = FavState.isOn(id);
        const busy = _favOps.has(id);
        document.querySelectorAll('figure.thumb[data-wallpaper-id="' + id + '"] .nx-fav').forEach(btn => {
            btn.classList.toggle('on', on);
            btn.classList.toggle('faved', on);
            btn.setAttribute('aria-pressed', String(on));
            btn.dataset.nxAccountState = on ? 'on' : 'off';
            if (busy) { btn.setAttribute('aria-busy', 'true'); btn.dataset.favState = 'loading'; }
            else { btn.removeAttribute('aria-busy'); if (!opts.keepFlash) delete btn.dataset.favState; }
            btn.title = busy ? (on ? 'Removing from favorites…' : 'Saving to favorites…') : favTitleFor(on);
        });
    }
    function favRenderAll () {
        document.querySelectorAll('figure.thumb[data-wallpaper-id]').forEach(f => favRender(f.getAttribute('data-wallpaper-id')));
    }
    /* transient success/error feedback on top of the real state */
    function favFlash (id, kind, msg) {
        id = String(id);
        document.querySelectorAll('figure.thumb[data-wallpaper-id="' + id + '"] .nx-fav').forEach(btn => {
            btn.dataset.favState = kind;
            if (kind === 'error') btn.classList.add('nx-fav-err');
            clearTimeout(btn._favFlashT);
            btn._favFlashT = setTimeout(() => {
                if (btn.isConnected) { delete btn.dataset.favState; btn.classList.remove('nx-fav-err'); btn.title = favTitleFor(FavState.isOn(id)); }
            }, kind === 'error' ? 1700 : 750);
        });
        if (msg) favNotice(msg, kind === 'error' ? 'error' : 'ok');
    }

    /* ─── per-wallpaper operation lock ──────────────────────────
     * Every mutation for one wallpaper runs exclusively: the op in
     * flight owns the truth; taps that arrive meanwhile coalesce
     * into ONE pending toggle that re-reads the state when its turn
     * comes. Overlapping responses can not overwrite each other,
     * and a burst of taps resolves to at most two server ops. */
    const _favOps  = new Map();     // wid → in-flight promise
    const _favPend = new Set();     // wid → one coalesced follow-up toggle
    function favRun (id, fn) {
        id = String(id);
        const prev = _favOps.get(id) || Promise.resolve();
        let p;
        p = prev.then(async () => {
            favRender(id);                                   // busy state on (entry already set)
            try { await fn(); }
            catch (e) { console.error('[naXim Labs] favorite operation failed', e); }
            finally {
                if (_favOps.get(id) === p) _favOps.delete(id);   // never delete a newer op's entry
                favRender(id);                                   // busy state off
                if (_favPend.delete(id)) favToggle(id);          // one coalesced follow-up
            }
        });
        _favOps.set(id, p);
        return p;
    }

    /* ─── operations ──────────────────────────────────────────── */

    /* Resolve the wallpaper's ACTUAL collections by walking every
     * collection until it is located — and record every membership
     * the pages reveal, so the expensive case doubles as an index
     * build. Collections are checked in parallel (the walk pool
     * still caps total concurrency). */
    async function favResolveExhaustive (id) {
        const cat = await favGetCatalog(true);          // fresh — this is the correctness path
        const found = [];
        await Promise.all(cat.list.map(async c => {
            let complete = false, count = 0;
            const r = await favWalkCollection(c.id, {
                wid: id,
                count: c.count,
                onPage: figs => { count += figs.length; figs.forEach(f => FavState.addCol(f.getAttribute('data-wallpaper-id'), c.id)); },
            });
            if (r.complete) { complete = true; count = r.count; }
            if (complete) FavState.noteWalk(c.id, count);
            if (r.found) found.push({ cid: String(c.id), link: r.delLink });
        }));
        return found;
    }

    /* ADD — to a real collection, chosen by the Quick-Save target or
     * the picker row. The token is fresh; a rotated CSRF (419) is
     * retried exactly once with a brand-new catalog. */
    async function favAdd (id, cid, opts = {}) {
        const cat = await favGetCatalog();
        const col = cat.list.find(c => String(c.id) === String(cid));
        if (!col) {
            if (opts.quick) { quickSave(null); refreshQuickStates(); favRenderAll(); }
            throw new Error('That collection no longer exists — hold the star to pick another.');
        }
        const build = c => 'https://wallhaven.cc/favorites/add?wallHashid=' + encodeURIComponent(id) +
                           '&collectionId=' + encodeURIComponent(c.id) + '&_token=' + encodeURIComponent(cat.token);
        try { await favRequestMethod(build(col), 'POST'); }
        catch (e) {
            if (e && e.status === 419) {                       // token rotated mid-session
                const cat2 = await favGetCatalog(true);
                const col2 = cat2.list.find(c => String(c.id) === String(cid));
                if (!col2) throw new Error('That collection no longer exists — hold the star to pick another.');
                await favRequestMethod('https://wallhaven.cc/favorites/add?wallHashid=' + encodeURIComponent(id) +
                    '&collectionId=' + encodeURIComponent(col2.id) + '&_token=' + encodeURIComponent(cat2.token), 'POST');
            } else throw e;
        }
        FavState.addCol(id, col.id);
        favFlash(id, 'success', 'Saved to ' + col.name);
    }

    /* REMOVE — from wherever the wallpaper ACTUALLY is. The
     * Quick-Save target is never consulted. */
    async function favRemove (id) {
        const known = FavState.locsFull(id);                  // null = not trustworthy yet
        let entries;
        if (known == null) {
            entries = await favResolveExhaustive(id);          // walk every collection, record truth
        } else {
            entries = [];
            for (const cid of known) {
                /* no count hint here: a cached count may predate this
                 * session, and a stale-low count could stop the walk
                 * one page short of the wallpaper — correctness first */
                const r = await favWalkCollection(cid, { wid: id });
                if (r.found) entries.push({ cid: String(cid), link: r.delLink });
                /* not found → stale record entry; the wholesale
                 * setCols below drops it */
            }
        }
        const withLink = entries.filter(e => e.link);
        const noLink   = entries.filter(e => !e.link);
        let removed = 0;
        for (const e of withLink) {
            try { await favRequestMethod(e.link, 'GET'); removed++; }
            catch (err) { if (!err || err.status !== 404) throw err; removed++; }   // 404 = already gone
        }
        /* everything with a link is now gone; anything without a
         * link stays recorded (it could not be removed) */
        FavState.setCols(id, noLink.map(e => e.cid));
        if (noLink.length) {
            favFlash(id, 'error', 'Removed from ' + removed + ' collection' + (removed === 1 ? '' : 's') +
                      ', but ' + noLink.length + ' could not be reached — try again in a moment.');
            return;
        }
        favFlash(id, 'success',
            removed === 0 ? 'It was not in your collections — the star is refreshed now.'
          : removed === 1 ? 'Removed from favorites'
          : 'Removed from ' + removed + ' collections');
    }

    /* The star tap: ONE decision, read from live state at execution
     * time — add via the configured flow, or remove immediately.
     * Already-favorited never opens the picker. A tap while an op is
     * in flight coalesces into a single follow-up toggle instead of
     * queueing unbounded work. */
    async function favDecide (id) {
        if (FavState.isOn(id)) {
            try { await favRemove(id); }
            catch (e) { favFlash(id, 'error', (e && e.message) || 'Removal failed'); }
        } else {
            const q = quickLoad();
            if (q) {
                try { await favAdd(id, q.id, { quick: true }); }
                catch (e) { favFlash(id, 'error', (e && e.message) || 'Save failed'); }
            } else await openFavManager(id);                    // manual flow — the picker belongs to adding
        }
    }
    function favToggle (id) {
        id = String(id);
        if (favLoggedOut()) { favNotice('Log in to Wallhaven to save favorites', 'error'); return Promise.resolve(); }
        if (_favOps.has(id)) { _favPend.add(id); return _favOps.get(id); }
        return favRun(id, () => favDecide(id));
    }

    /* ─── Quick-Save target — one stored value, the only source ── */
    const QUICK_FAV_KEY    = 'gf_quick_fav_collection_v713';
    const QUICK_NOTICE_KEY = 'gf_quick_fav_notice_v713';
    const quickLoad = () => { try { const v = GM_getValue(QUICK_FAV_KEY, null); return v && v.id ? v : null; } catch { return null; } };
    const quickSave = v => { try { v ? GM_setValue(QUICK_FAV_KEY, v) : GM_deleteValue(QUICK_FAV_KEY); } catch {} };

    /* Other tabs: keep their stars and pickers in agreement with a
     * target changed elsewhere (Tampermonkey broadcasts changes). */
    if (typeof GM_addValueChangeListener === 'function') {
        try { GM_addValueChangeListener(QUICK_FAV_KEY, () => { refreshQuickStates(); favRenderAll(); }); } catch {}
    }

    function favNotice (msg, kind) {
        let el = document.getElementById('nx-fav-notice');
        if (!el) { el = document.createElement('div'); el.id = 'nx-fav-notice'; document.body.appendChild(el); }
        el.textContent = msg; el.dataset.kind = kind || 'info'; el.classList.add('show');
        clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove('show'), 3800);
    }
    function favHideOverlay () {
        const ov = document.getElementById('overlay');
        if (!ov) return;
        ov.classList.add('overlay-hidden');
        const inner = ov.querySelector('.overlay-inner');
        if (inner) setTimeout(() => { if (ov.classList.contains('overlay-hidden')) inner.innerHTML = ''; }, 500);
    }

    /* ─── Collection picker — the ADD flow's destination chooser ──
     *
     * Structure mirrors wh-core's own views exactly, so the frame,
     * the backdrop-click close and the delegated .overlay-close
     * handler remain wallhaven's own:
     *   .overlay-inner > .overlay-header  (title + close)
     *                   > .overlay-content (51px top padding clears
     *                                      the title bar; scrolls)
     * One dialog, orthogonal actions per collection:
     *   • tap the row → save THIS wallpaper to that collection
     *   • tap the ⚡  → make that collection the one-tap Quick-Save
     *                  target (exactly one active; tapping the active
     *                  one turns Quick-Save off)
     * Rows holding the wallpaper already show a "Saved" chip,
     * re-derived from FavState on every render. */
    let _pickerSeq = 0;   // invalidates renders from superseded opens

    function pickerIsActive (id) {
        const ov = document.getElementById('overlay');
        if (!ov || ov.classList.contains('overlay-hidden')) return false;
        const box = ov.querySelector('.overlay-inner .nx-picker');
        return !!(box && box.dataset.wallId === id);
    }

    function renderPicker (id) {
        const ov = document.getElementById('overlay'), inner = ov && ov.querySelector('.overlay-inner');
        if (!ov || !inner) throw new Error('Wallhaven overlay is unavailable');
        bindFavOverlayEscape();
        inner.innerHTML = '';
        const header = document.createElement('header'); header.className = 'overlay-header';
        const title = document.createElement('h2'); title.className = 'overlay-title'; title.textContent = 'Save to collection';
        const close = document.createElement('a');
        close.className = 'jsAnchor overlay-close'; close.id = 'overlay-close';
        close.title = 'Close (Esc)';
        close.setAttribute('role', 'button');
        close.setAttribute('tabindex', '0');
        close.setAttribute('aria-label', 'Close');
        close.innerHTML = IC.x;
        close.addEventListener('click', ev => { ev.preventDefault(); favHideOverlay(); });
        close.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); close.click(); } });
        header.append(title, close);
        const content = document.createElement('div'); content.className = 'overlay-content';
        const box = document.createElement('div'); box.className = 'nx-picker'; box.dataset.wallId = id;
        content.appendChild(box);
        inner.append(header, content);
        ov.classList.remove('overlay-hidden');
        close.focus({ preventScroll: true });
        return box;
    }

    /* Context header — which wallpaper the picker is about. */
    function pickerHead (box, id) {
        const top = mk('div', 'nx-picker-top');
        const img = mk('img', 'nx-picker-thumb');
        img.src = deriveThumb(id); img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => { img.remove(); });
        const tt = mk('div', 'nx-picker-tt');
        const h = mk('strong');
        h.textContent = 'Save this wallpaper';
        const hash = mk('i'); hash.textContent = '#' + id;
        h.appendChild(hash);
        const s = mk('span');
        s.textContent = 'Tap a row to save it there · ⚡ sets your Quick-Save target.';
        tt.append(h, s);
        top.append(img, tt);
        box.appendChild(top);
    }

    function pickerLoading (box, id) {
        box.textContent = '';
        pickerHead(box, id);
        const l = mk('div', 'nx-picker-loading');
        const sp = mk('span', 'nx-spin'); sp.setAttribute('aria-hidden', 'true');
        const t = mk('span'); t.textContent = 'Loading your collections…';
        l.append(sp, t);
        box.appendChild(l);
    }

    function pickerError (box, err, retry) {
        box.textContent = '';
        pickerHead(box, box.dataset.wallId);
        const e = mk('div', 'nx-picker-error');
        const p = mk('p'); p.textContent = (err && err.message) || 'Could not load your collections.';
        const b = mk('button', 'nx-picker-retry'); b.type = 'button'; b.textContent = 'Try again';
        b.addEventListener('click', retry);
        e.append(p, b);
        box.appendChild(e);
    }

    function pickerFill (box, id, cols) {
        if (!box.isConnected) return;
        box.textContent = '';
        pickerHead(box, id);
        const list = mk('div', 'nx-picker-list');
        cols.forEach(c => {
            const row = mk('div', 'nx-picker-row');
            row.setAttribute('role', 'button');
            row.tabIndex = 0;
            row.dataset.cid = String(c.id);
            row.title = 'Save to “' + c.name + '”';
            const name = mk('span', 'nx-picker-name'); name.textContent = c.name;
            const saved = mk('span', 'nx-picker-saved'); saved.textContent = 'Saved';
            const qs = mk('button', 'nx-picker-qs'); qs.type = 'button';
            qs.innerHTML = IC.bolt;
            const lbl = mk('span'); lbl.textContent = 'Quick-Save';
            qs.appendChild(lbl);
            row.append(name, saved, qs);
            row.addEventListener('click', () => saveToCollection(id, c, row));
            row.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); row.click(); } });
            qs.addEventListener('click', ev => { ev.stopPropagation(); toggleQuickTarget(c); });
            list.appendChild(row);
        });
        box.appendChild(list);
        const foot = mk('div', 'nx-picker-foot');
        const status = mk('span', 'nx-picker-status');
        foot.appendChild(status);
        box.appendChild(foot);
        refreshQuickStates();
    }

    /* Single render pass over the open picker — re-derives every
     * active/current state and the status line from quickLoad() and
     * FavState, so there is no way for the UI and the stored truth
     * to diverge. */
    function refreshQuickStates () {
        const box = document.querySelector('.overlay-inner .nx-picker');
        if (!box) return;
        const q = quickLoad();
        const cur = FavState.locsDisplay(box.dataset.wallId);
        box.querySelectorAll('.nx-picker-row').forEach(row => {
            const cid = String(row.dataset.cid);
            const active = !!q && cid === String(q.id);
            const holds = !!(cur && cur.includes(cid));
            const name = row.querySelector('.nx-picker-name');
            const label = 'Save to ' + ((name && name.textContent) || 'collection');
            row.classList.toggle('active', active);
            row.classList.toggle('current', holds);
            row.setAttribute('aria-label', (holds ? 'Currently saved here — ' : '') + label + (active ? ' — Quick-Save target' : ''));
            const qs = row.querySelector('.nx-picker-qs');
            if (qs) {
                qs.setAttribute('aria-pressed', String(active));
                qs.title = active ? 'Quick-Save target — click to turn off' : 'Make this the Quick-Save target';
            }
            const saved = row.querySelector('.nx-picker-saved');
            if (saved) saved.style.display = holds ? '' : 'none';
        });
        const status = box.querySelector('.nx-picker-status');
        if (status) {
            status.textContent = '';
            if (q) {
                status.append('Quick-Save is ON — one tap on the ★ saves to ');
                const b = mk('b'); b.textContent = q.name || 'collection';
                status.append(b, '. Tapping a favorited ★ always removes it.');
            } else {
                status.textContent = 'Tap ⚡ on a collection to make it your one-tap Quick-Save target for the ★.';
            }
        }
    }

    /* The only writer of the Quick-Save target besides favAdd's
     * self-healing invalidation — one call, one stored value. */
    function toggleQuickTarget (c) {
        const cur = quickLoad();
        if (cur && String(cur.id) === String(c.id)) {
            quickSave(null);
            favNotice('Quick-Save off — tapping the ★ now opens this picker', 'ok');
        } else {
            quickSave({ id: String(c.id), name: c.name, href: c.href || '' });
            const first = !GM_getValue(QUICK_NOTICE_KEY, false);
            GM_setValue(QUICK_NOTICE_KEY, true);
            favNotice(first ? 'Quick-Save target: ' + c.name + ' — one tap on the ★ saves there. Hold the ★ to change.'
                            : 'Quick-Save target: ' + c.name, 'ok');
        }
        refreshQuickStates();
        favRenderAll();     // star tooltips name the new target
    }

    function saveToCollection (id, c, row) {
        if (row.classList.contains('busy')) return;
        const qs = row.querySelector('.nx-picker-qs');
        const spin = mk('span', 'nx-spin');
        row.classList.add('busy');
        if (qs) qs.appendChild(spin);
        favRun(id, async () => {
            try {
                await favAdd(id, c.id);
                favHideOverlay();
            } catch (e) {
                row.classList.remove('busy');
                spin.remove();
                favNotice((e && e.message) || 'Save failed', 'error');
            }
        });
    }

    async function pickerLoad (box, id) {
        const seq = ++_pickerSeq;
        pickerLoading(box, id);
        try {
            const cat = await favGetCatalog(true);            // the list must be live
            if (seq === _pickerSeq && box.isConnected) pickerFill(box, id, cat.list);
            FavState.ensureIndexSoon();                       // piggyback validation on the fresh catalog
        } catch (e) {
            if (seq === _pickerSeq && box.isConnected) pickerError(box, e, () => pickerLoad(box, id));
        }
    }

    /* Opens the picker NOW (instant shell + loading state) — called
     * from the hold timer the moment the threshold is reached, and
     * from a plain star tap when the wallpaper is NOT favorited and
     * no Quick-Save target is set. */
    async function openFavManager (id) {
        if (favLoggedOut()) { favNotice('Log in to Wallhaven to save favorites', 'error'); return; }
        if (pickerIsActive(id)) return;   // already showing this wallpaper
        let box;
        try { box = renderPicker(id); }
        catch (e) { favNotice((e && e.message) || 'Could not open the collection picker', 'error'); return; }
        pickerLoad(box, id);
    }

    /* ─── Star interaction: tap vs deliberate hold ────────────────
     *
     * One pointer state machine per star, bound exactly once per
     * element (WeakSet guard — cloneNode restores in clearGrid and
     * re-runs of the upgrader can never double-bind).
     *
     *   press ── 400 ms ──▶ picker opens AT the threshold, while the
     *                      star is still held (loading state first)
     *   release < 400 ms ─▶ normal tap action
     *   release after ───▶ swallow the ghost click (time-boxed
     *                      window — no stale DOM flag left behind to
     *                      eat a later, unrelated click)
     *
     * Movement: 9 px of slop is forgiven; beyond that (or on
     * pointercancel, i.e. a scroll/drag gesture taking over) the
     * hold cancels. Only the primary mouse button holds. On touch,
     * the long-press context menu is suppressed while the hold is
     * alive. */
    const FAV_HOLD_MS = 400;        // deliberate-hold threshold (keep in sync with .nx-holding CSS)
    const FAV_HOLD_SLOP = 9;         // px of tolerated movement
    const FAV_SWALLOW_MS = 600;      // post-hold ghost-click window
    const _favAnchorsBound = new WeakSet();

    function bindFavAnchor (a) {
        if (!a || _favAnchorsBound.has(a)) return;
        _favAnchorsBound.add(a);

        const st = { timer: 0, x: 0, y: 0, firedAt: 0 };

        const clearHold = () => {
            if (st.timer) { clearTimeout(st.timer); st.timer = 0; a.classList.remove('nx-holding'); }
        };

        const fireHold = () => {
            st.timer = 0;
            st.firedAt = Date.now();
            a.classList.remove('nx-holding');
            const f = a.closest('figure.thumb');
            const id = f && f.getAttribute('data-wallpaper-id');
            if (id) openFavManager(id);
        };

        a.addEventListener('pointerdown', (e) => {
            st.firedAt = 0;                                         // new interaction resets suppression
            if (e.pointerType === 'mouse' && e.button !== 0) return; // primary mouse button only
            clearHold();
            st.x = e.clientX; st.y = e.clientY;
            a.classList.add('nx-holding');
            st.timer = setTimeout(fireHold, FAV_HOLD_MS);
        }, { passive: true });

        a.addEventListener('pointermove', (e) => {
            if (!st.timer) return;
            const dx = e.clientX - st.x, dy = e.clientY - st.y;
            if (dx * dx + dy * dy > FAV_HOLD_SLOP * FAV_HOLD_SLOP) clearHold();   // drag/scroll, not a hold
        }, { passive: true });

        ['pointerup', 'pointercancel', 'pointerleave'].forEach(t =>
            a.addEventListener(t, clearHold, { passive: true }));

        a.addEventListener('contextmenu', (e) => {
            if (st.timer || Date.now() - st.firedAt < FAV_SWALLOW_MS) e.preventDefault();   // keep touch long-press clean
        });

        a.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (st.timer) clearHold();                             // released before the threshold
            if (Date.now() - st.firedAt < FAV_SWALLOW_MS) return;  // release after the hold opened the picker
            const f = a.closest('figure.thumb');
            const id = f && f.getAttribute('data-wallpaper-id');
            if (!id) return;
            favToggle(id);   // add-or-remove, decided from live state under the per-wallpaper lock
        }, true);
        a.addEventListener('keydown', (e) => {                    // Space activates the star like a button
            if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); a.click(); }
        });
    }

    function bindAllFavAnchors () { document.querySelectorAll('figure.thumb .nx-fav, figure.thumb .wall-favs').forEach(bindFavAnchor); }

    /* Escape-to-close for modals this script shows itself. wh-core
     * binds its body-level Escape handler only from its own show()
     * path, so a picker rendered directly into #overlay must wire its
     * own. Bound once; coexists safely with wh-core's handler (both
     * are idempotent hides). */
    let _favEscBound = false;
    function bindFavOverlayEscape () {
        if (_favEscBound) return;
        _favEscBound = true;
        document.addEventListener('keydown', (e) => {
            const k = e.key;
            if (e.keyCode !== 27 && k !== 'Escape' && k !== 'Esc') return;
            const ov = document.getElementById('overlay');
            if (!ov || ov.classList.contains('overlay-hidden')) return;
            e.preventDefault();
            ov.classList.add('overlay-hidden');
            const inner = ov.querySelector('.overlay-inner');
            /* mirror wh-core's hide(): empty the content 500 ms later */
            if (inner) setTimeout(() => { if (ov.classList.contains('overlay-hidden')) inner.innerHTML = ''; }, 500);
        }, true);
    }

    /* Turn the card's star into the restyled native overlay-anchor.
     * Server truth (.faved) wins over the local mirror; the mirror
     * decides only when the page shows no .faved marker anywhere. */
    function upgradeFavoriteButton (fig) {
        if (fig.classList.contains('nx-card')) return;   // scan cards build their own
        const id = fig.getAttribute('data-wallpaper-id');
        const info = fig.querySelector(':scope > .thumb-info');
        const old = info && info.querySelector(':scope > .wall-favs');
        if (!id || !info || !old) return;
        const serverFaved = old.classList.contains('faved');
        const count = favParseCount(old);
        /* The server marker is the freshest account hint — record it
         * as a seed, then let the index upgrade it (a wallpaper in a
         * custom collection the marker missed still counts as on). */
        FavState.markSeed(id, serverFaved);
        const on = FavState.isOn(id);
        let a;
        if (old.tagName !== 'A') {
            /* 0-favorite wallpapers render as a bare <span> — rebuild
             * them as the very anchor wallhaven itself uses for its
             * clickable star (every card becomes favoritable). */
            a = document.createElement('a');
            a.className = 'jsAnchor overlay-anchor wall-favs nx-fav' + (on ? ' on' : '') + (serverFaved ? ' faved' : '');
            a.setAttribute('data-href', FAV_URL(id));
            a.innerHTML = '<span class="nx-fav-n">' + count.toLocaleString() + '</span>' + IC.star;
            old.replaceWith(a);
        } else {
            a = old;
            a.classList.add('jsAnchor', 'overlay-anchor', 'nx-fav');
            a.classList.toggle('on', on);
            a.setAttribute('data-href', FAV_URL(id));
            if (!a.querySelector('.nx-fav-n')) {
                a.innerHTML = '<span class="nx-fav-n">' + count.toLocaleString() + '</span>' + IC.star;
            } else {
                const n = a.querySelector('.nx-fav-n');
                n.textContent = count.toLocaleString();
                if (!a.querySelector('svg')) n.insertAdjacentHTML('afterend', IC.star);
            }
        }
        a.setAttribute('href', FAV_URL(id));
        a.setAttribute('role', 'button');
        a.setAttribute('tabindex', '0');
        a.setAttribute('aria-label', 'Favorite wallpaper');
        a.setAttribute('aria-pressed', String(on));
        a.title = favTitleFor(on);
        bindFavAnchor(a);
    }

    function upgradeVisibleFavoriteButtons () {
        document.querySelectorAll('figure.thumb').forEach(upgradeFavoriteButton);
        bindAllFavAnchors();
    }


    /* ═══ DOWNLOAD MANAGER — real circular progress ═══════════════ */

    const DL = (() => {
        /* ═══ v7.5.0 SETTINGS + PARALLEL QUEUE + TELEMETRY ═════════
         * The queue lives in GM storage and is rebuilt on every load —
         * refreshes, tab closures and browser restarts no longer lose
         * pending work.
         *
         * MODEL — one envelope (gf_dlq_v1): { v, rev, base, seq, items[], gone{} }
         *   • items[] is the full queue in strict chronological order —
         *     (seq, id) — the exact global order wallpapers were added
         *     in, across tabs. The in-memory map mirrors that order.
         *   • gone{} maps dismissed ids → timestamp (tombstones) so a
         *     conscious removal is never mistaken for a stale
         *     concurrent write, and vice versa (10-minute TTL).
         *   • rev/base version every write and record the version it
         *     started from, so a reader can tell whether a writer could
         *     have even seen a given item (base >= the item's revAt).
         *
         * SETTINGS — a SECOND, tiny store (gf_dlq_cfg_v1) keeps user
         *   preferences OUT of the queue envelope, so changing a
         *   setting never churns queue revisions or disturbs executing
         *   items: { conc, paused, notif, files, bytes }.
         *   • conc — parallel transfers, 1..MAX_LIVE. Default 1 =
         *     strictly one-by-one (FIFO), exactly as requested. Raise
         *     it live and the pump fills the new slots immediately;
         *     lower it and in-flight transfers finish naturally.
         *   • paused — a TRUE pause: in-flight transfers are aborted
         *     and requeued at their FIFO position (save-step files —
         *     fully downloaded, mid-save — land instead of
         *     restarting); every tab honors the hold the instant it
         *     is set, through its own remote listener. Adding a new
         *     download while paused auto-resumes: a fresh click is a
         *     clear statement of intent.
         *   • notif — desktop notification when the queue drains.
         *   • files/bytes — lifetime counters, updated once per
         *     completed file.
         *   The settings UI lives in the TOP naXim Labs panel
         *     (Downloads section); the queue pane is action-only —
         *     pause/resume, retry-all, clear-failed, clear-all.
         *     Settings sync cross-tab through their own value-change
         *     listener — no echo loops, no queue-store traffic.
         *
         * OWNERSHIP — the tab that adds a download executes it. Items
         * orphaned by a dead tab are re-claimed by a live one. Death is
         * proven two ways: the localStorage death ring (pagehide drops
         * a synchronous note — the async GM bridge can lose a dying
         * page's last write, localStorage never does) or registry
         * silence (TAB_STALE — a live heartbeat always vetoes, so a
         * throttled background tab is never robbed mid-transfer).
         * Claims are write-then-verify; executing items are immune to
         * foreign merges — exactly one tab ever transfers a given file.
         *
         * WRITES — state transitions persist immediately (add, claim,
         * retry, done, fail, dismiss); progress coalesces to >= 1 s or
         * >= 5% deltas and rides a 250 ms debounce. GM_setValue failures
         * degrade to volatile operation — never a crash. Object URLs
         * are revoked on every exit path; nothing executable is ever
         * persisted (no xhr handles, no blob URLs).
         *
         * FAILURES — transient errors keep the auto-retry ladder (4
         * tries, 700/1800/4200 ms backoff). A really failed item STAYS:
         * red row, error detail, Retry and Dismiss. Success behavior is
         * unchanged: the previewer fades out gracefully on completion. */

        /* Timing/policy knobs live here so the stress suite can run the
         * REAL engine on fast-forward (window.__NX_DL_TEST__ override —
         * never set in production). */
        const DTC = Object.assign({
            MAX_TRIES : 4,
            BACKOFF   : [700, 1800, 4200],
            REVOKE_MS : 30000,
            GDL_REVOKE_MS : 5000,     /* grace after a native save completes */
            MAX_LIVE  : 6,          /* absolute ceiling; the user setting lives in cfg */
            FLUSH_MS  : 250,        /* write debounce */
            PROG_MS   : 1000,       /* min progress-persist interval */
            PROG_PCT  : 0.05,       /* min progress-persist delta */
            CLAIM_MS  : 150,        /* claim verify window */
            FADE_MS   : 500,        /* done-row grace before fading */
            DONE_TTL  : 90000,      /* done entries linger for cross-tab sync */
            TAB_STALE : 75000,      /* owner unseen this long = dead */
            DIED_TTL  : 86400000,   /* death-note retention */
            DIED_MAX   : 12,        /* death-note ring size */
            HEARTBEAT : 10000,      /* liveness ping while owning work */
            WATCHDOG  : 20000,      /* stall/reconcile sweep */
            ITEM_CAP  : 400,        /* hard store bound */
            GONE_TTL  : 600000,     /* tombstone lifetime */
            K_Q       : 'gf_dlq_v1',
            K_TABS    : 'gf_dltabs_v1',
            K_CORRUPT : 'gf_dlq_corrupt_last',
            K_DIED    : 'gf_dlq_died_v1',   /* localStorage death ring */
            K_CFG     : 'gf_dlq_cfg_v1',    /* settings + lifetime stats */
        }, (typeof window !== 'undefined' && window.__NX_DL_TEST__) || {});

        const items = new Map();           /* id → item; map order = (seq, id) */
        const rows  = new Map();
        const gone  = new Map();            /* dismissed ids → ts (tombstones) */
        const progAt = new Map(), progPct = new Map();
        let root = null, pill = null, list = null, cnt = null, pfg = null;
        let bar = null, rowsBox = null;
        let pauseBtn = null, barInfo = null, rtaBtn = null, clrBtn = null, trashBtn = null;
        let expanded = false, raf = 0, booted = false;
        const TAB_ID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        let rev = 0, base = 0, seq = 0;     /* store versions + global add counter */
        let dirty = false, flushT = 0, claimT = 0, wdT = 0, hbT = 0, liveCount = 0;
        const PC = 2 * Math.PI * 15.5;
        const RC = 2 * Math.PI * 8;

        /* ─── settings (separate tiny store) ─────────────────────── */

        let cfg = cfgAdopt(GM_getValue(DTC.K_CFG, ''));

        function cfgAdopt (raw) {
            let o = null;
            try { o = JSON.parse(raw); } catch {}
            const c = { conc: 1, paused: false, notif: true, files: 0, bytes: 0 };
            if (o && typeof o === 'object') {
                const n = parseInt(o.conc, 10);
                if (isFinite(n)) c.conc = Math.max(1, Math.min(DTC.MAX_LIVE, n));   /* clamp, never trust */
                c.paused = !!o.paused;
                c.notif = o.notif !== false;            /* default ON */
                if (typeof o.files === 'number' && isFinite(o.files) && o.files >= 0 && o.files < 1e9)  c.files  = Math.floor(o.files);
                if (typeof o.bytes === 'number' && isFinite(o.bytes) && o.bytes >= 0 && o.bytes < 1e15) c.bytes = Math.floor(o.bytes);
            }
            return c;
        }
        function cfgWrite () { try { GM_setValue(DTC.K_CFG, JSON.stringify(cfg)); } catch {} }
        function concOf () { return Math.max(1, Math.min(DTC.MAX_LIVE, cfg.conc | 0)); }

        const cfgSubs = [];                       /* settings consumers (top panel) */

        function statsText () {
            const f = cfg.files || 0;
            return f + (f === 1 ? ' file saved · ' : ' files saved · ') + fmtBytes(cfg.bytes || 0) + ' all-time';
        }
        function snapshot () {
            return { conc: cfg.conc, paused: cfg.paused, notif: cfg.notif,
                     files: cfg.files, bytes: cfg.bytes, max: DTC.MAX_LIVE,
                     statsText: statsText() };
        }
        function notifyCfg () { for (const cb of cfgSubs) { try { cb(); } catch {} } }
        function onCfg (cb) { if (typeof cb === 'function') cfgSubs.push(cb); }

        function holdWork () {
            /* TRUE pause — abort my in-flight transfers and put them
             * back at their FIFO position. Save-step files (gdl) are
             * fully downloaded; they land, not restart. Aborted
             * requests fire their stale handlers later, but every
             * handler is state-guarded, so a late arrival can never
             * double-fire a transition. */
            let touched = false;
            for (const it of items.values()) {
                if (it.owner !== TAB_ID) continue;
                if (it.state !== 'meta' && it.state !== 'down') continue;
                if (it.gdl) continue;                       /* mid-save — let it land */
                it.state = 'queued';
                clearTimeout(it.backT); it.backT = 0; it.nextTryAt = 0;
                it.spd = 0; it.pLoad = 0; it.loaded = 0; it.total = 0;
                dropSlot(it);
                const x = it.xhr; it.xhr = null;
                if (x) { try { x.abort(); } catch {} }
                touched = true;
            }
            if (touched) persistNow();
            schedule();
        }

        function setCfg (patch) {
            if (patch && typeof patch === 'object') {
                if (patch.conc !== undefined) {
                    const n = parseInt(patch.conc, 10);
                    if (isFinite(n)) cfg.conc = Math.max(1, Math.min(DTC.MAX_LIVE, n));   /* clamp */
                }
                if (patch.paused !== undefined) {
                    const p = !!patch.paused;
                    if (p && !cfg.paused) { cfg.paused = true; holdWork(); }   /* rising edge: stop the world */
                    else cfg.paused = p;
                }
                if (patch.notif  !== undefined) cfg.notif  = !!patch.notif;
                cfgWrite();
                refreshSettingsUI();
                schedule(); pump();               /* new slots fill now; shrink takes effect as slots free */
            }
            return snapshot();
        }
        function onCfgRemote () {
            const fresh = cfgAdopt(GM_getValue(DTC.K_CFG, ''));
            const changed = fresh.conc !== cfg.conc || fresh.paused !== cfg.paused || fresh.notif !== cfg.notif;
            const rising  = fresh.paused && !cfg.paused;
            cfg = fresh;
            if (rising) holdWork();              /* a pause is honored everywhere, instantly */
            refreshSettingsUI();
            if (changed) { schedule(); pump(); }
        }
        function refreshSettingsUI () {
            if (pauseBtn) {
                pauseBtn.innerHTML = cfg.paused ? IC.play : IC.pause;
                pauseBtn.title = cfg.paused ? 'Resume queue' : 'Pause queue';
                pauseBtn.setAttribute('aria-label', pauseBtn.title);
                pauseBtn.setAttribute('aria-pressed', cfg.paused ? 'true' : 'false');
            }
            notifyCfg();                        /* top-panel settings repaint */
        }

        /* ─── UI ─────────────────────────────────────────────────── */

        function build () {
            root = mk('div', 'nx-dlm');
            list = mk('div', 'nx-dlm-list');

            bar = mk('div', 'nx-dlm-bar');
            pauseBtn = mk('button', 'nx-dlm-act nx-pause'); pauseBtn.type = 'button';
            pauseBtn.addEventListener('click', () => setCfg({ paused: !cfg.paused }));
            barInfo = mk('span', 'nx-dlm-info');
            rtaBtn = mk('button', 'nx-dlm-act nx-rta'); rtaBtn.type = 'button';
            rtaBtn.title = 'Retry all failed'; rtaBtn.setAttribute('aria-label', 'Retry all failed downloads');
            rtaBtn.innerHTML = IC.retry;
            rtaBtn.addEventListener('click', () => retryAll());
            rtaBtn.hidden = true;
            clrBtn = mk('button', 'nx-dlm-act nx-clr'); clrBtn.type = 'button';
            clrBtn.title = 'Clear failed'; clrBtn.setAttribute('aria-label', 'Clear failed downloads');
            clrBtn.innerHTML = IC.x;
            clrBtn.addEventListener('click', () => clearFailed());
            clrBtn.hidden = true;
            trashBtn = mk('button', 'nx-dlm-act nx-trash'); trashBtn.type = 'button';
            trashBtn.title = 'Clear all'; trashBtn.setAttribute('aria-label', 'Clear all downloads');
            trashBtn.innerHTML = IC.trash;
            let armT = 0;                        /* two-step confirm: no modal, no clutter */
            const disarm = () => {
                clearTimeout(armT); armT = 0;
                trashBtn.classList.remove('nx-armed');
                trashBtn.title = 'Clear all'; trashBtn.setAttribute('aria-label', 'Clear all downloads');
                trashBtn.innerHTML = IC.trash;
            };
            trashBtn.addEventListener('click', () => {
                if (trashBtn.classList.contains('nx-armed')) { disarm(); clearAll(); return; }
                trashBtn.classList.add('nx-armed');
                trashBtn.title = 'Click again to clear everything';
                trashBtn.setAttribute('aria-label', 'Clear all downloads — click again to confirm');
                trashBtn.innerHTML = IC.help;
                armT = setTimeout(disarm, 2600);
            });
            bar.append(pauseBtn, barInfo, rtaBtn, clrBtn, trashBtn);

            rowsBox = mk('div', 'nx-dlm-rows');

            list.append(bar, rowsBox);

            pill = mk('button', 'nx-dlm-pill'); pill.type = 'button';
            pill.setAttribute('aria-label', 'Download activity');
            pill.setAttribute('aria-expanded', 'false');
            const ring = mk('span', 'nx-dlm-ring');
            ring.innerHTML = '<svg viewBox="0 0 36 36"><circle class="nx-r-bg" cx="18" cy="18" r="15.5"/><circle class="nx-r-fg" cx="18" cy="18" r="15.5"/></svg>';
            pfg = ring.querySelector('.nx-r-fg');
            pfg.style.strokeDasharray = PC.toFixed(2);
            pfg.style.strokeDashoffset = PC.toFixed(2);
            cnt = mk('span', 'nx-dlm-count'); cnt.textContent = '0';
            ring.appendChild(cnt);
            pill.appendChild(ring);
            pill.addEventListener('click', () => {
                expanded = !expanded;
                root.classList.toggle('nx-open', expanded);
                pill.setAttribute('aria-expanded', expanded);
                render();
            });
            root.append(list, pill);
            document.body.appendChild(root);
            refreshSettingsUI();
        }

        function fmtBytes (b) {
            if (!b || b < 1024) return (b || 0) + ' B';
            if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
            if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
            return (b / 1073741824).toFixed(2) + ' GB';
        }
        function fmtRate (bpm) {                  /* bytes per millisecond → human */
            const bs = (bpm || 0) * 1000;
            if (bs < 1024) return Math.max(0, Math.round(bs)) + ' B/s';
            if (bs < 1048576) return (bs / 1024).toFixed(1) + ' KB/s';
            if (bs < 1073741824) return (bs / 1048576).toFixed(1) + ' MB/s';
            return (bs / 1073741824).toFixed(2) + ' GB/s';
        }
        function fmtDur (ms) {
            if (ms < 1000) return '<1s';
            const s = Math.round(ms / 1000);
            if (s < 60) return s + 's';
            const m = Math.floor(s / 60);
            if (m < 60) return m + 'm ' + (s % 60) + 's';
            const h = Math.floor(m / 60);
            return h + 'h ' + (m % 60) + 'm';
        }

        function setRing (fg, C, p, indet) {
            fg.classList.toggle('nx-indet', !!indet);
            fg.style.strokeDashoffset = (indet ? C * 0.75 : C * (1 - Math.min(1, Math.max(0, p || 0))).toFixed(2));
        }

        function aggregate () {
            let loaded = 0, total = 0, unknown = false, failed = 0, visible = 0, done = 0, waiting = 0, speed = 0;
            for (const it of items.values()) {
                if (it.uiGone) continue;
                visible++;
                if (it.state === 'done') { done++; continue; }
                if (it.state === 'fail') { failed++; continue; }
                if (it.state === 'queued' || it.state === 'retry') waiting++;
                else speed += it.spd || 0;                     /* meta/down */
                if (it.total > 0) { loaded += it.loaded; total += it.total; }
                else unknown = true;
            }
            return { active: visible - done - failed, exec: visible - done - failed - waiting,
                     waiting, done, failed, visible, speed,
                     p: total > 0 ? loaded / total : (unknown ? -1 : 0) };
        }

        function schedule () {
            if (raf) return;
            raf = window.requestAnimationFrame(() => { raf = 0; render(); });
        }

        function collapse () {
            expanded = false;
            if (root) { root.classList.remove('nx-open'); root.classList.remove('on'); }
            if (pill) pill.setAttribute('aria-expanded', 'false');
            if (rowsBox) rowsBox.textContent = '';
            rows.clear();
        }

        function render () {
            if (!root) return;
            const a = aggregate();
            root.classList.toggle('nx-paused', cfg.paused);
            if (!a.visible) { collapse(); return; }
            root.classList.add('on');
            cnt.textContent = String(a.visible);
            if (a.active === 0) setRing(pfg, PC, 1, false);
            else if (a.p < 0)   setRing(pfg, PC, 0, true);
            else                setRing(pfg, PC, a.p, false);
            pill.title = cfg.paused && a.active
                ? 'Paused — ' + a.active + ' item' + (a.active > 1 ? 's' : '') + ' waiting'
                : a.active
                    ? 'Downloading ' + a.exec + ' of ' + a.active +
                      (a.p >= 0 ? ' · ' + Math.round(a.p * 100) + '%' : '') +
                      (a.speed > 0 ? ' · ' + fmtRate(a.speed) : '')
                    : (a.failed
                         ? a.failed + ' download' + (a.failed > 1 ? 's' : '') + ' failed — open for Retry'
                         : 'Downloads complete');
            if (!expanded) {
                if (rows.size) { rowsBox.textContent = ''; rows.clear(); }
                return;
            }
            if (rtaBtn) rtaBtn.hidden = a.failed === 0;
            if (clrBtn) clrBtn.hidden = a.failed === 0;
            if (trashBtn) trashBtn.disabled = a.visible === 0;
            if (barInfo) {
                if (cfg.paused && a.active) barInfo.textContent = 'paused — ' + a.active + ' waiting';
                else if (a.exec > 0) {
                    let t = a.exec + ' of ' + a.active + ' running';
                    if (a.speed > 0) t += ' · ' + fmtRate(a.speed);
                    if (a.p >= 0)    t += ' · ' + Math.round(a.p * 100) + '%';
                    barInfo.textContent = t;
                }
                else if (a.failed > 0) barInfo.textContent = a.failed + ' failed';
                else if (a.done  > 0) barInfo.textContent = 'complete';
                else barInfo.textContent = '';
            }
            /* waiting positions — computed once per render, in queue order */
            const wpos = new Map();
            let wtot = 0;
            for (const it of items.values()) {
                if (it.uiGone || it.state !== 'queued') continue;
                wpos.set(it.id, ++wtot);
            }
            const now = Date.now();
            for (const it of items.values()) {
                if (it.uiGone) continue;
                const r = ensureRow(it);
                r.row.dataset.st = it.state;
                if (it.name && r.nm.textContent !== it.name) { r.nm.textContent = it.name; r.nm.title = it.name; }
                r.row.title = (it.name || 'wallhaven-' + it.id) + (it.err ? ' — ' + it.err : '');
                let sub = '';
                if (it.state === 'queued') {
                    const p = wpos.get(it.id) || 0;
                    sub = (cfg.paused ? 'paused' : 'waiting') +
                          (wtot > 1 && p ? ' — ' + p + ' of ' + wtot : '');
                }
                else if (it.state === 'meta')   sub = 'resolving…';
                else if (it.state === 'retry')  sub = 'retry ' + it.tries + '/' + DTC.MAX_TRIES +
                                                       (it.nextTryAt > now ? ' in ' + fmtDur(it.nextTryAt - now) : '');
                else if (it.state === 'done')   sub = 'saved' + (it.total > 0 ? ' · ' + fmtBytes(it.total) : '');
                else if (it.state === 'fail')   sub = it.err || 'failed';
                else {
                    const parts = [];
                    if (it.total > 0) parts.push(fmtBytes(it.loaded) + ' of ' + fmtBytes(it.total));
                    else if (it.loaded > 0) parts.push(fmtBytes(it.loaded));
                    if (it.spd > 0) {
                        parts.push(fmtRate(it.spd));
                        if (it.total > it.loaded) {
                            const e = (it.total - it.loaded) / it.spd;
                            if (isFinite(e) && e > 0) parts.push(fmtDur(e) + ' left');
                        }
                    }
                    sub = parts.length ? parts.join(' · ') : 'starting…';
                }
                if (r.sub.textContent !== sub) r.sub.textContent = sub;
                if (it.state === 'retry')       r.pct.textContent = '↻' + it.tries;
                else if (it.state === 'meta')   r.pct.textContent = '…';
                else if (it.state === 'queued') r.pct.textContent = 'wait';
                else if (it.state === 'done')   r.pct.textContent = '100%';
                else if (it.state === 'fail')   r.pct.textContent = 'failed';
                else if (it.total > 0)          r.pct.textContent = Math.min(100, Math.round(it.loaded / it.total * 100)) + '%';
                else                            r.pct.textContent = fmtBytes(it.loaded);
                if (it.state === 'done')        setRing(r.fg, RC, 1, false);
                else if (it.state === 'fail')   setRing(r.fg, RC, 0, false);
                else if (it.state === 'queued') setRing(r.fg, RC, 0, false);
                else if (it.total > 0)          setRing(r.fg, RC, it.loaded / it.total, false);
                else                            setRing(r.fg, RC, 0, true);
                const busy = it.state === 'meta' || it.state === 'down' || it.state === 'retry' || it.state === 'queued';
                r.xb.style.display = (busy || it.state === 'fail') ? '' : 'none';
                r.rt.style.display = it.state === 'fail' ? '' : 'none';
            }
            for (const [id, r] of [...rows]) {
                if (!items.has(id) || items.get(id).uiGone) { r.row.remove(); rows.delete(id); }
            }
        }

        function ensureRow (it) {
            let r = rows.get(it.id);
            if (r) return r;
            const row = mk('div', 'nx-dlm-row');
            const th = mk('img', 'nx-dlm-thumb');
            th.src = it.thumb; th.alt = ''; th.loading = 'lazy';
            const col = mk('div', 'nx-dlm-col');
            const nm = mk('span', 'nx-dlm-id');
            nm.textContent = it.name || ('wallhaven-' + it.id);
            nm.title = nm.textContent;
            const sub = mk('span', 'nx-dlm-sub');
            col.append(nm, sub);
            const pct = mk('span', 'nx-dlm-pct');
            const ring = mk('span', 'nx-dlm-rring');
            ring.innerHTML = '<svg viewBox="0 0 20 20"><circle class="nx-r-bg" cx="10" cy="10" r="8"/><circle class="nx-r-fg" cx="10" cy="10" r="8"/></svg>';
            const fg = ring.querySelector('.nx-r-fg');
            fg.style.strokeDasharray = RC.toFixed(2);
            fg.style.strokeDashoffset = RC.toFixed(2);
            const rt = mk('button', 'nx-dlm-x nx-dlm-rt'); rt.type = 'button';
            rt.title = 'Retry download'; rt.setAttribute('aria-label', 'Retry download');
            rt.innerHTML = IC.retry;
            rt.addEventListener('click', (ev) => { ev.stopPropagation(); retry(it.id); });
            const xb = mk('button', 'nx-dlm-x'); xb.type = 'button';
            xb.title = 'Cancel download'; xb.setAttribute('aria-label', 'Cancel download');
            xb.innerHTML = IC.x;
            xb.addEventListener('click', (ev) => { ev.stopPropagation(); cancel(it.id); });
            row.append(th, col, pct, ring, rt, xb);
            rowsBox.appendChild(row);
            r = { row, nm, sub, pct, fg, xb, rt };
            rows.set(it.id, r);
            return r;
        }

        /* ─── persistence ─────────────────────────────────────────── */

        function qRead () {
            let env = null;
            try { env = JSON.parse(GM_getValue(DTC.K_Q, '')); } catch { env = null; }
            if (!env || typeof env !== 'object' || !Array.isArray(env.items)) return null;
            if (typeof env.rev === 'number' && env.rev > base) base = env.rev;
            return env;
        }

        function persistOf (it) {
            return { id: it.id, seq: it.seq, state: it.state, name: it.name || '',
                     thumb: it.thumb || '', loaded: it.loaded || 0, total: it.total || 0,
                     tries: it.tries || 0, err: it.err || '', addedAt: it.addedAt || 0,
                     doneAt: it.doneAt || 0, owner: it.owner || '', ownerAt: it.ownerAt || 0 };
        }

        function qWrite () {
            try {
                rev = Math.max(rev, base) + 1;
                const env = { v: 1, rev: rev, base: base, seq: seq, items: [], gone: {} };
                for (const it of items.values()) { env.items.push(persistOf(it)); it.revAt = rev; }
                for (const [id, ts] of gone) if (Date.now() - ts < DTC.GONE_TTL) env.gone[id] = ts;
                GM_setValue(DTC.K_Q, JSON.stringify(env));
                touchTabs();
            } catch (e) { /* storage broken → keep running volatile */ }
        }

        function persistNow () { dirty = false; clearTimeout(flushT); flushT = 0; qWrite(); }
        function persistSoon () { dirty = true; if (!flushT) flushT = setTimeout(flushDebounced, DTC.FLUSH_MS); }
        function flushDebounced () { flushT = 0; if (!dirty) return; dirty = false; qWrite(); }

        function persistProgress (it) {
            const now = Date.now();
            const frac = it.total > 0 ? it.loaded / it.total : 0;
            const lastAt = progAt.get(it.id) || 0;
            const lastPct = progPct.get(it.id) || 0;
            if (now - lastAt < DTC.PROG_MS && frac - lastPct < DTC.PROG_PCT && frac < 1) return;
            progAt.set(it.id, now); progPct.set(it.id, frac);
            persistSoon();
        }

        /* ─── tabs registry (liveness) ────────────────────────────── */

        function readTabs () {
            try { const v = JSON.parse(GM_getValue(DTC.K_TABS, '{}')); return v && typeof v === 'object' ? v : {}; }
            catch { return {}; }
        }
        function touchTabs (when) {
            try {
                const t = readTabs();
                const now = when || Date.now();
                for (const k of Object.keys(t)) if (now - t[k] > DTC.TAB_STALE * 3) delete t[k];
                t[TAB_ID] = now;
                GM_setValue(DTC.K_TABS, JSON.stringify(t));
            } catch {}
        }

        /* ─── death notes — unload-proof liveness ──────────────────
         * GM_setValue rides an async bridge (the extension's service
         * worker) that can drop a dying page's very last write, so a
         * refresh can leave the committed store still owned by the
         * dead tab — freshly stamped, indistinguishable from "alive
         * but quiet" for TAB_STALE seconds. localStorage writes are
         * synchronous and commit during unload, so the dying page
         * drops a note there instead: provable, instant death for
         * every successor. Same-origin, so every wallhaven tab
         * shares the ring. */
        function diedRead () {
            let ring = null;
            try { ring = JSON.parse(localStorage.getItem(DTC.K_DIED) || '[]'); } catch {}
            if (!Array.isArray(ring)) ring = [];
            const out = new Map();
            const now = Date.now();
            for (const e of ring) {
                if (!e || typeof e.t !== 'string' || typeof e.at !== 'number') continue;
                if (now - e.at > DTC.DIED_TTL) continue;
                out.set(e.t, e.at);
            }
            return out;
        }
        function diedWrite (ring) {
            try {
                localStorage.setItem(DTC.K_DIED,
                    JSON.stringify([...ring.entries()].map(x => ({ t: x[0], at: x[1] }))));
            } catch {}
        }
        function noteDeath (tab) {
            try {
                const ring = diedRead();                 /* re-note = move to freshest */
                ring.delete(tab);
                ring.set(tab, Date.now());
                while (ring.size > DTC.DIED_MAX) ring.delete(ring.keys().next().value);
                diedWrite(ring);
            } catch {}
        }
        function clearDeath (tab) {
            try {
                const ring = diedRead();
                if (ring.delete(tab)) diedWrite(ring);
            } catch {}
        }
        function ownerDead (owner, tabs, died) {
            if (!owner) return true;                          /* ownerless = adoptable */
            if (died && died.has(owner)) return true;         /* provable death — beats a
                                                  * fresh registry (pagehide case) */
            const beat = tabs ? tabs[owner] : 0;
            return !beat || Date.now() - beat > DTC.TAB_STALE;   /* registry silence */
        }
        function livenessCtx () {
            return { tabs: readTabs(), died: diedRead() };
        }

        /* ─── validation & hydration (self-healing load) ──────────── */

        const ST_RE = /^(queued|meta|down|retry|done|fail)$/;
        const ID_RE = /^[a-z0-9]{2,12}$/i;
        function validItem (o) {
            return !!o && typeof o === 'object' && typeof o.id === 'string' && ID_RE.test(o.id) &&
                   typeof o.state === 'string' && ST_RE.test(o.state) &&
                   typeof o.seq === 'number' && isFinite(o.seq);
        }

        function adoptItem (o, revAt) {
            const it = { id: o.id, seq: o.seq || 0, state: o.state, name: o.name || '',
                         thumb: o.thumb || deriveThumb(o.id), loaded: o.loaded || 0, total: o.total || 0,
                         tries: o.tries || 0, err: o.err || '', addedAt: o.addedAt || Date.now(),
                         doneAt: o.doneAt || 0, owner: o.owner || '', ownerAt: o.ownerAt || 0,
                         revAt: revAt || 0, uiGone: o.state === 'done',
                         cbs: null, started: false, xhr: null, gdl: null, backT: 0, revT: 0,
                         fadeT: 0, blobUrl: '', cancelled: false, claimPend: false, slot: false,
                         spd: 0, pLoad: 0, pAt: 0, nextTryAt: 0 };
            items.set(it.id, it);
            return it;
        }

        function resort () {
            const arr = [...items.values()].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            items.clear();
            for (const it of arr) items.set(it.id, it);
        }

        function hydrate () {
            const raw = GM_getValue(DTC.K_Q, '');
            if (!raw) return;
            let env = null;
            try { env = JSON.parse(raw); } catch { env = null; }
            if (!env || typeof env !== 'object' || !Array.isArray(env.items)) {
                try { GM_setValue(DTC.K_CORRUPT, String(raw).slice(0, 20000)); GM_deleteValue(DTC.K_Q); } catch {}
                console.warn('[naXim Labs] download-queue store was corrupt — backed up and reset');
                return;
            }
            const tabs = readTabs();
            const died = diedRead();
            const now = Date.now();
            const seen = new Set();
            let dropped = 0;
            for (const o of env.items) {
                if (!validItem(o) || seen.has(o.id)) { dropped++; continue; }
                if (env.gone && env.gone[o.id]) { dropped++; continue; }          /* tombstoned */
                seen.add(o.id);
                if (typeof o.addedAt !== 'number' || !isFinite(o.addedAt) || o.addedAt > now + 60000) o.addedAt = now;
                if (o.state === 'done' && (!o.doneAt || now - o.doneAt > DTC.DONE_TTL)) { dropped++; continue; }
                /* dead owner → back in line. Covers meta/down/retry AND an
                 * owned-QUEUED item (a claim that outlived its tab — the
                 * eternal-"wait" hole). Death is proven three ways: the
                 * localStorage ring (instant, unload-proof), registry
                 * silence, or an expired per-item lease. */
                if ((o.state === 'meta' || o.state === 'down' || o.state === 'retry' ||
                     (o.state === 'queued' && o.owner)) &&
                    ownerDead(o.owner, tabs, died)) {
                    o.state = 'queued'; o.owner = ''; o.ownerAt = 0;
                    o.loaded = 0; o.total = 0;
                }
                if (o.seq > seq) seq = o.seq;
                adoptItem(o, env.rev || 0);
            }
            if (env.gone && typeof env.gone === 'object')
                for (const [id, ts] of Object.entries(env.gone)) if (typeof ts === 'number') gone.set(id, ts);
            if (typeof env.rev === 'number' && env.rev > rev) rev = env.rev;
            base = rev;
            resort();
            if (dropped || items.size) qWrite();      /* heal the store, stamp my base */
        }

        /* ─── lifecycle helpers ───────────────────────────────────── */

        function liveState (s) { return s === 'queued' || s === 'meta' || s === 'down' || s === 'retry'; }
        function iOwn () {
            for (const it of items.values()) if (it.owner === TAB_ID && liveState(it.state)) return true;
            return false;
        }

        function killItem (id) {
            const it = items.get(id);
            if (it) {
                if (it.xhr) { try { it.xhr.abort && it.xhr.abort(); } catch {} }
                if (it.gdl) { try { it.gdl.abort && it.gdl.abort(); } catch {} }
                clearTimeout(it.backT);
                clearTimeout(it.fadeT);
                dropSlot(it);
            }
            items.delete(id);
            const r = rows.get(id);
            if (r) { r.row.remove(); rows.delete(id); }
        }

        function prune () {
            const now = Date.now();
            let changed = false;
            for (const [id, ts] of [...gone]) if (now - ts > DTC.GONE_TTL) { gone.delete(id); changed = true; }
            for (const it of [...items.values()]) {
                if (it.state === 'done' && now - (it.doneAt || 0) > DTC.DONE_TTL) { killItem(it.id); changed = true; }
            }
            let guard = 0;
            while (items.size > DTC.ITEM_CAP && guard++ < 1000) {
                let victim = null;
                for (const it of items.values()) {
                    if (it.state !== 'done') continue;
                    if (!victim || (it.doneAt || 0) < (victim.doneAt || 0)) victim = it;
                }
                if (!victim) break;
                killItem(victim.id); changed = true;
            }
            for (const k of [...progAt.keys()]) if (!items.has(k)) { progAt.delete(k); progPct.delete(k); }
            return changed;
        }

        function armDoneFade (it) {
            if (it.fadeT) return;
            it.fadeT = setTimeout(() => {
                it.fadeT = 0; it.uiGone = true;
                const r = rows.get(it.id); if (r) { r.row.remove(); rows.delete(it.id); }
                schedule();
            }, DTC.FADE_MS);
        }

        /* ─── completion notification (hidden-tab courtesy) ──────── */

        let prevWork = 0, notified = false, drainDone = 0, drainFail = 0;
        function maybeNotify () {
            let work = 0, failN = 0;
            for (const it of items.values()) {
                if (it.uiGone) continue;
                if (liveState(it.state)) work++;
                else if (it.state === 'fail') failN++;
            }
            if (work > 0) { notified = false; drainDone = 0; drainFail = 0; }
            else if (!notified && prevWork > 0 && (drainDone + drainFail) > 0) {
                notified = true;
                if (cfg.notif && document.hidden) {
                    try {
                        if (typeof GM_notification === 'function') {
                            GM_notification({
                                title: 'naXim Labs — queue complete',
                                text: drainDone + (drainDone === 1 ? ' download finished' : ' downloads finished') +
                                      (drainFail ? (' · ' + drainFail + ' failed') : ''),
                                timeout: 6000,
                                onclick () { try { window.focus(); } catch {} },
                            });
                        }
                    } catch {}
                }
            }
            prevWork = work;
        }

        /* ─── scheduler: FIFO slots + cross-tab claims ────────────── */

        function nextRunnable (ctx) {
            if (!ctx) ctx = livenessCtx();
            for (const it of items.values()) {
                if (it.cancelled || it.state !== 'queued' || it.claimPend) continue;
                if (it.owner === TAB_ID) return { it: it, claim: false };
                if (ownerDead(it.owner, ctx.tabs, ctx.died))
                    return { it: it, claim: true };    /* provably dead owner → claimable */
            }
            return null;
        }
        function takeSlot (it) { if (it.slot) return; it.slot = true; liveCount++; }
        function dropSlot (it) { if (!it.slot) return; it.slot = false; liveCount--; }

        function pump () {
            if (claimT) return;
            maybeNotify();
            if (cfg.paused) return;                /* queue held — in-flight items finish naturally;
                                                    * adding a new download auto-resumes */
            const ctx = livenessCtx();
            let pending = 0;                       /* pending claims hold capacity */
            while (liveCount + pending < concOf()) {
                const n = nextRunnable(ctx);
                if (!n) break;
                if (n.claim) {
                    n.it.claimPend = true; n.it.owner = TAB_ID; n.it.ownerAt = Date.now();
                    pending++;
                    continue;
                }
                n.it.state = 'meta';
                takeSlot(n.it);
                run(n.it);
            }
            if (pending) {
                claimT = setTimeout(verifyClaims, DTC.CLAIM_MS);  /* arm FIRST — qWrite's
                                                    same-tab echo re-enters pump */
                qWrite();                                        /* publish the claim */
            }
        }

        function verifyClaims () {
            claimT = 0;
            const env = qRead();
            for (const it of [...items.values()]) {
                if (!it.claimPend) continue;
                it.claimPend = false;
                if (!env) continue;               /* store unreadable — no rival evidence
                                                  * beats a local claim: keep it, keep working */
                const ext = env.items.find(x => x.id === it.id);
                if (!ext) { killItem(it.id); continue; }         /* dismissed while pending */
                if (ext.owner !== TAB_ID) mergeOne(ext, env.rev || 0);   /* a live rival won */
            }
            schedule(); pump();
        }

        /* ─── transfer machinery ─────────────────────────────────── */

        function fire (it, ev) {
            const cb = it.cbs && it.cbs[ev];
            if (cb) { try { cb(); } catch {} }
        }

        async function run (it) {
            let m = null;
            try { m = await fetchWallData(it.id); } catch {}
            if (!items.has(it.id) || it.cancelled) return;
            if (it.owner !== TAB_ID || it.state !== 'meta') return;   /* requeued/lost while awaiting */
            if (!m || !m.path) { it.err = 'wallpaper data unavailable'; failed(it, null, new Error('meta')); return; }
            it.name = mkFilename(it.id, m.ext, m.tags);
            persistSoon();
            attempt(it, m.path);
        }

        function attempt (it, path) {
            if (!items.has(it.id) || it.cancelled) return;
            if (it.owner !== TAB_ID || it.state !== 'meta') return;
            clearTimeout(it.backT);
            it.state = 'down';
            it.loaded = 0; it.total = 0;
            it.spd = 0; it.pLoad = 0; it.pAt = Date.now(); it.nextTryAt = 0;   /* fresh telemetry */
            if (!it.started) { it.started = true; fire(it, 'onStart'); }
            persistSoon(); schedule();
            it.xhr = GM_xmlhttpRequest({
                method: 'GET', url: path, responseType: 'blob',
                headers: { Referer: 'https://wallhaven.cc/' },
                timeout: 120000,
                onprogress (r) {
                    if (!items.has(it.id) || it.cancelled || it.state !== 'down') return;
                    const now = Date.now();
                    if (now > it.pAt && r.loaded > it.pLoad) {
                        const inst = (r.loaded - it.pLoad) / (now - it.pAt);   /* bytes/ms */
                        it.spd = it.spd ? it.spd * 0.6 + inst * 0.4 : inst;   /* smoothed */
                    }
                    it.pLoad = r.loaded || 0;
                    it.pAt = now;
                    it.loaded = r.loaded || 0;
                    if (r.total && r.total > 0) it.total = r.total;
                    persistProgress(it);
                    schedule();
                },
                onload (r) {
                    if (!items.has(it.id) || it.cancelled || it.state !== 'down') return;
                    it.xhr = null;
                    if (r.status === 200 && r.response) { save(it, path, r.response); return; }
                    failed(it, path, Object.assign(new Error('HTTP ' + r.status), { status: r.status }));
                },
                onerror ()   { if (!items.has(it.id) || it.cancelled || it.state !== 'down') return; it.xhr = null; failed(it, path, new Error('network error')); },
                ontimeout () { if (!items.has(it.id) || it.cancelled || it.state !== 'down') return; it.xhr = null; failed(it, path, new Error('timeout')); },
            });
        }

        function save (it, path, blob) {
            if (!items.has(it.id) || it.cancelled || it.state !== 'down') return;
            let url = '';
            try { url = URL.createObjectURL(blob); } catch (e) { failedFinal(it, path, 'browser storage refused the file', true); return; }
            it.blobUrl = url;
            const name = it.name || ('wallhaven-' + it.id);
            const armRevoke = (ms) => {
                clearTimeout(it.revT);
                it.revT = setTimeout(() => {
                    it.blobUrl = '';
                    try { URL.revokeObjectURL(url); } catch {}
                }, ms || DTC.REVOKE_MS);
            };
            try {
                it.gdl = GM_download({
                    url: url,
                    name: name,
                    onload: () => { it.gdl = null; armRevoke(DTC.GDL_REVOKE_MS); finish(it, 'done'); },
                    onerror: (err) => {
                        it.gdl = null;
                        if (!items.has(it.id) || it.cancelled) return;
                        const msg = String((err && (err.error || err.message)) || '').toLowerCase();
                        if (/cancel|abort/.test(msg)) { armRevoke(1000); dismiss(it.id); return; }
                        anchorSave(it, path, url, name, armRevoke);
                    },
                });
            } catch (e) { anchorSave(it, path, url, name, armRevoke); }
        }

        function anchorSave (it, path, url, name, armRevoke) {
            if (!items.has(it.id) || it.cancelled || it.state !== 'down') return;
            try {
                const a = document.createElement('a');
                a.href = url;
                a.download = name;
                a.rel = 'noopener';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { if (a.isConnected) a.remove(); }, 0);
                armRevoke(DTC.REVOKE_MS);
                finish(it, 'done');
            } catch (e) { failedFinal(it, path, 'could not open the save dialog', true); }
        }

        function failed (it, path, err) {
            if (!items.has(it.id) || it.cancelled) return;
            if (it.state !== 'down' && it.state !== 'meta') return;
            const code = (err && err.status) || 0;
            it.err = (err && err.message) ? String(err.message) : 'download failed';
            const permanent = code === 401 || code === 403 || code === 404;
            if (permanent || it.tries >= DTC.MAX_TRIES - 1) { failedFinal(it, path, it.err, false); return; }
            it.tries++;
            it.state = 'retry';
            dropSlot(it);                       /* backoff must not hold a slot */
            persistNow();                       /* durable state transition */
            schedule();
            const delay = DTC.BACKOFF[Math.min(it.tries - 1, DTC.BACKOFF.length - 1)];
            it.nextTryAt = Date.now() + delay;   /* row telemetry: "retry 2/4 · in 3s" */
            clearTimeout(it.backT);
            it.backT = setTimeout(() => {
                it.backT = 0; it.nextTryAt = 0;
                if (!items.has(it.id) || it.cancelled) return;
                it.state = 'queued';            /* FIFO takes it from here */
                persistSoon(); pump();
            }, delay);
        }

        function failedFinal (it, path, why, savePipeline) {
            if (it.blobUrl) {
                const u = it.blobUrl; it.blobUrl = '';
                clearTimeout(it.revT);
                try { URL.revokeObjectURL(u); } catch {}
            }
            it.err = why || it.err || 'download failed';
            finish(it, 'fail');
            /* The direct-URL courtesy is reserved for a broken SAVE step —
             * network/HTTP failures have Retry; opening tabs for those
             * would just spam the browser. */
            if (savePipeline && path) { try { window.open(path, '_blank'); } catch {} }
        }

        function finish (it, state) {
            it.state = state;
            it.xhr = null; it.gdl = null;
            clearTimeout(it.backT);
            dropSlot(it);
            it.owner = ''; it.ownerAt = 0;
            it.nextTryAt = 0;
            if (state === 'done') {
                it.doneAt = Date.now(); armDoneFade(it);
                cfg.files++; cfg.bytes += (it.total || 0);      /* lifetime stats */
                cfgWrite();
                drainDone++;
            }
            else { it.doneAt = 0; drainFail++; fire(it, 'onFail'); }
            persistNow();
            refreshSettingsUI();
            schedule(); pump();
        }

        /* ─── public operations ───────────────────────────────────── */

        function add (id, cbs) {
            /* any download click is intent — a paused queue resumes.
             * (Dedupe / failed re-add paths below share this rule.) */
            if (cfg.paused) {
                cfg.paused = false; cfgWrite(); refreshSettingsUI();
            }
            const cur = items.get(id);
            if (cur && cur.state !== 'fail') {
                if (cbs) {
                    if (cur.started && cbs.onStart) { try { cbs.onStart(); } catch {} }
                    else cur.cbs = Object.assign({}, cur.cbs, cbs);
                }
                persistSoon(); schedule();
                return;
            }
            if (cur) {                          /* re-adding a failed item = Retry */
                cur.cbs = cbs ? Object.assign({}, cur.cbs, cbs) : cur.cbs;
                retry(id);
                return;
            }
            const it = { id: id, cbs: cbs || null, state: 'queued', tries: 0, started: false,
                         name: '', thumb: deriveThumb(id), loaded: 0, total: 0,
                         xhr: null, gdl: null, backT: 0, revT: 0, fadeT: 0, blobUrl: '',
                         cancelled: false, claimPend: false, slot: false, uiGone: false,
                         spd: 0, pLoad: 0, pAt: 0, nextTryAt: 0,
                         seq: ++seq, addedAt: Date.now(), err: '', doneAt: 0,
                         owner: TAB_ID, ownerAt: Date.now(), revAt: 0 };
            items.set(id, it);
            gone.delete(id);                     /* a fresh add clears any tombstone */
            if (!root) build();
            root.classList.add('on');
            persistNow();                        /* durable append, in order, before any await */
            pump(); schedule();
        }

        function retry (id) {
            const it = items.get(id);
            if (!it || it.state !== 'fail') return;
            it.tries = 0; it.err = ''; it.cancelled = false; it.started = false;
            it.loaded = 0; it.total = 0; it.uiGone = false; it.nextTryAt = 0;
            it.state = 'queued';
            it.owner = TAB_ID; it.ownerAt = Date.now(); it.claimPend = true;
            gone.delete(id);
            if (!claimT) claimT = setTimeout(verifyClaims, DTC.CLAIM_MS);
            persistNow();
            schedule(); pump();
        }

        function retryAll () {
            let n = 0;
            for (const it of [...items.values()]) {
                if (it.state === 'fail') { retry(it.id); n++; }
            }
            return n;
        }
        function clearFailed () {
            let n = 0;
            for (const it of [...items.values()]) {
                if (it.state === 'fail') { dismiss(it.id); n++; }
            }
            schedule();
            return n;
        }

        function hardKill (it) {
            /* full teardown for a consciously removed item — aborts the
             * transfer, revokes the blob, clears timers, frees the slot.
             * Used by dismiss (single X), clearAll, and mergeEnv when a
             * tombstone arrives — so a removal is honored even by the
             * tab that is mid-transfer on that very item. */
            it.cancelled = true;
            if (it.blobUrl) { const u = it.blobUrl; it.blobUrl = ''; clearTimeout(it.revT); try { URL.revokeObjectURL(u); } catch {} }
            killItem(it.id);
        }
        function dismiss (id) {
            const it = items.get(id);
            if (it) hardKill(it);
            gone.set(id, Date.now());           /* tombstone: authoritative everywhere */
            persistNow(); schedule(); pump();
        }
        function cancel (id) { dismiss(id); }
        function clearAll () {
            /* remove EVERYTHING — rows, store, executing transfers in
             * every tab (tombstones ride the shared store). Lifetime
             * stats and the settings survive; the queue restarts
             * empty. */
            let n = 0;
            for (const it of [...items.values()]) { hardKill(it); gone.set(it.id, Date.now()); n++; }
            prevWork = 0; drainDone = 0; drainFail = 0; notified = false;   /* no bogus drain notice */
            prune();                            /* progress-bookkeeping maps */
            persistNow(); schedule();
            return n;
        }

        /* ─── cross-tab reconciliation ────────────────────────────── */

        function mergeOne (o, revAt) {
            const it = items.get(o.id);
            if (!it) { adoptItem(o, revAt); return true; }
            if (it.slot || it.claimPend) return false;       /* executing locally — mine wins */
            let changed = false;
            const set = (k, v) => { if (it[k] !== v) { it[k] = v; changed = true; } };
            const was = it.state;
            set('state', o.state); set('name', o.name || '');
            set('thumb', o.thumb || it.thumb);
            set('loaded', o.loaded || 0); set('total', o.total || 0);
            set('tries', o.tries || 0); set('err', o.err || '');
            set('doneAt', o.doneAt || 0);
            set('owner', o.owner || ''); set('ownerAt', o.ownerAt || 0);
            set('seq', o.seq || it.seq);
            it.revAt = revAt || it.revAt;
            if (it.state === 'done' && was !== 'done') armDoneFade(it);
            if (it.state !== 'done' && it.fadeT) { clearTimeout(it.fadeT); it.fadeT = 0; }
            if (it.state === 'fail' && it.uiGone) it.uiGone = false;
            return changed;
        }

        function mergeEnv (env) {
            let changed = false;
            if (env.gone && typeof env.gone === 'object') {
                for (const [id, ts] of Object.entries(env.gone)) {
                    if (typeof ts !== 'number') continue;
                    if (!gone.has(id)) { gone.set(id, ts); changed = true; }
                    if (items.has(id)) { hardKill(items.get(id)); changed = true; }   /* full teardown — even mid-transfer (blob revoke too) */
                }
            }
            const byId = new Map();
            for (const o of env.items) if (validItem(o)) byId.set(o.id, o);
            for (const it of [...items.values()]) {
                if (gone.has(it.id)) { hardKill(it); changed = true; continue; }   /* a conscious removal beats ANY local state — even mid-transfer */
                if (it.slot || it.claimPend) continue;       /* executing locally — mine wins */
                const ext = byId.get(it.id);
                if (ext) { if (mergeOne(ext, env.rev || 0)) changed = true; continue; }
                if ((env.base || 0) >= it.revAt) { killItem(it.id); changed = true; }
                /* else: the writer never saw this item (stale write) — keep;
                 * my next persist reasserts it. */
            }
            let added = false;
            for (const o of byId.values()) {
                if (items.has(o.id) || gone.has(o.id)) continue;
                if (o.state === 'done' && Date.now() - (o.doneAt || 0) > DTC.DONE_TTL) continue;
                adoptItem(o, env.rev || 0); added = true;
            }
            for (const o of byId.values()) if (o.seq > seq) seq = o.seq;
            if (added) { resort(); changed = true; }
            return changed;
        }

        function onRemote () {
            const env = qRead();
            if (!env) return;
            const changed = mergeEnv(env);
            if (prune()) changed = true;
            if (changed) persistSoon();          /* converge the store; no echo when nothing changed */
            schedule(); pump();
        }

        function watchdog () {
            const env = qRead();
            if (!env) { if (prune()) persistNow(); return; }
            const changed = mergeEnv(env);
            const tabs = readTabs();
            const died = diedRead();
            const now = Date.now();
            let touched = false;
            for (const o of env.items) {
                if (o.state !== 'meta' && o.state !== 'down' && o.state !== 'retry' &&
                    !(o.state === 'queued' && o.owner)) continue;   /* owned-queued = mid-claim */
                if (o.owner === TAB_ID) continue;
                if (ownerDead(o.owner, tabs, died)) {
                    const it = items.get(o.id) || adoptItem(o, env.rev || 0);
                    it.state = 'queued'; it.owner = ''; it.ownerAt = 0;
                    it.loaded = 0; it.total = 0; it.claimPend = false;
                    touched = true;
                }
            }
            /* unsticker: a claim whose verify timer was lost (context
             * freeze, timer drop) must not park an item forever */
            for (const it of items.values()) {
                if (it.claimPend && !claimT && now - it.ownerAt > 4 * DTC.CLAIM_MS) {
                    it.claimPend = false; touched = true;
                }
            }
            if (prune()) touched = true;
            if (changed || touched) { persistNow(); resort(); pump(); }
        }

        function boot () {
            if (booted) return;
            booted = true;
            touchTabs();
            if (items.size) {
                if (!root) build();
                root.classList.add('on');
                schedule(); pump();               /* resume pending work */
            }
            hbT = setInterval(() => { if (iOwn()) touchTabs(); }, DTC.HEARTBEAT);
            wdT = setInterval(watchdog, DTC.WATCHDOG);
            watchdog();
        }

        /* ─── wiring + hydration at eval ──────────────────────────── */

        if (typeof GM_addValueChangeListener === 'function') {
            try { GM_addValueChangeListener(DTC.K_Q, () => onRemote()); } catch {}
            try { GM_addValueChangeListener(DTC.K_CFG, () => onCfgRemote()); } catch {}
        }
        window.addEventListener('pagehide', () => {
            /* Unload my in-flight items as claimable work — a refresh or a
             * tab close must never strand a download. (Crashes without
             * pagehide are covered by the watchdog's staleness window.) */
            let touched = false;
            for (const it of items.values()) {
                if (it.owner === TAB_ID && liveState(it.state)) {
                    it.state = 'queued'; it.owner = ''; it.ownerAt = 0;
                    it.loaded = 0; it.total = 0;
                    clearTimeout(it.backT);
                    dropSlot(it);
                    touched = true;
                }
            }
            if (touched || dirty) persistNow();
            /* GM storage may drop this dying write (async bridge), so the
             * death also goes to localStorage — synchronous, commits during
             * unload — and every successor can prove me dead instantly. */
            noteDeath(TAB_ID);
        });
        window.addEventListener('pageshow', () => {     /* bfcache restore / fresh load */
            clearDeath(TAB_ID);                          /* I'm alive — un-note my death */
            touchTabs();
            pump();
        });

        hydrate();

        return { add: add, cancel: cancel, boot: boot, retryAll: retryAll, clearFailed: clearFailed,
                 clearAll: clearAll, cfg: setCfg, onCfg: onCfg, TAB_ID: TAB_ID };
    })();

    function mkFilename (id, ext, tags) {
        if (!tags || !tags.length) return 'wallhaven-' + id + '.' + ext;
        const out = [];
        for (const t of tags) {
            const c = t.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
            if (!c) continue;
            if (([...out, c]).join(', ').length <= 220) out.push(c); else break;
        }
        return (out.length ? out.join(', ') : 'wallhaven-' + id) + '.' + ext;
    }

    /* ═══ CARD ACTIONS & DATES ═════════════════════════════════════ */

    const _dlBusy = new WeakSet();

    function btnSpin (b) { b.classList.remove('nx-ok','nx-se'); b.classList.add('nx-busy'); b.innerHTML = '<span class="nx-spin"></span>'; }
    function btnOk   (b, ico) { b.classList.remove('nx-busy'); b.classList.add('nx-ok'); b.innerHTML = ico; setTimeout(() => { if (b.isConnected) b.classList.remove('nx-ok'); }, 1500); }
    function btnErr  (b, ico) { b.classList.remove('nx-busy'); b.classList.add('nx-se'); b.innerHTML = ico; setTimeout(() => { if (b.isConnected) b.classList.remove('nx-se'); }, 1800); }
    function btnPulse (b) { b.classList.remove('nx-pulse'); void b.offsetWidth; b.classList.add('nx-pulse'); }

    function injectButtons (fig, id) {
        const wrap = mk('div', 'nx-tools');

        const dl = mk('button', 'nx-tool'); dl.type = 'button';
        dl.title = 'Download'; dl.setAttribute('aria-label', 'Download wallpaper'); dl.innerHTML = IC.dl;
        dl.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (_dlBusy.has(fig)) return;
            _dlBusy.add(fig);
            btnPulse(dl);
            btnSpin(dl);
            DL.add(id, {
                onStart: () => { btnOk(dl, IC.dl); setTimeout(() => _dlBusy.delete(fig), 1000); },
                onFail : () => { btnErr(dl, IC.dl); setTimeout(() => _dlBusy.delete(fig), 1000); },
            });
        });

        const pv = mk('button', 'nx-tool'); pv.type = 'button';
        pv.title = 'Preview'; pv.setAttribute('aria-label', 'Preview wallpaper'); pv.innerHTML = IC.eye;
        pv.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); lbOpenFromFig(fig); });

        const hy = mk('button', 'nx-tool nx-tool-hy' + (_hyper ? ' on' : '')); hy.type = 'button';
        hy.title = _hyper ? 'Hyper ON — click to disable' : 'Hyper mode: click any wallpaper to download';
        hy.setAttribute('aria-pressed', _hyper);
        hy.innerHTML = IC.bolt;
        hy.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setHyper(!_hyper); });

        wrap.append(dl, pv, hy);
        fig.appendChild(wrap);
    }

    function appendBadge (fig, d) {
        if (fig.querySelector(':scope > .nx-date')) return;
        const b = mk('span', 'nx-date'); b.textContent = fmtDate(d); fig.appendChild(b);
    }

    const _badgeTries = new WeakMap();
    function ensureBadge (fig) {
        if (fig.querySelector(':scope > .nx-date')) return;
        const id = fig.getAttribute('data-wallpaper-id'); if (!id) return;
        const d = (_meta.get(id) || {}).created || _dates.get(id);
        if (d) { appendBadge(fig, d); return; }
        const tries = _badgeTries.get(fig) || 0;
        if (tries >= 2) return;
        _badgeTries.set(fig, tries + 1);
        resolveDate(id).then(dd => {
            if (dd && fig.isConnected) { appendBadge(fig, dd); return; }
            if (tries + 1 < 2) setTimeout(() => {
                if (fig.isConnected && !fig.querySelector(':scope > .nx-date')) ensureBadge(fig);
            }, 9000);
        }).catch(() => {});
    }

    const NX_KEEP_FIG  = 'img, a.preview, .thumb-info, .nx-tools, .nx-date, .nx-hind, .wall-favs, .wall-res';
    const NX_KEEP_INFO = '.wall-res, .wall-favs, .nx-fav';
    function sanitizeCard (fig) {
        if (fig.classList.contains('nx-card')) return;
        const kids = Array.prototype.slice.call(fig.children);
        for (const el of kids) {
            if (!el.matches(NX_KEEP_FIG)) el.classList.add('nx-hide');
        }
        const info = fig.querySelector('.thumb-info');
        if (info) {
            const ik = Array.prototype.slice.call(info.children);
            for (const el of ik) {
                if (!el.matches(NX_KEEP_INFO)) el.classList.add('nx-hide');
            }
        }
    }

    document.addEventListener('pointerenter', (e) => {
        const t = e.target;
        if (!(t instanceof Element) || t.tagName !== 'FIGURE' || !t.classList.contains('thumb')) return;
        const id = t.getAttribute('data-wallpaper-id');
        if (!id) return;
        if (!t.querySelector(':scope > .nx-tools')) injectButtons(t, id);
        ensureBadge(t);
        upgradeFavoriteButton(t);
        sanitizeCard(t);
    }, { capture: true, passive: true });

    /* ═══ PAGE BARS — a download button beside every page number ══
     *
     * v7.9.0 — every loaded page of the listing carries its own
     * small download chip right beside its page number ("Page 4 /
     * 9876"): one tap queues THAT page only — never the pages
     * below it — through the exact classic download manager a
     * single click uses.
     *
     *   • NATIVE HEADERS — wallhaven renders a header above every
     *     page it appends while you scroll; the chip slots straight
     *     into it, next to the number.
     *   • THE HEADERLESS FIRST PAGE — wallhaven leaves the page-1
     *     section without a header, so a matching bar is injected
     *     ("Page 1 / 896" — the total from the listing's own
     *     pagination data) and the chip lives there: every page is
     *     equal.
     *   • SCAN GRIDS — while the panel's search grid owns the
     *     listing (nx-card figures) the first section's bar becomes
     *     "Batch N" with the batch's live count; the stale native
     *     header steps aside (hidden, never destroyed) until Clear
     *     grid restores the listing and brings it back.
     *   • LIVE LISTING — one childList observer on the thumbs
     *     container notices every page wallhaven appends and wires
     *     the new page's chip within a frame (rAF-coalesced; no
     *     polling, no layout reads). The same tick lets the
     *     floating pill re-read the DOM, so its number always
     *     equals what a tap would queue.
     *   • OFF SWITCH — "Page download buttons" in the panel's
     *     Downloads section removes every trace live.
     *
     * The tap itself is a pure queue append — DL.add per wallpaper:
     * duplicates can never double-download, and all network work
     * happens inside the manager, behind the unified rate shield. */

    const PageBar = (() => {
        let scanCount = 0, mo = null, tick = false;
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn => setTimeout(fn, 16));
        const START_PAGE = (() => {          /* the page this listing started on — captured at load, before scrolling rewrites the URL */
            const q = new URLSearchParams(location.search).get('page');
            return (q && /^\d+$/.test(q)) ? parseInt(q, 10) : 1;
        })();

        function host () {
            const t = document.getElementById('thumbs');
            if (t && t.tagName !== 'UL') return t;
            const s = document.querySelector('section.thumb-listing-page');
            return s ? s.parentNode : null;
        }
        function sections () {
            const t = document.getElementById('thumbs');
            if (t && t.tagName !== 'UL')
                return Array.prototype.slice.call(t.querySelectorAll(':scope > section.thumb-listing-page'));
            const s = document.querySelector('section.thumb-listing-page');
            return s ? [s] : [];
        }
        function secFigs (sec) {
            const out = [];
            sec.querySelectorAll('figure.thumb[data-wallpaper-id]').forEach(f => {
                const id = f.getAttribute('data-wallpaper-id');
                if (id && out.indexOf(id) === -1) out.push(id);
            });
            return out;
        }
        function secNum (sec) {
            const n = sec.querySelector('.thumb-listing-page-num');
            if (n && /^\d+$/.test((n.textContent || '').trim())) return parseInt(n.textContent, 10);
            const pg = sec.nextElementSibling;     /* this page's own pagination sits right after it */
            if (pg && pg.classList && pg.classList.contains('pagination')) {
                const cur = pg.querySelector('li.current');
                if (cur && /^\d+$/.test((cur.textContent || '').trim())) return parseInt(cur.textContent, 10);
            }
            if (sec === sections()[0]) return START_PAGE;   /* the first section is the page the listing started on */
            return 1;
        }
        function secTotal () {
            const scope = document.getElementById('thumbs') || document;
            const pg = scope.querySelector('ul.pagination[data-pagination]');
            if (pg) {
                try {
                    const j = JSON.parse(pg.getAttribute('data-pagination'));
                    if (j && j.total) return parseInt(j.total, 10);
                } catch (e) {}
            }
            return 0;
        }
        function isScan () {
            const s = sections()[0]; if (!s) return false;
            const ul = s.querySelector(':scope > ul');
            return !!(ul && ul.querySelector('figure.nx-card'));
        }
        function batchNo () {
            if (_gridPage) { const b = _gridPage.split('#')[1]; if (b) return b; }
            if (_session && _session.batchNum) return _session.batchNum;
            return 0;
        }
        function flash (btn) {
            btn.classList.remove('nx-pb-ok'); void btn.offsetWidth; btn.classList.add('nx-pb-ok');
        }

        /* the chip itself — one tap, one page, the classic queue */
        function makeBtn (sec) {
            const btn = mk('button', 'nx-pb');
            btn.type = 'button';
            btn.title = 'Download this page’s wallpapers — straight into the download manager';
            btn.setAttribute('aria-label', 'Download the wallpapers on this page');
            const ico = mk('span', 'nx-pb-i'); ico.innerHTML = IC.dl;
            const num = mk('span', 'nx-pb-n');
            btn.append(ico, num);
            btn.addEventListener('click', () => {
                const ids = secFigs(sec);
                if (!ids.length) { setStatus('✕ Nothing to download — this page shows no wallpapers.', true); return; }
                for (const id of ids) DL.add(id);   /* the exact queue a page of single clicks would fill */
                flash(btn);
                if (sec === sections()[0] && isScan()) {
                    const b = batchNo();
                    setStatus('✓ ' + (b ? 'Batch ' + b : 'Scan grid') + ' queued — ' + ids.length + ' wallpaper' +
                              (ids.length === 1 ? '' : 's') + ' → download manager · duplicates skip automatically.');
                } else {
                    setStatus('✓ Page ' + secNum(sec) + ' queued — ' + ids.length + ' wallpaper' +
                              (ids.length === 1 ? '' : 's') + ' → download manager · duplicates skip automatically.');
                }
            });
            return btn;
        }

        /* an ownbar is injected only where wallhaven rendered no
           header (the page-1 section) or while the scan grid owns
           the listing; it reuses wallhaven's own header classes,
           so it looks native everywhere */
        function setKind (own, kind, num, total) {
            let h2 = own.querySelector('h2');
            if (!h2) { h2 = mk('h2'); own.insertBefore(h2, own.firstChild); }
            h2.textContent = '';
            if (kind === 'batch') {
                if (num) { const s = mk('span', 'thumb-listing-page-num'); s.textContent = String(num); h2.append('Batch ', s); }
                else h2.textContent = 'Scan results';
            } else {
                const s = mk('span', 'thumb-listing-page-num'); s.textContent = String(num || 1);
                h2.append('Page ', s);
                if (total && total > 1) h2.appendChild(document.createTextNode(' / ' + total));
            }
        }
        function paintCount (sec) {
            /* v8.1: update EVERY chip the section carries — a scan-mode
               section can hold one in the CSS-hidden native header and
               one in the visible ownbar at the same time */
            const val = ((sec === sections()[0] && isScan()) ? scanCount : secFigs(sec).length).toLocaleString();
            sec.querySelectorAll(':scope > header.thumb-listing-page-header .nx-pb').forEach(btn => {
                const n = btn.querySelector('.nx-pb-n'); if (n && n.textContent !== val) n.textContent = val;
            });
        }
        function wire (sec) {
            if (!sec || !sec.querySelector) return;
            const native = sec.querySelector(':scope > header.thumb-listing-page-header:not(.nx-ownbar)');
            let own = sec.querySelector(':scope > header.nx-ownbar');
            if (!native && !own) {
                own = mk('header', 'thumb-listing-page-header nx-ownbar');
                setKind(own, 'page', secNum(sec), secTotal());
                sec.insertBefore(own, sec.firstChild);
            }
            const h = native || own;
            if (h && !h.querySelector('.nx-pb')) h.appendChild(makeBtn(sec));
            paintCount(sec);
        }
        function paintScanMode () {
            const sec = sections()[0]; if (!sec) return;
            const scan = isScan();
            sec.classList.toggle('nx-scanmode', scan);
            let own = sec.querySelector(':scope > header.nx-ownbar');
            const native = sec.querySelector(':scope > header.thumb-listing-page-header:not(.nx-ownbar)');
            if (scan) {
                if (!own) {
                    own = mk('header', 'thumb-listing-page-header nx-ownbar');
                    sec.insertBefore(own, sec.firstChild);
                }
                setKind(own, 'batch', batchNo(), 0);
                own.hidden = false;
                /* v8.1 FIX: when the listing's first section carries a
                   native header (a /search?page=2+ URL), scan mode hides
                   it — and with it the per-batch chip that lived inside.
                   The visible ownbar now carries its OWN chip, so
                   "Batch N" always has its single-batch button. */
                if (get('pageBars') && !own.querySelector('.nx-pb')) own.appendChild(makeBtn(sec));
            } else if (own) {
                own.hidden = !!native;
                if (!native) setKind(own, 'page', secNum(sec), secTotal());
                const stray = own.querySelector('.nx-pb');            /* v8.1: back to the listing — the native header owns the chip again */
                if (stray && native && native.querySelector('.nx-pb')) stray.remove();
            }
            paintCount(sec);
        }
        function wireAll () { sections().forEach(wire); paintScanMode(); }
        function removeAll () {
            sections().forEach(sec => {
                sec.classList.remove('nx-scanmode');
                const own = sec.querySelector(':scope > header.nx-ownbar'); if (own) own.remove();
                sec.querySelectorAll(':scope > header.thumb-listing-page-header .nx-pb').forEach(b => b.remove());
            });
        }

        /* one observer for the whole listing: a new page appears,
           its chip gets wired and the pill re-reads the truth — a
           frame later, never mid-layout */
        function onTick () {
            try { PagePill.recount(); } catch (e) {}   /* the pill re-reads the same DOM */
            if (get('pageBars')) wireAll();
        }
        function start () {
            if (mo) return;
            const h = host();
            if (!h || typeof MutationObserver !== 'function') return;
            mo = new MutationObserver(() => {
                if (tick) return;
                tick = true;
                raf(() => { tick = false; onTick(); });
            });
            mo.observe(h, { childList: true });
        }
        function boot () {
            if (!document.body) return;
            start();
            if (get('pageBars')) wireAll(); else removeAll();
        }

        return {
            boot: boot,
            sync: boot,                              /* the panel toggle asks for exactly this */
            onCount: n => { scanCount = n || 0; paintScanMode(); },  /* the grid's renders feed the scan bar */
        };
    })();

    /* ═══ PAGE PILL — one tap queues everything on screen ═════════
     *
     * v7.9.0 — the pill finally tells the truth. It queues EVERY
     * wallpaper currently loaded on the listing — that is the
     * feature: want three pages? Scroll until three pages sit on
     * screen, tap once, and all of them ride the classic queue,
     * exactly as if you had clicked every wallpaper one by one.
     *
     *   • THE COUNT IS THE CONTRACT — the number is recomputed from
     *     the live DOM every time anything changes (the page bars'
     *     observer pokes it when wallhaven appends a page; the
     *     panel's own setCount feeds it when the search grid
     *     renders), and the tap harvests the very same list — so
     *     the label can never say 24 while it queues 72.
     *   • THE TAG NAMES THE RANGE — "page 2" for one page, "pages
     *     1–3" for a contiguous run, "batch 4" while the search
     *     grid owns the listing; nothing on random.
     *   • THE QUEUE IS THE CLASSIC ONE — DL.add per wallpaper, in
     *     DOM order: identical concurrency, pacing, byte-accurate
     *     transfers, names, dedupe, retry, pause/resume, cross-tab
     *     sync and telemetry. Zero requests at tap time — all
     *     network work happens inside the manager, behind the
     *     rate shield.
     *   • The pill hides itself when there is nothing to queue and
     *     can be turned off in the panel's Downloads section. */

    const PagePill = (() => {
        let root = null, numEl = null, tagEl = null, lastCount = 0, lastTag = '';
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn => setTimeout(fn, 16));
        const START_PAGE = (() => {          /* the page this listing started on — captured at load, before scrolling rewrites the URL */
            const q = new URLSearchParams(location.search).get('page');
            return (q && /^\d+$/.test(q)) ? parseInt(q, 10) : 1;
        })();

        function listSections () {
            const t = document.getElementById('thumbs');
            if (t && t.tagName !== 'UL')
                return Array.prototype.slice.call(t.querySelectorAll(':scope > section.thumb-listing-page'));
            const s = document.querySelector('section.thumb-listing-page');
            return s ? [s] : [];
        }
        function scanGrid () {                    /* the panel's search grid owns the listing */
            const first = listSections()[0]; if (!first) return false;
            const ul = first.querySelector(':scope > ul');
            return !!(ul && ul.querySelector('figure.nx-card'));
        }

        /* v8.1 — BATCH RANGE: which job owns the grid, and the batches
           between batch 1 and the batch on screen — exactly the way the
           pill treats the pages you scrolled to load ("pages 1–4").
           The live in-progress batch counts as the current page; the
           count always equals the harvest. */
        function accInfo () {
            const jid = (_gridPage ? String(_gridPage).split('#')[0] : '') || (_session ? _session.id : '');
            if (!jid) return null;
            const live = (_session && _session.id === jid) ? _session : null;
            const st = live ? null : ((historyLoad().find(e => e.id === jid) || {}).state || null);
            const batches = ((live ? (live.batches || []) : (jobLoad(jid).batches || [])))
                .filter(b => b && b.n && b.count > 0)
                .sort((a, b) => a.n - b.n);
            if (!batches.length) return null;      /* first batch still collecting — the DOM is the truth */
            const partial = live ? (live.batchServed || 0) : ((st && st.batchServed) || 0);
            const liveN = live ? (live.batchNum || 0) : ((st && st.batchNum) || 0);
            /* the batch the screen is showing — the pill queues 1..it */
            const viewing = (parseInt(_gridPage ? String(_gridPage).split('#')[1] : '', 10) || 0) ||
                            liveN || batches[batches.length - 1].n;
            const hi = Math.max(1, viewing);
            return { jid: jid, live: live, batches: batches, partial: partial, hi: hi,
                     withLive: partial > 0 && liveN === hi && !batches.some(b => b.n === hi) };
        }
        function accCount (a) {
            let n = 0;
            for (const b of a.batches) if (b.n <= a.hi) n += b.count || 0;
            if (a.withLive) n += a.partial;
            return n;
        }
        function accIds (a) {
            const out = [];
            for (const b of a.batches) {
                if (b.n > a.hi) continue;
                bpageLoad(a.jid, b.n).forEach(w => { const id = String(w.id); if (id && out.indexOf(id) === -1) out.push(id); });
            }
            if (a.withLive)
                (a.live ? (a.live.batchItems || []) : batchLoad(a.jid)).forEach(w => { const id = String(w.id); if (id && out.indexOf(id) === -1) out.push(id); });
            return out;
        }
        function scopeNode () {                    /* what "on screen" means right now */
            const t = document.getElementById('thumbs');
            if (t && t.tagName !== 'UL') {
                const first = t.querySelector(':scope > section.thumb-listing-page');
                const ul = first && first.querySelector(':scope > ul');
                if (ul && ul.querySelector('figure.nx-card')) return first;   /* the grid, never the stale pages below it */
                return t;                                                       /* every page you've scrolled to load */
            }
            if (t) return t;                                                     /* legacy flat listing */
            const s = document.querySelector('section.thumb-listing-page');
            return s || document;
        }
        function scopedIds () {
            const out = [];
            scopeNode().querySelectorAll('figure.thumb[data-wallpaper-id]').forEach(f => {
                const id = f.getAttribute('data-wallpaper-id');
                if (id && out.indexOf(id) === -1) out.push(id);
            });
            return out;
        }

        /* which pages the scope covers — the sections' own numbers
           (headers first, then each page's pagination cell, then the
           URL), the batch's number on scan grids, nothing on random */
        function pageTag () {
            if (scanGrid()) {
                const a = accInfo();
                if (a) return a.hi > 1 ? 'batches 1–' + a.hi : 'batch 1';   /* v8.1: the whole served range up to this page, honestly named */
                if (_gridPage) { const b = _gridPage.split('#')[1]; if (b) return 'batch ' + b; }
                if (_session && _session.batchNum) return 'batch ' + _session.batchNum;
                return 'scan';
            }
            if (PAGE_TYPE === 'random') return '';
            const secs = listSections();
            const nums = [];
            secs.forEach(sec => {
                const n = sec.querySelector('.thumb-listing-page-num');
                let v = (n && /^\d+$/.test((n.textContent || '').trim())) ? parseInt(n.textContent, 10) : 0;
                if (!v) {
                    const pg = sec.nextElementSibling;
                    const cur = (pg && pg.classList && pg.classList.contains('pagination')) ? pg.querySelector('li.current') : null;
                    v = (cur && /^\d+$/.test((cur.textContent || '').trim())) ? parseInt(cur.textContent, 10) : 0;
                }
                if (!v && sec === secs[0]) v = START_PAGE;   /* the headerless first section started this listing */
                if (v && nums.indexOf(v) === -1) nums.push(v);
            });
            if (!nums.length) return '';
            nums.sort((a, b) => a - b);
            if (nums.length === 1) return 'page ' + nums[0];
            if (nums[nums.length - 1] - nums[0] + 1 === nums.length)
                return 'pages ' + nums[0] + '–' + nums[nums.length - 1];
            return nums.length + ' pages';
        }

        function paint () {
            if (!root || !root.isConnected) return;
            const scan = scanGrid();
            lastTag = pageTag();
            numEl.textContent = lastCount.toLocaleString();
            tagEl.textContent = lastTag;
            root.classList.toggle('on', lastCount > 0);   /* nothing to queue shows nothing to tap */
            const what = scan ? 'every batch from batch 1 to the batch on screen' : 'every wallpaper on screen';
            root.title = 'Download ' + what + (lastTag ? ' (' + lastTag + ')' : '') +
                         ' — straight into the download manager';
            root.setAttribute('aria-label', 'Download ' + what + (lastTag ? ' — ' + lastTag : ''));
        }

        function build () {
            root = mk('button', 'nx-pg');
            root.type = 'button';
            root.id = 'nx-pg';
            const ico = mk('span', 'nx-pg-i'); ico.innerHTML = IC.dl;
            numEl = mk('span', 'nx-pg-n'); numEl.textContent = '0';
            tagEl = mk('span', 'nx-pg-t');
            root.append(ico, numEl, tagEl);
            root.addEventListener('click', () => {
                const a = scanGrid() ? accInfo() : null;   /* v8.1: on a scan grid the pill queues the served range up to this page */
                const ids = a ? accIds(a) : scopedIds();
                if (!ids.length) { setStatus('✕ Nothing to download — this page shows no wallpapers.', true); return; }
                for (const id of ids) DL.add(id);   /* the exact queue N single clicks would fill */
                root.classList.remove('nx-pg-ok'); void root.offsetWidth; root.classList.add('nx-pg-ok');
                const tag = pageTag();
                const what = tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : 'Page';
                setStatus('✓ ' + what + ' queued — ' + ids.length + ' wallpaper' + (ids.length === 1 ? '' : 's') +
                          ' → download manager · duplicates skip automatically.');
            });
            document.body.appendChild(root);
            raf(() => recount());                   /* entrance fades in through .on, count from the truth */
        }
        function recount () {
            const a = scanGrid() ? accInfo() : null;      /* v8.1: on scan grids the number is the served range, not the DOM */
            lastCount = a ? accCount(a) : scopedIds().length;
            paint();
        }

        function boot () {
            if (!document.body) return;
            if (get('pagePill')) { if (!root || !root.isConnected) build(); else recount(); }
            else if (root && root.isConnected) root.remove();
            paint();
        }

        return {
            boot: boot,
            sync: boot,                             /* the panel toggle asks for exactly this */
            recount: recount,                       /* the listing changed — re-read the truth */
            onCount: n => {                          /* the grid's own renders feed the number */
                const a = scanGrid() ? accInfo() : null;
                lastCount = a ? accCount(a) : (n || 0);
                paint();
            },
        };
    })();

    /* ═══ LIGHTBOX ════════════════════════════════════════════════ */

    const MAX_ZOOM = 8;
    const HD_MAX_TRIES  = 3;
    const HD_BACKOFF    = [700, 1800];
    let _lb = null, _lbR = null, _lbId = null, _lbTok = 0, _lbIds = [];

    const setLdr = on => { if (_lbR) _lbR.ldr.style.display = on ? '' : 'none'; };

    function stageBox (R) {
        const cs = getComputedStyle(R.stage);
        const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
        const pt = parseFloat(cs.paddingTop)  || 0, pb = parseFloat(cs.paddingBottom) || 0;
        R.cw = Math.max(0, R.stage.clientWidth - pl - pr);
        R.ch = Math.max(0, R.stage.clientHeight - pt - pb);
        R.cx = pl + R.cw / 2;
        R.cy = pt + R.ch / 2;
    }

    function sizeImg (im, natW, natH, setBase) {
        const R = _lbR; if (!R || !im || !natW || !natH) return;
        stageBox(R);
        if (!R.cw || !R.ch) return;
        const s = Math.min(R.cw / natW, R.ch / natH);
        const w = Math.max(1, Math.round(natW * s));
        const h = Math.max(1, Math.round(natH * s));
        im.style.width = w + 'px';
        im.style.height = h + 'px';
        if (setBase) {
            R.baseW = w; R.baseH = h; R.baseNat = { w: natW, h: natH };
            clampPan(R);
            applyZoom(false);
            updateZoomUI(R);
            R.zc.classList.add('on');
        }
    }

    function killSwipe (R) {
        for (const im of [R.pvEl, R.hdEl]) if (im) im.classList.remove('nx-sw-in', 'nx-sw-f', 'nx-sw-b');
    }
    function clampPan (R) {
        if (!R.baseW) return;
        const mx = Math.abs(R.zoom * R.baseW - R.cw) / 2;
        const my = Math.abs(R.zoom * R.baseH - R.ch) / 2;
        R.tx = Math.min(mx, Math.max(-mx, R.tx));
        R.ty = Math.min(my, Math.max(-my, R.ty));
    }
    /* v7.9.1 — the HD layer keeps its TRUE natural pixel size and is
       fitted by the transform itself (zoom * hdFitScale), so the
       browser always holds a full-quality decode and zooming only
       ever samples DOWN from native pixels. The preview keeps the
       classic fit-sized box; both share the same translate because
       transform-origin is each box's center and both boxes are
       flex-centered on the same stage center — the two layers stay
       pixel-aligned at every zoom (proof: the hd transform's scale
       maps natW to the same on-screen width zoom*baseW gives the
       preview, and the translate is applied in screen space for
       both). */
    function hdFitScale (R) {
        if (!R.hdNat || !R.cw || !R.ch) return 1;
        return Math.min(R.cw / R.hdNat.w, R.ch / R.hdNat.h);
    }
    function applyZoom (anim) {
        const R = _lbR; if (!R) return;
        const t = 'translate3d(' + R.tx.toFixed(2) + 'px,' + R.ty.toFixed(2) + 'px,0) scale(' + R.zoom.toFixed(4) + ')';
        const th = R.hdEl ? 'translate3d(' + R.tx.toFixed(2) + 'px,' + R.ty.toFixed(2) + 'px,0) scale(' + (R.zoom * hdFitScale(R)).toFixed(4) + ')' : null;
        for (const im of [R.pvEl, R.hdEl]) {
            if (!im) continue;
            im.classList.toggle('nx-anim', !!anim);
            im.style.transform = (im === R.hdEl && th) ? th : t;
        }
    }
    function updateZoomUI (R) {
        R.zpct.textContent = Math.round(R.zoom * 100) + '%';
        R.zout.disabled = R.zoom <= 1.001;
        R.zfit.disabled = R.zoom <= 1.001;
        R.zin.disabled  = R.zoom >= MAX_ZOOM - 0.001;
        R.stage.classList.toggle('nx-pannable', R.zoom > 1.001);
    }
    function setZoom (z, anchor, anim) {
        const R = _lbR; if (!R || !R.baseW) return;
        z = Math.max(1, Math.min(MAX_ZOOM, z));
        if (!anchor) anchor = { x: R.cx, y: R.cy };
        const qx = (anchor.x - R.cx - R.tx) / R.zoom;
        const qy = (anchor.y - R.cy - R.ty) / R.zoom;
        R.zoom = z;
        R.tx = anchor.x - R.cx - z * qx;
        R.ty = anchor.y - R.cy - z * qy;
        if (z <= 1.0001) { R.zoom = 1; R.tx = 0; R.ty = 0; }
        clampPan(R);
        killSwipe(R);
        applyZoom(anim);
        updateZoomUI(R);
    }
    function zoomStep (f) { const R = _lbR; if (!R) return; setZoom(R.zoom * f, null, true); }

    /* v7.9.1 — one tap to TRUE native pixels: the zoom factor that
       makes the active layer (the HD image when shown, else the
       preview) render one image pixel per screen pixel. */
    function oneToOneZoom (R) {
        const nat = (R.hdEl && !R.hdEl.classList.contains('nx-off') && R.hdNat) ? R.hdNat
                  : (R.pvEl ? { w: R.pvEl.naturalWidth, h: R.pvEl.naturalHeight } : R.baseNat);
        if (!nat || !nat.w || !R.cw || !R.ch) return 1;
        const fs = Math.min(R.cw / nat.w, R.ch / nat.h);
        return fs > 0 ? Math.max(1, 1 / fs) : 1;
    }
    function zoomNative () {
        const R = _lbR; if (!R || !R.baseW) return;
        setZoom(oneToOneZoom(R), null, true);
    }

    const _wheelPt = { x: 0, y: 0 };
    let _wheelAcc = 0, _wheelRaf = false;

    function lbOnWheel (e) {
        if (e.target.closest && e.target.closest('.nx-lb-bar, .nx-zc, .nx-lb-arr')) return;
        e.preventDefault();
        const R = _lbR; if (!R) return;
        _wheelPt.x = e.clientX; _wheelPt.y = e.clientY;
        _wheelAcc += (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY);
        if (!_wheelRaf) { _wheelRaf = true; requestAnimationFrame(lbWheelApply); }
    }
    function lbWheelApply () {
        _wheelRaf = false;
        const R = _lbR;
        if (!R || !R.baseW) { _wheelAcc = 0; return; }
        const factor = Math.exp(-_wheelAcc * 0.0016);
        _wheelAcc = 0;
        setZoom(R.zoom * factor, { x: _wheelPt.x - R.cRect.left, y: _wheelPt.y - R.cRect.top }, false);
    }

    function lbOnPointerDown (e) {
        const R = _lbR; if (!R) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        R.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { R.stage.setPointerCapture(e.pointerId); } catch {}
        R.suppressClick = false;
        if (R.pts.size === 1) {
            R.drag = { x0: e.clientX, y0: e.clientY, t0x: R.tx, t0y: R.ty, moved: false, pan: R.zoom > 1.001 };
            if (R.drag.pan) R.stage.classList.add('nx-grabbing');
        } else {
            R.drag = null;
            if (R.pts.size === 2) {
                const [a, b] = [...R.pts.values()];
                R.pinch = { d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), z0: R.zoom };
            } else R.pinch = null;
        }
    }
    function lbOnPointerMove (e) {
        const R = _lbR; if (!R || !R.pts.has(e.pointerId)) return;
        R.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (R.pinch && R.pts.size >= 2) {
            const [a, b] = [...R.pts.values()];
            const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            const pt = { x: (a.x + b.x) / 2 - R.cRect.left, y: (a.y + b.y) / 2 - R.cRect.top };
            setZoom(R.pinch.z0 * (d / R.pinch.d0), pt, false);
            return;
        }
        if (!R.drag) return;
        const dx = e.clientX - R.drag.x0, dy = e.clientY - R.drag.y0;
        if (Math.abs(dx) + Math.abs(dy) > 5) R.drag.moved = true;
        if (R.drag.pan) {
            R.tx = R.drag.t0x + dx; R.ty = R.drag.t0y + dy;
            clampPan(R);
            if (!R.panRaf) {
                R.panRaf = true;
                requestAnimationFrame(() => { R.panRaf = false; if (_lbR === R) applyZoom(false); });
            }
        }
    }
    function lbOnPointerUp (e) {
        const R = _lbR; if (!R) return;
        if (R.pts.delete(e.pointerId)) {
            if (R.pts.size < 2) R.pinch = null;
            if (R.pts.size === 0 && R.drag) { R.suppressClick = R.drag.moved; R.drag = null; }
        }
        R.stage.classList.remove('nx-grabbing');
    }
    function lbOnClick (e) {
        const R = _lbR; if (!R) return;
        if (R.suppressClick) { R.suppressClick = false; return; }
        if (e.target && e.target.tagName !== 'IMG') lbClose();
    }
    function lbOnResize () {
        const R = _lbR; if (!R || R.rsRaf) return;
        R.rsRaf = true;
        requestAnimationFrame(() => {
            R.rsRaf = false;
            if (_lbR !== R) return;
            R.cRect = R.stage.getBoundingClientRect();
            if (!R.baseNat) return;
            /* v7.9.1 — the preview re-fits, but the HD layer keeps its
               true natural box; only its transform's fitScale follows
               the new stage (applyZoom recomputes it from R.cw/R.ch),
               and a preview-less HD view re-derives the zoom base from
               its own natural size. */
            if (R.pvEl) sizeImg(R.pvEl, R.baseNat.w, R.baseNat.h, true);
            else if (R.hdEl && R.hdNat) {
                stageBox(R);
                if (R.cw && R.ch) {
                    const s = Math.min(R.cw / R.hdNat.w, R.ch / R.hdNat.h);
                    R.baseW = Math.max(1, Math.round(R.hdNat.w * s));
                    R.baseH = Math.max(1, Math.round(R.hdNat.h * s));
                    clampPan(R); applyZoom(false); updateZoomUI(R);
                }
            }
            if (R.thumbEl) sizeImg(R.thumbEl, R.baseNat.w, R.baseNat.h, false);
        });
    }
    function lbKey (e) {
        if (!_lb) return;
        switch (e.key) {
            case 'Escape':     e.preventDefault(); lbClose(); break;
            case 'ArrowRight': e.preventDefault(); e.stopPropagation(); lbNav(1);  break;
            case 'ArrowLeft':  e.preventDefault(); e.stopPropagation(); lbNav(-1); break;
            case '+': case '=': e.preventDefault(); zoomStep(1.45); break;
            case '-': case '_': e.preventDefault(); zoomStep(1 / 1.45); break;
            case '0': case 'f': case 'F': e.preventDefault(); setZoom(1, null, true); break;
            case '1': e.preventDefault(); zoomNative(); break;
        }
    }

    function lbRefreshIds () {
        _lbIds = [];
        for (const f of document.querySelectorAll('figure.thumb[data-wallpaper-id]')) {
            const id = f.getAttribute('data-wallpaper-id'); if (id) _lbIds.push(id);
        }
    }
    function lbOpenFromFig (fig) {
        const id = fig.getAttribute('data-wallpaper-id'); if (!id) return;
        const img = fig.querySelector('img');
        const src = (img && (img.currentSrc || img.src)) || (img && img.getAttribute('data-src')) || deriveThumb(id);
        lbOpen(id, src);
    }
    function lbClose (instant) {
        if (!_lb) return;
        const el = _lb;
        if (_lbR) {
            clearTimeout(_lbR.hdRetryT);
            if (_lbR.pinnedId) ImagePool.unpin(_lbR.pinnedId);
            _lbR.pts.clear();
        }
        ImagePool.abortKind('main');
        _lb = null; _lbId = null; _lbTok++; _lbR = null;
        window.removeEventListener('resize', lbOnResize);
        el.removeEventListener('wheel', lbOnWheel);
        document.removeEventListener('keydown', lbKey);
        document.body.style.overflow = '';
        if (instant) el.remove();
        else { el.classList.add('nx-lb-out'); setTimeout(() => el.remove(), 130); }
    }
    function lbNav (dir) {
        if (!_lb || !_lbId) return;
        const i = _lbIds.indexOf(_lbId);
        if (i === -1) return;
        const nid = _lbIds[i + dir];
        if (!nid) return;
        const fig = document.querySelector('figure.thumb[data-wallpaper-id="' + nid + '"]');
        let src = '';
        if (fig) { const im = fig.querySelector('img'); src = (im && (im.currentSrc || im.src)) || (im && im.getAttribute('data-src')) || ''; }
        lbLoad(nid, src || deriveThumb(nid), dir);
    }
    function lbSync () {
        const R = _lbR; if (!R) return;
        const i = _lbIds.indexOf(_lbId);
        R.arrP.classList.toggle('off', i <= 0);
        R.arrN.classList.toggle('off', i === -1 || i >= _lbIds.length - 1);
        R.num.textContent = (i !== -1 && _lbIds.length) ? (i + 1) + ' / ' + _lbIds.length : '';
    }
    function setBloom (src) {
        const R = _lbR; if (!R) return;
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) { R.bloom.style.opacity = '0'; R.bloomSrc = ''; return; }
        if (R.bloomSrc !== src) { R.bloomImg.src = src; R.bloomSrc = src; }
        R.bloom.style.opacity = '';
    }
    /* v7.9.1 — the meta bar is a pure render of R.data (plus the HD
       natural size when present). applyMeta MERGES whatever arrives —
       the cached partial first, then the full fresh record — and
       every merge re-renders the chips from scratch, so a late
       arrival can never duplicate a chip and the tags always land on
       the FIRST open. */
    function renderMetaChips (R) {
        const d = R.data || {};
        R.metaX.textContent = '';
        if (d.tags && d.tags.length) {
            const s = mk('span', 'nx-lb-chip'); s.textContent = d.tags.slice(0, 6).join(' · ');
            R.metaX.appendChild(s);
        }
        if (d.created) {
            const s = mk('span', 'nx-lb-chip'); s.textContent = fmtDate(d.created);
            R.metaX.appendChild(s);
        }
        const res = R.resVal || d.resolution || '';
        if (res) {
            const s = mk('span', 'nx-lb-chip'); s.textContent = res;
            R.metaX.appendChild(s);
        }
    }
    function applyMeta (m) {
        const R = _lbR; if (!R || !m) return;
        const d = R.data || (R.data = {});
        if (m.path) d.path = m.path;
        if (m.ext) d.ext = m.ext;
        if (m.tags && m.tags.length) d.tags = m.tags;
        if (m.created) d.created = m.created;
        if (m.resolution) d.resolution = m.resolution;
        renderMetaChips(R);
    }
    function lbShowError (msg) {
        const R = _lbR; if (!R) return;
        setLdr(false);
        if (R.pvEl || R.thumbEl || R.hdEl) {
            if (!R.errEl) { const n = mk('div', 'nx-lb-note'); n.textContent = msg; R.el.appendChild(n); R.errEl = n; }
        } else {
            const n = mk('div', 'nx-lb-err'); n.textContent = msg;
            R.stage.appendChild(n); R.errEl = n;
        }
    }

    const _warmed = new Set();
    function prefetchNeighbor (off) {
        const i = _lbIds.indexOf(_lbId);
        if (i === -1) return;
        const nid = _lbIds[i + off];
        if (!nid) return;
        const m = _meta.get(nid);
        const url = (m && m.preview) || deriveLarge(nid);
        if (!_warmed.has(url)) { _warmed.add(url); const im = new Image(); im.decoding = 'async'; im.src = url; }
        if (!_meta.has(nid)) fetchWallData(nid).catch(() => {});
    }

    /* ── HD Mode ── */

    function hdBtnSync (R) {
        const st = R.hdState;
        R.hdBtn.classList.toggle('nx-on', !!R.hdOn);
        R.hdBtn.classList.toggle('nx-load', st === 'load');
        R.hdBtn.classList.toggle('nx-proc', st === 'load' && !!R.hdProc);
        R.hdBtn.classList.toggle('nx-retry', st === 'retry');
        R.hdIco.innerHTML = st === 'ok' ? IC.ok : st === 'retry' ? IC.sync : IC.hd;
        /* v8.1: the label narrates the real phase — MB while bytes
           flow, "Rendering" while the bitmap decodes, never a blank
           stare at a full bar. */
        R.hdLbl.textContent = st === 'retry' ? 'Retry HD'
            : (st === 'load' && R.hdLblTxt) ? R.hdLblTxt
            : 'HD Mode';
        R.hdBtn.title = st === 'retry' ? 'Retry HD for this wallpaper' : 'Toggle HD Mode (persistent)';
        R.hdBtn.setAttribute('aria-label', st === 'retry' ? 'Retry HD' : 'Toggle HD Mode');
    }

    function hdSetProg (R, frac) {
        R.hdProgFrac = frac;
        if (R.hdProgRaf) return;
        R.hdProgRaf = true;
        requestAnimationFrame(() => {
            R.hdProgRaf = false;
            if (_lbR !== R) return;
            if (R.hdProgFrac < 0) {
                R.hdBar.classList.add('nx-indet');
                R.hdBarI.style.width = '';
            } else {
                R.hdBar.classList.remove('nx-indet');
                R.hdBarI.style.width = (R.hdProgFrac * 100).toFixed(1) + '%';
            }
        });
    }

    /* v8.1: the label's live byte readout — throttled to whole-MB
       steps so the text never thrashes on fast links. */
    const fmtMB = b => (b / 1048576).toFixed(1);
    function hdLblBytes (R, loaded, total) {
        const txt = total > 0 ? fmtMB(loaded) + ' / ' + fmtMB(total) + ' MB' : fmtMB(loaded) + ' MB';
        if (R.hdLblNext !== txt) { R.hdLblNext = txt; R.hdLblTxt = txt; hdBtnSync(R); }
    }

    function setHDMode (on) {
        on = !!on;
        set('hdMode', on);
        const R = _lbR;
        if (!R || !_lbId) return;
        R.hdGen++;
        clearTimeout(R.hdRetryT); R.hdRetryT = 0;
        R.hdOn = on;
        if (!on) {
            if (R.hdEl) R.hdEl.classList.add('nx-off');
            if (R.pvEl) R.pvEl.classList.remove('nx-off');
            R.hdState = 'idle';
            R.hdProc = false; R.hdLblTxt = ''; R.hdLblNext = '';
            hdBtnSync(R);
            return;
        }
        if (R.hdEl) { hdApply(R); return; }
        R.hdTries = 0;
        hdBegin(R);
    }

    function hdBegin (R) {
        clearTimeout(R.hdRetryT); R.hdRetryT = 0;
        const gen = ++R.hdGen, tok = _lbTok;
        R.hdState = 'load';
        R.hdProc = false; R.hdLblTxt = ''; R.hdLblNext = '';   /* v8.1: every attempt starts the bar from a clean slate */
        R.hdBar.classList.remove('nx-indet');
        R.hdBarI.style.width = '';
        hdSetProg(R, -1);
        hdBtnSync(R);
        hdLoad(R, gen, tok);
    }

    async function hdLoad (R, gen, tok) {
        const id = _lbId;
        let url = null, usedPath = null, lastErr = null;
        const tryPath = async p => {
            try {
                const u = await ImagePool.request(id, p, {
                    kind: 'main',
                    onprogress: (l, t) => {
                        if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
                        /* v8.1: the bar NEVER reads 100% while still
                           downloading — a full bar that does nothing is
                           the oldest lie in progress UIs. Unknown totals
                           (no Content-Length) run the indeterminate
                           shimmer instead of freezing. */
                        if (t > 0) hdSetProg(R, Math.min(0.992, l / t));
                        else if (l > 0) hdSetProg(R, -1);
                        hdLblBytes(R, l, t);
                    },
                });
                if (u) usedPath = p;
                return u;
            } catch (e) { lastErr = e; return null; }
        };

        const m0 = _meta.get(id);
        if (m0 && m0.path) url = await tryPath(m0.path);
        if (!url && (!lastErr || lastErr.status)) {
            const guess = deriveFullUrl(id, 'jpg');
            if (!m0 || !m0.path || m0.path !== guess) url = await tryPath(guess);
        }
        if (!url && (!lastErr || lastErr.status)) {
            const m = await fetchWallData(id).catch(() => null);
            if (m && m.path && !(m0 && m0.path === m.path)) url = await tryPath(m.path);
        }

        if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
        if (!url) { hdFail(R, gen, tok, lastErr); return; }

        /* v8.1: pin the blob for the WHOLE decode — an eviction under
           cache pressure used to revoke the object URL mid-decode and
           kill the conversion (the retry then re-downloaded it). */
        ImagePool.pin(id);
        if (R.pinnedId && R.pinnedId !== id) ImagePool.unpin(R.pinnedId);
        R.pinnedId = id;

        /* v8.1: the blob landed — flip the bar to a distinct green
           "Rendering" shimmer while the bitmap decodes, so the gap
           between download-done and image-on-screen is narrated. */
        R.hdProc = true; R.hdLblTxt = 'Rendering…'; R.hdLblNext = '';
        hdSetProg(R, 1);
        const hdToIndet = () => { if (_lbR === R && R.hdState === 'load' && R.hdProc) hdSetProg(R, -1); };
        requestAnimationFrame(hdToIndet);
        setTimeout(hdToIndet, 140);      /* rAF freezes in background tabs — the shimmer must not */
        hdBtnSync(R);

        const img = new Image();
        img.className = 'nx-lb-img nx-off';
        img.decoding = 'async'; img.draggable = false; img.alt = 'wallpaper ' + id;
        img.src = url;
        /* v8.1: decode is raced against a hard 8 s bound — an exotic
           or pathological codec can never wedge the pipeline; if the
           metadata has parsed by then, naturalWidth carries us. */
        try { if (img.decode) await Promise.race([img.decode().catch(() => {}), sleep(8000)]); } catch {}
        if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) {
            if (_lbR !== R && R.pinnedId === id) { ImagePool.unpin(id); R.pinnedId = null; }   /* v8.1: the lightbox is gone — don't leak the pin */
            return;
        }
        if (!img.naturalWidth) {
            /* v8.1 second chance — an image that already settled fires
               no further events, so img.complete answers instantly
               and only a genuinely pending load waits (6 s cap). */
            const gotNat = img.complete
                ? !!img.naturalWidth                  /* already settled — loaded or errored, no events will ever fire */
                : await Promise.race([
                    new Promise(res => { img.onload = () => res(true); img.onerror = () => res(false); }),
                    sleep(6000).then(() => false),
                ]);
            if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) {
                if (_lbR !== R && R.pinnedId === id) { ImagePool.unpin(id); R.pinnedId = null; }   /* v8.1: the lightbox is gone — don't leak the pin */
                return;
            }
            if (!gotNat || !img.naturalWidth) { hdFail(R, gen, tok, null); return; }
        }

        /* v7.9.1 — no fit-box pre-sizing: hdMount lays the HD layer
           out at its TRUE natural pixel size. */
        R.hdEl = img;
        if (usedPath) R.hdPath = usedPath;
        R.stage.appendChild(img);
        hdApply(R);
    }

    function hdFail (R, gen, tok, err) {
        if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
        /* v8.1: an aborted attempt while this lightbox is STILL the
           current target used to return silently and leave the 'load'
           state (and its bar) frozen forever. It now re-arms through
           the same retry ladder as any other failure. */
        if (err && err.aborted) {
            R.hdTries++;
            if (R.hdTries < HD_MAX_TRIES) {
                const delay = HD_BACKOFF[Math.min(R.hdTries - 1, HD_BACKOFF.length - 1)];
                hdSetProg(R, -1);
                R.hdRetryT = setTimeout(() => {
                    R.hdRetryT = 0;
                    if (!_lb || _lbR !== R || tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
                    hdBegin(R);
                }, delay);
            } else { R.hdState = 'retry'; hdBtnSync(R); }
            return;
        }
        R.hdTries++;
        if (R.hdTries < HD_MAX_TRIES) {
            const delay = HD_BACKOFF[Math.min(R.hdTries - 1, HD_BACKOFF.length - 1)];
            hdSetProg(R, -1);
            R.hdRetryT = setTimeout(() => {
                R.hdRetryT = 0;
                if (!_lb || _lbR !== R || tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
                hdBegin(R);
            }, delay);
            return;
        }
        R.hdState = 'retry';
        hdBtnSync(R);
        if (!R.pvEl && !R.thumbEl) lbShowError('Full resolution unavailable.');
    }

    /* v7.9.1 — lay the HD layer out at its TRUE natural pixel size.
       This is the whole fix for the 8K bug: an <img> whose layout box
       is much smaller than its bitmap gets its decode clamped to the
       box, and a CSS transform zoom then only upscales that clamp.
       At natural size the decode is always full quality; the zoom
       transform (zoom * fitScale) only ever shrinks real pixels. */
    function hdMount (R) {
        const im = R.hdEl; if (!im) return;
        const nw = im.naturalWidth, nh = im.naturalHeight;
        if (!nw || !nh) return;
        R.hdNat = { w: nw, h: nh };
        im.classList.add('nx-lb-hdnat');
        im.style.width  = nw + 'px';
        im.style.height = nh + 'px';
        if (!R.baseW) {                    /* no preview ever sized: the HD image is the base */
            stageBox(R);
            if (!R.cw || !R.ch) return;
            const s = Math.min(R.cw / nw, R.ch / nh);
            R.baseW = Math.max(1, Math.round(nw * s));
            R.baseH = Math.max(1, Math.round(nh * s));
            R.baseNat = { w: nw, h: nh };
            clampPan(R); applyZoom(false); updateZoomUI(R);
            R.zc.classList.add('on');
        } else applyZoom(false);
    }
    function hdApply (R) {
        if (!R.hdEl) return;
        R.hdOn = true;
        R.hdState = 'ok';
        R.hdProc = false; R.hdLblTxt = ''; R.hdLblNext = '';   /* v8.1: clear the narrated phase */
        clearTimeout(R.hdRetryT); R.hdRetryT = 0;
        if (R.thumbEl) { R.thumbEl.remove(); R.thumbEl = null; }
        hdMount(R);
        if (R.pvEl) R.pvEl.classList.add('nx-off');
        R.hdEl.classList.remove('nx-off');
        R.hdEl.classList.remove('nx-hd-in');
        void R.hdEl.offsetWidth;
        R.hdEl.classList.add('nx-hd-in');
        hdBtnSync(R);
        ImagePool.pin(_lbId);
        if (R.pinnedId && R.pinnedId !== _lbId) ImagePool.unpin(R.pinnedId);
        R.pinnedId = _lbId;
        if (!R.resVal && R.hdNat) { R.resVal = R.hdNat.w + '×' + R.hdNat.h; renderMetaChips(R); }
    }

    async function lbLoad (id, thumbSrc, dir) {
        if (!_lb) return;
        const my = ++_lbTok; _lbId = id;
        const R = _lbR;

        for (const im of [R.thumbEl, R.pvEl, R.hdEl]) if (im) im.remove();
        R.thumbEl = R.pvEl = R.hdEl = null;
        if (R.errEl) { R.errEl.remove(); R.errEl = null; }
        R.metaX.textContent = '';
        R.baseW = R.baseH = 0; R.baseNat = null;
        R.zoom = 1; R.tx = 0; R.ty = 0;
        R.pts.clear(); R.drag = null; R.pinch = null; R.suppressClick = false;
        R.resVal = ''; R.data = null; R.hdPath = ''; R.hdNat = null;
        R.dlBusy = false;
        R.hdOn = !!get('hdMode');
        R.hdGen++;
        R.hdTries = 0;
        R.hdState = 'idle';
        R.hdProc = false; R.hdLblTxt = ''; R.hdLblNext = '';   /* v8.1: every navigation starts the HD bar from a clean slate */
        clearTimeout(R.hdRetryT); R.hdRetryT = 0;
        if (R.pinnedId) { ImagePool.unpin(R.pinnedId); R.pinnedId = null; }
        R.zc.classList.remove('on');
        R.zpct.textContent = '100%';
        R.dlBtn.classList.remove('nx-ok', 'nx-wob');
        R.dlBtn.innerHTML = IC.dl + '<span>Download</span>';
        hdBtnSync(R);
        R.idEl.textContent = id.toUpperCase();
        setLdr(true);
        lbSync();
        setBloom(thumbSrc);

        if (thumbSrc && !thumbSrc.startsWith('data:') && !thumbSrc.startsWith('blob:')) {
            const t = new Image();
            t.decoding = 'async';
            const show = () => {
                if (my !== _lbTok || R.pvEl || R.thumbEl) return;
                t.className = 'nx-lb-img nx-lb-ph';
                t.alt = ''; t.draggable = false;
                R.thumbEl = t;
                R.stage.appendChild(t);
                sizeImg(t, t.naturalWidth, t.naturalHeight, false);
                setLdr(false);
            };
            t.onload = show; t.onerror = () => {};
            t.src = thumbSrc;
        }

        /* v7.9.1 — the fresh record is ALWAYS applied when it lands:
           page-sync/scan seed the cache with partial (tagless)
           records, and dropping the fresh merge made the first open
           render without tags until a second click. */
        const meta0 = _meta.get(id) || null;
        const metaP = fetchWallData(id).catch(() => null);
        if (meta0) applyMeta(meta0);
        metaP.then(m => { if (m && my === _lbTok) applyMeta(m); });

        const previewUrl = (meta0 && meta0.preview) || deriveLarge(id);
        const pv = new Image();
        let pvOk = false;
        await new Promise(res => { pv.onload = () => { pvOk = true; res(); }; pv.onerror = res; pv.decoding = 'async'; pv.src = previewUrl; });
        if (my !== _lbTok) return;

        if (pvOk) {
            pv.className = 'nx-lb-img' + ((R.hdEl && !R.hdEl.classList.contains('nx-off')) ? ' nx-off' : '');
            pv.alt = 'wallpaper ' + id; pv.draggable = false;
            if (R.thumbEl) { R.thumbEl.remove(); R.thumbEl = null; }
            R.pvEl = pv;
            R.stage.appendChild(pv);
            sizeImg(pv, pv.naturalWidth, pv.naturalHeight, true);
            setLdr(false);
            pv.classList.add(dir > 0 ? 'nx-sw-f' : dir < 0 ? 'nx-sw-b' : 'nx-sw-in');
            prefetchNeighbor(dir >= 0 ? 1 : -1);
            if (R.hdOn && !R.hdEl) hdBegin(R);
        } else {
            R.hdOn = true;
            hdBegin(R);
        }
    }

    function lbOpen (id, thumbSrc) {
        if (_lb) lbClose(true);
        lbRefreshIds();

        const el = mk('div', 'nx-lb');
        el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', 'Wallpaper preview');

        const bg = mk('div', 'nx-lb-bg');
        const bloom = mk('div', 'nx-lb-bloom');
        const bloomImg = new Image(); bloomImg.alt = ''; bloom.appendChild(bloomImg);

        const stage = mk('div', 'nx-lb-stage');
        stage.addEventListener('pointerdown', lbOnPointerDown);
        stage.addEventListener('pointermove', lbOnPointerMove);
        stage.addEventListener('pointerup', lbOnPointerUp);
        stage.addEventListener('pointercancel', lbOnPointerUp);
        stage.addEventListener('click', lbOnClick);

        const ldr = mk('div', 'nx-lb-ldr');
        ldr.appendChild(mk('div', 'nx-lb-ring'));

        const zc = mk('div', 'nx-zc');
        const zpct = mk('span', 'nx-zc-pct'); zpct.textContent = '100%';
        const zin  = mk('button'); zin.type = 'button';  zin.innerHTML = IC.plus;  zin.title = 'Zoom in (+)'; zin.setAttribute('aria-label', 'Zoom in');
        const zfit = mk('button'); zfit.type = 'button'; zfit.innerHTML = IC.fit;  zfit.title = 'Fit to screen (0)'; zfit.setAttribute('aria-label', 'Fit to screen');
        const zout = mk('button'); zout.type = 'button'; zout.innerHTML = IC.minus; zout.title = 'Zoom out (−)'; zout.setAttribute('aria-label', 'Zoom out');
        const z1 = mk('button', 'nx-zc-11'); z1.type = 'button'; z1.textContent = '1:1';
        z1.title = 'Zoom 1:1 — one image pixel per screen pixel (1)'; z1.setAttribute('aria-label', 'Zoom to native pixels');
        zin.addEventListener('click',  e => { e.stopPropagation(); zoomStep(1.45); });
        zfit.addEventListener('click', e => { e.stopPropagation(); setZoom(1, null, true); });
        zout.addEventListener('click', e => { e.stopPropagation(); zoomStep(1 / 1.45); });
        z1.addEventListener('click', e => { e.stopPropagation(); zoomNative(); });
        zc.append(zpct, zin, zfit, z1, zout);

        const bar = mk('div', 'nx-lb-bar');
        const meta = mk('div', 'nx-lb-meta');
        const idEl = mk('span', 'nx-lb-id');
        const num = mk('span', 'nx-lb-num');
        const metaX = mk('span', 'nx-lb-mx');
        meta.append(idEl, num, metaX);

        const acts = mk('div', 'nx-lb-acts');
        const hdBtn = mk('button', 'nx-lb-ab nx-lb-hd'); hdBtn.type = 'button';
        const hdIco = mk('span', 'nx-hd-ico'); hdIco.innerHTML = IC.hd;
        const hdLbl = mk('span', 'nx-hd-lbl'); hdLbl.textContent = 'HD Mode';
        const hdBar = mk('span', 'nx-hd-prog'); const hdBarI = mk('i'); hdBar.appendChild(hdBarI);
        hdBtn.append(hdIco, hdLbl, hdBar);
        const dlBtn = mk('button', 'nx-lb-ab'); dlBtn.type = 'button'; dlBtn.innerHTML = IC.dl + '<span>Download</span>';
        const op = mk('button', 'nx-lb-ab'); op.type = 'button'; op.innerHTML = IC.open + '<span>Open page</span>';
        op.addEventListener('click', () => window.open('https://wallhaven.cc/w/' + (_lbId || ''), '_blank'));
        const xb = mk('button', 'nx-lb-ab nx-lb-x'); xb.type = 'button'; xb.innerHTML = IC.x; xb.title = 'Close (Esc)';
        xb.addEventListener('click', () => lbClose());
        acts.append(hdBtn, dlBtn, op, xb);
        bar.append(meta, acts);

        const arrP = mk('button', 'nx-lb-arr nx-lb-arr-p'); arrP.type = 'button'; arrP.innerHTML = IC.left;  arrP.title = 'Previous (←)';
        arrP.addEventListener('click', e => { e.stopPropagation(); lbNav(-1); });
        const arrN = mk('button', 'nx-lb-arr nx-lb-arr-n'); arrN.type = 'button'; arrN.innerHTML = IC.right; arrN.title = 'Next (→)';
        arrN.addEventListener('click', e => { e.stopPropagation(); lbNav(1); });
        const hint = mk('div', 'nx-lb-hint'); hint.textContent = 'Esc close · ← → browse · scroll zoom · drag pan';

        el.append(bg, bloom, ldr, stage, zc, arrP, arrN, bar, hint);
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', lbKey);
        el.addEventListener('wheel', lbOnWheel, { passive: false });
        window.addEventListener('resize', lbOnResize);

        _lb = el;
        _lbR = {
            el: el, stage: stage, ldr: ldr, metaX: metaX, idEl: idEl, num: num,
            hdBtn: hdBtn, hdIco: hdIco, hdLbl: hdLbl, hdBar: hdBar, hdBarI: hdBarI, dlBtn: dlBtn, arrP: arrP, arrN: arrN, bloom: bloom, bloomImg: bloomImg,
            zc: zc, zin: zin, zout: zout, zfit: zfit, zpct: zpct,
            thumbEl: null, pvEl: null, hdEl: null, errEl: null,
            baseW: 0, baseH: 0, baseNat: null, cw: 0, ch: 0, cx: 0, cy: 0, cRect: null,
            zoom: 1, tx: 0, ty: 0,
            pts: new Map(), drag: null, pinch: null, suppressClick: false, panRaf: false, rsRaf: false,
            hdOn: false, hdGen: 0, hdPath: '',
            hdState: 'idle', hdTries: 0, hdRetryT: 0, hdProgFrac: -1, hdProgRaf: false,
            hdProc: false, hdLblTxt: '', hdLblNext: '',
            pinnedId: null, data: null, resVal: '', hdNat: null, dlBusy: false, bloomSrc: '',
        };
        _lbR.cRect = stage.getBoundingClientRect();

        hdBtn.addEventListener('click', () => {
            const R = _lbR; if (!R) return;
            if (R.hdState === 'retry') {
                R.hdTries = 0;
                hdBegin(R);
                return;
            }
            setHDMode(!R.hdOn);
        });
        dlBtn.addEventListener('click', () => {
            const R = _lbR; if (!R || R.dlBusy || !_lbId) return;
            R.dlBusy = true;
            btnPulse(dlBtn);
            DL.add(_lbId, {
                onStart: () => {
                    dlBtn.innerHTML = IC.ok + '<span>Started</span>';
                    dlBtn.classList.add('nx-ok');
                    setTimeout(() => lbClose(), 700);
                },
                onFail: () => {
                    R.dlBusy = false;
                    dlBtn.classList.remove('nx-ok');
                    dlBtn.innerHTML = IC.dl + '<span>Download</span>';
                    dlBtn.classList.add('nx-wob');
                    setTimeout(() => dlBtn.classList.remove('nx-wob'), 450);
                },
            });
        });

        lbLoad(id, thumbSrc, 0);
    }

    /* ── v7.9.1 hover prime — tags & HD path local before the click ──
       One passive document-level listener; a 300 ms dwell over a
       thumbnail fires (at most) the same metadata fetch the click
       itself would trigger — deduped by the cache, paced by the
       rate shield, free for anything already fetched. The first
       open of any wallpaper then carries its tags instantly. */
    const HOVER_PRIME_MS = 300;
    let _primeT = 0;
    document.addEventListener('pointerover', (e) => {
        clearTimeout(_primeT);
        const t = e.target;
        const fig = t && t.closest && t.closest('figure.thumb[data-wallpaper-id]');
        if (!fig) return;
        const id = fig.getAttribute('data-wallpaper-id');
        const m = id && _meta.get(id);
        if (m && m.tagsFetched === true) return;
        _primeT = setTimeout(() => {
            if (!fig.isConnected) return;
            if (id) fetchWallData(id).catch(() => {});
        }, HOVER_PRIME_MS);
    }, { passive: true });

    /* ═══ HYPER DOWNLOAD MODE ══════════════════════════════════════ */

    let _hyper = false;
    const hyperPill = mk('div', 'nx-hyper-pill');
    hyperPill.style.display = 'none';
    hyperPill.innerHTML = IC.bolt + '<span>Hyper — click a wallpaper to download</span>';
    const hxOff = mk('button'); hxOff.type = 'button'; hxOff.title = 'Turn off'; hxOff.innerHTML = IC.x;
    hyperPill.appendChild(hxOff);

    function setHyper (on) {
        _hyper = on;
        document.body.classList.toggle('nx-hyper-on', on);
        hyperPill.style.display = on ? 'flex' : 'none';
        for (const b of document.querySelectorAll('.nx-tool-hy')) {
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', on);
            b.title = on ? 'Hyper ON — click to disable' : 'Hyper mode: click any wallpaper to download';
        }
    }
    hxOff.addEventListener('click', () => setHyper(false));

    document.addEventListener('click', (e) => {
        if (!_hyper) return;
        const fig = e.target.closest && e.target.closest('figure.thumb');
        if (!fig) return;
        if (e.target.closest('.nx-tools, .thumb-info, .wall-favs, .nx-fav')) return;
        e.preventDefault(); e.stopPropagation();
        const id = fig.getAttribute('data-wallpaper-id'); if (!id) return;
        fig.classList.add('nx-flash');
        setTimeout(() => fig.classList.remove('nx-flash'), 550);
        const ind = mk('div', 'nx-hind'); ind.innerHTML = IC.dl; fig.appendChild(ind);
        setTimeout(() => { if (ind.isConnected) ind.remove(); }, 800);
        DL.add(id);
    }, { capture: true });

    /* ═══ SEARCH HISTORY & JOB LEDGER ════════════════════════════ */
    /* v7.6.0 — every job records a stable served-id ledger (doneIds),
       a per-batch ledger, and a live phase, persisted through GM
       storage so any session survives refreshes and restarts and
       resumes without ever reprocessing a wallpaper it already
       served. */

    /* v7.8 — where a page opens: a NEW batch page starts at the very
       top (Continue / viewing a saved batch); a resumed interrupted
       batch never moves the user. Smooth, unless reduced-motion. */
    function nxScrollTop () {
        try {
            const w = document.defaultView || (typeof window !== 'undefined' ? window : null);
            if (!w || typeof w.scrollTo !== 'function') return;
            const mm = (typeof w.matchMedia === 'function') ? w.matchMedia('(prefers-reduced-motion: reduce)') : null;
            w.scrollTo({ top: 0, left: 0, behavior: (mm && mm.matches) ? 'auto' : 'smooth' });
        } catch (e) { try { window.scrollTo(0, 0); } catch (_) {} }
    }

    const HISTORY_INDEX = 'gf_hist_index';
    const BATCH_PREFIX = 'gf_batch_';
    const BUF_PREFIX   = 'gf_buf_';          /* legacy v7.5 buffers */
    const JOB_PREFIX   = 'gf_job_';
    const JOB_DONE_CAP = 12000;              /* max stable ids kept per job */
    const JOB_LEDGER_CAP = 60;               /* max batch records kept per job */
    const RANK_TAIL_CAP = 2000;              /* max unserved ranked matches persisted per job */
    const historyLoad = () => { try { return JSON.parse(GM_getValue(HISTORY_INDEX, '[]')); } catch { return []; } };
    const historySave = idx => GM_setValue(HISTORY_INDEX, JSON.stringify(idx));
    const batchLoad = id => { try { return JSON.parse(GM_getValue(BATCH_PREFIX + id, '[]')); } catch { return []; } };
    const bufLoad   = id => { try { return JSON.parse(GM_getValue(BUF_PREFIX + id, '[]')); } catch { return []; } };   /* v7.6.2: legacy v7.5 buffers */
    const jobLoad   = id => { try { return JSON.parse(GM_getValue(JOB_PREFIX + id, 'null')) || {}; } catch { return {}; } };
    const jobSave   = (id, job) => { try { GM_setValue(JOB_PREFIX + id, JSON.stringify(job)); } catch {} };
    /* v7.7 — per-batch page payloads: every completed batch is
       persisted under its own key so Settings can open it as its
       own page, separate from every other batch of the session. */
    const BPAGE_PREFIX = 'gf_bpage_';
    const bpageKey  = (id, n) => BPAGE_PREFIX + id + '_' + n;
    const bpageLoad = (id, n) => { try { return JSON.parse(GM_getValue(bpageKey(id, n), '[]')); } catch { return []; } };
    function bpageSave (id, n, items) { try { GM_setValue(bpageKey(id, n), JSON.stringify(items.map(slimWall))); } catch {} }
    function bpageDelete (id, n) { try { GM_deleteValue(bpageKey(id, n)); } catch {} }
    function wipeSessionData (id) {
        (jobLoad(id).batches || []).forEach(b => { if (b && b.n) bpageDelete(id, b.n); });
        try { GM_deleteValue(BATCH_PREFIX + id); } catch {}
        try { GM_deleteValue(BUF_PREFIX + id); } catch {}
        try { GM_deleteValue(JOB_PREFIX + id); } catch {}
    }
    const batchDelete = id => { historySave(historyLoad().filter(e => e.id !== id)); wipeSessionData(id); };
    const trimHistory = () => {
        const limit = Math.max(1, parseInt(get('maxHistory'), 10) || 20);
        const idx = historyLoad();
        if (idx.length > limit) { idx.splice(limit).forEach(e => wipeSessionData(e.id)); historySave(idx); }
    };

    function slimWall (w) {
        return { id: w.id, path: w.path, thumbs: w.thumbs ? { small: w.thumbs.small, large: w.thumbs.large } : null,
                 file_type: w.file_type, resolution: w.resolution, favorites: w.favorites,
                 created_at: w.created_at, purity: w.purity, category: w.category,
                 dimension_x: w.dimension_x, dimension_y: w.dimension_y };
    }

    function jobLabel (P) {
        return (P.query ? '"' + P.query + '" · ' : '') + P.dateFrom + ' → ' + P.dateTo +
               ' · ♥' + P.minFavs + (P.maxFavsOn ? '–' + P.maxFavs : '+') +
               ' · ' + (P.sortMode === 'date_added' ? 'new' : 'favs');
    }

    /* index-only write — used for crash-safe per-page checkpoints.
       Small (one entry, ~1 KB), never touches item payloads. */
    function sessionSaveIndex (sess) {
        const P = sess.params;
        const state = { mode: sess.mode === 'rank' ? 'rank' : 'walk', page: sess.page, itemIdx: sess.itemIdx, lastPage: sess.lastPage,
                        winTop: sess.winTop || 1, winBot: sess.winBot || 0,
                        rankCursor: sess.rankCursor || 0, rankScanned: !!sess.rankScanned,
                        rankCollected: sess.rankCollected || 0, rankRank: sess.rankRank || 0,
                        rankTotal: sess.rankTotal || 0, rankTailLost: !!sess.rankTailLost,
                        batchNum: sess.batchNum, batchServed: sess.batchServed || 0, served: sess.served || 0,
                        skipped: sess.skipped || 0, dupes: sess.dupes || 0, pagesScanned: sess.pagesScanned || 0,
                        skippedAbove: sess.skippedAbove || 0, consecMisses: sess.consecMisses || 0,
                        favFloorDone: !!sess.favFloorDone, phase: sess.phase || 'awaiting',
                        lastServedId: sess.lastServedId || '', lastError: sess.lastError || '',
                        exhausted: !!sess.exhausted, legacy: !!sess.legacy };
        const entry = {
            id: sess.id, ts: sess.ts || Date.now(), lastTs: Date.now(),
            name: sess.name || jobLabel(P),
            count: sess.served || 0,
            bcount: (sess.batches || []).length,         /* v7.7: batch sub-card badge, no job parse needed */
            label: jobLabel(P) + (state.phase === 'exhausted' ? ' · complete' : ' · next #' + state.batchNum),
            params: { query: P.query, categories: P.categories, purity: P.purity, atleast: P.atleast, ratios: P.ratios,
                      sortMode: P.sortMode, dateFrom: P.dateFrom, dateTo: P.dateTo,
                      minFavs: P.minFavs, maxFavs: P.maxFavs, maxFavsOn: P.maxFavsOn, batchSize: P.batchSize },
            state: state,
        };
        const idx = historyLoad();
        const i = idx.findIndex(e => e.id === sess.id);
        if (i !== -1) idx[i] = entry; else idx.unshift(entry);
        const limit = Math.max(1, parseInt(get('maxHistory'), 10) || 20);
        if (idx.length > limit) idx.splice(limit).forEach(e => wipeSessionData(e.id));
        historySave(idx);
    }

    /* full snapshot — batch end, pause, fatal, exhaustion. Writes the
       job ledger (stable served ids + batch records) plus the grid
       batch payload used by History → Load to re-render results. */
    function sessionSave (sess) {
        try { GM_setValue(BATCH_PREFIX + sess.id, JSON.stringify(sess.batchItems.map(slimWall))); } catch {}
        const job = jobLoad(sess.id);
        job.doneIds = (sess.doneIds && sess.doneIds.size)
            ? Array.from(sess.doneIds).slice(-JOB_DONE_CAP)
            : (job.doneIds || []);
        const allB = (sess.batches && sess.batches.length ? sess.batches : (job.batches || []));
        if (allB.length > JOB_LEDGER_CAP)                /* v7.7: dropped records take their page payloads with them */
            allB.slice(0, allB.length - JOB_LEDGER_CAP).forEach(b => { if (b && b.n) bpageDelete(sess.id, b.n); });
        job.batches = allB.slice(-JOB_LEDGER_CAP);
        sess.batches = job.batches;                       /* v7.7: the in-memory ledger (and bcount) stay honest with the cap */
        if (sess.mode === 'rank') {
            const from = sess.rankScanned ? (sess.rankRank || 0) : 0;
            if (sess.rankMatches && sess.rankMatches.length - from > RANK_TAIL_CAP) sess.rankTailLost = true;
            if (!sess.rankScanned && sess.rankTailLost) {          /* partial pool too big to keep — restart collection cleanly */
                sess.rankMatches = []; sess.rankCollected = 0; sess.rankCursor = sess.winTop || 1; sess.rankTailLost = false;
            }
            job.rankTail = (sess.rankMatches || []).slice(from, from + RANK_TAIL_CAP).map(slimWall);
            job.rankTailLost = !!sess.rankTailLost;
            job.rankTailAt = sess.rankCursor || 0;
            job.mode = 'rank';
        } else {
            job.rankTail = []; job.rankTailLost = false; job.rankTailAt = 0;
        }
        jobSave(sess.id, job);
        sessionSaveIndex(sess);
    }

    function sessionCheckpoint (sess) { sess.lastTs = Date.now(); sessionSaveIndex(sess); }

    function buildParams (c) {
        /* v7.8.1: legacy hot jobs (v7.8.0's client-side ratio rank)
           resume as new-uploads walks — the served-id ledger still
           guarantees no wallpaper is ever processed twice. */
        const sm = c.sortMode === 'hot' ? 'date_added' : c.sortMode;
        const baseParams = { categories: c.categories, purity: c.purity, sorting: sm };
        if (c.query)   baseParams.q = c.query;
        if (c.atleast) baseParams.atleast = c.atleast;
        if (c.ratios)  baseParams.ratios = c.ratios;
        return { baseParams: baseParams, query: c.query, categories: c.categories, purity: c.purity, atleast: c.atleast, ratios: c.ratios,
                 sortMode: sm, dateFrom: c.dateFrom, dateTo: c.dateTo,
                 minFavs: c.minFavs, maxFavs: c.maxFavs, maxFavsOn: c.maxFavsOn, batchSize: c.batchSize };
    }

    function restoreSearchSettings (c) {
        const i = UI.inputs;
        i.q.value = c.query || '';
        i.sort.value = c.sortMode === 'hot' ? 'date_added' : c.sortMode;   /* v7.8.1: the hot option is gone — legacy jobs land on new uploads */
        i.dfrom.value = c.dateFrom; i.dto.value = c.dateTo;
        i.minf.value = c.minFavs; i.maxf.value = c.maxFavs || 0;
        i.res.value = c.atleast || ''; i.rat.value = c.ratios || '';
        i.bs.value = c.batchSize || 200;
        setChips(UI.chips.cat, c.categories || '111');
        setChips(UI.chips.pur, c.purity || '100');
        UI.maxon.classList.toggle('on', !!c.maxFavsOn);
        UI.maxon.setAttribute('aria-pressed', !!c.maxFavsOn);
        set('query', c.query || ''); set('sortMode', c.sortMode === 'hot' ? 'date_added' : c.sortMode);
        set('dateFrom', c.dateFrom); set('dateTo', c.dateTo);
        set('minFavs', c.minFavs); set('maxFavs', c.maxFavs || 0); set('maxFavsOn', !!c.maxFavsOn);
        set('atleast', c.atleast || ''); set('ratios', c.ratios || '');
        set('categories', c.categories || '111'); set('purity', c.purity || '100');
        refreshMaxFavUI(); markFavRange(); validateDates();
    }

    function loadHistoryEntry (entry, batchN) {
        if (_running) { setStatus('✕ Pause the scan before loading a history entry.', true); return; }
        const fresh = historyLoad().find(e => e.id === entry.id);      /* v7.7: always restore the LATEST saved state, never a stale closure */
        if (fresh) entry = fresh;
        const data = batchN ? batchPagePayload(entry, batchN) : batchLoad(entry.id);
        renderBatch(data);
        _gridPage = entry.id + '#' + (batchN || (entry.state && entry.state.batchNum) || 1);   /* v7.7: which page the grid is showing */
        if (entry.params && entry.state) {
            restoreSearchSettings(entry.params);
            const st = entry.state;
            const legacy = st.mode === 'buffer' || !!st.legacy || !('phase' in st);
            const job = jobLoad(entry.id);
            const doneIds = new Set(job.doneIds || []);
            if (!doneIds.size) for (const w of data) doneIds.add(String(w.id));
            const P = buildParams(entry.params);
            const rankMode = !legacy && st.mode === 'rank';
            const tailStale = rankMode && !st.rankScanned && job.rankTailAt !== st.rankCursor;
            _session = { id: entry.id, params: P, ts: entry.ts || Date.now(),
                         name: entry.name || jobLabel(P), mode: rankMode ? 'rank' : 'walk',
                         phase: legacy ? 'legacy' : (st.phase === 'collecting' ? 'paused' : (st.phase || (st.exhausted ? 'exhausted' : 'awaiting'))),
                         page: legacy ? 1 : (st.page || 1), itemIdx: legacy ? 0 : (st.itemIdx || 0),
                         lastPage: st.lastPage || 1, winTop: st.winTop || 1, winBot: st.winBot || 0, favFloorDone: !!st.favFloorDone,
                         batchNum: st.batchNum || 1, batchServed: legacy ? 0 : (st.batchServed || 0),
                         served: st.served || st.totalFound || data.length,
                         skipped: st.skipped || 0, dupes: st.dupes || 0,
                         pagesScanned: st.pagesScanned || 0, skippedAbove: st.skippedAbove || 0,
                         consecMisses: st.consecMisses || 0,
                         exhausted: !!st.exhausted, legacy: legacy,
                         lastServedId: st.lastServedId || '', lastError: st.lastError || '',
                         cursorVerified: false, batches: job.batches || [],
                         rankCursor: tailStale ? (st.winTop || 1) : (st.rankCursor || 0),
                         rankScanned: rankMode && !!st.rankScanned,
                         rankCollected: tailStale ? 0 : (st.rankCollected || 0),
                         rankRank: rankMode ? 0 : (st.rankRank || 0),
                         rankTotal: st.rankTotal || 0, rankTailLost: !!job.rankTailLost,
                         rankMatches: rankMode ? (tailStale ? [] : (job.rankTail || [])) : [],
                         doneIds: doneIds,
                         batchItems: (!legacy && st.batchServed > 0) ? batchLoad(entry.id) : [],   /* v7.7: the live partial seeds the next payload, never a viewed page */
                         pageCache: new Map() };
            _seenIds = new Set(_session.doneIds);
            setCount(data.length);                   /* v7.7: the pill counts the page on screen */
            renderJobStrip();
            if (_session.phase === 'exhausted') {
                setContBar('done', 'No more results', _session.served.toLocaleString() + ' collected');
            } else if (legacy) {
                setContBar('go', 'Continue — recover unserved matches (v7.6.2 engine)',
                           'old buffered session · the ranked window takes over');
            } else if (rankMode && !_session.rankScanned) {
                setContBar('go', 'Continue — collect window',
                           'resumes at page ' + _session.rankCursor + '/' + Math.max(1, _session.winBot - 1));
            } else {
                const left = Math.max(0, entry.params.batchSize - _session.batchServed);
                setContBar('go', _session.phase === 'paused' || _session.phase === 'error'
                    ? 'Resume — finish batch ' + _session.batchNum + ' (' + left + ' left)'
                    : 'Continue — batch ' + _session.batchNum,
                    rankMode
                        ? (_session.rankMatches.length + ' ranked matches ready · instant')
                        : ('resumes at page ' + _session.page + (_session.phase === 'error' ? ' · retries the error' : '')));
            }
            setStatus(legacy
                ? 'Loaded a v7.5 buffered session · Continue recovers its unserved matches with the v7.6.2 ranked-window engine — wallpapers already on screen are excluded'
                : 'History restored · Continue resumes the saved cursor — or Restart to process the job from the beginning');
        } else {
            _session = null;
            renderJobStrip();
            setContBar('none', '', '');
            setStatus('✓ Loaded batch: ' + (entry.label || entry.name || ''));
        }
        refreshHistoryPanel();
    }

    /* v7.7 — open one completed batch as its own page: the grid
       shows exactly that batch's wallpapers (a separate page, not
       a continuous stream), while the session's cursor, ledger and
       resume state stay completely untouched.
       v8.1 — the LIVE in-progress batch is a page too: its
       crash-safe partial (written at every checkpoint) is its
       payload, so Forward can hand you back the live page after a
       Back, and it is exactly what is on it so far. */
    function batchPagePayload (entry, n) {
        let d = bpageLoad(entry.id, n);
        if (!d.length && entry.state && entry.state.batchNum === n && (entry.state.batchServed || 0) > 0)
            d = batchLoad(entry.id);          /* the live batch's checkpointed partial */
        return d;
    }
    function viewJobBatch (entry, n) {
        if (_running) { setStatus('✕ Pause the scan before viewing a batch page.', true); return; }
        const fresh = historyLoad().find(e => e.id === entry.id);      /* always the LATEST saved state, never a stale closure */
        if (fresh) entry = fresh;
        const payload = batchPagePayload(entry, n);
        if (!payload.length) { setStatus('✕ Batch #' + n + ' has no saved page (created by an older engine version).', true); return; }
        loadHistoryEntry(entry, n);
        nxScrollTop();                                    /* v7.8: a batch page opens at the top */
        setStatus('Viewing batch #' + n + ' · ' + payload.length.toLocaleString() + ' wallpapers · this batch only — Continue returns to the live session page');
    }

    const PHASE_TXT = { running: 'scanning', collecting: 'collecting window', awaiting: 'awaiting next batch', paused: 'paused',
                        sparse: 'sparse — deep scan ready', exhausted: 'complete',
                        error: 'error — retry ready', legacy: 'v7.5 session' };
    function fmtAgo (ts) {
        if (!ts) return '';
        const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (s < 60) return 'just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
    }

    /* v7.7 — session cards expand into per-batch sub-cards. Each
       completed batch is a sub-card; "View" opens it as its own
       page. Toggles are remembered for the tab's lifetime, and the
       active session starts expanded so its batches are visible
       while the job runs. */
    let _histUser = new Map();
    function histOpen (id) {
        return _histUser.has(id) ? _histUser.get(id) === 'open' : !!(_session && _session.id === id);
    }
    function buildBatchSubCards (sub, entry) {
        const batches = (jobLoad(entry.id).batches || []).filter(b => b && b.n && b.count > 0);
        for (const b of batches.slice().reverse()) {          /* newest batch first */
            const bc = mk('div', 'nx-hist-batch');
            const bn = mk('span', 'nx-hist-batch-n');
            bn.textContent = '#' + b.n;
            const bm = mk('span', 'nx-hist-batch-meta');
            bm.textContent = (b.count || 0).toLocaleString() + ' wallpapers · ' + fmtAgo(b.ts) +
                             (b.final ? ' · final' : '');
            const bv = mk('button', 'nx-btn nx-btn-dim');
            bv.type = 'button'; bv.textContent = 'View';
            bv.title = 'Open batch #' + b.n + ' as its own page — only this batch\u2019s wallpapers';
            bv.addEventListener('click', () => viewJobBatch(entry, b.n));
            bc.append(bn, bm, bv);
            sub.appendChild(bc);
        }
    }
    function refreshHistoryPanel () {
        const host = document.getElementById('nx-hist'); if (!host) return;
        const idx = historyLoad();
        host.textContent = '';
        if (!idx.length) {
            const e = mk('span', 'nx-hist-empty'); e.textContent = 'No searches saved yet.';
            host.appendChild(e); return;
        }
        for (const entry of idx) {
            const nb = entry.bcount != null ? entry.bcount : (jobLoad(entry.id).batches || []).length;
            const open = histOpen(entry.id) && nb > 0;
            const item = mk('div', 'nx-hist-item' + (open ? ' nx-open' : ''));
            const row = mk('div', 'nx-hist-row');
            const tw = mk('button', 'nx-hist-tw');
            tw.type = 'button'; tw.disabled = !nb;
            tw.title = nb ? 'Show / hide this session\u2019s saved batches' : 'No batches saved yet';
            tw.setAttribute('aria-expanded', String(open));
            tw.innerHTML = (nb ? '<b>' + nb + '</b>' : '') + IC.chev;
            const main = mk('div', 'nx-hist-main');
            const l = mk('span', 'nx-hist-label');
            l.textContent = entry.name || entry.label || ('job ' + entry.id);
            l.title = entry.label || l.textContent;
            const st = entry.state || {};
            const meta = mk('span', 'nx-hist-meta');
            const phase = st.phase || (st.exhausted ? 'exhausted' : 'awaiting');
            meta.textContent = (entry.count || 0) + ' served · batch ' + (st.batchNum || 1) +
                               (st.batchServed ? ' (' + st.batchServed + ' in progress)' : '') +
                               ((st.skipped || 0) ? ' · ' + st.skipped + ' skipped' : '') +
                               (st.lastError ? ' · ' + st.lastError.slice(0, 40) : '') +
                               ' · ' + (PHASE_TXT[phase] || phase) + ' · ' + fmtAgo(entry.lastTs || entry.ts);
            const btns = mk('span', 'nx-hist-btns');
            const bl = mk('button', 'nx-btn nx-btn-dim'); bl.type = 'button'; bl.textContent = 'Load';
            bl.title = 'Inspect results & resume this job';
            const br = mk('button', 'nx-btn nx-btn-dim nx-hist-ib'); br.type = 'button'; br.innerHTML = IC.retry;
            br.title = 'Restart this job from the beginning (new history entry)';
            const bd = mk('button', 'nx-btn nx-btn-dim nx-hist-x'); bd.type = 'button'; bd.innerHTML = IC.x;
            bd.title = 'Delete this job and its data';
            bl.addEventListener('click', () => loadHistoryEntry(entry));
            br.addEventListener('click', () => restartJob(entry));
            bd.addEventListener('click', () => {
                batchDelete(entry.id);
                if (_session && _session.id === entry.id) { _session = null; _gridPage = null; renderJobStrip(); }
                syncBackBtn(); syncFwdBtn();          /* v8.1: the arrows follow the live page tag */
                refreshHistoryPanel();
            });
            btns.append(bl, br, bd);
            main.append(l, meta);
            row.append(tw, main, btns);
            item.appendChild(row);
            if (nb) {
                const sub = mk('div', 'nx-hist-sub');
                sub.hidden = !open;
                if (open) buildBatchSubCards(sub, entry);
                tw.addEventListener('click', () => {
                    const to = sub.hidden;                    /* flip */
                    sub.hidden = !to;
                    _histUser.set(entry.id, to ? 'open' : 'closed');
                    tw.setAttribute('aria-expanded', String(to));
                    item.classList.toggle('nx-open', to);
                    if (to && !sub.childNodes.length) buildBatchSubCards(sub, entry);
                });
                item.appendChild(sub);
            }
            host.appendChild(item);
        }
    }

    function restartJob (entry) {
        if (_running) { setStatus('✕ Pause the scan before restarting a job.', true); return; }
        if (!entry.params) return;
        restoreSearchSettings(entry.params);
        runSearch();
    }

    /* ═══ CARD BUILDER & GRID HELPERS ══════════════════════════════ */

    function mkCard (w) {
        registerSearchItem(w);
        const TW = 300;
        const dx = w.dimension_x || 16, dy = w.dimension_y || 9;
        const th = Math.max(1, Math.round(TW * dy / dx));
        const li = document.createElement('li');
        li.style.cssText = 'contain-intrinsic-size:' + TW + 'px ' + th + 'px;content-visibility:auto';
        const fig = document.createElement('figure');
        fig.className = 'thumb nx-card thumb-' + w.id + ' thumb-' + w.purity + ' thumb-' + (w.category || 'general');
        fig.setAttribute('data-wallpaper-id', w.id);
        fig.style.cssText = 'width:' + TW + 'px;height:' + th + 'px;overflow:hidden;border-radius:10px';
        const img = document.createElement('img');
        img.className = 'nx-img'; img.alt = 'wallpaper ' + w.id; img.loading = 'lazy';
        img.src = (w.thumbs && w.thumbs.small) || deriveThumb(w.id);
        img.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;border-radius:0;margin:0;padding:0';
        const a = document.createElement('a');
        a.className = 'preview'; a.href = 'https://wallhaven.cc/w/' + w.id; a.target = '_blank'; a.rel = 'noopener';
        const info = document.createElement('div'); info.className = 'thumb-info';
        info.style.cssText = 'position:absolute;left:0;right:0;bottom:0;top:auto;height:30px;margin:0;padding:0 8px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;background:linear-gradient(rgba(10,12,16,0),rgba(10,12,16,.88));border:0;border-radius:0 0 10px 10px;pointer-events:none;z-index:120;white-space:nowrap';
        const res = document.createElement('span'); res.className = 'wall-res';
        res.textContent = w.resolution || '';
        res.style.cssText = 'margin:0;padding:0;color:#c3cbd9;font:600 10.5px/1 sans-serif';
        /* v7.1.1: scan cards get the same native overlay-anchor the
         * grid cards use — one wire protocol for every favorite. */
        const favId = String(w.id);
        /* Scan cards carry no server-rendered account marker — their
         * star comes from FavState (server seeds + the cached,
         * count-validated account index), and the first scan card
         * schedules the background index build that keeps it true. */
        FavState.ensureIndexSoon();
        const favOn = FavState.isOn(favId);
        const fav = document.createElement('a');
        fav.className = 'jsAnchor overlay-anchor wall-favs nx-fav' + (favOn ? ' on' : '');
        fav.setAttribute('href', FAV_URL(favId));
        fav.setAttribute('data-href', FAV_URL(favId));
        fav.setAttribute('role', 'button');
        fav.setAttribute('tabindex', '0');
        fav.title = favTitleFor(favOn);
        fav.setAttribute('aria-label', 'Favorite wallpaper');
        fav.setAttribute('aria-pressed', String(favOn));
        fav.innerHTML = '<span class="nx-fav-n">' + (w.favorites || 0).toLocaleString() + '</span>' + IC.star;
        bindFavAnchor(fav);
        fav.style.cssText = 'margin:0;padding:0;border:0;background:none;display:inline-flex;align-items:center;gap:4px;color:#e8ecf4;font:600 10.5px/1 sans-serif;cursor:pointer;pointer-events:auto;text-decoration:none;white-space:nowrap';
        info.append(res, fav);
        fig.append(img, a, info);
        li.appendChild(fig);
        return li;
    }

    const getUL = () => {
        const sec = getSection(); if (!sec) return null;
        let ul = sec.querySelector(':scope > ul');
        if (!ul) { ul = document.createElement('ul'); sec.prepend(ul); }
        return ul;
    };
    const getInsertPoint = () => { const sec = getSection(); return sec ? { parent: sec.parentNode, before: sec } : null; };

    let _nativeItems = null;
    function ensureSnapshot () {
        if (_nativeItems) return;
        const ul = getUL(); if (!ul) return;
        _nativeItems = Array.prototype.map.call(ul.children, n => n.cloneNode(true));
    }

    function renderBatch (walls) {
        const ul = getUL(); if (!ul) return;
        ensureSnapshot();
        ul.textContent = '';
        const frag = document.createDocumentFragment();
        walls.forEach(w => frag.appendChild(mkCard(w)));
        ul.appendChild(frag);
        setCount(walls.length);
    }

    function clearGrid () {
        const ul = getUL(); if (!ul) return;
        setContBar('none', '', '');
        _session = null;
        _gridPage = null;
        renderJobStrip();
        ensureSnapshot();
        if (_nativeItems && _nativeItems.length) {
            ul.textContent = '';
            const frag = document.createDocumentFragment();
            _nativeItems.forEach(n => frag.appendChild(n.cloneNode(true)));
            ul.appendChild(frag);
            bindAllFavAnchors();   // clones carry markup, not listeners
            favRenderAll();          // …and snapshot markup may predate recent favorites
        } else ul.textContent = '';
        _seenIds.clear();
        setCount(document.querySelectorAll('figure.thumb[data-wallpaper-id]').length);
        setProgress(0);
        setStatus('Cleared — original listing restored.');
        setRunningUI(false);
    }

    function refreshImages () {
        const ul = getUL(); if (!ul) return;
        let n = 0;
        ul.querySelectorAll('img').forEach(img => {
            if (img.complete && img.naturalWidth > 0) return;
            const src = img.getAttribute('data-src') || img.currentSrc || img.src; if (!src) return;
            img.src = '';
            setTimeout(() => { img.src = src + (src.includes('?') ? '&' : '?') + '_nx=' + Date.now(); }, 40 + n * 15);
            n++;
        });
        setStatus(n > 0 ? 'Reloading ' + n + ' thumbnail' + (n !== 1 ? 's' : '') + '…' : 'All thumbnails look loaded.');
    }

    /* ═══ SCAN ENGINE — v7.6 TRUE BATCH ════════════════════════════ */
    /* Two complementary strategies, both batch-first:
       · WALK — date order, or favorites order without a date
         window. The walk itself is the result sequence, so only
         the pages each batch needs are fetched and it stops
         mid-page with a resumable cursor.
       · RANKED WINDOW — favorites order inside a date window. The
         favorites index interleaves every date, so a window is
         sparse there; instead the contiguous window is collected
         once in upload order (every page in range — the minimum
         possible discovery), ranked by ♥, and each batch serves
         the top N instantly from memory. Sampling picks the
         cheaper strategy when the window is large.
       Both keep the persistent served-id ledger, per-page
       crash-safe checkpoints and one-time source-shift detection,
       so every job resumes without duplicate work. */

    const MAX_CONSEC_MISS = 50;
    const MAX_SAFE_PAGE = 4000;
    const SCAN_RETRIES = 3;
    const PAGE_CACHE_MAX = 16;                 /* walked/prefetched pages kept per job */
    const BUFFER_MAX_PAGES = 2500;             /* windows larger than this are walked, not ranked */
    const WALK_EST_MAX = 600;                  /* walk preferred when it needs at most this many pages per batch */

    let _running = false, _stop = false;
    let _seenIds = new Set();
    let _session = null;
    let _gridPage = null;              /* v7.7: which job#batch page the grid is currently showing */

    function phaseLabel (ph) {
        return PHASE_TXT[ph] || ph || 'idle';
    }

    /* ── v7.7.3 UNIFIED RATE SHIELD (engine side) ───────────────────
       The gate itself — one rolling window for EVERY request the
       script sends to wallhaven.cc — lives in the NETWORK LAYER, so
       scan pages, wallpaper metadata, page-sync and the HTML fallback
       all share one budget. The engine keeps only the recovery ladder:
       a 429/403 is waited out with an exponential backoff that honors
       the server's own Retry-After, never a fatal. */
    const RL_RETRIES   = 6;               /* 403/429 ladder: 2s, 4s, 8s, 16s, 32s, 64s */
    const RL_WAIT_BASE = 2000;

    async function scanFetch (P, page) {
        let attempt = 0, rl = 0;
        for (;;) {
            if (_stop) return { stopped: true };
            /* v7.7.3: the gate guards the network layer — the engine
               requests its slot itself (pause beats pacing) and marks
               the call preGated so apiRaw does not count it twice. */
            if ((await paceGate(() => _stop)) === 'stopped') return { stopped: true };
            const resp = await apiSearch({ ...P.baseParams, page: page }, { preGated: true });
            if (resp._httpError === -3) return { stopped: true };   /* gate abort on pause */
            if (resp.error) {
                const msg = String(resp.error).toLowerCase().includes('key') ? '✕ Invalid API key.' : '✕ API: ' + resp.error;
                return { fatal: true, msg: msg };
            }
            if (!resp._httpError) {
                if (!resp.data || !resp.data.length) {
                    const lp = (resp.meta && resp.meta.last_page) || page;
                    if (page <= lp && attempt < 1) { attempt++; await sleep(700); continue; }
                    return { done: true };
                }
                return { data: resp.data, meta: resp.meta };
            }
            const code = resp._httpError;
            /* v7.7.3 — 403/429 = Wallhaven's rate limit. NEVER a reason
               to die: back off exponentially (2s -> 64s, past a full
               limit window), honor the server's own Retry-After, and
               retry the page automatically. */
            if ((code === 403 || code === 429) && rl < RL_RETRIES) {
                rl++;
                const wait = Math.max(RL_WAIT_BASE << (rl - 1), resp._retryAfter ? resp._retryAfter * 1000 + 250 : 0);
                setStatus('⏳ Rate limit (' + code + ') — auto-retry in ' + Math.round(wait / 1000) + 's (' + rl + '/' + RL_RETRIES + ')…');
                try { GM_setValue('gf_rl_until', String(Date.now() + 60000)); } catch (e) {}
                await sleep(wait);
                continue;
            }
            const transient = (code >= 500 || code === -1 || code === -2 || code === 0);
            if (transient && attempt < SCAN_RETRIES) {
                attempt++;
                setStatus('⚠ API hiccup (' + code + ') · retry ' + attempt + '/' + SCAN_RETRIES + '…');
                await sleep(900 * attempt);
                continue;
            }
            return { fatal: true, msg:
                (code === 403 || code === 429) ? '✕ API rate limit — state saved; press Continue to retry (the limit resets within a minute).' :
                code >= 500 ? '✕ Wallhaven server limit — state saved, Continue retries.' : '✕ API error ' + code };
        }
    }

    /* page fetch with a small per-job cache — enables one-page-ahead
       prefetch without extra requests and never refetches a page the
       cursor already passed. v7.6.2: keys are sorting-aware, so
       date-window locator probes, rank-mode collection pages and the
       walk's own pages each cache in their own lane — and pages the
       binary search already probed are REUSED by the collection
       instead of fetched twice. In-flight promises are cached too, so
       overlapping calls for the same page share one request. */
    function cachedPage (sess, page, P) {
        const key = (((P || sess.params).baseParams || {}).sorting || '') + page;
        const hit = sess.pageCache.get(key);
        if (hit) return Promise.resolve(hit);
        const p = scanFetch(P || sess.params, page).then(r => {
            if (r && r.data && !r.stopped && !r.fatal) {
                if (sess.pageCache.size >= PAGE_CACHE_MAX) {
                    for (const k of sess.pageCache.keys()) { if (k !== key) { sess.pageCache.delete(k); break; } }
                }
            } else if (sess.pageCache.get(key) === p) {
                sess.pageCache.delete(key);      /* don't cache stop/fail results */
            }
            return r;
        });
        p.catch(() => { if (sess.pageCache.get(key) === p) sess.pageCache.delete(key); });   /* v7.6.2: a rejected fetch is retried, never wedges the cache */
        sess.pageCache.set(key, p);
        return p;
    }
    function prefetch (sess, page) { cachedPage(sess, page).catch(() => {}); }

    /* v7.7.1 — the Continue pill FLOATS: fixed to the viewport,
       bottom-center, always on screen — one tap, zero scrolling.
       v8.1 — it also carries Back and Forward: viewing a batch page
       gets a one-tap return to the previous batch's saved page and a
       one-tap jump to the next saved one, without ever touching the
       live session's cursor. */
    const CONT_DONE_TTL = 6000;
    function setContBar (mode, label, note) {
        let bar = document.getElementById('nx-cont-bar');
        if (mode === 'none') { dismissContBar(); return; }
        if (!bar) {
            bar = mk('div', 'nx-cont-bar'); bar.id = 'nx-cont-bar';
            bar.setAttribute('role', 'status');
            bar.setAttribute('aria-live', 'polite');
            const bk = mk('button', 'nx-btn nx-back-btn'); bk.type = 'button';
            bk.addEventListener('click', () => {
                const t = backTarget(); if (!t) return;
                viewJobBatch(t.entry, t.n);
            });
            const fw = mk('button', 'nx-btn nx-fwd-btn'); fw.type = 'button';
            fw.addEventListener('click', () => {
                const t = fwdTarget(); if (!t) return;
                viewJobBatch(t.entry, t.n);
            });
            const b = mk('button', 'nx-btn nx-cont-btn'); b.type = 'button';
            b.addEventListener('click', () => { if (!_running) continueSearch(); });
            bar.append(bk, fw, b, mk('span', 'nx-cont-note'));
            document.body.appendChild(bar);     /* body-level fixed pill — independent of the grid */
            requestAnimationFrame(() => { if (bar.isConnected) bar.classList.add('on'); });
        } else {
            if (bar._t) { clearTimeout(bar._t); bar._t = 0; }   /* a new state cancels any pending fade-out */
            bar.classList.add('on');            /* revive a mid-fade pill instantly — no invisible zombies */
        }
        const btn = bar.querySelector('.nx-cont-btn');
        const noteEl = bar.querySelector('.nx-cont-note');
        bar.classList.toggle('nx-done', mode === 'done');
        btn.classList.toggle('nx-loading', mode === 'load');
        btn.disabled = mode !== 'go';
        btn.innerHTML = (mode === 'load' ? IC.sync : mode === 'done' ? IC.ok : IC.play) +
                        '<span>' + (label || (mode === 'done' ? 'No more results' : 'Continue')) + '</span>';
        noteEl.textContent = note || '';
        noteEl.hidden = !note;                  /* no empty flex-gap slot when noteless */
        if (mode === 'done') bar._t = setTimeout(() => dismissContBar(), CONT_DONE_TTL);
        syncBackBtn();
        syncFwdBtn();                 /* v8.1: the arrows follow the page tag live too */
    }

    /* v8.1 — where does Back go? The grid page tag ("job#batch") plus
       the ledger decide: the previous batch page of the SAME job, read
       from its saved payload. Never offered mid-scan, never when the
       payload is missing, never at batch #1. */
    function backTarget () {
        if (_running) return null;
        const m = _gridPage ? String(_gridPage).split('#') : null;
        if (!m || m.length !== 2) return null;
        const n = parseInt(m[1], 10) || 0;
        if (n <= 1) return null;
        const entry = historyLoad().find(e => e.id === m[0]);
        if (!entry) return null;
        return { entry: entry, n: n - 1 };
    }
    function syncBackBtn () {
        const bar = document.getElementById('nx-cont-bar');
        if (!bar) return;
        const bk = bar.querySelector('.nx-back-btn');
        if (!bk) return;
        const t = backTarget();
        bk.hidden = !t;
        if (!t) { bk.disabled = true; return; }
        bk.disabled = false;
        const lbl = 'Batch ' + t.n;
        if (bk._lbl !== lbl) {
            bk._lbl = lbl;
            bk.innerHTML = IC.left + '<span>' + lbl + '</span>';
            bk.title = 'Open batch ' + t.n + ' as its own page — the live session cursor is untouched';
            bk.setAttribute('aria-label', 'Back to batch ' + t.n);
        }
    }

    /* v8.1 — and Forward, Back's mirror: the next SAVED batch page of
       the same job, payload straight from the ledger (or the live
       in-progress batch's crash-safe partial). Never offered
       mid-scan, never past what exists — from the newest page,
       Continue serves the future instead. */
    function fwdTarget () {
        if (_running) return null;
        const m = _gridPage ? String(_gridPage).split('#') : null;
        if (!m || m.length !== 2) return null;
        const n = parseInt(m[1], 10) || 0;
        if (n < 1) return null;
        const entry = historyLoad().find(e => e.id === m[0]);
        if (!entry) return null;
        const nxt = n + 1;
        const saved = (jobLoad(entry.id).batches || []).some(b => b && b.n === nxt && b.count > 0);
        const liveNext = !saved && entry.state && entry.state.batchNum === nxt && (entry.state.batchServed || 0) > 0;
        return (saved || liveNext) ? { entry: entry, n: nxt } : null;
    }
    function syncFwdBtn () {
        const bar = document.getElementById('nx-cont-bar');
        if (!bar) return;
        const fw = bar.querySelector('.nx-fwd-btn');
        if (!fw) return;
        const t = fwdTarget();
        fw.hidden = !t;
        if (!t) { fw.disabled = true; return; }
        fw.disabled = false;
        const lbl = 'Batch ' + t.n;
        if (fw._lbl !== lbl) {
            fw._lbl = lbl;
            fw.innerHTML = IC.right + '<span>' + lbl + '</span>';
            fw.title = 'Open batch ' + t.n + ' as its own page — the live session cursor is untouched';
            fw.setAttribute('aria-label', 'Forward to batch ' + t.n);
        }
    }
    function dismissContBar () {
        const bar = document.getElementById('nx-cont-bar');
        if (!bar) return;
        if (bar._t) { clearTimeout(bar._t); bar._t = 0; }
        bar.classList.remove('on');             /* graceful fade — a fresh state can still revive it */
        setTimeout(() => { if (!bar.classList.contains('on') && bar.isConnected) bar.remove(); }, 220);
    }

    async function findDateStartPage (sess, P, targetDate, lastPage) {
        let lo = 1, hi = Math.min(lastPage + 1, MAX_SAFE_PAGE + 1), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ' + targetDate + ' · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = (mid > lastPage) ? { done: true } : await cachedPage(sess, mid, P);
            if (r.fatal) return -1;
            if (r.stopped) return -2;
            if (r.done || !r.data.length) { hi = mid; continue; }
            if ((r.data[0].created_at || '').slice(0, 10) > targetDate) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
    async function findDateEndPage (sess, P, targetDate, lastPage) {
        let lo = 1, hi = Math.min(lastPage + 1, MAX_SAFE_PAGE + 1), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ' + targetDate + ' floor · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = (mid > lastPage) ? { done: true } : await cachedPage(sess, mid, P);
            if (r.fatal) return -1;
            if (r.stopped) return -2;
            if (r.done || !r.data.length) { hi = mid; continue; }
            if ((r.data[0].created_at || '').slice(0, 10) < targetDate) hi = mid; else lo = mid + 1;
        }
        return lo;
    }
    async function findFavsFloorPage (sess, P, minFavs, lastPage) {
        let lo = 1, hi = Math.min(lastPage + 1, MAX_SAFE_PAGE + 1), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ♥' + minFavs.toLocaleString() + ' floor · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = (mid > lastPage) ? { done: true } : await cachedPage(sess, mid, P);
            if (r.fatal) return -1;
            if (r.stopped) return -2;
            if (r.done || !r.data.length) { hi = mid; continue; }
            if (r.data[0].favorites >= minFavs) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
    async function findFavsStartPage (sess, P, maxFavs, lastPage) {
        let lo = 1, hi = Math.min(lastPage, MAX_SAFE_PAGE), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ♥' + maxFavs.toLocaleString() + ' · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = await cachedPage(sess, mid, P);
            if (r.fatal) return -1;
            if (r.stopped) return -2;
            if (r.done || !r.data.length) { hi = mid; continue; }
            if (r.data[0].favorites > maxFavs) lo = mid + 1; else hi = mid;
        }
        return lo;
    }


    /* two probes estimate how dense the window is in the
       favorites-ordered index — decides walk vs ranked window. */
    async function sampleDensity (sess, P, region) {
        let hits = 0, pages = 0;
        for (const frac of [0.5, 0.8]) {
            const pg = Math.max(1, Math.min(Math.round(region * frac), MAX_SAFE_PAGE));
            const r = await cachedPage(sess, pg, P);
            if (r.fatal || r.done || r.stopped || !r.data) continue;
            pages++;
            for (const w of r.data) {
                const d = (w.created_at || '').slice(0, 10);
                if (d >= P.dateFrom && d <= P.dateTo && w.favorites >= P.minFavs &&
                    !(P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs)) hits++;
            }
        }
        return pages ? hits / pages : 0;
    }

    function abortStart (msg) {
        _running = false; setRunningUI(false);
        scanBarResolve();               /* v8.1: no terminal leaves the bar mid-flight */
        setStatus(msg, true);
        setContBar('go', 'Continue — retry scan', '');
        if (_session) { _session.phase = 'error'; _session.lastError = msg; renderJobStrip(); }
    }
    function emptyWindow (sess) {
        _running = false; setRunningUI(false);
        scanBarResolve();               /* v8.1 */
        sess.exhausted = true; sess.phase = 'exhausted';
        sessionSave(sess);
        const ul = getUL();
        if (ul) {
            const li = mk('li', 'nx-empty');
            li.innerHTML = '<strong>No uploads in this date range.</strong><br>The date boundaries were checked directly — nothing exists between ' + sess.params.dateFrom + ' and ' + sess.params.dateTo + '.';
            ul.appendChild(li);
        }
        setContBar('done', 'No more results', 'empty range · no scanning needed');
        setStatus('✓ Empty range — verified via date boundaries in a couple dozen requests');
        renderJobStrip(); refreshHistoryPanel();
    }
    function maxFavsEmpty (sess) {
        _running = false; setRunningUI(false);
        scanBarResolve();               /* v8.1 */
        sess.exhausted = true; sess.phase = 'exhausted';
        sessionSave(sess);
        setStatus('⚠ Max ♥ starts below the favorites floor — no results. Raise Max ♥ or lower Min ♥.');
        setContBar('done', 'No more results', '');
        renderJobStrip(); refreshHistoryPanel();
    }

    async function prepareFavsWalk (sess) {
        const P = sess.params;
        if (P.minFavs > 0 && !sess.favFloorDone) {
            const floor = await findFavsFloorPage(sess, P, P.minFavs, sess.lastPage);
            if (floor === -1) return 'abort';
            if (floor === -2) return 'stopped';
            sess.lastPage = Math.min(sess.lastPage, floor);
            sess.favFloorDone = true;
        }
        sess.page = 1;
        if (P.maxFavsOn && P.maxFavs > 0) {
            const pg = await findFavsStartPage(sess, P, P.maxFavs, sess.lastPage);
            if (pg === -1) return 'abort';
            if (pg === -2) return 'stopped';
            sess.page = pg;
            if (sess.page > sess.lastPage) return 'empty';
        }
        return 'ok';
    }

    /* ── the job strip: live job/batch/counts/phase in the panel ── */
    let _jobRaf = false;
    function renderJobStrip () {
        if (_jobRaf || !UI || !UI.jobstrip) return;
        _jobRaf = true;
        requestAnimationFrame(() => {
            _jobRaf = false;
            syncRunButtons();
            const el = UI.jobstrip; if (!el) return;
            if (!_session) { el.hidden = true; el.textContent = ''; return; }
            const s = _session, P = s.params;
            let txt;
            if (s.mode === 'rank') {
                if (s.phase === 'collecting') {
                    txt = 'job #' + s.id + ' · collecting page ' + (s.rankCursor || s.winTop || 1) + '/' + Math.max(1, (s.winBot || 1) - 1) +
                          ' · ' + (s.rankCollected || 0) + ' matches';
                } else {
                    const pool = s.rankMatches ? s.rankMatches.length : (s.rankTotal || 0);
                    txt = 'job #' + s.id + ' · batch ' + s.batchNum + ' · ' + (s.batchServed || 0) + '/' + P.batchSize + ' in batch' +
                          ' · ' + (s.served || 0) + ' served · ' + Math.max(0, pool - (s.rankRank || 0)) + ' left in window';
                }
            } else {
                txt = 'job #' + s.id + ' · batch ' + s.batchNum + ' · ' + (s.batchServed || 0) + '/' + P.batchSize + ' in batch' +
                      ' · ' + (s.served || 0) + ' served · ' + (s.skipped || 0) + ' skipped';
            }
            if (s.dupes) txt += ' · ' + s.dupes + ' dupes';
            txt += ' · page ' + s.page;
            if (s.phase !== 'exhausted' && s.winBot > 1 && s.page < s.winBot) {
                const density = s.pagesScanned ? (s.served || 0) / s.pagesScanned : 1;
                const left = Math.max(0, Math.round((s.winBot - 1 - s.page) * density));
                txt += ' · ≈' + left.toLocaleString() + ' left';
            }
            el.hidden = false;
            el.innerHTML = '<span class="nx-phase nx-phase-' + (s.phase || 'awaiting') + '">' + phaseLabel(s.phase) + '</span>' +
                           '<span class="nx-job-txt">' + txt + '</span>';
        });
    }

    function syncRunButtons () {
        if (!UI || !UI.btnStop) return;
        const paused = !!(_session && _session.phase === 'paused');
        UI.btnStop.forEach(b => {
            b.disabled = !_running && !paused;
            if (b.id === 'nx-stop2') {
                const label = paused ? 'Resume' : 'Pause';
                if (b.textContent !== label) b.textContent = label;
            }
            b.title = paused ? 'Resume the paused scan' : 'Pause safely after the current page (state is saved)';
        });
    }

    function pauseSearch () {
        if (!_running) return;
        _stop = true;
        setStatus('Pausing after the current page…');
    }

    /* dynamic batch size: re-read the field on every batch so the
       user's current number is always respected, never hardcoded. */
    function refreshBatchSize (sess) {
        if (!UI || !UI.inputs || !UI.inputs.bs) return sess.params.batchSize;
        const n = clampInt(UI.inputs.bs.value, 1, 1000, sess.params.batchSize);
        if (n !== sess.params.batchSize) { sess.params.batchSize = n; set('batchSize', n); }
        return n;
    }

    /* one-time post-restore sanity check: the page at the cursor must
       still hold the last wallpaper we served. If wallhaven's results
       shifted (new uploads, reordering), say so — doneIds still
       guarantees no duplicate processing, only page order differs. */
    async function verifyCursor (sess) {
        if (sess.cursorVerified || !sess.lastServedId) { sess.cursorVerified = true; return; }
        const page = sess.itemIdx > 0 ? sess.page : Math.max(1, sess.page - 1);
        const r = await cachedPage(sess, page);
        if (r && r.data && !r.stopped && !r.fatal) {
            const idx = sess.itemIdx > 0 ? sess.itemIdx - 1 : -1;
            const ok = idx >= 0
                ? (r.data[idx] && String(r.data[idx].id) === String(sess.lastServedId))
                : r.data.some(w => String(w.id) === String(sess.lastServedId));
            if (!ok) {
                setStatus('⚠ Wallhaven results shifted since this job was saved. Continuing from the saved cursor — ' +
                          'already-served wallpapers stay excluded, but page order may differ from before.');
            }
        }
        sess.cursorVerified = true;
    }

    /* ── RANKED WINDOW — favorites sort inside a date window ──
       In the favorites-ordered index a date window is sparse: the
       top-favorites pages are years old and almost nothing falls
       inside a recent range, so a favorites walk can scan hundreds
       of pages without a single eligible match. Instead: collect
       the window ONCE in upload order — every page between winTop
       and winBot is already inside the range, so the pass is exact
       and minimal — rank the matches by ♥, then serve the top N of
       each batch instantly from memory. Collection is checkpointed
       per page (crash-safe), pause/fatal resume at the cursor, and
       the served-id ledger still guarantees no wallpaper is ever
       served twice. */
    async function rankCore (sess) {
        if (!sess || sess.phase === 'exhausted') return;
        _running = true; _stop = false;
        sess.phase = 'running';
        setRunningUI(true); renderJobStrip();
        const ul = getUL();
        if (!ul) { setStatus('✕ Grid not found.', true); _running = false; setRunningUI(false); sess.phase = 'awaiting'; return; }
        const P = sess.params;
        const DP = { ...P, baseParams: { ...P.baseParams, sorting: 'date_added' } };
        const B = refreshBatchSize(sess);
        let fatal = null, stopped = false;

        for (;;) {
            /* phase 1 — collect the window once, in upload order */
            if (!sess.rankScanned) {
                sess.phase = 'collecting';
                setProgress(0);
                let pre = null;
                try {
                    while (!_stop && sess.rankCursor < sess.winBot) {
                        const pg = sess.rankCursor;
                        setContBar('load', 'Collecting window · page ' + pg + '/' + Math.max(1, sess.winBot - 1),
                                   (sess.rankMatches.length || 0).toLocaleString() + ' matches · one-time scan');
                        setStatus('Collecting ' + P.dateFrom + ' → ' + P.dateTo + ' in upload order · page ' + pg + '/' + Math.max(1, sess.winBot - 1) + ' · ' + (sess.rankMatches.length || 0) + ' matches');
                        setProgress(Math.min(96, Math.round(((pg - sess.winTop) / Math.max(1, sess.winBot - sess.winTop)) * 100)));
                        renderJobStrip();
                        let r = pre ? await pre : null; pre = null;   /* v7.6.2: the stored prefetch is a Promise — await it */
                        if (!r) r = await cachedPage(sess, pg, DP);   /* rejected probe → fresh, retried fetch */
                        if (r.stopped) { stopped = true; break; }
                        if (r.fatal)  { fatal = r.msg; break; }
                        if (r.done)   { sess.winBot = pg; break; }
                        if (pg + 1 < sess.winBot) pre = cachedPage(sess, pg + 1, DP).catch(() => null);   /* overlap latency, no extra requests */
                        for (const w of r.data) {
                            const d = (w.created_at || '').slice(0, 10);
                            if (d < P.dateFrom || d > P.dateTo) { sess.skipped++; continue; }
                            if (w.favorites < P.minFavs) { sess.skipped++; continue; }
                            if (P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs) { sess.skipped++; sess.skippedAbove++; continue; }
                            sess.rankMatches.push(w);
                        }
                        sess.rankCursor = pg + 1;
                        sess.rankCollected = sess.rankMatches.length;
                        sess.pagesScanned++;
                        sessionCheckpoint(sess);
                        renderJobStrip();
                        await sleep(300);
                    }
                } catch (e) { fatal = '✕ Unexpected error: ' + (e && e.message); }
                if (_stop && !fatal && !stopped) stopped = true;   /* v7.6.2: a pause that lands between awaits parks the job */
                if (fatal || stopped) break;
                sess.rankScanned = true;
                sess.rankTotal = sess.rankMatches.length;
                sess.rankMatches.sort((a, b) => (b.favorites - a.favorites) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
                setStatus('Ranking ' + sess.rankTotal.toLocaleString() + ' matches by favorites…');
            }

            /* phase 2 — serve the top of the ranked pool */
            sess.phase = 'running';
            setContBar('load', 'Batch ' + sess.batchNum + ' · ' + (sess.batchServed || 0) + '/' + B, '');
            renderJobStrip();
            ensureBatchPage(sess, ul);            /* v7.7: this batch gets its own page */
            const frag = document.createDocumentFragment();
            let lastId = sess.lastServedId;
            while (sess.batchServed < B && sess.rankRank < sess.rankMatches.length) {
                const w = sess.rankMatches[sess.rankRank++];
                const wid = String(w.id);
                if (sess.doneIds.has(wid) || _seenIds.has(wid)) { sess.dupes++; continue; }
                _seenIds.add(wid); sess.doneIds.add(wid);
                frag.appendChild(mkCard(w));
                sess.batchItems.push(w);
                sess.batchServed++; sess.served++; lastId = wid;
            }
            if (frag.childNodes.length) ul.appendChild(frag);
            sess.lastServedId = lastId;
            setCount(sess.batchServed);            /* v7.7: the pill counts the page being served */
            renderJobStrip();

            if (sess.batchServed >= B) {                       /* batch filled */
                sess.batches.push({ n: sess.batchNum, count: sess.batchServed, ts: Date.now(),
                                    lastId: lastId || '', paged: true });
                bpageSave(sess.id, sess.batchNum, sess.batchItems);   /* v7.7: the batch's own page payload */
                setCount(sess.batchServed);                    /* v7.7: the pill counts the page on screen */
                sess.batchNum++; sess.batchServed = 0; sess.phase = 'awaiting';
                _running = false; setRunningUI(false);
                scanBarResolve();               /* v8.1 */
                sessionSave(sess); sess.batchItems = [];
                const left = Math.max(0, sess.rankMatches.length - sess.rankRank);
                setContBar('go', 'Continue — next ' + B + ' (batch ' + sess.batchNum + ')',
                           left > 0 ? 'instant · fresh page · ' + left.toLocaleString() + ' ranked matches left' : 'one-time scan');
                setStatus('✓ Batch ' + (sess.batchNum - 1) + ' · ' + sess.served.toLocaleString() + ' served · ' +
                          'top ♥ first' +
                          (left > 0 ? ' · ' + left.toLocaleString() + ' left in the window' : ''));
                break;
            }
            if (sess.rankTailLost) {                            /* saved tail ran dry — re-verify the window */
                sess.rankTailLost = false; sess.rankScanned = false;
                sess.rankMatches = []; sess.rankRank = 0; sess.rankCursor = sess.winTop; sess.rankCollected = 0;
                setStatus('Saved tail ran out — re-verifying the window (nothing already served repeats)…');
                continue;
            }
            if (sess.batchServed > 0) {                         /* v7.7: the final partial batch is a page too */
                sess.batches.push({ n: sess.batchNum, count: sess.batchServed, ts: Date.now(),
                                    lastId: sess.lastServedId || '', paged: true, final: true });
                bpageSave(sess.id, sess.batchNum, sess.batchItems);
            }
            sess.exhausted = true; sess.phase = 'exhausted';    /* pool truly dry — honest completion */
            _running = false; setRunningUI(false);
            scanBarResolve();               /* v8.1: the single-batch-exhausted job used to leave the bar frozen mid-way — it always resolves now */
            sessionSave(sess); sess.batchItems = [];
            setContBar('done', 'No more results', (sess.rankTotal || sess.served || 0).toLocaleString() + ' matches in window');
            setStatus(sess.rankTotal
                ? '✓ Complete — ' + sess.rankTotal.toLocaleString() + ' matching wallpapers in ' + P.dateFrom + ' → ' + P.dateTo + ' · all served'
                : '✓ No matching wallpapers in this window — try widening the range or lowering Min ♥.');
            if (!sess.rankTotal && !sess.served) {
                const li = mk('li', 'nx-empty');
                li.innerHTML = '<strong>No wallpapers matched.</strong><br>The date window contains no uploads that pass the favorites filter.';
                ul.appendChild(li);
            }
            break;
        }

        if (fatal) {
            sess.phase = 'error'; sess.lastError = fatal;
            _running = false; setRunningUI(false);
            scanBarResolve();               /* v8.1 */
            sessionSave(sess);
            setStatus(fatal, true);
            setContBar('go', 'Continue — retry collection', 'state preserved · resumes at page ' + sess.rankCursor);
        } else if (stopped) {
            sess.phase = 'paused';
            _running = false; setRunningUI(false);
            scanBarResolve();               /* v8.1 */
            sessionSave(sess);
            setStatus('Paused · ' + (sess.rankCollected || 0).toLocaleString() + ' matches collected · state saved');
            setContBar('go', sess.rankScanned ? 'Resume — finish batch ' + sess.batchNum : 'Resume — collect window',
                       'state preserved · resumes at page ' + sess.rankCursor);
        }
        setCount(sess.batchServed || 0);            /* v7.7: the pill counts the page on screen */
        renderJobStrip();
        refreshHistoryPanel();
    }

    /* v7.7 — every batch is its own PAGE. A fresh batch starts from
       a clean grid (never a continuous stream), and a resumed
       partial batch rebuilds its page first when the screen is
       showing something else (an older batch, another job, or the
       native listing after Clear) — so a page never mixes batches. */
    function ensureBatchPage (sess, ul) {
        const want = sess.id + '#' + sess.batchNum;
        if ((sess.batchServed || 0) === 0) ul.textContent = '';
        else if (_gridPage !== want) renderBatch(batchLoad(sess.id).filter(w => sess.doneIds.has(String(w.id))));
        _gridPage = want;
        syncBackBtn(); syncFwdBtn();     /* v8.1: the arrows follow the page tag live */
    }

    async function coreScan (sess, preloaded) {
        if (!sess || sess.phase === 'exhausted') return;
        if (sess.legacy) { startFreshFromLegacy(sess); return; }

        _running = true; _stop = false;
        sess.phase = 'running';
        setRunningUI(true); renderJobStrip(); setProgress(0);
        const ul = getUL();
        if (!ul) { setStatus('✕ Grid not found.', true); _running = false; setRunningUI(false); sess.phase = 'awaiting'; return; }
        const P = sess.params;
        const B = refreshBatchSize(sess);

        ensureBatchPage(sess, ul);          /* v7.7: this batch gets its own page */
        await verifyCursor(sess);

        let page = sess.page, itemIdx = sess.itemIdx, lastPage = sess.lastPage || 1;
        let served = sess.served || 0, skipped = sess.skipped || 0, dupes = sess.dupes || 0;
        let skippedAbove = sess.skippedAbove || 0, consecMisses = sess.consecMisses || 0, pagesScanned = sess.pagesScanned || 0;
        let batchServed = sess.batchServed || 0, batchNum = sess.batchNum;
        let exhausted = false, stopped = false, fatal = null, sparse = false;
        const firstPage = page, firstIdx = itemIdx;
        sess.batchItems = sess.batchItems || [];

        try {
            outer:
            while (!_stop && batchServed < B) {
                const prog = 'Batch ' + batchNum + ' · ' + batchServed + '/' + B;
                setContBar('load', prog, '');
                setStatus(prog + ' · page ' + page + ' · ' + served + ' served' +
                          (skippedAbove > 0 ? ' · ' + skippedAbove.toLocaleString() + ' skipped' : ''));
                setProgress(Math.min(95, Math.round((batchServed / B) * 100)));
                renderJobStrip();

                let items = null, meta = null;
                if (preloaded && page === 1) { items = preloaded.data; meta = preloaded.meta; preloaded = null; }
                else {
                    const r = await cachedPage(sess, page);
                    if (r.stopped) { stopped = true; break; }
                    if (r.fatal)  { fatal = r.msg; break; }
                    if (r.done)   { exhausted = true; break; }
                    items = r.data; meta = r.meta;
                }
                if (meta && meta.last_page) lastPage = Math.min(meta.last_page, MAX_SAFE_PAGE);

                let pageMatched = 0, pageInRange = 0, stopIdx = -1;
                const frag = document.createDocumentFragment();
                for (let i = (page === firstPage ? firstIdx : 0); i < items.length; i++) {
                    const w = items[i];
                    if (batchServed >= B) { stopIdx = i; break; }
                    const d = (w.created_at || '').slice(0, 10);
                    if (P.sortMode === 'date_added') {
                        if (d < P.dateFrom) { exhausted = true; break; }
                        if (d > P.dateTo) { skipped++; continue; }
                        if (w.favorites < P.minFavs) { skipped++; continue; }
                        if (P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs) { skipped++; skippedAbove++; continue; }
                    } else {
                        if (w.favorites < P.minFavs) { exhausted = true; break; }
                        if (P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs) { skipped++; skippedAbove++; continue; }
                        pageInRange++;
                        if (d < P.dateFrom || d > P.dateTo) { skipped++; continue; }
                    }
                    const wid = String(w.id);
                    if (sess.doneIds.has(wid) || _seenIds.has(wid)) { dupes++; continue; }   /* never reprocess */
                    _seenIds.add(wid); sess.doneIds.add(wid); sess.lastServedId = wid;
                    frag.appendChild(mkCard(w));
                    sess.batchItems.push(w);
                    served++; batchServed++; pageMatched++;
                }
                if (frag.childNodes.length) ul.appendChild(frag);
                setCount(batchServed);         /* v7.7: the pill counts the page being served */
                pagesScanned++;

                if (exhausted) break;
                if (stopIdx >= 0) { itemIdx = stopIdx; break; }

                if (P.sortMode === 'favorites' && pageInRange > 0 && pageMatched === 0) {
                    consecMisses++;
                    if (consecMisses >= MAX_CONSEC_MISS) { sparse = true; break; }
                } else if (pageMatched > 0) consecMisses = 0;

                if ((sess.winBot && page >= sess.winBot) || page >= lastPage) { exhausted = true; break; }
                page++; itemIdx = 0;

                /* crash-safe checkpoint once per page — cursor + counters */
                sess.page = page; sess.itemIdx = 0; sess.lastPage = lastPage;
                sess.served = served; sess.skipped = skipped; sess.dupes = dupes;
                sess.skippedAbove = skippedAbove; sess.batchServed = batchServed;
                sess.pagesScanned = pagesScanned; sess.consecMisses = consecMisses;
                sessionCheckpoint(sess);
                renderJobStrip();

                /* one-page-ahead prefetch while the DOM settles — no
                   extra requests, just overlapped latency */
                if (batchServed < B) prefetch(sess, page);
                await sleep(300);
            }
        } catch (e) { fatal = '✕ Unexpected error: ' + (e && e.message); }

        /* a pause that lands between awaits (loop-condition exit) must
           still count as stopped — unless the batch filled anyway, in
           which case it completes instead of parking */
        if (_stop && !fatal && !exhausted && !sparse && batchServed < B) stopped = true;

        sess.page = page; sess.itemIdx = itemIdx; sess.lastPage = lastPage;
        sess.served = served; sess.skipped = skipped; sess.dupes = dupes;
        sess.skippedAbove = skippedAbove; sess.batchServed = batchServed;
        sess.pagesScanned = pagesScanned; sess.consecMisses = sparse ? 0 : consecMisses;
        sess.exhausted = exhausted;

        const batchDone = batchServed >= B && !exhausted && !stopped && !fatal && !sparse;
        if (batchDone || (exhausted && batchServed > 0)) {     /* v7.7: every completed batch — the final partial included — becomes a sub-history card with its own page */
            sess.batches.push({ n: batchNum, count: batchServed, ts: Date.now(),
                                lastId: sess.lastServedId || '', paged: true, final: !!exhausted });
            bpageSave(sess.id, batchNum, sess.batchItems);
        }
        if (batchDone) {
            sess.batchNum = batchNum + 1; sess.batchServed = 0;
            sess.phase = 'awaiting';
        } else if (exhausted) sess.phase = 'exhausted';
        else if (stopped) sess.phase = 'paused';
        else if (fatal) { sess.phase = 'error'; sess.lastError = fatal; }
        else if (sparse) sess.phase = 'sparse';

        _running = false;
        setRunningUI(false);
        setProgress(batchServed > 0 ? 100 : 0);
        setTimeout(() => setProgress(0), 900);

        sessionSave(sess);
        if (batchDone || exhausted) sess.batchItems = [];
        setCount(batchServed);                    /* v7.7: the pill counts the page on screen */
        if (sess.exhausted && served === 0 && !sess.batchItems.length && !fatal && !stopped && !sparse) {
            const li = mk('li', 'nx-empty');
            li.innerHTML = '<strong>No wallpapers found.</strong><br>Try widening the date range, lowering Min ♥, or switching sort mode.';
            ul.appendChild(li);
        }

        const left = Math.max(0, B - batchServed);
        if (fatal) {
            setStatus(fatal, true);
            setContBar('go', 'Continue — finish batch ' + batchNum + ' (' + left + ' left)',
                       'state preserved · resumes at page ' + page);
        } else if (stopped) {
            setStatus('Paused · ' + served.toLocaleString() + ' served · state saved');
            setContBar('go', 'Resume — finish batch ' + batchNum + ' (' + left + ' left)',
                       'state preserved · resumes at page ' + page);
        } else if (exhausted) {
            setContBar('done', 'No more results', served.toLocaleString() + ' collected');
            setStatus(batchDone
                ? '✓ Batch ' + batchNum + ' complete — no more matching results'
                : '✓ No more matching results · only ' + served.toLocaleString() + ' exist for these filters');
        } else if (sparse) {
            setStatus('⚠ Sparse in favorites order — no date matches in ' + MAX_CONSEC_MISS + ' pages (now at page ' + page + '). Continue the deep scan, narrow the range, or raise Min ♥.');
            setContBar('go', 'Continue deep scan — page ' + page, 'results are sparse in this order');
        } else if (batchDone) {
            setStatus('✓ Batch ' + batchNum + ' complete · ' + served.toLocaleString() + ' served · next: #' + sess.batchNum);
            setContBar('go', 'Continue — next ' + B + ' (batch ' + sess.batchNum + ')',
                       'fresh page · total ' + served.toLocaleString() + ' served · walk page ' + page);
        }
        renderJobStrip();
        refreshHistoryPanel();
    }

    async function startScan (sess) {
        _running = true; _stop = false;
        sess.phase = 'running';
        setRunningUI(true); renderJobStrip();
        setContBar('load', 'Scanning…', '');
        const P = sess.params;
        const DP = { ...P, baseParams: { ...P.baseParams, sorting: 'date_added' } };

        setStatus('Scanning… page 1');
        const probe = await cachedPage(sess, 1);   /* v7.6.2: cached — the walk reuses page 1 instead of refetching */
        if (probe.stopped) { _running = false; setRunningUI(false); sess.phase = 'paused'; sessionCheckpoint(sess); renderJobStrip(); scanBarResolve(); setContBar('go', 'Resume scan', ''); return; }
        if (probe.fatal) {
            _running = false; setRunningUI(false);
            sess.phase = 'error'; sess.lastError = probe.msg; sessionCheckpoint(sess); renderJobStrip();
            scanBarResolve();               /* v8.1 */
            setStatus(probe.msg, true);
            setContBar('go', 'Continue — retry scan', '');
            return;
        }
        if (probe.done) {
            _running = false; setRunningUI(false);
            sess.exhausted = true; sess.phase = 'exhausted';
            sessionSave(sess);
            scanBarResolve();               /* v8.1 */
            setStatus('⚠ No results — check filters' + (get('apiKey') ? '' : ' / API key') + '.');
            const ul = getUL();
            if (ul) {
                const li = mk('li', 'nx-empty');
                li.innerHTML = '<strong>No wallpapers found.</strong><br>Try widening the date range, lowering Min ♥, or switching sort mode.';
                ul.appendChild(li);
            }
            setContBar('done', 'No more results', '');
            renderJobStrip(); refreshHistoryPanel();
            return;
        }
        sess.lastPage = Math.min((probe.meta && probe.meta.last_page) || 1, MAX_SAFE_PAGE);

        if (P.sortMode === 'date_added') {
            let winTop = 1;
            if (P.dateTo < todayStr()) {
                winTop = await findDateStartPage(sess, DP, P.dateTo, sess.lastPage);
                if (winTop === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
                if (winTop === -2) { scanStopped(sess); return; }
            }
            if (winTop > sess.lastPage) return emptyWindow(sess);
            if (P.dateTo < todayStr() || P.dateFrom > '2010-01-01') {
                const winBot = await findDateEndPage(sess, DP, P.dateFrom, sess.lastPage);
                if (winBot === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
                if (winBot === -2) { scanStopped(sess); return; }
                sess.winBot = winBot;
                if (winBot <= winTop) return emptyWindow(sess);
            }
            sess.page = winTop;
            setStatus('Upload order · true batch walk' + (sess.winBot ? ' (≈' + Math.max(0, sess.winBot - winTop) + ' pages in window)' : ''));
            await coreScan(sess, winTop === 1 ? probe : null);
            return;
        }


        /* favorites order — strategy selection:
           · no date window → the favorites walk IS the result
             sequence and every page is in range (dense, optimal);
           · date window → choose between the ranked-window pass
             (collect the contiguous window in upload order once,
             rank by ♥, serve the top N per batch — right when the
             window is sparse in favorites order, which it almost
             always is) and the favorites walk (only when sampling
             proves it is clearly cheaper for this batch size). */
        const bounded = P.dateTo < todayStr() || P.dateFrom > '2010-01-01';
        if (!bounded) {
            const prep = await prepareFavsWalk(sess);
            if (prep === 'abort') return abortStart('✕ API unavailable while locating favorites bounds — try again.');
            if (prep === 'stopped') { scanStopped(sess); return; }
            if (prep === 'empty') return maxFavsEmpty(sess);
            setStatus('Favorites order · true batch walk · ♥ floor at page ' + sess.lastPage);
            await coreScan(sess, sess.page === 1 ? probe : null);
            return;
        }

        let winTop = 1;
        if (P.dateTo < todayStr()) {
            winTop = await findDateStartPage(sess, DP, P.dateTo, sess.lastPage);
            if (winTop === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
            if (winTop === -2) { scanStopped(sess); return; }
        }
        const winBot = await findDateEndPage(sess, DP, P.dateFrom, sess.lastPage);
        if (winBot === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
        if (winBot === -2) { scanStopped(sess); return; }
        const windowPages = winBot - winTop;
        if (windowPages <= 0 || winTop > sess.lastPage) return emptyWindow(sess);

        let mode = 'rank', walkEst = 0;
        if (windowPages > 60) {
            if (P.minFavs > 0 && !sess.favFloorDone) {
                const floor = await findFavsFloorPage(sess, P, P.minFavs, sess.lastPage);
                if (floor === -1) return abortStart('✕ API unavailable while locating the favorites floor — try again.');
                if (floor === -2) { scanStopped(sess); return; }
                sess.lastPage = Math.min(sess.lastPage, floor);
                sess.favFloorDone = true;
            }
            setStatus('Estimating scan depth (sampling the favorites region)…');
            const d = await sampleDensity(sess, P, sess.lastPage);
            walkEst = d > 0 ? Math.ceil(P.batchSize / d) : Infinity;
            if (windowPages > BUFFER_MAX_PAGES) mode = 'walk';
            else if (walkEst <= WALK_EST_MAX && walkEst * 1.25 < windowPages) mode = 'walk';
        }

        if (mode === 'rank') {
            sess.mode = 'rank';
            sess.winTop = winTop; sess.winBot = winBot;
            sess.rankCursor = (sess.rankCursor > winTop) ? sess.rankCursor : winTop;
            setStatus('Ranked window · collecting ' + windowPages + ' pages in upload order, then serving the top ♥ ' + P.batchSize + ' per batch');
            await rankCore(sess);
            return;
        }

        const prep = await prepareFavsWalk(sess);
        if (prep === 'abort') return abortStart('✕ API unavailable while locating favorites bounds — try again.');
        if (prep === 'stopped') { scanStopped(sess); return; }
        if (prep === 'empty') return maxFavsEmpty(sess);
        setStatus('Strategy: favorites-ordered walk' +
                  (isFinite(walkEst) ? ' (≈' + walkEst + ' pages to a full batch)' : '') +
                  ' · ♥ floor at page ' + sess.lastPage);
        await coreScan(sess, sess.page === 1 ? probe : null);
    }

    function scanStopped (sess) {
        _running = false; setRunningUI(false);
        sess.phase = 'paused';
        sessionCheckpoint(sess);
        scanBarResolve();               /* v8.1: paused mid-probe still resolves the bar */
        setStatus('Paused · state saved');
        setContBar('go', 'Resume scan', 'resumes at page ' + sess.page);
        renderJobStrip();
    }

    /* v7.5 buffered session → v7.6.1 ranked-window job, keeping the
       same job identity and excluding whatever is still on screen.
       v7.5 stored only the unserved tail (cap 600) and had no
       served-id ledger, so the on-screen batch is the exclusion
       set; a tail that hit the old cap is re-verified against the
       window when it runs dry — still never re-serving anything. */
    function startFreshFromLegacy (sess) {
        const buf = bufLoad(sess.id);
        try { GM_deleteValue(BUF_PREFIX + sess.id); } catch {}
        const P = sess.params;
        const keepId = sess.id;
        const keepTs = sess.ts;
        const seeded = new Set(sess.doneIds || []);
        for (const w of batchLoad(sess.id)) seeded.add(String(w.id));
        _session = newSession(P);
        _session.id = keepId; _session.ts = keepTs;
        _session.doneIds = seeded;
        _seenIds = new Set(seeded);
        if (buf && buf.length) {
            _session.mode = 'rank';
            _session.winTop = sess.winTop || 1;
            _session.winBot = sess.winBot || 0;
            _session.rankMatches = buf;
            _session.rankTotal = buf.length;
            _session.rankScanned = true;
            _session.rankTailLost = buf.length >= 600;
            setStatus('v7.5 buffered session → ranked window · ' + buf.length + ' unserved matches recovered · wallpapers already on screen are excluded');
            refreshHistoryPanel();
            rankCore(_session);
            return;
        }
        setStatus('v7.5 session → v7.6.2 engine · re-running the search with the true-batch engine');
        refreshHistoryPanel();
        startScan(_session);
    }

    function newSession (P) {
        return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                 ts: Date.now(), params: P, name: jobLabel(P), mode: 'walk', phase: 'awaiting',
                 page: 1, itemIdx: 0, lastPage: 1, winBot: 0, skippedAbove: 0, favFloorDone: false,
                 batchNum: 1, batchServed: 0, served: 0, skipped: 0, dupes: 0, pagesScanned: 0,
                 consecMisses: 0, exhausted: false, lastServedId: '', lastError: '',
                 cursorVerified: true, batches: [], batchItems: [],
                 winTop: 1, rankCursor: 0, rankRank: 0, rankMatches: [], rankScanned: false,
                 rankCollected: 0, rankTotal: 0, rankTailLost: false,
                 doneIds: new Set(), pageCache: new Map() };
    }

    async function runSearch () {
        if (_running) return;
        const p = readParams();
        if (!p) return;
        const ul = getUL();
        if (!ul) { setStatus('✕ Grid not found.', true); return; }
        ensureSnapshot();
        ul.textContent = '';
        _seenIds = new Set();
        _gridPage = null;
        setCount(0); setProgress(0);
        setContBar('none', '', '');
        _session = newSession(p);
        renderJobStrip();
        await startScan(_session);
        if (!_running) scanBarResolve();      /* v8.1: the catch-all — no terminal can leave the bar mid-flight */
        refreshHistoryPanel();
    }

    async function continueSearch () {
        if (_running || !_session) return;
        if (_session.phase === 'exhausted') return;
        /* v7.8 — WHERE A CONTINUE STARTS FROM (state-based, never
           timing-based):
           · a NEW batch — phase 'awaiting' with nothing served into
             it yet — opens at the very TOP of the fresh page;
           · a RESUME of an interrupted batch — paused, error, sparse
             deep-scan, or mid-batch — keeps the user's position. */
        const resuming = _session.phase === 'paused' || _session.phase === 'error' ||
                         _session.phase === 'sparse' || ((_session.batchServed || 0) > 0);
        if (_session.legacy) { nxScrollTop(); startFreshFromLegacy(_session); return; }   /* a fresh ranked page */
        if (!resuming) nxScrollTop();
        if (_session.mode === 'rank') { _stop = false; await rankCore(_session); if (!_running) scanBarResolve(); refreshHistoryPanel(); return; }
        if (_session.phase === 'sparse') _session.consecMisses = 0;
        _stop = false;
        await coreScan(_session);
        if (!_running) scanBarResolve();      /* v8.1: the catch-all */
        refreshHistoryPanel();
    }

    async function restartSearch () {
        if (_running || !_session) return;
        const ul = getUL();
        if (!ul) return;
        ensureSnapshot();
        ul.textContent = '';
        _seenIds = new Set();
        _gridPage = null;
        setCount(0); setProgress(0);
        setContBar('none', '', '');
        _session = newSession(_session.params);
        renderJobStrip();
        await startScan(_session);
        if (!_running) scanBarResolve();      /* v8.1: the catch-all */
        refreshHistoryPanel();
    }

    /* ═══ PANEL UI ═══════════════════════════════════════════════ */

    let UI = null;

    const PANEL_HTML = '<div class="nx-prog"><i></i></div>' +
    '<div class="nx-bar">' +
      '<span class="nx-brand"><span class="nx-mark">nx</span><span class="nx-name">naXim<i> Labs</i></span></span>' +
      '<div class="nx-status" role="status" aria-live="polite">Ready</div>' +
      '<span class="nx-count" title="Wallpapers in grid">0</span>' +
      '<div class="nx-actions">' +
        '<button type="button" class="nx-ib nx-act-search" title="Search with current filters" aria-label="Search"></button>' +
        '<button type="button" class="nx-ib nx-act-stop" title="Stop scanning" aria-label="Stop" disabled></button>' +
        '<button type="button" class="nx-ib nx-act-refresh" title="Reload broken thumbnails" aria-label="Reload thumbnails"></button>' +
        '<a class="nx-ib nx-gh" href="https://github.com/0naXim0" target="_blank" rel="noopener noreferrer" title="naXim Labs · GitHub" aria-label="GitHub"></a>' +
        '<button type="button" class="nx-ib nx-exp" title="Filters &amp; settings" aria-label="Toggle panel" aria-expanded="false"></button>' +
      '</div>' +
    '</div>' +
    '<div class="nx-body"><div class="nx-body-in"><div class="nx-pad">' +
      '<div class="nx-grid">' +
        '<label class="nx-field nx-f-q"><span class="nx-l">Query</span><input id="nx-q" class="nx-in" type="text" spellcheck="false" autocomplete="off" placeholder="keywords · tag:… · -exclude"></label>' +
        '<label class="nx-field nx-f-sort"><span class="nx-l">Sort</span><select id="nx-sort" class="nx-in"><option value="date_added">New uploads</option><option value="favorites">Most favorited</option></select></label>' +
        '<label class="nx-field"><span class="nx-l">From</span><input id="nx-dfrom" class="nx-in" type="date"></label>' +
        '<label class="nx-field"><span class="nx-l">To</span><input id="nx-dto" class="nx-in" type="date"></label>' +
        '<label class="nx-field"><span class="nx-l">Min ♥</span><input id="nx-minf" class="nx-in" type="number" min="0" step="1"></label>' +
        '<label class="nx-field"><span class="nx-l">Max ♥ <button type="button" class="nx-chip" id="nx-maxon" aria-pressed="false" title="Cap favorites at Max ♥">limit</button></span>' +
          '<span class="nx-ix"><input id="nx-maxf" class="nx-in" type="number" min="0" step="1"><span class="nx-inf" id="nx-inf" hidden><b>∞</b><span>no cap</span></span></span></label>' +
        '<label class="nx-field"><span class="nx-l">Batch</span><input id="nx-bs" class="nx-in" type="number" min="1" step="1" title="Matching wallpapers per batch"></label>' +
      '</div>' +
      '<div class="nx-presets"><span class="nx-l">Quick range</span>' +
        '<button type="button" data-p="today">Today</button>' +
        '<button type="button" data-p="7">7 days</button>' +
        '<button type="button" data-p="30">30 days</button>' +
        '<button type="button" data-p="365">1 year</button>' +
        '<button type="button" data-p="all">All time</button>' +
      '</div>' +
      '<div class="nx-sec-h">Content filters</div>' +
      '<div class="nx-grid">' +
        '<div class="nx-field"><span class="nx-l">Categories</span><div class="nx-chips" id="nx-cat">' +
          '<button type="button" class="nx-chip" data-i="0">General</button>' +
          '<button type="button" class="nx-chip" data-i="1">Anime</button>' +
          '<button type="button" class="nx-chip" data-i="2">People</button></div></div>' +
        '<div class="nx-field"><span class="nx-l">Purity</span><div class="nx-chips" id="nx-pur">' +
          '<button type="button" class="nx-chip" data-i="0">SFW</button>' +
          '<button type="button" class="nx-chip" data-i="1">Sketchy</button>' +
          '<button type="button" class="nx-chip" data-i="2" title="Requires an API key">NSFW</button></div></div>' +
        '<label class="nx-field"><span class="nx-l">Min resolution</span><input id="nx-res" class="nx-in" type="text" spellcheck="false" placeholder="1920x1080"></label>' +
        '<label class="nx-field"><span class="nx-l">Ratios</span><input id="nx-rat" class="nx-in" type="text" spellcheck="false" placeholder="16x9, 9x16"></label>' +
      '</div>' +
      '<div class="nx-sec-h">Connection</div>' +
      '<div class="nx-grid">' +
        '<label class="nx-field nx-f-q"><span class="nx-l">API key · <a class="nx-a" href="https://wallhaven.cc/settings/account" target="_blank" rel="noopener">get one</a></span><input id="nx-key" class="nx-in" type="password" autocomplete="off" spellcheck="false" placeholder="optional — higher limits, NSFW"></label>' +
      '</div>' +
      '<div class="nx-sec-h">Downloads</div>' +
      '<div class="nx-grid nx-dlrow">' +
        '<div class="nx-field"><span class="nx-l">Parallel downloads</span>' +
          '<div class="nx-dlstep">' +
            '<button type="button" class="nx-stp" id="nx-dlm" aria-label="Fewer parallel downloads">−</button>' +
            '<span class="nx-dlcv" id="nx-dlcv">1</span>' +
            '<button type="button" class="nx-stp" id="nx-dlp" aria-label="More parallel downloads">+</button>' +
          '</div></div>' +
        '<div class="nx-field"><span class="nx-l">Notify when finished</span>' +
          '<span class="nx-dlchk"><input type="checkbox" id="nx-dlnotif"><span>desktop alert when the queue drains</span></span></div>' +
        '<div class="nx-field"><span class="nx-l">Floating page button</span>' +
          '<span class="nx-dlchk"><input type="checkbox" id="nx-pgpill" checked><span>one tap queues every page you have scrolled to load</span></span></div>' +
        '<div class="nx-field"><span class="nx-l">Page download buttons</span>' +
          '<span class="nx-dlchk"><input type="checkbox" id="nx-pgbars" checked><span>a download button beside every page number — this page only</span></span></div>' +
      '</div>' +
      '<div class="nx-dlstats" id="nx-dlstats"></div>' +
      '<div class="nx-actrow">' +
        '<button type="button" class="nx-btn nx-btn-go" id="nx-go"></button>' +
        '<button type="button" class="nx-btn" id="nx-stop2" disabled>Pause</button>' +
        '<button type="button" class="nx-btn" id="nx-restart" disabled>Restart</button>' +
        '<button type="button" class="nx-btn" id="nx-clear">Clear grid</button>' +
        '<button type="button" class="nx-btn" id="nx-fix">Fix thumbs</button>' +
      '</div>' +
      '<div class="nx-jobstrip" id="nx-jobstrip" hidden></div>' +
      '<div class="nx-sec-h">Search history <span class="nx-hspan">· keep <input id="nx-hm" class="nx-in nx-in-hm" type="number" min="1" step="1"> searches</span></div>' +
      '<div class="nx-hist" id="nx-hist"></div>' +
      '<div class="nx-hist-foot"><button type="button" class="nx-btn nx-btn-dim" id="nx-hist-clear">Clear history</button></div>' +
      '<div class="nx-foot"><span>naXim Labs · Wallhaven Enhancer v8.1.0</span><a href="https://github.com/0naXim0" target="_blank" rel="noopener">github.com/0naXim0</a></div>' +
    '</div></div></div>';

    function chipsVal (box)   { return Array.prototype.map.call(box.children, c => c.classList.contains('on') ? '1' : '0').join(''); }
    function setChips (box, v) {
        Array.prototype.forEach.call(box.children, (c, i) => {
            const on = v[i] === '1';
            c.classList.toggle('on', on); c.setAttribute('aria-pressed', on);
        });
    }
    function validateDates () {
        const i = UI.inputs;
        const bad = !!(i.dfrom.value && i.dto.value && i.dfrom.value > i.dto.value);
        i.dfrom.classList.toggle('nx-bad', bad);
        i.dto.classList.toggle('nx-bad', bad);
        return !bad;
    }
    function refreshMaxFavUI () {
        const on = UI.maxon.classList.contains('on');
        UI.inf.hidden = on;
        UI.inputs.maxf.disabled = !on;
    }

    function markFavRange () {
        const i = UI.inputs;
        let bad = false;
        if (UI.maxon.classList.contains('on')) {
            const mn = parseInt(i.minf.value, 10), mx = parseInt(i.maxf.value, 10);
            bad = !Number.isNaN(mn) && !Number.isNaN(mx) &&
                  i.minf.value.trim() !== '' && i.maxf.value.trim() !== '' && mn > mx;
        }
        i.minf.classList.toggle('nx-bad', bad);
        i.maxf.classList.toggle('nx-bad', bad);
        return bad;
    }

    function readParams () {
        if (!UI) return null;
        const i = UI.inputs;
        const dateFrom = i.dfrom.value, dateTo = i.dto.value;
        if (!dateFrom || !dateTo) { setStatus('✕ Pick a start and an end date.', true); return null; }
        if (dateFrom > dateTo)    { setStatus('✕ Start date is after end date.', true); return null; }
        const categories = chipsVal(UI.chips.cat);
        const purity = chipsVal(UI.chips.pur);
        if (categories === '000') { setStatus('✕ Pick at least one category.', true); return null; }
        if (purity === '000')     { setStatus('✕ Pick at least one purity level.', true); return null; }
        if (purity[2] === '1' && !get('apiKey')) setStatus('Note: NSFW requires an API key — this search may fail.');

        const query = i.q.value.trim();
        const sortMode = i.sort.value;
        let minFavs = clampInt(i.minf.value, 0, 1000000, 0);
        let maxFavs = clampInt(i.maxf.value, 0, 1000000, 0);
        const maxFavsOn = UI.maxon.classList.contains('on');
        if (maxFavsOn && maxFavs > 0 && maxFavs < minFavs) maxFavs = minFavs;
        const batchSize = clampInt(i.bs.value, 1, 1000, 200);
        const atleast = i.res.value.trim();
        const ratios = i.rat.value.trim();

        set('query', query); set('sortMode', sortMode);
        set('dateFrom', dateFrom); set('dateTo', dateTo);
        set('minFavs', minFavs); set('maxFavs', maxFavs); set('maxFavsOn', maxFavsOn);
        set('batchSize', batchSize);
        set('atleast', atleast); set('ratios', ratios);
        set('categories', categories); set('purity', purity);

        const baseParams = { categories: categories, purity: purity, sorting: sortMode };
        if (query)   baseParams.q = query;
        if (atleast) baseParams.atleast = atleast;
        if (ratios)  baseParams.ratios = ratios;

        return { baseParams: baseParams, query: query, categories: categories, purity: purity, atleast: atleast, ratios: ratios,
                 sortMode: sortMode, dateFrom: dateFrom, dateTo: dateTo, minFavs: minFavs, maxFavs: maxFavs, maxFavsOn: maxFavsOn, batchSize: batchSize };
    }

    function applyPreset (p) {
        const to = ymd(new Date());
        let from = to;
        if (p === 'all') from = '2010-01-01';
        else if (p !== 'today') { const d = new Date(); d.setDate(d.getDate() - (parseInt(p, 10) - 1)); from = ymd(d); }
        UI.inputs.dfrom.value = from; UI.inputs.dto.value = to;
        set('dateFrom', from); set('dateTo', to);
        validateDates();
    }

    let _cntRaf = false, _cntVal = 0;
    function setCount (n) {
        _cntVal = n || 0;
        try { PagePill.onCount(_cntVal); } catch (e) {}     /* v7.8.1: the floating page pill counts with the grid */
        try { PageBar.onCount(_cntVal); } catch (e) {}      /* v7.9: the scan bar's count follows the grid */
        if (_cntRaf || !UI) return;
        _cntRaf = true;
        requestAnimationFrame(() => { _cntRaf = false; if (UI && UI.count) UI.count.textContent = _cntVal.toLocaleString(); });
    }
    function setStatus (msg, err) {
        if (!UI || !UI.status) return;
        UI.status.textContent = msg || '';
        UI.status.classList.toggle('nx-err', !!err);
    }
    function setProgress (p) {
        if (!UI || !UI.progI) return;
        const w = Math.max(0, Math.min(100, p || 0));
        UI.progI.style.width = w + '%';
        UI.progI.parentNode.style.opacity = (w > 0 && w < 100) ? '1' : '0';
    }
    /* v8.1 — every scan terminal resolves the bar the same way: fill
       it for a beat, then clear — a completed job never leaves a frozen
       half-bar on screen. Idempotent within its window, and a fresh
       scan run always outranks the pending fade. */
    let _barResT = 0;
    function scanBarResolve () {
        setProgress(100);
        if (_barResT) clearTimeout(_barResT);
        _barResT = setTimeout(() => { _barResT = 0; if (!_running) setProgress(0); }, 600);
    }
    function setRunningUI (on) {
        if (!UI) return;
        UI.btnSearch.forEach(b => { b.disabled = on; });
        UI.btnStop.forEach(b => { b.disabled = !on; });
        UI.btnRestart.forEach(b => { b.disabled = on || !_session; });
        UI.btnClear.forEach(b => { b.disabled = on; });
        UI.btnRefresh.forEach(b => { b.disabled = on; });
        const go = document.getElementById('nx-go');
        const sp = go && go.querySelector('span');
        if (sp) sp.textContent = on ? 'Searching…' : 'Search';
    }

    function buildPanel () {
        const host = getInsertPoint(); if (!host) return;
        const root = mk('div', 'nx-panel' + (get('panelOpen') ? ' nx-open' : ''));
        root.id = 'nx-panel';
        root.innerHTML = PANEL_HTML;
        host.parent.insertBefore(root, host.before);

        const $r = sel => root.querySelector(sel);
        UI = {
            root: root,
            status: $r('.nx-status'), count: $r('.nx-count'), progI: $r('.nx-prog i'),
            btnSearch: [$r('.nx-act-search'), $r('#nx-go')],
            btnStop:   [$r('.nx-act-stop'),  $r('#nx-stop2')],
            btnRestart: [$r('#nx-restart')],
            btnClear:   [$r('#nx-clear')],
            btnRefresh: [$r('.nx-act-refresh'), $r('#nx-fix')],
            inputs: {
                q: $r('#nx-q'), sort: $r('#nx-sort'), dfrom: $r('#nx-dfrom'), dto: $r('#nx-dto'),
                minf: $r('#nx-minf'), maxf: $r('#nx-maxf'), bs: $r('#nx-bs'),
                res: $r('#nx-res'), rat: $r('#nx-rat'), key: $r('#nx-key'), hm: $r('#nx-hm'),
            },
            chips: { cat: $r('#nx-cat'), pur: $r('#nx-pur') },
            maxon: $r('#nx-maxon'), inf: $r('#nx-inf'), jobstrip: $r('#nx-jobstrip'),
        };

        UI.btnSearch.forEach(b => b.innerHTML = IC.play);
        UI.btnStop.forEach(b => b.innerHTML = IC.stop);
        UI.btnRefresh.forEach(b => b.innerHTML = IC.sync);
        $r('.nx-gh').innerHTML = IC.github;
        $r('.nx-exp').innerHTML = IC.chev;
        $r('#nx-go').innerHTML = IC.play + '<span>Search</span>';

        const i = UI.inputs;
        i.q.value = get('query'); i.sort.value = get('sortMode');
        i.dfrom.value = get('dateFrom'); i.dto.value = get('dateTo');
        i.minf.value = get('minFavs'); i.maxf.value = get('maxFavs');
        i.bs.value = get('batchSize');
        i.res.value = get('atleast'); i.rat.value = get('ratios');
        i.key.value = get('apiKey'); i.hm.value = get('maxHistory');
        setChips(UI.chips.cat, get('categories'));
        setChips(UI.chips.pur, get('purity'));
        UI.maxon.classList.toggle('on', get('maxFavsOn'));
        UI.maxon.setAttribute('aria-pressed', get('maxFavsOn'));
        refreshMaxFavUI();
        markFavRange();
        validateDates();

        i.q.addEventListener('change', () => set('query', i.q.value.trim()));
        i.sort.addEventListener('change', () => set('sortMode', i.sort.value));
        const dateChange = () => { set('dateFrom', i.dfrom.value); set('dateTo', i.dto.value); validateDates(); };
        i.dfrom.addEventListener('change', dateChange);
        i.dto.addEventListener('change', dateChange);
        i.dfrom.addEventListener('input', validateDates);
        i.dto.addEventListener('input', validateDates);

        i.minf.addEventListener('input', markFavRange);
        i.maxf.addEventListener('input', markFavRange);
        const normFavs = which => () => {
            const maxOn = UI.maxon.classList.contains('on');
            let minF = clampInt(i.minf.value, 0, 1000000, 0);
            let maxF = clampInt(i.maxf.value, 0, 1000000, 0);
            if (maxOn) {
                if (which === 'max' && maxF < minF) maxF = minF;
                if (which === 'min' && minF > maxF) minF = maxF;
            }
            i.minf.value = minF;
            i.maxf.value = maxF;
            set('minFavs', minF); set('maxFavs', maxF);
            markFavRange();
        };
        i.minf.addEventListener('change', normFavs('min'));
        i.maxf.addEventListener('change', normFavs('max'));

        i.bs.addEventListener('change', () => set('batchSize', clampInt(i.bs.value, 1, 1000, 200)));

        i.res.addEventListener('change', () => set('atleast', i.res.value.trim()));
        i.rat.addEventListener('change', () => set('ratios', i.rat.value.trim()));
        i.key.addEventListener('change', () => set('apiKey', i.key.value.trim()));
        i.hm.addEventListener('change', () => { set('maxHistory', clampInt(i.hm.value, 1, 200, 20)); trimHistory(); refreshHistoryPanel(); });

        [i.q, i.dfrom, i.dto, i.res, i.rat].forEach(el =>
            el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }));

        function wireChips (box, cfgKey) {
            box.addEventListener('click', e => {
                const c = e.target.closest('.nx-chip'); if (!c || !box.contains(c)) return;
                c.classList.toggle('on');
                c.setAttribute('aria-pressed', c.classList.contains('on'));
                set(cfgKey, chipsVal(box));
            });
        }
        wireChips(UI.chips.cat, 'categories');
        wireChips(UI.chips.pur, 'purity');

        UI.maxon.addEventListener('click', () => {
            const on = !UI.maxon.classList.contains('on');
            UI.maxon.classList.toggle('on', on); UI.maxon.setAttribute('aria-pressed', on);
            set('maxFavsOn', on);
            if (on) {
                const mn = clampInt(i.minf.value, 0, 1000000, 0);
                const mx = parseInt(i.maxf.value, 10);
                if (Number.isNaN(mx) || mx < mn) { i.maxf.value = mn; set('maxFavs', mn); }
            }
            refreshMaxFavUI();
            markFavRange();
        });

        /* Downloads — the DL engine's settings live HERE (top panel).
           The queue pane itself is action-only: pause/resume, retry,
           clear-failed, clear-all. Repaints on every change, local or
           from a sibling tab, through DL.onCfg. */
        const dlMinus = $r('#nx-dlm'), dlPlus = $r('#nx-dlp'), dlCv = $r('#nx-dlcv'),
              dlNotif = $r('#nx-dlnotif'), dlStats = $r('#nx-dlstats');
        function paintDl () {
            const c = DL.cfg();
            dlCv.textContent = String(c.conc);
            dlMinus.disabled = c.conc <= 1;
            dlPlus.disabled = c.conc >= c.max;
            if (dlNotif.checked !== !!c.notif) dlNotif.checked = !!c.notif;
            if (dlStats.textContent !== c.statsText) dlStats.textContent = c.statsText;
        }
        dlMinus.addEventListener('click', () => DL.cfg({ conc: DL.cfg().conc - 1 }));
        dlPlus.addEventListener('click', () => DL.cfg({ conc: DL.cfg().conc + 1 }));
        dlNotif.addEventListener('change', () => DL.cfg({ notif: dlNotif.checked }));
        DL.onCfg(paintDl);
        paintDl();

        /* v7.8.1 — the floating page pill: on by default, one tap
           queues the whole current page through the classic download
           manager (the pill itself mounts in the init steps). */
        const pgChk = $r('#nx-pgpill');
        pgChk.checked = !!get('pagePill');
        pgChk.addEventListener('change', () => { set('pagePill', pgChk.checked); PagePill.sync(); });

        /* v7.9 — the per-page buttons: a download chip beside every
           page number; off removes them all live. */
        const pbChk = $r('#nx-pgbars');
        pbChk.checked = !!get('pageBars');
        pbChk.addEventListener('change', () => { set('pageBars', pbChk.checked); PageBar.sync(); });

        $r('.nx-presets').addEventListener('click', e => {
            const b = e.target.closest('button[data-p]'); if (b) applyPreset(b.dataset.p);
        });

        $r('.nx-exp').addEventListener('click', () => {
            const open = !root.classList.contains('nx-open');
            root.classList.toggle('nx-open', open);
            $r('.nx-exp').setAttribute('aria-expanded', open);
            set('panelOpen', open);
        });

        UI.btnSearch.forEach(b => b.addEventListener('click', runSearch));
        UI.btnStop.forEach(b => b.addEventListener('click', () => {
            if (_running) pauseSearch();
            else if (_session && _session.phase === 'paused') continueSearch();
        }));
        UI.btnRestart.forEach(b => b.addEventListener('click', restartSearch));
        UI.btnClear.forEach(b => b.addEventListener('click', clearGrid));
        UI.btnRefresh.forEach(b => b.addEventListener('click', refreshImages));
        $r('#nx-hist-clear').addEventListener('click', () => {
            historyLoad().forEach(e => batchDelete(e.id));
            _session = null;
            refreshHistoryPanel();
            renderJobStrip();
            setStatus('History cleared.');
        });

        refreshHistoryPanel();
        renderJobStrip();
        setCount(document.querySelectorAll('figure.thumb[data-wallpaper-id]').length);
    }

    /* ═══ STYLES ═══════════════════════════════════════════════════ */

    const CSS = `
:root { --nx-acc:#7aa2f7; --nx-ok:#9ece6a; --nx-err:#f7768e; --nx-acc-soft:rgba(122,162,247,.16); }
:where(.nx-panel, .nx-lb, .nx-hyper-pill, .nx-cont-bar, .nx-dlm, .nx-pg) :is(button, a, input, select) {
    margin:0; padding:0; font:inherit; color:inherit; background:none; border:none;
    box-sizing:border-box; cursor:pointer; text-decoration:none; line-height:1.2;
}
:where(.nx-panel, .nx-lb, .nx-hyper-pill, .nx-cont-bar, .nx-dlm, .nx-pg) * { box-sizing:border-box; }
:where(.nx-panel, .nx-lb) :is(button, a):focus-visible { outline:2px solid var(--nx-acc); outline-offset:2px; }

#nx-panel {
    color-scheme: dark;
    --bg:#0f1216; --sf:#191c23; --sf2:#22262f; --bd:#2a2f3a; --bd2:#3a4150;
    --tx:#e3e7ef; --mut:#8b91a0;
    position:relative; display:flex; flex-direction:column;
    background:var(--sf); border:1px solid var(--bd); border-radius:12px;
    margin:0 0 14px; font:13px/1.4 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    color:var(--tx); overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.35);
}
#nx-panel .nx-bar { display:flex; align-items:center; gap:10px; padding:5px 10px; min-height:38px; }
.nx-brand { display:flex; align-items:center; gap:8px; user-select:none; }
.nx-mark { width:22px; height:22px; border-radius:7px; text-align:center;
    background:linear-gradient(135deg,var(--nx-acc),#b48ead); color:#0d0f14;
    font:800 10.5px/22px -apple-system,"Segoe UI",sans-serif; letter-spacing:-.5px; }
.nx-name { font-weight:600; font-size:12.5px; white-space:nowrap; }
.nx-name i { font-style:normal; color:var(--mut); font-weight:500; }
.nx-status { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    font-size:12px; color:var(--mut); }
.nx-status.nx-err { color:var(--nx-err); }
.nx-count { font-size:11px; color:var(--mut); background:var(--sf2); border:1px solid var(--bd);
    padding:2px 8px; border-radius:999px; white-space:nowrap; }
.nx-actions { display:flex; align-items:center; gap:3px; }
#nx-panel .nx-ib { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px;
    border-radius:8px; color:var(--mut); transition:background .15s,color .15s; }
#nx-panel .nx-ib svg { width:15px; height:15px; display:block; }
#nx-panel .nx-ib:hover { background:var(--sf2); color:var(--tx); }
#nx-panel .nx-ib:disabled { opacity:.35; cursor:default; }
#nx-panel .nx-ib:disabled:hover { background:transparent; }
.nx-exp svg { transition:transform .25s; }
#nx-panel.nx-open .nx-exp svg { transform:rotate(180deg); }
.nx-prog { position:absolute; top:0; left:0; right:0; height:2px; pointer-events:none; opacity:0; transition:opacity .3s; }
.nx-prog i { display:block; height:100%; width:0; border-radius:2px;
    background:linear-gradient(90deg,var(--nx-acc),var(--nx-ok)); transition:width .25s; }

.nx-body { display:grid; grid-template-rows:0fr; transition:grid-template-rows .3s cubic-bezier(.3,0,.2,1); }
#nx-panel.nx-open .nx-body { grid-template-rows:1fr; }
.nx-body-in { overflow:hidden; }
.nx-pad { padding:4px 12px 12px; border-top:1px solid var(--bd); }
.nx-grid { display:flex; flex-wrap:wrap; gap:9px 10px; padding:7px 0; }
.nx-field { display:flex; flex-direction:column; gap:4px; min-width:0; }
.nx-l { font-size:10px; font-weight:700; letter-spacing:.7px; text-transform:uppercase;
    color:var(--mut); display:flex; align-items:center; gap:6px; white-space:nowrap; }
.nx-in {
    height:30px; padding:0 10px;
    background:var(--bg); border:1px solid var(--bd); border-radius:9px;
    color:var(--tx); font-size:12.5px; font-weight:500;
    box-shadow:inset 0 1px 3px rgba(0,0,0,.28);
    transition:border-color .15s, box-shadow .15s, background .15s;
}
.nx-in:hover { border-color:var(--bd2); }
.nx-in:focus { outline:none; border-color:var(--nx-acc); background:#12151b;
    box-shadow:0 0 0 3px var(--nx-acc-soft), inset 0 1px 3px rgba(0,0,0,.28); }
.nx-in::placeholder { color:#585f6e; font-weight:400; }
.nx-in:disabled { opacity:.35; cursor:default; }
.nx-in.nx-bad { border-color:var(--nx-err); }
.nx-in[type=date]   { width:134px; }
.nx-in[type=number] { width:84px; }
.nx-f-q { flex:1 1 220px; } .nx-f-q .nx-in { width:100%; }
.nx-f-sort .nx-in { width:150px; }
#nx-panel select.nx-in {
    appearance:none; -webkit-appearance:none; padding-right:28px;
    background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238b91a0' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat:no-repeat; background-position:right 10px center;
}
#nx-panel select.nx-in option { background:#191c23; color:#e3e7ef; }
.nx-ix { position:relative; display:block; }
.nx-ix .nx-in { display:block; width:84px; }
.nx-inf { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; gap:7px;
    border:1px dashed var(--bd2); border-radius:9px; color:var(--mut);
    background:var(--bg); pointer-events:none; }
.nx-inf[hidden] { display:none; }
.nx-inf b { font-size:16px; font-weight:600; color:#9aa3b5; line-height:1; }
.nx-inf span { font-size:9.5px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; }
.nx-presets { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:0 0 6px; }
.nx-presets button { height:24px; padding:0 11px; border-radius:999px; border:1px solid var(--bd);
    background:var(--bg); color:var(--mut); font-size:11px; font-weight:600;
    box-shadow:inset 0 1px 2px rgba(0,0,0,.22); transition:color .15s,border-color .15s; }
.nx-presets button:hover { color:var(--tx); border-color:var(--nx-acc); }
.nx-sec-h { display:flex; align-items:center; gap:8px; margin-top:4px; padding-top:10px;
    border-top:1px solid var(--bd); font-size:10px; font-weight:700; letter-spacing:.8px;
    text-transform:uppercase; color:var(--mut); }
.nx-chips { display:flex; gap:4px; flex-wrap:wrap; }
.nx-chip { height:24px; padding:0 11px; border-radius:999px; border:1px solid var(--bd);
    background:var(--bg); color:var(--mut); font-size:11.5px; font-weight:600;
    box-shadow:inset 0 1px 2px rgba(0,0,0,.22); transition:all .15s; }
.nx-chip:hover { border-color:var(--bd2); color:var(--tx); }
.nx-chip.on { background:var(--nx-acc-soft); border-color:var(--nx-acc); color:var(--nx-acc); box-shadow:none; }
.nx-l .nx-chip { height:17px; padding:0 8px; font-size:10px; }
.nx-actrow { display:flex; gap:8px; flex-wrap:wrap; padding:10px 0 2px; }
.nx-btn { display:inline-flex; align-items:center; gap:7px; height:30px; padding:0 14px;
    border-radius:9px; border:1px solid var(--bd); background:var(--sf2); color:var(--tx);
    font-size:12.5px; font-weight:600; transition:background .15s, border-color .15s; }
.nx-btn svg { width:13px; height:13px; }
.nx-btn:hover { border-color:var(--bd2); background:#2a2f3d; }
.nx-btn:active { transform:translateY(1px); }
.nx-btn:disabled { opacity:.4; cursor:default; transform:none; }
.nx-btn-go { background:var(--nx-acc); border-color:var(--nx-acc); color:#0c0e13; }
.nx-btn-go:hover { background:#8cb0ff; }
.nx-btn-dim { height:24px; padding:0 10px; font-size:11.5px; font-weight:500; background:transparent; }
.nx-hist { display:flex; flex-direction:column; gap:4px; max-height:172px; overflow:auto; padding:4px 0; }
.nx-hist-row { display:flex; align-items:center; gap:8px; padding:4px 8px; border:1px solid var(--bd);
    border-radius:8px; background:var(--bg); }
.nx-hist-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11.5px; }
.nx-hist-empty { color:var(--mut); font-size:11.5px; padding:4px 8px; }
.nx-hist-x { padding:0 7px; } .nx-hist-x svg { width:11px; height:11px; }
.nx-hspan { display:inline-flex; align-items:center; gap:6px; text-transform:none;
    letter-spacing:0; font-weight:500; font-size:11px; }
.nx-in-hm { height:22px; width:52px; font-size:11px; }
.nx-dlrow { align-items:flex-end; }
.nx-dlstep { display:flex; align-items:center; gap:5px; }
.nx-stp { width:30px; height:30px; display:flex; align-items:center; justify-content:center;
    border-radius:9px; border:1px solid var(--bd); background:var(--bg); color:var(--mut);
    font:700 14px/1 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    transition:color .15s, border-color .15s; }
.nx-stp:hover:not(:disabled) { color:var(--nx-acc); border-color:var(--nx-acc); }
.nx-stp:disabled { opacity:.3; cursor:default; }
.nx-dlcv { min-width:56px; height:30px; text-align:center; border:1px solid var(--bd);
    border-radius:9px; background:var(--bg); color:var(--nx-acc);
    font:700 12.5px/28px -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }
.nx-dlchk { display:flex; align-items:center; gap:8px; height:30px; cursor:pointer; }
.nx-dlchk input { width:15px; height:15px; accent-color:#7aa2f7; cursor:pointer; }
.nx-dlchk span { font-size:11.5px; color:var(--mut); }
.nx-dlstats { padding:0 0 6px; font-size:10.5px; color:var(--mut); }
.nx-hist-foot { display:flex; justify-content:flex-end; padding-top:4px; }
.nx-jobstrip { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:6px 0 2px;
    padding:6px 9px; background:var(--sf2); border:1px solid var(--bd); border-radius:9px;
    font-size:11px; color:var(--mut); }
.nx-jobstrip[hidden] { display:none; }
.nx-job-txt { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nx-phase { flex:none; padding:2px 8px; border-radius:99px; background:var(--nx-acc-soft); color:var(--nx-acc);
    font:600 9.5px/1.4 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    letter-spacing:.4px; text-transform:uppercase; }
.nx-phase-paused, .nx-phase-sparse, .nx-phase-legacy { background:rgba(224,175,104,.16); color:#e0af68; }
.nx-phase-collecting { background:rgba(122,162,247,.16); color:#7aa2f7; }
.nx-phase-exhausted { background:rgba(158,206,106,.14); color:#9ece6a; }
.nx-phase-error { background:rgba(247,118,142,.15); color:#f7768e; }
.nx-hist-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.nx-hist-meta { font-size:10.5px; color:var(--mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nx-hist-btns { display:flex; gap:4px; flex:none; }
.nx-hist-ib { padding:0 7px; } .nx-hist-ib svg { width:11px; height:11px; }
.nx-hist-item { display:flex; flex-direction:column; gap:3px; }
.nx-hist-tw { flex:none; display:inline-flex; align-items:center; gap:4px; height:24px; padding:0 6px;
    border-radius:7px; color:var(--mut); transition:color .15s, background .15s; }
.nx-hist-tw:not(:disabled):hover { background:var(--sf2); color:var(--tx); }
.nx-hist-tw:disabled { opacity:.35; cursor:default; }
.nx-hist-tw b { font-size:10px; font-weight:700; color:var(--nx-acc); background:var(--nx-acc-soft);
    padding:1px 6px; border-radius:99px; line-height:1.4; }
.nx-hist-tw svg { width:11px; height:11px; transition:transform .18s; }
.nx-hist-item.nx-open > .nx-hist-row .nx-hist-tw svg { transform:rotate(180deg); }
.nx-hist-sub { display:flex; flex-direction:column; gap:3px; margin-left:24px; padding:1px 0 1px 9px;
    border-left:2px solid var(--bd); }
.nx-hist-sub[hidden] { display:none; }
.nx-hist-batch { display:flex; align-items:center; gap:8px; padding:3px 8px; border:1px solid var(--bd);
    border-radius:7px; background:var(--sf); }
.nx-hist-batch-n { flex:none; min-width:36px; font-size:11px; font-weight:700; color:var(--nx-acc); }
.nx-hist-batch-meta { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    font-size:10.5px; color:var(--mut); }
.nx-hist-batch .nx-btn { flex:none; height:22px; padding:0 9px; font-size:10.5px; }
.nx-foot { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px;
    padding:8px 0 2px; margin-top:8px; border-top:1px solid var(--bd);
    font-size:10.5px; color:var(--mut); }
.nx-foot a, .nx-a { color:var(--nx-acc); }
.nx-foot a:hover, .nx-a:hover { text-decoration:underline; }
@media (max-width:760px) {
    .nx-name { display:none; }
    #nx-panel .nx-bar { gap:7px; }
}

section.thumb-listing-page > ul, #thumbs > ul, ul#thumbs { display:flex; flex-wrap:wrap; gap:14px; }
section.thumb-listing-page > ul > li, #thumbs > ul > li, ul#thumbs > li { margin:0 !important; float:none !important; }
figure.thumb { position:relative; border-radius:10px; background:#101216;
    transition:transform .18s ease, box-shadow .18s ease; }
figure.thumb:hover { transform:translateY(-2px); box-shadow:0 12px 30px rgba(0,0,0,.45); }
/* ── GLOBAL KILL — wallhaven's native per-thumb corner star. The green
   .thumb-btn-unfav badge (rendered on every wallpaper you have favorited)
   is always visible from the server HTML until the lazy hover-time
   sanitizer reached the card. This rule keeps the corner star dead on
   every page from the moment the stylesheet lands — load, hover, refresh,
   and infinite-scroll additions alike. The enhancer's own .nx-fav star in
   the bottom info bar is the single favorite affordance. */
figure.thumb .thumb-btn.thumb-btn-fav,
figure.thumb .thumb-btn.thumb-btn-unfav { display:none !important; }
figure.thumb img { display:block; width:100%; height:auto; border-radius:10px; }
figure.thumb .preview, figure.thumb .thumb-info { border-radius:0 0 10px 10px; }
.nx-empty { flex:1 1 100%; width:100%; padding:26px 18px; text-align:center; color:#8d93a3; font-size:13px; }
.nx-empty strong { color:#dde1ea; }

figure.thumb.nx-card { overflow:hidden !important; border-radius:10px !important; }
figure.thumb.nx-card > img {
    display:block !important; width:100% !important; height:100% !important;
    object-fit:cover; border-radius:0 !important; margin:0 !important; padding:0 !important; }
figure.thumb .thumb-info {
    position:absolute !important; left:0 !important; right:0 !important;
    bottom:0 !important; top:auto !important; z-index:120 !important;
    width:auto !important; height:30px !important; min-height:0 !important; max-height:none !important;
    margin:0 !important; padding:0 8px !important;
    display:flex !important; flex-direction:row !important;
    align-items:center !important; justify-content:space-between !important; gap:8px;
    background:linear-gradient(rgba(10,12,16,0), rgba(10,12,16,.88)) !important;
    border:0 !important; border-radius:0 0 10px 10px !important;
    box-shadow:none !important; transform:none !important;
    pointer-events:none !important;
    opacity:0 !important; transition:opacity .16s ease;
    font-family:-apple-system,"Segoe UI",Roboto,sans-serif !important;
    font-size:10.5px !important; font-weight:600 !important; line-height:1 !important;
    color:#e8ecf4; white-space:nowrap; overflow:visible !important; visibility:visible !important;
}
figure.thumb:hover .thumb-info,
figure.thumb:focus-within .thumb-info { opacity:1 !important; }
figure.thumb .thumb-info .wall-res,
figure.thumb .thumb-info .nx-fav,
figure.thumb .thumb-info .wall-favs {
    position:static !important; float:none !important;
    top:auto !important; bottom:auto !important; left:auto !important; right:auto !important;
    display:inline-flex !important; align-items:center !important; gap:4px;
    margin:0 !important; padding:0 !important; border:0 !important;
    background:none !important; box-shadow:none !important; transform:none !important;
    width:auto !important; height:auto !important; max-height:none !important;
    font-family:inherit !important; font-size:10.5px !important; font-weight:600 !important;
    line-height:1 !important; color:#e8ecf4 !important;
    text-decoration:none !important; text-shadow:none !important;
    white-space:nowrap !important; opacity:1 !important; visibility:visible !important;
}
figure.thumb .thumb-info .wall-res { color:#c3cbd9 !important; pointer-events:none !important; cursor:default !important; }
figure.thumb .thumb-info .nx-fav,
figure.thumb .thumb-info .wall-favs { pointer-events:auto !important; cursor:pointer !important; transition:color .15s; }
figure.thumb .thumb-info .nx-fav { position:relative !important; isolation:isolate; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; touch-action:manipulation; -webkit-touch-callout:none; transition:color .18s ease, transform .16s ease, filter .18s ease; }
figure.thumb .thumb-info .nx-fav::after { content:""; position:absolute; inset:-5px; z-index:-1;
    border-radius:50%; background:rgba(230,192,105,.14); opacity:0; transform:scale(.72);
    transition:opacity .18s ease, transform .18s cubic-bezier(.2,.8,.2,1); pointer-events:none; }
figure.thumb .thumb-info .nx-fav:hover::after,
figure.thumb .thumb-info .nx-fav:focus-visible::after { opacity:1; transform:scale(1); }
figure.thumb .thumb-info .nx-fav:hover { filter:brightness(1.08); }
figure.thumb .thumb-info .nx-fav:active { transform:scale(.9); }
/* Hold feedback — the glow fills over exactly the hold threshold (FAV_HOLD_MS).
   Matches the :hover end-state, so mouse users see no change; touch users
   get a visible “almost there” cue while pressing. */
figure.thumb .thumb-info .nx-fav.nx-holding::after { opacity:1; transform:scale(1); transition-duration:.4s; }
figure.thumb .thumb-info .nx-fav[aria-busy="true"]{cursor:progress}
figure.thumb .thumb-info .nx-fav[data-fav-state="loading"] { color:#b8c9ef !important; cursor:default !important; opacity:.78; }
figure.thumb .thumb-info .nx-fav[data-fav-state="loading"]::after { opacity:.38; transform:scale(1); }
figure.thumb .thumb-info .nx-fav[data-fav-state="loading"] svg { animation:nx-fav-breathe .9s ease-in-out infinite; }
figure.thumb .thumb-info .nx-fav[data-fav-state="success"] { color:#b7df8a !important; }
figure.thumb .thumb-info .nx-fav[data-fav-state="success"] svg { animation:nx-fav-pop .28s cubic-bezier(.2,.8,.2,1); }
figure.thumb .thumb-info .nx-fav[data-fav-state="error"] { color:#f0a7b4 !important; }
figure.thumb .thumb-info .nx-fav svg { transform-origin:50% 58%; transition:transform .18s cubic-bezier(.2,.8,.2,1), color .18s ease, fill .18s ease; }
figure.thumb .thumb-info .nx-fav:hover svg { transform:scale(1.1); }
figure.thumb .thumb-info .nx-fav:hover,
figure.thumb .thumb-info .wall-favs:hover { color:#ffffff !important; }
figure.thumb .thumb-info .nx-fav:focus-visible { outline:2px solid rgba(122,162,247,.8); outline-offset:1px; }
figure.thumb .thumb-info .wall-favs svg,
figure.thumb .thumb-info .nx-fav svg {
    width:11px !important; height:11px !important; margin:0 !important; flex:none !important;
    color:#d9bd6e !important;
    fill:none !important; stroke:currentColor !important; stroke-width:2.4;
    vector-effect:non-scaling-stroke;
    transition:color .15s, fill .15s;
}
figure.thumb .thumb-info .wall-favs i {
    color:#d9bd6e !important; font-size:11px !important; line-height:1 !important;
    margin:0 !important; width:auto !important; height:auto !important; text-align:center; }
figure.thumb .thumb-info .nx-fav:hover svg,
figure.thumb .thumb-info .wall-favs:hover svg { color:#f2d788 !important; }
figure.thumb .thumb-info .nx-fav.on { color:#e6c069 !important; }
figure.thumb .thumb-info .nx-fav.on svg { fill:currentColor !important; stroke:none !important; }
figure.thumb .thumb-info .nx-fav.nx-pulse svg { animation:nx-fav-pop .28s cubic-bezier(.2,.8,.2,1); }
figure.thumb .thumb-info .nx-fav.on::after { animation:nx-fav-ring .34s ease-out; }
figure.thumb .thumb-info .nx-fav.nx-fav-err { color:#f0a7b4 !important; }
figure.thumb .thumb-info .nx-fav.nx-fav-err svg { fill:none !important; stroke:#f7768e !important; }
figure.thumb .thumb-info .nx-fav.nx-fav-err { animation:nx-fav-shake .28s ease-in-out; }
.nx-hide { display:none !important; }
figure.thumb .thumb-tags, figure.thumb .thumb-tag, figure.thumb .thumb-format,
figure.thumb .thumb-filetype, figure.thumb .thumb-purity, figure.thumb .thumb-options {
    display:none !important; }
figure.thumb > .wall-res { position:absolute !important; left:8px !important; bottom:10px !important;
    top:auto !important; right:auto !important; margin:0 !important; padding:0 !important; z-index:121 !important;
    color:#c3cbd9 !important; font:600 10.5px/1 -apple-system,"Segoe UI",sans-serif !important;
    pointer-events:none !important; background:none !important; border:0 !important; }
figure.thumb > .wall-favs { position:absolute !important; right:8px !important; bottom:10px !important;
    top:auto !important; left:auto !important; margin:0 !important; padding:0 !important; z-index:121 !important;
    display:inline-flex !important; align-items:center !important; gap:4px; color:#e8ecf4 !important;
    background:none !important; border:0 !important;
    font:600 10.5px/1 -apple-system,"Segoe UI",sans-serif !important;
    pointer-events:auto !important; text-decoration:none !important; cursor:pointer !important; }
figure.thumb > .wall-favs svg { width:11px !important; height:11px !important; color:#d9bd6e !important;
    fill:none !important; stroke:currentColor !important; stroke-width:2.4; vector-effect:non-scaling-stroke; }
figure.thumb > .wall-favs i { color:#d9bd6e !important; font-size:11px !important; line-height:1 !important; }

figure.thumb .nx-tools {
    position:absolute; top:50%; right:7px; transform:translateY(-50%);
    z-index:400; display:flex; flex-direction:column; gap:6px;
    opacity:0; pointer-events:none; transition:opacity .16s ease;
}
figure.thumb:hover .nx-tools,
figure.thumb:focus-within .nx-tools { opacity:1; pointer-events:auto; }
.nx-tool { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px;
    padding:0; border-radius:9px; border:1px solid rgba(255,255,255,.16);
    background:rgba(10,12,18,.62); color:#e8ecf4; backdrop-filter:blur(6px);
    transition:background .15s, color .15s, transform .12s; }
.nx-tool svg { width:13px; height:13px; }
.nx-tool:hover { background:rgba(22,27,38,.88); }
.nx-tool:active { transform:scale(.93); }
.nx-tool.nx-tool-hy.on { color:var(--nx-ok); border-color:rgba(158,206,106,.5); }
.nx-tool.nx-busy { color:var(--nx-acc); }
.nx-tool.nx-ok   { color:var(--nx-ok); }
.nx-tool.nx-se   { color:var(--nx-err); }
.nx-spin { width:13px; height:13px; border-radius:50%;
    border:2px solid rgba(122,162,247,.25); border-top-color:var(--nx-acc);
    animation:nx-rot .7s linear infinite; }
@media (pointer:coarse) {
    figure.thumb .nx-tools { right:5px; gap:7px; }
    .nx-tool { width:32px; height:32px; }
}
@media (hover:none) {
    figure.thumb .nx-tools { opacity:1; pointer-events:auto; }
    figure.thumb .nx-date  { opacity:1; }
    figure.thumb .thumb-info { opacity:1 !important; }
}

.nx-tool.nx-pulse, .nx-lb-ab.nx-pulse, .nx-fav.nx-pulse { animation:nx-pulse .32s ease; }
@keyframes nx-pulse { 0% { transform:scale(1); } 35% { transform:scale(.78); } 100% { transform:scale(1); } }
@keyframes nx-fav-pop { 0% { transform:scale(1); } 45% { transform:scale(1.28); } 100% { transform:scale(1); } }
@keyframes nx-fav-ring { 0% { opacity:.72; transform:scale(.72); } 100% { opacity:0; transform:scale(1.35); } }
@keyframes nx-fav-shake { 25% { transform:translateX(-2px); } 75% { transform:translateX(2px); } }
@keyframes nx-fav-breathe { 0%,100% { opacity:.55; transform:scale(.94); } 50% { opacity:1; transform:scale(1.08); } }

figure.thumb .nx-date { position:absolute; top:8px; left:8px; z-index:9999; padding:2px 8px;
    border-radius:999px; background:rgba(10,12,18,.66); color:#c9d2e2;
    font:600 10px/1.4 -apple-system,"Segoe UI",sans-serif; letter-spacing:.3px;
    pointer-events:none; backdrop-filter:blur(6px); white-space:nowrap;
    opacity:0; transition:opacity .16s ease; }
figure.thumb:hover .nx-date,
figure.thumb:focus-within .nx-date { opacity:1; }

.nx-hyper-pill { position:fixed; top:10px; left:50%; transform:translateX(-50%); z-index:30500;
    display:flex; align-items:center; gap:8px; padding:6px 8px 6px 12px; border-radius:999px;
    background:rgba(18,21,28,.92); border:1px solid rgba(158,206,106,.4); color:#dfe6f1;
    font:600 12px/1 -apple-system,"Segoe UI",sans-serif; backdrop-filter:blur(8px);
    box-shadow:0 6px 24px rgba(0,0,0,.4); }
.nx-hyper-pill svg { width:13px; height:13px; color:var(--nx-ok); }
.nx-hyper-pill button { display:inline-flex; align-items:center; justify-content:center;
    width:20px; height:20px; border-radius:50%; color:#8d93a3; }
.nx-hyper-pill button:hover { color:#fff; }
.nx-hyper-pill button svg { width:11px; height:11px; color:currentColor; }
figure.thumb.nx-flash { animation:nx-flash .55s ease; }
@keyframes nx-flash {
    0%   { box-shadow:inset 0 0 0 0 rgba(158,206,106,.9), 0 0 0 0 rgba(158,206,106,.55); }
    100% { box-shadow:inset 0 0 0 3px rgba(158,206,106,0), 0 0 0 18px rgba(158,206,106,0); }
}
.nx-hind { position:absolute; inset:0; z-index:500; display:flex; align-items:center;
    justify-content:center; pointer-events:none; color:#fff; animation:nx-hind .8s ease forwards; opacity:0; }
.nx-hind svg { width:26px; height:26px; filter:drop-shadow(0 2px 8px rgba(0,0,0,.6)); }
@keyframes nx-hind { 0%{opacity:0;transform:translateY(6px);} 25%{opacity:1;} 80%{opacity:1;} 100%{opacity:0;transform:translateY(-8px);} }

.nx-dlm { position:fixed; right:16px; bottom:16px; z-index:30400;
    display:flex; flex-direction:column; align-items:flex-end; gap:8px;
    opacity:0; transform:translateY(10px); pointer-events:none;
    transition:opacity .18s ease, transform .18s ease; }
.nx-dlm.on { opacity:1; transform:none; pointer-events:auto; }
.nx-dlm-pill { width:36px; height:36px; padding:0; border-radius:50%;
    border:1px solid #2a2f3a; background:rgba(25,28,35,.94);
    backdrop-filter:blur(8px); box-shadow:0 6px 20px rgba(0,0,0,.4);
    display:flex; align-items:center; justify-content:center; cursor:pointer;
    transition:background .15s; }
.nx-dlm-pill:hover { background:rgba(34,38,48,.96); }
.nx-dlm-pill:focus-visible { outline:2px solid rgba(122,162,247,.85); outline-offset:2px; }
.nx-dlm-ring { position:relative; width:26px; height:26px; display:block; }
.nx-dlm-ring svg { width:26px; height:26px; display:block; transform:rotate(-90deg); }
.nx-dlm-ring .nx-r-bg { fill:none; stroke:rgba(255,255,255,.14); stroke-width:3; }
.nx-dlm-ring .nx-r-fg { fill:none; stroke:#7aa2f7; stroke-width:3; stroke-linecap:round;
    transition:stroke-dashoffset .18s linear, stroke .25s; }
.nx-dlm-ring .nx-r-fg.nx-indet { opacity:.45; }
.nx-dlm-count { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    font:700 9.5px/1 -apple-system,"Segoe UI",sans-serif; color:#e8ecf4; pointer-events:none; }
.nx-dlm-list { display:none; flex-direction:column; width:262px;
    padding:6px; border-radius:12px; border:1px solid #2a2f3a; background:rgba(25,28,35,.96);
    backdrop-filter:blur(10px); box-shadow:0 10px 32px rgba(0,0,0,.45); }
.nx-dlm.nx-open .nx-dlm-list { display:flex; animation:nx-dlm-in .16s ease; }
@keyframes nx-dlm-in { from { opacity:0; transform:translateY(6px); } }
.nx-dlm-bar { display:flex; align-items:center; gap:2px; padding:0 2px 6px; margin-bottom:4px;
    border-bottom:1px solid rgba(255,255,255,.07); }
.nx-dlm-info { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:0 5px;
    font:600 9.5px/1.2 -apple-system,"Segoe UI",sans-serif; color:#98a0b0; }
.nx-dlm-act { width:22px; height:22px; flex:none; display:flex; align-items:center; justify-content:center;
    border-radius:6px; color:#8d93a3; transition:color .15s, background .15s; }
.nx-dlm-act svg { width:12px; height:12px; }
.nx-dlm-act:hover { color:#c9d2e2; background:rgba(255,255,255,.06); }
.nx-dlm-act[hidden] { display:none; }
.nx-dlm-act.nx-pause:hover { color:#e0af68; background:rgba(224,175,104,.12); }
.nx-dlm-act.nx-rta:hover { color:var(--nx-ok); background:rgba(158,206,106,.12); }
.nx-dlm-act.nx-clr:hover { color:var(--nx-err); background:rgba(247,118,142,.12); }
.nx-dlm-act.nx-trash:hover { color:#f7768e; background:rgba(247,118,142,.12); }
.nx-dlm-act.nx-trash.nx-armed { color:#f7768e; background:rgba(247,118,142,.2); }
.nx-dlm-act:disabled { opacity:.3; cursor:default; }
.nx-dlm-act:disabled:hover { color:#8d93a3; background:transparent; }
.nx-dlm.nx-paused .nx-dlm-ring .nx-r-fg { stroke:#e0af68; }
.nx-dlm-rows { display:flex; flex-direction:column; gap:3px; overflow-y:auto; max-height:216px; }
.nx-dlm-row { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:8px; }
.nx-dlm-col { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.nx-dlm-sub { overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    font:500 9px/1.1 -apple-system,"Segoe UI",sans-serif; color:#79808f; }
.nx-dlm-row[data-st=down] .nx-dlm-sub { color:#8d93a3; }
.nx-dlm-row[data-st=fail] .nx-dlm-sub { color:var(--nx-err); opacity:.85; }
.nx-dlm-row:hover { background:rgba(255,255,255,.04); }
.nx-dlm-thumb { width:34px; height:22px; object-fit:cover; border-radius:4px; background:#101216; flex:none; }
.nx-dlm-id { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    font:600 10.5px/1.2 -apple-system,"Segoe UI",sans-serif; color:#c9d2e2; }
.nx-dlm-pct { flex:none; min-width:44px; text-align:right;
    font:700 10px/1 -apple-system,"Segoe UI",sans-serif; color:#98a0b0; }
.nx-dlm-rring { position:relative; width:18px; height:18px; flex:none; display:block; }
.nx-dlm-rring svg { width:18px; height:18px; display:block; transform:rotate(-90deg); }
.nx-dlm-rring .nx-r-bg { fill:none; stroke:rgba(255,255,255,.14); stroke-width:2.5; }
.nx-dlm-rring .nx-r-fg { fill:none; stroke:#7aa2f7; stroke-width:2.5; stroke-linecap:round;
    transition:stroke-dashoffset .18s linear, stroke .25s; }
.nx-dlm-rring .nx-r-fg.nx-indet { opacity:.45; }
.nx-dlm-row[data-st=done] .nx-dlm-pct { color:var(--nx-ok); }
.nx-dlm-row[data-st=done] .nx-r-fg  { stroke:var(--nx-ok); }
.nx-dlm-row[data-st=fail] .nx-dlm-pct { color:var(--nx-err); }
.nx-dlm-row[data-st=fail] .nx-r-fg  { stroke:var(--nx-err); }
.nx-dlm-x { width:20px; height:20px; flex:none; display:flex; align-items:center; justify-content:center;
    border-radius:6px; color:#8d93a3; cursor:pointer; transition:color .15s, background .15s; }
.nx-dlm-x:hover { color:#f7768e; background:rgba(247,118,142,.12); }
.nx-dlm-x svg { width:11px; height:11px; }
.nx-dlm-rt:hover { color:var(--nx-ok); background:rgba(158,206,106,.12); }
@media (max-width:760px) {
    .nx-dlm { right:10px; bottom:10px; }
    .nx-dlm-list { width:220px; }
    .nx-dlm-rows { max-height:170px; }
}

/* ─── v7.7.1 floating Continue pill — always on screen ─── */
.nx-cont-bar { position:fixed; left:50%; bottom:18px; z-index:30400;
    display:flex; align-items:center; gap:10px; max-width:min(92vw, 640px);
    padding:5px; border:1px solid #2a2f3a; border-radius:999px;
    background:rgba(25,28,35,.92); backdrop-filter:blur(10px);
    box-shadow:0 10px 32px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.28);
    font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
    opacity:0; transform:translate(-50%, 10px); pointer-events:none;
    transition:opacity .18s ease, transform .18s ease; }
.nx-cont-bar.on { opacity:1; transform:translate(-50%, 0); pointer-events:auto; }
.nx-cont-bar .nx-btn { flex:none; height:34px; min-width:0; padding:0 16px;
    border-radius:999px; justify-content:center; white-space:nowrap; cursor:pointer;
    background:#7aa2f7; border:1px solid #7aa2f7; color:#0c0e13;
    font-size:12.5px; font-weight:600;
    box-shadow:0 3px 12px rgba(122,162,247,.35);
    transition:background .15s, border-color .15s, transform .15s, box-shadow .15s; }
.nx-cont-bar .nx-btn svg { color:#0c0e13; }
.nx-cont-bar .nx-btn:hover:not(:disabled) { background:#8cb0ff; border-color:#8cb0ff;
    transform:translateY(-1px); box-shadow:0 5px 16px rgba(122,162,247,.45); }
.nx-cont-bar .nx-btn:active:not(:disabled) { transform:translateY(0); }
.nx-cont-bar .nx-btn:focus-visible { outline:2px solid rgba(122,162,247,.85); outline-offset:2px; }
.nx-cont-bar .nx-btn:disabled { opacity:.85; cursor:default; transform:none;
    background:#39415a; border-color:#39415a; color:#c6ccd8; box-shadow:none; }
.nx-cont-bar .nx-btn.nx-loading { background:#39415a; border-color:#4a5470; color:#c6ccd8; }
.nx-cont-bar .nx-btn.nx-loading svg { color:#7aa2f7; animation:nx-rot 1s linear infinite; }
.nx-cont-bar.nx-done .nx-btn { background:transparent; border-color:#2a2f3a; color:#8d93a3; box-shadow:none; opacity:1; }
.nx-cont-bar.nx-done .nx-btn svg { color:#8d93a3; }
.nx-cont-note { min-width:0; max-width:340px; padding-right:10px; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; font-size:11.5px; color:#8d93a3; }
.nx-cont-note[hidden] { display:none; }
/* v8.1 — Back & Forward ride the same pill, visually quiet: they
   return to SAVED pages, they never drive the live session. */
.nx-cont-bar .nx-back-btn, .nx-cont-bar .nx-fwd-btn { background:#2b313d; border-color:#3a4150; color:#c2cad8; box-shadow:none; }
.nx-cont-bar .nx-back-btn svg, .nx-cont-bar .nx-fwd-btn svg { color:#c2cad8; }
.nx-cont-bar .nx-back-btn:hover:not(:disabled), .nx-cont-bar .nx-fwd-btn:hover:not(:disabled) { background:#353d4c; border-color:#4a5470;
    transform:translateY(-1px); box-shadow:0 4px 14px rgba(0,0,0,.35); }
.nx-cont-bar .nx-back-btn:disabled, .nx-cont-bar .nx-fwd-btn:disabled { background:#242933; border-color:#242933; color:#6d7484; opacity:1; }
.nx-cont-bar .nx-back-btn[hidden], .nx-cont-bar .nx-fwd-btn[hidden] { display:none; }
.nx-cont-bar.nx-done .nx-back-btn, .nx-cont-bar.nx-done .nx-fwd-btn { display:none; }   /* a finished job has nowhere to go back or forward to */
@media (max-width:760px) {
    .nx-cont-bar { left:12px; right:66px; bottom:12px; transform:translateY(10px); max-width:none; }
    .nx-cont-bar.on { transform:none; }
    .nx-cont-note { display:none !important; }
    .nx-cont-bar .nx-back-btn, .nx-cont-bar .nx-fwd-btn { width:34px; padding:0; }      /* v8.1: icon-only on phones — the pill stays compact */
    .nx-cont-bar .nx-back-btn span, .nx-cont-bar .nx-fwd-btn span { display:none; }
}

.nx-lb { position:fixed; inset:0; z-index:31000; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.nx-lb-bg { position:absolute; inset:0; background:rgba(7,9,13,.88); backdrop-filter:blur(16px) saturate(1.1); }
.nx-lb-bloom { position:absolute; inset:-80px; overflow:hidden; opacity:.5; transition:opacity .4s; pointer-events:none; }
.nx-lb-bloom img { width:100%; height:100%; object-fit:cover;
    filter:blur(64px) saturate(1.6) brightness(.55); transform:scale(1.15); }
.nx-lb-bar { position:absolute; top:0; left:0; right:0; z-index:3; display:flex; align-items:center;
    gap:12px; padding:10px 14px; background:linear-gradient(rgba(10,12,16,.75), rgba(10,12,16,0)); }
.nx-lb-meta { flex:1; min-width:0; display:flex; align-items:baseline; gap:10px;
    font-size:12px; color:#aeb6c6; overflow:hidden; }
.nx-lb-id { font-weight:700; letter-spacing:.5px; color:#e6eaf2; white-space:nowrap; }
.nx-lb-num { color:#7d8494; font-size:11.5px; white-space:nowrap; }
.nx-lb-mx { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-flex; gap:8px; }
.nx-lb-chip { white-space:nowrap; }
.nx-lb-acts { display:flex; gap:6px; }
.nx-lb-ab { position:relative; display:inline-flex; align-items:center; gap:7px; height:30px; padding:0 13px;
    border-radius:9px; border:1px solid rgba(255,255,255,.14); background:rgba(22,26,34,.75);
    color:#e8ecf4; font-size:12.5px; font-weight:600; backdrop-filter:blur(8px); transition:background .15s; }
.nx-lb-ab svg { width:13px; height:13px; }
.nx-lb-ab:hover { background:rgba(34,40,52,.9); }
.nx-lb-ab.nx-ok, .nx-lb-ab.nx-on { color:var(--nx-ok); border-color:rgba(158,206,106,.45); }
.nx-lb-x { width:30px; padding:0; justify-content:center; }
.nx-lb-hd { min-width:112px; justify-content:center; }
.nx-hd-lbl { white-space:nowrap; }
.nx-lb-ab.nx-retry { background:rgba(158,206,106,.14); }
.nx-hd-prog { position:absolute; left:10px; right:10px; bottom:3px; height:2px; border-radius:2px;
    background:rgba(255,255,255,.14); overflow:hidden; opacity:0; transition:opacity .25s; }
.nx-lb-ab.nx-load .nx-hd-prog { opacity:1; }
.nx-hd-prog i { display:block; height:100%; width:0; border-radius:2px;
    background:var(--nx-acc); transition:width .2s; }
.nx-lb-ab.nx-on .nx-hd-prog i { background:var(--nx-ok); }
.nx-hd-prog.nx-indet i { width:30%; animation:nx-hdslide 1.15s ease-in-out infinite; }
@keyframes nx-hdslide { 0% { transform:translateX(-105%); } 100% { transform:translateX(330%); } }
/* v8.1 — the RENDERING phase: the blob has landed and the bitmap is
   decoding; a green shimmer, distinct from the blue download bar, so
   a full bar never reads as stuck. */
.nx-lb-ab.nx-proc .nx-hd-prog i { background:var(--nx-ok); }
.nx-lb-stage { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    padding:64px 70px 46px; touch-action:none; }
.nx-lb-stage.nx-pannable { cursor:grab; }
.nx-lb-stage.nx-grabbing { cursor:grabbing; }
.nx-lb-img { max-width:100%; max-height:100%; object-fit:contain; border-radius:3px;
    box-shadow:0 18px 70px rgba(0,0,0,.55); user-select:none; -webkit-user-drag:none; will-change:transform; }
/* v7.9.1 — the HD layer lives at its TRUE natural pixel size so the decode is never
   clamped to a small box; the transform fits it. max-* must not fight that. */
.nx-lb-img.nx-lb-hdnat { max-width:none; max-height:none; object-fit:fill; }
.nx-lb-img.nx-off { display:none; }
.nx-lb-img.nx-anim { transition:transform .26s cubic-bezier(.22,.8,.3,1); }
.nx-lb-img.nx-lb-ph { filter:blur(14px) brightness(.72) saturate(1.15); transform:scale(1.04); box-shadow:none; }
.nx-lb-img.nx-sw-in { animation:nx-fade .22s ease backwards; }
.nx-lb-img.nx-sw-f  { animation:nx-sw-f .26s cubic-bezier(.25,.7,.3,1) backwards; }
.nx-lb-img.nx-sw-b  { animation:nx-sw-b .26s cubic-bezier(.25,.7,.3,1) backwards; }
.nx-lb-img.nx-hd-in { animation:nx-fade .22s ease backwards; }
.nx-lb-ldr { position:absolute; inset:0; z-index:1; display:flex; align-items:center;
    justify-content:center; pointer-events:none; }
.nx-lb-ring { width:42px; height:42px; border-radius:50%;
    border:3px solid rgba(122,162,247,.22); border-top-color:var(--nx-acc);
    animation:nx-rot .8s linear infinite; }
.nx-zc { position:absolute; right:18px; bottom:34px; z-index:4; display:flex; flex-direction:column;
    align-items:center; gap:5px; opacity:0; pointer-events:none; transition:opacity .2s; }
.nx-zc.on { opacity:1; pointer-events:auto; }
.nx-zc-pct { font-size:10.5px; color:#98a0b0; background:rgba(16,19,26,.72); padding:2px 7px;
    border-radius:6px; backdrop-filter:blur(6px); }
.nx-zc button { width:34px; height:34px; border-radius:9px; border:1px solid rgba(255,255,255,.12);
    background:rgba(18,21,28,.6); color:#e8ecf4; display:flex; align-items:center; justify-content:center;
    backdrop-filter:blur(8px); transition:background .15s, opacity .2s; }
.nx-zc button svg { width:15px; height:15px; }
.nx-zc button:hover { background:rgba(30,35,46,.85); }
.nx-zc button:disabled { opacity:.3; cursor:default; }
.nx-zc-11 { font-size:10.5px; font-weight:700; letter-spacing:.04em; }
.nx-lb-arr { position:absolute; top:50%; transform:translateY(-50%); z-index:4; width:46px; height:46px;
    border-radius:50%; border:1px solid rgba(255,255,255,.12); background:rgba(18,21,28,.6);
    color:#e8ecf4; display:flex; align-items:center; justify-content:center;
    backdrop-filter:blur(8px); transition:background .15s, opacity .2s; }
.nx-lb-arr svg { width:17px; height:17px; }
.nx-lb-arr:hover { background:rgba(30,35,46,.85); }
.nx-lb-arr-p { left:14px; } .nx-lb-arr-n { right:14px; }
.nx-lb-arr.off { opacity:.22; pointer-events:none; }
.nx-lb-hint { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); z-index:3;
    font-size:10.5px; color:#6d7484; letter-spacing:.6px; pointer-events:none; white-space:nowrap; }
.nx-lb-err { max-width:340px; padding:18px 22px; border-radius:10px; background:rgba(24,27,34,.9);
    border:1px solid rgba(247,118,142,.35); color:#f0a7b4; font-size:12.5px; text-align:center; }
.nx-lb-note { position:absolute; bottom:52px; left:50%; transform:translateX(-50%); z-index:3;
    padding:6px 12px; border-radius:8px; background:rgba(24,27,34,.9);
    border:1px solid rgba(247,118,142,.3); color:#f0a7b4; font-size:11.5px; white-space:nowrap; pointer-events:none; }
.nx-lb.nx-lb-out { animation:nx-fade .13s ease reverse both; }
.nx-wob { animation:nx-wob .4s ease; }
@keyframes nx-fade { from{opacity:0;} to{opacity:1;} }
@keyframes nx-sw-f { from{opacity:0;transform:translateX(26px);} to{opacity:1;transform:none;} }
@keyframes nx-sw-b { from{opacity:0;transform:translateX(-26px);} to{opacity:1;transform:none;} }
@keyframes nx-rot  { to{transform:rotate(360deg);} }
@keyframes nx-wob  { 25%{transform:translateX(-3px);} 75%{transform:translateX(3px);} }
@media (max-width:760px) {
    .nx-lb-stage { padding:60px 12px 40px; }
    .nx-lb-arr { width:38px; height:38px; }
    .nx-lb-arr-p { left:6px; } .nx-lb-arr-n { right:6px; }
    .nx-lb-bar { flex-wrap:wrap; }
    .nx-lb-mx { display:none; }
    .nx-zc { right:8px; bottom:36px; }
}
@media (prefers-reduced-motion: reduce) {
    figure.thumb, .nx-tool, #nx-panel .nx-body, .nx-lb-img { transition:none !important; }
    figure.thumb:hover { transform:none; }
    figure.thumb .thumb-info { transition:none !important; }
    .nx-lb-img.nx-sw-in, .nx-lb-img.nx-sw-f, .nx-lb-img.nx-sw-b, .nx-lb-img.nx-hd-in { animation:none !important; }
    .nx-hd-prog.nx-indet i { animation:none !important; width:100%; }
    .nx-cont-bar .nx-btn.nx-loading svg { animation:none !important; }
    .nx-tool.nx-pulse, .nx-lb-ab.nx-pulse, .nx-fav.nx-pulse { animation:none !important; }
    .nx-fav::after, .nx-fav svg { transition:none !important; animation:none !important; }
    .nx-dlm { transition:none !important; }
    .nx-cont-bar { transition:none !important; }
    .nx-dlm-ring .nx-r-fg, .nx-dlm-rring .nx-r-fg { transition:none !important; }
    .nx-dlm-act, .nx-stp { transition:none !important; }
    .nx-dlm.nx-open .nx-dlm-list { animation:none !important; }
    .nx-pg { transition:none !important; }
    .nx-pg.nx-pg-ok { animation:none !important; }
    .nx-pb { transition:none !important; }
    .nx-pb.nx-pb-ok { animation:none !important; }
}
#nx-fav-notice{position:fixed;right:22px;bottom:22px;z-index:2147483647;max-width:360px;padding:12px 16px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(18,22,30,.97);box-shadow:0 12px 34px rgba(0,0,0,.42);color:#eef3fb;font:600 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .18s,transform .18s}#nx-fav-notice.show{opacity:1;transform:none}#nx-fav-notice[data-kind="ok"]{border-color:rgba(125,220,160,.5)}#nx-fav-notice[data-kind="error"]{border-color:rgba(244,120,140,.6)}
/* ─── Collection picker (rendered inside wallhaven's #overlay) ───
   The close button fixes apply to EVERY .overlay-close on the page:
   wallhaven's own CSS omits cursor:pointer there and its :hover
   rule (".overlay-close :hover") targets the icon's children, so
   closers looked and behaved like selectable text. */
#overlay .overlay-close{display:flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;top:7px;right:7px;border-radius:9px;background:rgba(255,255,255,.05);color:#98a0b0;cursor:pointer !important;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:color .15s,background .15s,transform .12s;z-index:30}
#overlay .overlay-close:hover{color:#f2f5fa;background:rgba(247,118,142,.18)}
#overlay .overlay-close:active{transform:scale(.92)}
#overlay .overlay-close:focus-visible{outline:2px solid rgba(122,162,247,.85);outline-offset:1px}
#overlay .overlay-close svg{width:15px;height:15px;display:block;pointer-events:none}
#overlay .overlay-close i{font-size:15px;line-height:1;pointer-events:none}
.nx-picker{width:400px;max-width:calc(100vw - 90px);padding:2px 2px 14px;color:#eef3fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-user-select:none;user-select:none}
.nx-picker-top{display:flex;align-items:center;gap:12px;padding:2px 4px 13px}
.nx-picker-thumb{width:66px;height:42px;object-fit:cover;border-radius:6px;background:#101216;flex:none}
.nx-picker-tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.nx-picker-tt strong{font-size:13.5px;font-weight:700;letter-spacing:.2px;color:#f2f5fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nx-picker-tt strong i{font-style:normal;color:#7d8798;font-weight:600;margin-left:6px;font-size:11px}
.nx-picker-tt span{font-size:11.5px;color:#9aa5b5;line-height:1.45}
.nx-picker-list{display:flex;flex-direction:column;gap:7px}
.nx-picker-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.045);cursor:pointer;transition:background .15s,border-color .15s,transform .12s}
.nx-picker-row:hover{border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.07)}
.nx-picker-row:active{transform:scale(.99)}
.nx-picker-row:focus-visible{outline:2px solid rgba(122,162,247,.85);outline-offset:1px}
.nx-picker-row.active{border-color:rgba(114,201,218,.55);background:rgba(55,144,166,.15)}
.nx-picker-row.active:hover{background:rgba(55,144,166,.22)}
.nx-picker-row.busy{opacity:.55;pointer-events:none}
.nx-picker-row.current{border-color:rgba(151,208,137,.5);background:rgba(122,180,120,.07)}
.nx-picker-row.current:hover{background:rgba(122,180,120,.12)}
.nx-picker-row.current .nx-picker-name{color:#d9ecd6}
.nx-picker-saved{flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;background:rgba(122,180,120,.17);color:#a9d8a2;font-size:10px;font-weight:700;letter-spacing:.4px;cursor:default}
.nx-picker-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:#e8edf6}
.nx-picker-row.active .nx-picker-name{color:#dff3f7}
.nx-picker-qs{flex:none;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#8f9aa9;font-size:10.5px;font-weight:700;letter-spacing:.4px;cursor:pointer;transition:color .15s,border-color .15s,background .15s,transform .12s}
.nx-picker-qs svg{width:11px;height:11px;display:block;pointer-events:none;transition:fill .15s}
.nx-picker-qs:hover{color:#d5dde8;border-color:rgba(255,255,255,.32);background:rgba(255,255,255,.09)}
.nx-picker-qs:active{transform:scale(.95)}
.nx-picker-qs:focus-visible{outline:2px solid rgba(122,162,247,.85);outline-offset:1px}
.nx-picker-row.active .nx-picker-qs{color:#8fdcec;border-color:rgba(114,201,218,.6);background:rgba(55,144,166,.24)}
.nx-picker-row.active .nx-picker-qs:hover{color:#bfeff8;background:rgba(55,144,166,.34)}
.nx-picker-row.active .nx-picker-qs svg{fill:currentColor}
.nx-picker-qs .nx-spin{width:10px;height:10px;border-width:2px;flex:none}
.nx-picker-foot{margin-top:13px;padding-top:11px;border-top:1px solid rgba(255,255,255,.08);color:#8b96a6;font-size:11px;line-height:1.55}
.nx-picker-foot b{color:#8fdcec;font-weight:700}
.nx-picker-loading{display:flex;align-items:center;gap:11px;padding:24px 4px;color:#9aa5b5;font-size:12.5px}
.nx-picker-error{padding:6px 4px 2px}
.nx-picker-error p{margin:0 0 12px;color:#f0a7b5;font-size:12.5px;line-height:1.5}
.nx-picker-retry{display:inline-flex;align-items:center;height:30px;padding:0 14px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#e8edf6;font-size:12px;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s}
.nx-picker-retry:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.3)}
.nx-picker-retry:focus-visible{outline:2px solid rgba(122,162,247,.85);outline-offset:1px}

/* ─── v7.8.1 — floating page pill (one tap = the whole page) ──── */
.nx-pg { position:fixed; left:16px; bottom:16px; z-index:30400; display:inline-flex; align-items:center; gap:7px;
    height:36px; padding:0 15px 0 13px; border:1px solid #2a2f3a; border-radius:99px;
    background:rgba(25,28,35,.92); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
    box-shadow:0 10px 28px rgba(0,0,0,.45); color:#e8ecf4; cursor:pointer;
    font:600 12px/1 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    opacity:0; transform:translateY(10px); pointer-events:none;
    transition:opacity .18s, transform .18s, background .15s, border-color .15s; }
.nx-pg.on { opacity:1; transform:none; pointer-events:auto; }
.nx-pg:hover { background:rgba(34,38,48,.96); border-color:#3a4152; }
.nx-pg:active { transform:translateY(1px); }
.nx-pg:focus-visible { outline:2px solid rgba(122,162,247,.85); outline-offset:2px; }
.nx-pg-i { display:flex; flex:none; color:#7aa2f7; }
.nx-pg-i svg { width:14px; height:14px; }
.nx-pg-n { letter-spacing:.2px; }
.nx-pg-t { font-size:11px; font-weight:500; color:#8d93a3; white-space:nowrap; }
.nx-pg-t:empty { display:none; }
.nx-pg.nx-pg-ok { animation:nx-pg-ok .8s ease; }
@keyframes nx-pg-ok { 0% { background:#7aa2f7; border-color:#7aa2f7; } }
@media (max-width:760px) { .nx-pg { left:12px; bottom:62px; height:32px; padding:0 13px 0 11px; } }

/* ─── v7.9.0 page bars — a download chip beside every page number ─── */
.nx-pb { order:15; -ms-flex-order:15; display:inline-flex; align-items:center; gap:6px; height:28px;
    margin:0 0 .45em 14px; padding:0 12px 0 10px; box-sizing:border-box; border:1px solid #2a2f3a; border-radius:99px;
    background:rgba(25,28,35,.92); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    color:#e8ecf4; cursor:pointer; vertical-align:middle;
    font:600 12px/1 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    transition:background .15s, border-color .15s, transform .12s; }
.nx-pb:hover { background:rgba(34,38,48,.96); border-color:#3a4152; }
.nx-pb:active { transform:translateY(1px); }
.nx-pb:focus-visible { outline:2px solid rgba(122,162,247,.85); outline-offset:2px; }
.nx-pb-i { display:flex; flex:none; color:#7aa2f7; }
.nx-pb-i svg { width:12px; height:12px; }
.nx-pb-n { letter-spacing:.2px; }
.nx-pb.nx-pb-ok { animation:nx-pg-ok .8s ease; }
section.thumb-listing-page.nx-scanmode > header.thumb-listing-page-header:not(.nx-ownbar) { display:none !important; }
header.nx-ownbar[hidden] { display:none !important; }
@media (max-width:760px) { .nx-pb { height:26px; margin-left:10px; padding:0 10px 0 9px; } }
`;

    const addCss = css => {
        if (typeof GM_addStyle === 'function') GM_addStyle(css);
        else { const s = mk('style'); s.type = 'text/css'; s.textContent = css; document.head.appendChild(s); }
    };

    /* ═══ INIT — guarded per-step bootstrap: failures print the exact failing step and never silence the rest. */

    const step = (name, fn) => { try { fn(); } catch (e) { console.error('[naXim Labs] init failed at: ' + name, e); } };
    step('styles',   () => { addCss(CSS); });
    step('hyperPill',() => { if (hyperPill && document.body) document.body.appendChild(hyperPill); });
    step('panel',   buildPanel);
    step('favoriteButtons', upgradeVisibleFavoriteButtons);
    step('favoriteBindings', bindAllFavAnchors);
    step('pageSync',() => pageSync());
    /* No favorite network I/O at boot: server .faved markers already
     * render native cards, and the cached index is validated lazily
     * (first scan card, picker open, or a removal that needs it). */
    step('favIndex', () => { if (FavState.hasCache()) FavState.ensureIndexSoon(5000); });
    step('dlQueue',  () => { DL.boot(); });
    step('pageBars', () => PageBar.boot());
    step('pagePill', () => PagePill.boot());
    step('status',   () => setStatus('Ready · hover a card, then click the eye for an instant preview'));
    console.info('[naXim Labs] initialized');
})();
