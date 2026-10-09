// ==UserScript==
// @name         naXim Labs — Wallhaven Enhancer
// @namespace    https://github.com/0naXim0
// @author       naXim Labs (0naXim0)
// @homepageURL  https://github.com/0naXim0
// @downloadURL  https://cdn.jsdelivr.net/gh/0naXim0/wallhaven-enhancer@main/wallhaven-enhancer.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/0naXim0/wallhaven-enhancer@main/wallhaven-enhancer.user.js
// @supportURL   https://github.com/0naXim0
// @version      7.5.1
// @description  Byte-accurate downloads, instant previews, persistent HD Mode, smooth zoom & pan, unified cards, adaptive scanning, a server-verified favorite/collection system with true add/remove semantics, a per-collection Quick-Save target and a hold-to-open collection picker, and a crash-proof persistent download queue with cross-tab sync, retry, tunable parallelism, pause/resume and speed/ETA telemetry. A naXim Labs product.
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
    console.info('[naXim Labs] v7.5.1 executing');

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

    function apiRaw (url) {
        return new Promise((res) => {
            GM_xmlhttpRequest({
                method: 'GET', url,
                headers: { Accept: 'application/json', Referer: 'https://wallhaven.cc/' },
                timeout: 20000,
                onload (r) {
                    if (r.status >= 400) { res({ _httpError: r.status }); return; }
                    try { res(JSON.parse(r.responseText)); } catch { res({ _httpError: 0 }); }
                },
                onerror  : () => res({ _httpError: -1 }),
                ontimeout: () => res({ _httpError: -2 }),
            });
        });
    }
    function apiSearch (params) {
        const p = { ...params };
        const key = get('apiKey');
        if (key && !p.apikey) p.apikey = key;
        return apiRaw('https://wallhaven.cc/api/v1/search?' + new URLSearchParams(p));
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
    function scrapeWallPage (id) {
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
            let d = null;
            const key = get('apiKey');
            if (key) {
                const r = await apiRaw('https://wallhaven.cc/api/v1/w/' + id + '?apikey=' + encodeURIComponent(key));
                if (!r._httpError && r.data && r.data.path) d = r.data;
            }
            if (!d) {
                const r = await apiRaw('https://wallhaven.cc/api/v1/w/' + id);
                if (!r._httpError && r.data && r.data.path) d = r.data;
            }
            if (!d) {
                const s = await scrapeWallPage(id);
                if (s) d = { path: s.path, file_type: s.ext, resolution: '', tags: s.tags, created_at: s.created, thumbs: null };
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
        function settleResolve (job, url) { running.delete(job.key); job.resolve(url); pump(); }
        function settleReject  (job, err) { running.delete(job.key); job.reject(err);  pump(); }

        function startJob (job) {
            job.req = GM_xmlhttpRequest({
                method: 'GET', url: job.url, responseType: 'blob',
                headers: { Referer: 'https://wallhaven.cc/' },
                timeout: 45000,
                onprogress (r) { if (!job.aborted && job.onprogress) job.onprogress(r.loaded || 0, r.total || 0); },
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
        const r = await fetch(url, { credentials: 'same-origin',
            headers: { Accept: 'text/html,application/xhtml+xml' },
            signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined });
        if (!r.ok) throw new Error('Wallhaven could not load the account collection page');
        return r.text();
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
    function applyZoom (anim) {
        const R = _lbR; if (!R) return;
        const t = 'translate3d(' + R.tx.toFixed(2) + 'px,' + R.ty.toFixed(2) + 'px,0) scale(' + R.zoom.toFixed(4) + ')';
        for (const im of [R.pvEl, R.hdEl]) {
            if (!im) continue;
            im.classList.toggle('nx-anim', !!anim);
            im.style.transform = t;
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
            const primary = R.pvEl || R.hdEl;
            if (primary) sizeImg(primary, R.baseNat.w, R.baseNat.h, true);
            for (const im of [R.thumbEl, R.pvEl, R.hdEl]) {
                if (im && im !== primary) sizeImg(im, R.baseNat.w, R.baseNat.h, false);
            }
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
    function addChip (txt) {
        const s = mk('span', 'nx-lb-chip'); s.textContent = txt;
        _lbR.metaX.appendChild(s);
    }
    function applyMeta (m) {
        const R = _lbR; if (!R) return;
        if (m.tags && m.tags.length) addChip(m.tags.slice(0, 6).join(' · '));
        if (m.created) addChip(fmtDate(m.created));
        R.data = { path: m.path, ext: m.ext, tags: m.tags || [] };
        if (m.resolution && !R.hasRes) { R.hasRes = true; addChip(m.resolution); }
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
        R.hdBtn.classList.toggle('nx-retry', st === 'retry');
        R.hdIco.innerHTML = st === 'ok' ? IC.ok : st === 'retry' ? IC.sync : IC.hd;
        R.hdLbl.textContent = st === 'retry' ? 'Retry HD' : 'HD Mode';
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
                        if (tok === _lbTok && gen === R.hdGen && R.hdOn && t > 0) hdSetProg(R, l / t);
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

        const img = new Image();
        img.className = 'nx-lb-img nx-off';
        img.decoding = 'async'; img.draggable = false; img.alt = 'wallpaper ' + id;
        img.src = url;
        try { if (img.decode) await img.decode(); } catch {}
        if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
        if (!img.naturalWidth) { hdFail(R, gen, tok, null); return; }

        if (R.baseW) { img.style.width = R.baseW + 'px'; img.style.height = R.baseH + 'px'; }
        else sizeImg(img, img.naturalWidth, img.naturalHeight, true);
        R.hdEl = img;
        if (usedPath) R.hdPath = usedPath;
        R.stage.appendChild(img);
        hdApply(R);
    }

    function hdFail (R, gen, tok, err) {
        if (tok !== _lbTok || gen !== R.hdGen || !R.hdOn) return;
        if (err && err.aborted) return;
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

    function hdApply (R) {
        if (!R.hdEl) return;
        R.hdOn = true;
        R.hdState = 'ok';
        clearTimeout(R.hdRetryT); R.hdRetryT = 0;
        if (R.thumbEl) { R.thumbEl.remove(); R.thumbEl = null; }
        if (!R.hdEl.style.width) {
            if (R.baseW) { R.hdEl.style.width = R.baseW + 'px'; R.hdEl.style.height = R.baseH + 'px'; }
            else sizeImg(R.hdEl, R.hdEl.naturalWidth, R.hdEl.naturalHeight, true);
        }
        if (R.pvEl) R.pvEl.classList.add('nx-off');
        R.hdEl.classList.remove('nx-off');
        R.hdEl.classList.remove('nx-hd-in');
        void R.hdEl.offsetWidth;
        R.hdEl.classList.add('nx-hd-in');
        hdBtnSync(R);
        ImagePool.pin(_lbId);
        if (R.pinnedId && R.pinnedId !== _lbId) ImagePool.unpin(R.pinnedId);
        R.pinnedId = _lbId;
        if (!R.hasRes) { R.hasRes = true; addChip(R.hdEl.naturalWidth + '×' + R.hdEl.naturalHeight); }
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
        R.hasRes = false; R.data = null; R.hdPath = '';
        R.dlBusy = false;
        R.hdOn = !!get('hdMode');
        R.hdGen++;
        R.hdTries = 0;
        R.hdState = 'idle';
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

        const meta0 = _meta.get(id) || null;
        const metaP = fetchWallData(id).catch(() => null);
        if (meta0) applyMeta(meta0);
        else metaP.then(m => { if (m && my === _lbTok) applyMeta(m); });

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
            const mres = (meta0 || {}).resolution;
            if (mres && !R.hasRes) { R.hasRes = true; addChip(mres); }
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
        zin.addEventListener('click',  e => { e.stopPropagation(); zoomStep(1.45); });
        zfit.addEventListener('click', e => { e.stopPropagation(); setZoom(1, null, true); });
        zout.addEventListener('click', e => { e.stopPropagation(); zoomStep(1 / 1.45); });
        zc.append(zpct, zin, zfit, zout);

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
            pinnedId: null, data: null, hasRes: false, dlBusy: false, bloomSrc: '',
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

    /* ═══ SEARCH HISTORY ══════════════════════════════════════════ */

    const HISTORY_INDEX = 'gf_hist_index';
    const BATCH_PREFIX = 'gf_batch_';
    const BUF_PREFIX   = 'gf_buf_';
    const historyLoad = () => { try { return JSON.parse(GM_getValue(HISTORY_INDEX, '[]')); } catch { return []; } };
    const historySave = idx => GM_setValue(HISTORY_INDEX, JSON.stringify(idx));
    const batchLoad = id => { try { return JSON.parse(GM_getValue(BATCH_PREFIX + id, '[]')); } catch { return []; } };
    const bufLoad   = id => { try { return JSON.parse(GM_getValue(BUF_PREFIX + id, '[]')); } catch { return []; } };
    function wipeSessionData (id) {
        try { GM_deleteValue(BATCH_PREFIX + id); } catch {}
        try { GM_deleteValue(BUF_PREFIX + id); } catch {}
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

    function sessionSave (sess) {
        const P = sess.params;
        try { GM_setValue(BATCH_PREFIX + sess.id, JSON.stringify(sess.batchItems.map(slimWall))); } catch {}
        if (sess.mode === 'buffer' && sess.scanned) {
            const unserved = sess.matches.slice(sess.rank, sess.rank + 600);
            if (unserved.length) { try { GM_setValue(BUF_PREFIX + sess.id, JSON.stringify(unserved.map(slimWall))); } catch {} }
            else { try { GM_deleteValue(BUF_PREFIX + sess.id); } catch {} }
        }
        const label = P.dateFrom + ' → ' + P.dateTo + ' · ♥' + P.minFavs + (P.maxFavsOn ? '–' + P.maxFavs : '+') +
                      ' · ' + (P.sortMode === 'date_added' ? 'new' : 'favs') +
                      (sess.exhausted ? ' · complete' : ' · next #' + sess.batchNum);
        const state = sess.mode === 'buffer'
            ? { mode: 'buffer', winTop: sess.winTop, winBot: sess.winBot, rank: sess.rank,
                batchNum: sess.batchNum, totalFound: sess.rank, exhausted: sess.exhausted }
            : { mode: 'walk', page: sess.page, itemIdx: sess.itemIdx, lastPage: sess.lastPage,
                skippedAbove: sess.skippedAbove, batchNum: sess.batchNum, batchFound: sess.batchFound,
                totalFound: sess.totalFound, consecMisses: sess.consecMisses, exhausted: sess.exhausted };
        const entry = {
            id: sess.id, ts: Date.now(), count: sess.mode === 'buffer' ? sess.rank : sess.totalFound, label: label,
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

    function buildParams (c) {
        const baseParams = { categories: c.categories, purity: c.purity, sorting: c.sortMode };
        if (c.query)   baseParams.q = c.query;
        if (c.atleast) baseParams.atleast = c.atleast;
        if (c.ratios)  baseParams.ratios = c.ratios;
        return { baseParams: baseParams, query: c.query, categories: c.categories, purity: c.purity, atleast: c.atleast, ratios: c.ratios,
                 sortMode: c.sortMode, dateFrom: c.dateFrom, dateTo: c.dateTo,
                 minFavs: c.minFavs, maxFavs: c.maxFavs, maxFavsOn: c.maxFavsOn, batchSize: c.batchSize };
    }

    function restoreSearchSettings (c) {
        const i = UI.inputs;
        i.q.value = c.query || ''; i.sort.value = c.sortMode;
        i.dfrom.value = c.dateFrom; i.dto.value = c.dateTo;
        i.minf.value = c.minFavs; i.maxf.value = c.maxFavs || 0;
        i.res.value = c.atleast || ''; i.rat.value = c.ratios || '';
        setChips(UI.chips.cat, c.categories || '111');
        setChips(UI.chips.pur, c.purity || '100');
        UI.maxon.classList.toggle('on', !!c.maxFavsOn);
        UI.maxon.setAttribute('aria-pressed', !!c.maxFavsOn);
        set('query', c.query || ''); set('sortMode', c.sortMode);
        set('dateFrom', c.dateFrom); set('dateTo', c.dateTo);
        set('minFavs', c.minFavs); set('maxFavs', c.maxFavs || 0); set('maxFavsOn', !!c.maxFavsOn);
        set('atleast', c.atleast || ''); set('ratios', c.ratios || '');
        set('categories', c.categories || '111'); set('purity', c.purity || '100');
        refreshMaxFavUI(); markFavRange(); validateDates();
    }

    function loadHistoryEntry (entry) {
        const data = batchLoad(entry.id);
        renderBatch(data);
        if (entry.params && entry.state) {
            restoreSearchSettings(entry.params);
            const st = entry.state;
            if (st.mode === 'buffer') {
                const buf = bufLoad(entry.id);
                _session = { id: entry.id, params: buildParams(entry.params), mode: 'buffer',
                             winTop: st.winTop || 1, winBot: st.winBot || 1, scanPage: st.winTop || 1,
                             matches: buf, collectedIds: new Set(), scanned: buf.length > 0,
                             rank: buf.length ? 0 : (st.rank || 0),
                             batchNum: st.batchNum || 1, batchFound: 0,
                             totalFound: st.totalFound || st.rank || data.length, consecMisses: 0, skippedAbove: 0,
                             page: 1, itemIdx: 0, lastPage: 1, winBotSaved: 0, favFloorDone: false,
                             exhausted: !!st.exhausted, batchItems: data };
            } else {
                _session = { id: entry.id, params: buildParams(entry.params), mode: 'walk',
                             page: st.page, itemIdx: st.itemIdx, lastPage: st.lastPage || 1,
                             skippedAbove: st.skippedAbove || 0, winBot: 0, favFloorDone: true,
                             batchNum: st.batchNum || 1, batchFound: st.batchFound || 0,
                             totalFound: st.totalFound || data.length, consecMisses: st.consecMisses || 0,
                             exhausted: !!st.exhausted, batchItems: data,
                             winTop: 1, scanPage: 1, matches: [], collectedIds: new Set(), rank: 0, scanned: false };
            }
            _seenIds = new Set();
            for (const f of document.querySelectorAll('figure.thumb[data-wallpaper-id]')) {
                const id = f.getAttribute('data-wallpaper-id'); if (id) _seenIds.add(id);
            }
            setCount(_session.totalFound || data.length);
            if (_session.exhausted) {
                setContBar('done', 'No more results', (_session.totalFound || 0).toLocaleString() + ' collected');
            } else if (_session.mode === 'buffer') {
                setContBar('go', _session.scanned
                    ? 'Continue — next ' + entry.params.batchSize + ' (instant)'
                    : 'Continue — collect window',
                    'resumes at page ' + _session.scanPage);
            } else {
                const left = Math.max(0, entry.params.batchSize - _session.batchFound);
                setContBar('go', _session.batchFound
                    ? 'Continue — finish batch ' + _session.batchNum + ' (' + left + ' left)'
                    : 'Continue — batch ' + _session.batchNum,
                    'resumes at page ' + _session.page);
            }
            setStatus('History restored · Continue resumes the scan — or change filters and press Search for a fresh one');
        } else {
            _session = null;
            setContBar('none', '', '');
            setStatus('✓ Loaded batch: ' + entry.label);
        }
        refreshHistoryPanel();
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
            const row = mk('div', 'nx-hist-row');
            const l = mk('span', 'nx-hist-label'); l.textContent = entry.label; l.title = entry.label;
            const c = mk('span', 'nx-hist-count'); c.textContent = entry.count + ' collected';
            const bl = mk('button', 'nx-btn nx-btn-dim'); bl.type = 'button'; bl.textContent = 'Load';
            const bd = mk('button', 'nx-btn nx-btn-dim nx-hist-x'); bd.type = 'button'; bd.innerHTML = IC.x; bd.title = 'Delete';
            bl.addEventListener('click', () => loadHistoryEntry(entry));
            bd.addEventListener('click', () => { batchDelete(entry.id); if (_session && _session.id === entry.id) _session = null; refreshHistoryPanel(); });
            row.append(l, c, bl, bd);
            host.appendChild(row);
        }
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

    /* ═══ SCAN ENGINE ════════════════════════════════════════════ */

    const MAX_CONSEC_MISS = 50;
    const MAX_SAFE_PAGE = 4000;
    const SCAN_RETRIES = 3;
    const BUFFER_MAX_PAGES = 2500;
    const WALK_EST_MAX = 600;

    let _running = false, _stop = false;
    let _seenIds = new Set();
    let _session = null;

    async function scanFetch (P, page) {
        let attempt = 0;
        for (;;) {
            if (_stop) return { stopped: true };
            const resp = await apiSearch({ ...P.baseParams, page: page });
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
            const transient = (code === 429 || code >= 500 || code === -1 || code === -2 || code === 0);
            if (transient && attempt < SCAN_RETRIES) {
                attempt++;
                setStatus('⚠ API hiccup (' + code + ') · retry ' + attempt + '/' + SCAN_RETRIES + '…');
                await sleep(900 * attempt);
                continue;
            }
            return { fatal: true, msg: code >= 500 ? '✕ Wallhaven server limit — state saved, Continue retries.' : '✕ API error ' + code };
        }
    }

    async function findDateStartPage (P, targetDate, lastPage) {
        let lo = 1, hi = Math.min(lastPage + 1, MAX_SAFE_PAGE + 1), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ' + targetDate + ' · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = (mid > lastPage) ? { done: true } : await scanFetch(P, mid);
            if (r.fatal) return -1;
            if (r.done || r.stopped || !r.data.length) { hi = mid; continue; }
            if ((r.data[0].created_at || '').slice(0, 10) > targetDate) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
    async function findDateEndPage (P, targetDate, lastPage) {
        let lo = 1, hi = Math.min(lastPage + 1, MAX_SAFE_PAGE + 1), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ' + targetDate + ' floor · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = (mid > lastPage) ? { done: true } : await scanFetch(P, mid);
            if (r.fatal) return -1;
            if (r.done || r.stopped || !r.data.length) { hi = mid; continue; }
            if ((r.data[0].created_at || '').slice(0, 10) < targetDate) hi = mid; else lo = mid + 1;
        }
        return lo;
    }
    async function findFavsFloorPage (P, minFavs, lastPage) {
        let lo = 1, hi = Math.min(lastPage + 1, MAX_SAFE_PAGE + 1), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ♥' + minFavs.toLocaleString() + ' floor · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = (mid > lastPage) ? { done: true } : await scanFetch(P, mid);
            if (r.fatal) return -1;
            if (r.done || r.stopped || !r.data.length) { hi = mid; continue; }
            if (r.data[0].favorites >= minFavs) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
    async function findFavsStartPage (P, maxFavs, lastPage) {
        let lo = 1, hi = Math.min(lastPage, MAX_SAFE_PAGE), calls = 0;
        while (lo < hi) {
            const mid = (lo + hi) >> 1; calls++;
            setStatus('Locating ♥' + maxFavs.toLocaleString() + ' · probe ' + calls + ' (page ' + mid + ')');
            await sleep(80);
            const r = await scanFetch(P, mid);
            if (r.fatal) return -1;
            if (r.done || r.stopped || !r.data.length) { hi = mid; continue; }
            if (r.data[0].favorites > maxFavs) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    async function sampleDensity (P, region) {
        let hits = 0, pages = 0;
        for (const frac of [0.5, 0.8]) {
            const pg = Math.max(1, Math.min(Math.round(region * frac), MAX_SAFE_PAGE));
            const r = await scanFetch(P, pg);
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
        setStatus(msg, true);
        setContBar('go', 'Continue — retry scan', '');
    }

    function emptyWindow (sess) {
        _running = false; setRunningUI(false);
        sess.exhausted = true;
        const ul = getUL();
        if (ul) {
            const li = mk('li', 'nx-empty');
            li.innerHTML = '<strong>No uploads in this date range.</strong><br>The date boundaries were checked directly — nothing exists between ' + sess.params.dateFrom + ' and ' + sess.params.dateTo + '.';
            ul.appendChild(li);
        }
        setContBar('done', 'No more results', 'empty range · no scanning needed');
        setStatus('✓ Empty range — verified via date boundaries in a couple dozen requests');
    }
    function maxFavsEmpty (sess) {
        _running = false; setRunningUI(false);
        sess.exhausted = true;
        setStatus('⚠ Max ♥ starts below the favorites floor — no results. Raise Max ♥ or lower Min ♥.');
        setContBar('done', 'No more results', '');
    }

    async function prepareFavsWalk (sess) {
        const P = sess.params;
        if (P.minFavs > 0 && !sess.favFloorDone) {
            const floor = await findFavsFloorPage(P, P.minFavs, sess.lastPage);
            if (floor === -1) return 'abort';
            sess.lastPage = Math.min(sess.lastPage, floor);
            sess.favFloorDone = true;
        }
        sess.page = 1;
        if (P.maxFavsOn && P.maxFavs > 0) {
            const pg = await findFavsStartPage(P, P.maxFavs, sess.lastPage);
            if (pg === -1) return 'abort';
            sess.page = pg;
            if (sess.page > sess.lastPage) return 'empty';
        }
        return 'ok';
    }

    function setContBar (mode, label, note) {
        let bar = document.getElementById('nx-cont-bar');
        if (mode === 'none') { if (bar) bar.remove(); return; }
        if (!bar) {
            bar = mk('div', 'nx-cont-bar'); bar.id = 'nx-cont-bar';
            const b = mk('button', 'nx-btn'); b.type = 'button';
            b.addEventListener('click', () => { if (!_running) continueSearch(); });
            bar.append(b, mk('span', 'nx-cont-note'));
            const sec = getSection();
            if (!sec) return;
            sec.parentNode.insertBefore(bar, sec.nextSibling);
        }
        const btn = bar.querySelector('.nx-btn');
        const noteEl = bar.querySelector('.nx-cont-note');
        bar.classList.toggle('nx-done', mode === 'done');
        btn.classList.toggle('nx-loading', mode === 'load');
        btn.disabled = mode !== 'go';
        btn.innerHTML = (mode === 'load' ? IC.sync : mode === 'done' ? IC.ok : IC.play) +
                        '<span>' + (label || (mode === 'done' ? 'No more results' : 'Continue')) + '</span>';
        noteEl.textContent = note || '';
    }

    async function bufferCore (sess) {
        _running = true; _stop = false;
        setRunningUI(true);
        const ul = getUL();
        if (!ul) { setStatus('✕ Grid not found.', true); _running = false; setRunningUI(false); return; }
        const P = sess.params;
        const SW = { ...P, baseParams: { ...P.baseParams, sorting: 'date_added' } };

        if (!sess.scanned) {
            while (!_stop && sess.scanPage < sess.winBot) {
                const page = sess.scanPage;
                setStatus('Collecting ' + P.dateFrom + ' → ' + P.dateTo + ' in upload order' +
                          (sess.rank ? ' · ' + sess.rank + ' already served' : '') +
                          ' · page ' + page + '/' + (sess.winBot - 1) + ' · ' + sess.matches.length + ' matches');
                setContBar('load', 'Collecting window · page ' + page + '/' + (sess.winBot - 1),
                           sess.matches.length + ' matches · one-time scan');
                setProgress(Math.min(99, Math.round(((page - sess.winTop) / Math.max(1, sess.winBot - sess.winTop)) * 100)));
                const r = await scanFetch(SW, page);
                if (r.stopped) break;
                if (r.fatal) {
                    _running = false; setRunningUI(false);
                    sessionSave(sess);
                    setStatus(r.msg, true);
                    setContBar('go', 'Continue — retry collection', 'state preserved · page ' + sess.scanPage);
                    return;
                }
                if (r.done) { sess.winBot = page; break; }
                for (const w of r.data) {
                    const d = (w.created_at || '').slice(0, 10);
                    if (d < P.dateFrom || d > P.dateTo) continue;
                    if (w.favorites < P.minFavs) continue;
                    if (P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs) continue;
                    if (sess.collectedIds.has(w.id)) continue;
                    sess.collectedIds.add(w.id);
                    sess.matches.push(w);
                }
                sess.scanPage = page + 1;
                await sleep(300);
            }
            if (_stop) {
                _running = false; setRunningUI(false);
                sessionSave(sess);
                setStatus('Paused · page ' + sess.scanPage + '/' + (sess.winBot - 1) + ' · ' + sess.matches.length + ' matches collected');
                setContBar('go', 'Continue — finish collection', 'resumes at page ' + sess.scanPage);
                return;
            }
            sess.scanned = true;
            sess.matches.sort((a, b) => (b.favorites - a.favorites) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            setStatus('Ranking ' + sess.matches.length + ' matches by favorites…');
        }

        sess.batchItems = [];
        const serve = [];
        let i = sess.rank;
        while (i < sess.matches.length && serve.length < P.batchSize) {
            const w = sess.matches[i++];
            if (_seenIds.has(w.id)) continue;
            serve.push(w);
        }
        sess.rank = i;
        const frag = document.createDocumentFragment();
        for (const w of serve) { _seenIds.add(w.id); frag.appendChild(mkCard(w)); sess.batchItems.push(w); }
        if (frag.childNodes.length) ul.appendChild(frag);
        const left = Math.max(0, sess.matches.length - sess.rank);
        sess.totalFound = sess.rank;
        sess.batchNum++;
        sess.exhausted = left <= 0;
        setCount(sess.rank);
        setProgress(100); setTimeout(() => setProgress(0), 900);
        _running = false; setRunningUI(false);
        sessionSave(sess);
        if (sess.exhausted) {
            setContBar('done', 'No more results', sess.matches.length + ' matches in window');
            setStatus('✓ Complete — ' + sess.matches.length + ' matching wallpapers in ' + P.dateFrom + ' → ' + P.dateTo + (sess.rank ? ' · all served' : ''));
            if (sess.rank === 0) {
                const li = mk('li', 'nx-empty');
                li.innerHTML = '<strong>No wallpapers matched.</strong><br>The date window contains no uploads that pass the favorites filter.';
                ul.appendChild(li);
            }
        } else {
            setContBar('go', 'Continue — next ' + P.batchSize + ' (batch ' + sess.batchNum + ')',
                       'instant · ' + left + ' matches left');
            setStatus('✓ Batch ' + (sess.batchNum - 1) + ' · ' + serve.length + ' served · ' + left + ' left · Continue is instant');
        }
    }

    async function coreScan (sess, preloaded) {
        if (!sess || sess.exhausted) return;
        if (sess.mode === 'buffer') { await bufferCore(sess); return; }

        _running = true; _stop = false;
        setRunningUI(true);
        setProgress(0);
        const ul = getUL();
        if (!ul) { setStatus('✕ Grid not found.', true); _running = false; setRunningUI(false); return; }

        const P = sess.params;
        let page = sess.page, itemIdx = sess.itemIdx, lastPage = sess.lastPage || 1;
        let skippedAbove = sess.skippedAbove || 0;
        let batchNum = sess.batchNum, batchFound = sess.batchFound || 0, totalFound = sess.totalFound || 0;
        let consecMisses = sess.consecMisses || 0;
        let exhausted = false, stopped = false, fatal = null, checkpoint = false;
        const firstPage = page, firstIdx = itemIdx;
        sess.batchItems = sess.batchItems || [];

        try {
            outer:
            while (!_stop && batchFound < P.batchSize) {
                const pDen = sess.winBot ? (sess.winBot - 1) : lastPage;
                const prog = 'Batch ' + batchNum + ' · ' + batchFound + '/' + P.batchSize;
                setContBar('load', prog, '');
                setStatus(prog + ' · page ' + page + (pDen > 1 ? '/' + pDen : '') +
                          (skippedAbove > 0 && P.maxFavsOn ? ' · ' + skippedAbove.toLocaleString() + ' skipped' : ''));
                setProgress(Math.min(95, Math.round((batchFound / P.batchSize) * 100)));

                let items = null, meta = null;
                if (preloaded && page === 1) { items = preloaded.data; meta = preloaded.meta; preloaded = null; }
                else {
                    const r = await scanFetch(P, page);
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
                    if (batchFound >= P.batchSize) { stopIdx = i; break; }
                    const d = (w.created_at || '').slice(0, 10);
                    if (P.sortMode === 'date_added') {
                        if (d < P.dateFrom) { exhausted = true; break; }
                        if (d > P.dateTo) continue;
                        if (w.favorites < P.minFavs) continue;
                        if (P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs) { skippedAbove++; continue; }
                    } else {
                        if (w.favorites < P.minFavs) { exhausted = true; break; }
                        if (P.maxFavsOn && P.maxFavs > 0 && w.favorites > P.maxFavs) { skippedAbove++; continue; }
                        pageInRange++;
                        if (d < P.dateFrom || d > P.dateTo) continue;
                    }
                    if (_seenIds.has(w.id)) continue;
                    _seenIds.add(w.id);
                    frag.appendChild(mkCard(w));
                    sess.batchItems.push(w);
                    batchFound++; totalFound++;
                    pageMatched++;
                }
                if (frag.childNodes.length) ul.appendChild(frag);
                setCount(totalFound);

                if (exhausted) break;
                if (stopIdx >= 0) { itemIdx = stopIdx; break; }

                if (P.sortMode === 'favorites' && pageInRange > 0 && pageMatched === 0) {
                    consecMisses++;
                    if (consecMisses >= MAX_CONSEC_MISS) { checkpoint = true; break; }
                } else if (pageMatched > 0) consecMisses = 0;

                if ((sess.winBot && page >= sess.winBot) || page >= lastPage) { exhausted = true; break; }
                page++; itemIdx = 0;
                await sleep(300);
            }
        } catch (e) { fatal = '✕ Unexpected error: ' + (e && e.message); }

        sess.page = page; sess.itemIdx = itemIdx; sess.lastPage = lastPage;
        sess.skippedAbove = skippedAbove; sess.totalFound = totalFound;
        sess.consecMisses = checkpoint ? 0 : consecMisses;
        sess.exhausted = exhausted;

        const batchDone = batchFound >= P.batchSize;
        if (batchDone) { sess.batchNum = batchNum + 1; sess.batchFound = 0; }
        else sess.batchFound = batchFound;

        _running = false;
        setRunningUI(false);
        setProgress(batchFound > 0 ? 100 : 0);
        setTimeout(() => setProgress(0), 900);

        if (totalFound > 0 || sess.batchItems.length) sessionSave(sess);
        if (batchDone) sess.batchItems = [];
        if (sess.exhausted && totalFound === 0 && !sess.batchItems.length && !fatal && !stopped && !checkpoint) {
            const li = mk('li', 'nx-empty');
            li.innerHTML = '<strong>No wallpapers found.</strong><br>Try widening the date range, lowering Min ♥, or switching sort mode.';
            ul.appendChild(li);
        }

        if (fatal) {
            setStatus(fatal, true);
            setContBar('go', 'Continue — finish batch ' + batchNum + ' (' + (P.batchSize - batchFound) + ' left)',
                       'state preserved · resumes at page ' + page);
        } else if (stopped) {
            setStatus('Stopped · ' + totalFound.toLocaleString() + ' collected');
            setContBar('go', batchDone ? 'Continue — batch ' + sess.batchNum : 'Continue — finish batch ' + batchNum,
                       'state preserved · resumes at page ' + page);
        } else if (exhausted) {
            setContBar('done', 'No more results', totalFound.toLocaleString() + ' collected');
            setStatus(batchDone
                ? '✓ Batch ' + batchNum + ' complete — no more matching results'
                : '✓ No more matching results · only ' + totalFound.toLocaleString() + ' exist for these filters');
        } else if (checkpoint) {
            setStatus('⚠ Sparse in favorites order — no date matches in ' + MAX_CONSEC_MISS + ' pages (now at page ' + page + '). Continue the scan, narrow the range, or raise Min ♥.');
            setContBar('go', 'Continue deep scan — page ' + page, 'results are sparse in this order');
        } else if (batchDone) {
            setStatus('✓ Batch ' + batchNum + ' complete · ' + totalFound.toLocaleString() + ' collected · next: #' + sess.batchNum);
            setContBar('go', 'Continue — next ' + P.batchSize + ' (batch ' + sess.batchNum + ')',
                       'total ' + totalFound.toLocaleString() + ' so far');
        }
    }

    async function startScan (sess) {
        _running = true; _stop = false;
        setRunningUI(true);
        setContBar('load', 'Scanning…', '');
        const P = sess.params;
        const DP = { ...P, baseParams: { ...P.baseParams, sorting: 'date_added' } };

        setStatus('Scanning… page 1');
        const probe = await scanFetch(P, 1);
        if (probe.stopped) { _running = false; setRunningUI(false); setContBar('none', '', ''); return; }
        if (probe.fatal) {
            _running = false; setRunningUI(false);
            setStatus(probe.msg, true);
            setContBar('go', 'Continue — retry scan', '');
            return;
        }
        if (probe.done) {
            _running = false; setRunningUI(false);
            setStatus('⚠ No results — check filters' + (get('apiKey') ? '' : ' / API key') + '.');
            const ul = getUL();
            if (ul) {
                const li = mk('li', 'nx-empty');
                li.innerHTML = '<strong>No wallpapers found.</strong><br>Try widening the date range, lowering Min ♥, or switching sort mode.';
                ul.appendChild(li);
            }
            setContBar('done', 'No more results', '');
            return;
        }
        sess.lastPage = Math.min((probe.meta && probe.meta.last_page) || 1, MAX_SAFE_PAGE);

        if (P.sortMode === 'date_added') {
            sess.mode = 'walk';
            let winTop = 1;
            if (P.dateTo < todayStr()) {
                winTop = await findDateStartPage(DP, P.dateTo, sess.lastPage);
                if (winTop === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
            }
            if (winTop > sess.lastPage) return emptyWindow(sess);
            if (P.dateTo < todayStr() || P.dateFrom > '2010-01-01') {
                const winBot = await findDateEndPage(DP, P.dateFrom, sess.lastPage);
                if (winBot === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
                sess.winBot = winBot;
                if (winBot <= winTop) return emptyWindow(sess);
            }
            sess.page = winTop;
            setStatus('Upload order · scanning the window' + (sess.winBot ? ' (≈' + Math.max(0, sess.winBot - winTop) + ' pages)' : ''));
            await coreScan(sess, winTop === 1 ? probe : null);
            return;
        }

        const bounded = P.dateTo < todayStr() || P.dateFrom > '2010-01-01';
        if (!bounded) {            sess.mode = 'walk';
            const prep = await prepareFavsWalk(sess);
            if (prep === 'abort') return abortStart('✕ API unavailable while locating favorites bounds — try again.');
            if (prep === 'empty') return maxFavsEmpty(sess);
            setStatus('Favorites order · ♥ floor at page ' + sess.lastPage + ' · matches are dense');
            await coreScan(sess, sess.page === 1 ? probe : null);
            return;
        }

        const winTop = P.dateTo < todayStr()
            ? await findDateStartPage(DP, P.dateTo, sess.lastPage)
            : 1;
        if (winTop === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
        const winBot = await findDateEndPage(DP, P.dateFrom, sess.lastPage);
        if (winBot === -1) return abortStart('✕ API unavailable while locating the date range — try again.');
        const windowPages = winBot - winTop;
        if (windowPages <= 0 || winTop > sess.lastPage) return emptyWindow(sess);

        let mode = 'buffer', walkEst = 0;
        if (windowPages > 60) {
            if (P.minFavs > 0 && !sess.favFloorDone) {
                const floor = await findFavsFloorPage(P, P.minFavs, sess.lastPage);
                if (floor === -1) return abortStart('✕ API unavailable while locating the favorites floor — try again.');
                sess.lastPage = Math.min(sess.lastPage, floor);
                sess.favFloorDone = true;
            }
            setStatus('Estimating scan depth (sampling the favorites region)…');
            const d = await sampleDensity(P, sess.lastPage);
            walkEst = d > 0 ? Math.ceil(P.batchSize / d) : Infinity;
            if (windowPages > BUFFER_MAX_PAGES) {
                mode = 'walk';
            } else if (walkEst <= WALK_EST_MAX && walkEst * 1.25 < windowPages) {
                mode = 'walk';
            }
        }

        if (mode === 'buffer') {
            sess.mode = 'buffer';
            sess.winTop = winTop; sess.winBot = winBot;
            sess.scanPage = winTop;
            setStatus('Strategy: collect the ' + windowPages + '-page window once in upload order, rank by favorites · later batches are instant');
            await bufferCore(sess);
            return;
        }

        sess.mode = 'walk';
        const prep = await prepareFavsWalk(sess);
        if (prep === 'abort') return abortStart('✕ API unavailable while locating favorites bounds — try again.');
        if (prep === 'empty') return maxFavsEmpty(sess);
        setStatus('Strategy: favorites-ordered walk' +
                  (isFinite(walkEst) ? ' (≈' + walkEst + ' pages to a full batch)' : ' (window too large to enumerate)'));
        await coreScan(sess, sess.page === 1 ? probe : null);
    }

    function newSession (P) {
        return { id: Date.now().toString(36), params: P, mode: 'walk',
                 page: 1, itemIdx: 0, lastPage: 1, winBot: 0, skippedAbove: 0, favFloorDone: false,
                 batchNum: 1, batchFound: 0, totalFound: 0, consecMisses: 0,
                 exhausted: false, batchItems: [],
                 winTop: 1, scanPage: 1, matches: [], collectedIds: new Set(), rank: 0, scanned: false };
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
        setCount(0); setProgress(0);
        setContBar('none', '', '');
        _session = newSession(p);
        await startScan(_session);
    }

    async function continueSearch () {
        if (_running || !_session || _session.exhausted) return;
        if (_session.mode === 'buffer') { await bufferCore(_session); return; }
        await coreScan(_session);
    }

    async function restartSearch () {
        if (_running || !_session) return;
        const ul = getUL();
        if (!ul) return;
        ensureSnapshot();
        ul.textContent = '';
        _seenIds = new Set();
        setCount(0); setProgress(0);
        setContBar('none', '', '');
        _session = newSession(_session.params);
        await startScan(_session);
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
      '</div>' +
      '<div class="nx-dlstats" id="nx-dlstats"></div>' +
      '<div class="nx-actrow">' +
        '<button type="button" class="nx-btn nx-btn-go" id="nx-go"></button>' +
        '<button type="button" class="nx-btn" id="nx-stop2" disabled>Stop</button>' +
        '<button type="button" class="nx-btn" id="nx-restart" disabled>Restart</button>' +
        '<button type="button" class="nx-btn" id="nx-clear">Clear grid</button>' +
        '<button type="button" class="nx-btn" id="nx-fix">Fix thumbs</button>' +
      '</div>' +
      '<div class="nx-sec-h">Search history <span class="nx-hspan">· keep <input id="nx-hm" class="nx-in nx-in-hm" type="number" min="1" step="1"> searches</span></div>' +
      '<div class="nx-hist" id="nx-hist"></div>' +
      '<div class="nx-hist-foot"><button type="button" class="nx-btn nx-btn-dim" id="nx-hist-clear">Clear history</button></div>' +
      '<div class="nx-foot"><span>naXim Labs · Wallhaven Enhancer v7.5.1</span><a href="https://github.com/0naXim0" target="_blank" rel="noopener">github.com/0naXim0</a></div>' +
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
            maxon: $r('#nx-maxon'), inf: $r('#nx-inf'),
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
        UI.btnStop.forEach(b => b.addEventListener('click', () => { _stop = true; setStatus('Stopping…'); }));
        UI.btnRestart.forEach(b => b.addEventListener('click', restartSearch));
        UI.btnClear.forEach(b => b.addEventListener('click', clearGrid));
        UI.btnRefresh.forEach(b => b.addEventListener('click', refreshImages));
        $r('#nx-hist-clear').addEventListener('click', () => {
            historyLoad().forEach(e => batchDelete(e.id));
            _session = null;
            refreshHistoryPanel();
            setStatus('History cleared.');
        });

        refreshHistoryPanel();
        setCount(document.querySelectorAll('figure.thumb[data-wallpaper-id]').length);
    }

    /* ═══ STYLES ═══════════════════════════════════════════════════ */

    const CSS = `
:root { --nx-acc:#7aa2f7; --nx-ok:#9ece6a; --nx-err:#f7768e; --nx-acc-soft:rgba(122,162,247,.16); }
:where(.nx-panel, .nx-lb, .nx-hyper-pill, .nx-cont-bar, .nx-dlm) :is(button, a, input, select) {
    margin:0; padding:0; font:inherit; color:inherit; background:none; border:none;
    box-sizing:border-box; cursor:pointer; text-decoration:none; line-height:1.2;
}
:where(.nx-panel, .nx-lb, .nx-hyper-pill, .nx-cont-bar, .nx-dlm) * { box-sizing:border-box; }
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
.nx-hist-count { font-size:10.5px; color:var(--mut); white-space:nowrap; }
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

.nx-cont-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin:12px 0;
    padding:10px 12px; border:1px solid #2a2f3a; border-radius:12px;
    background:rgba(25,28,35,.92); backdrop-filter:blur(8px);
    box-shadow:0 6px 20px rgba(0,0,0,.35); font-family:-apple-system,"Segoe UI",Roboto,sans-serif; }
.nx-cont-bar .nx-btn { min-width:170px; justify-content:center;
    background:#7aa2f7; border:1px solid #7aa2f7; color:#0c0e13;
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
.nx-cont-note { font-size:11.5px; color:#8d93a3; }

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
.nx-lb-stage { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    padding:64px 70px 46px; touch-action:none; }
.nx-lb-stage.nx-pannable { cursor:grab; }
.nx-lb-stage.nx-grabbing { cursor:grabbing; }
.nx-lb-img { max-width:100%; max-height:100%; object-fit:contain; border-radius:3px;
    box-shadow:0 18px 70px rgba(0,0,0,.55); user-select:none; -webkit-user-drag:none; will-change:transform; }
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
    .nx-dlm-ring .nx-r-fg, .nx-dlm-rring .nx-r-fg { transition:none !important; }
    .nx-dlm-act, .nx-stp { transition:none !important; }
    .nx-dlm.nx-open .nx-dlm-list { animation:none !important; }
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
    step('status',   () => setStatus('Ready · hover a card, then click the eye for an instant preview'));
    console.info('[naXim Labs] initialized');
})();
