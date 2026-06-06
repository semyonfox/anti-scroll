(function startAntiScroll(root) {
  "use strict";

  const config = root.AntiScrollConfig;
  const api = config.getApi();

  if (!api?.storage || !api?.runtime) {
    return;
  }

  const MAIN_LOCK_EVENT = "anti-scroll-main-lock-state";
  const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;
  const MAX_SCAN_COUNT = 900;
  const SCROLL_KEYS = new Set([
    " ",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
    "Spacebar"
  ]);

  let settings = config.DEFAULT_SETTINGS;
  let activeMatch = null;
  let shieldMatch = null;
  let locked = false;
  let rootPosition = { x: 0, y: 0 };
  let restoringScroll = false;
  let lastAttemptAt = 0;
  let activeUntilTimer = null;
  let scanTimer = null;
  let periodicScanTimer = null;
  let mutationObserver = null;
  let surfaceObserver = null;
  let surfaceTimer = null;
  let pointerStart = null;

  const scrollContainers = new Set();
  const scrollPositions = new WeakMap();
  const surfaceTargets = new Set();
  const FEED_SELECTORS = {
    reddit: [
      "shreddit-feed",
      "faceplate-batch",
      "[data-testid='post-container']",
      "shreddit-post",
      "article:has(a[href*='/comments/'])"
    ],
    youtube: [
      "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer #contents",
      "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer",
      "ytd-browse[page-subtype='subscriptions'] ytd-section-list-renderer #contents",
      "ytd-shorts",
      "ytd-search ytd-section-list-renderer",
      "ytd-two-column-search-results-renderer",
      "ytd-rich-shelf-renderer[is-shorts]",
      "ytd-reel-shelf-renderer",
      "ytd-video-renderer:has(a[href^='/shorts/'])"
    ],
    instagram: [
      "main article",
      "main a[href^='/p/']",
      "main a[href^='/reel/']",
      "main div[role='presentation']:has(a[href^='/p/'])",
      "main div[role='presentation']:has(a[href^='/reel/'])"
    ],
    tiktok: [
      "#main-content-homepage_hot",
      "#main-content-explore_page",
      "main [data-e2e='recommend-list-item-container']",
      "main [data-e2e='feed-video']",
      "main [data-e2e='browse-video-list']",
      "main [data-e2e='user-post-item']",
      "main div[class*='DivVideoFeed']"
    ],
    x: [
      "main[role='main'] div[data-testid='cellInnerDiv']",
      "main[role='main'] article[data-testid='tweet']",
      "main[role='main'] div[aria-label*='Timeline'] > div > div",
      "main[role='main'] div[data-testid='primaryColumn'] section"
    ],
    facebook: [
      "div[role='feed']",
      "div[role='main'] div[role='article']",
      "div[data-pagelet='MainFeed']",
      "div[data-pagelet*='FeedUnit']",
      "div[data-pagelet^='VideoHome']"
    ],
    linkedin: [
      "main .feed-shared-update-v2",
      "main div[data-view-tracking-scope*='FEED_UPDATE_SERVED'] > div",
      "main .scaffold-finite-scroll__content > div",
      ".feed-new-update-pill__new-update-button",
      ".feed-shared-news-module",
      ".feed-follows-module",
      ".scaffold-finite-scroll__load-button"
    ],
    threads: [
      "main [role='article']",
      "main div[aria-label*='Timeline'] [role='article']"
    ]
  };

  function storageGet(area, defaults) {
    return new Promise((resolve) => {
      const result = area.get(defaults, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function ensureStyle() {
    if (document.getElementById("anti-scroll-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "anti-scroll-style";
    style.textContent = `
      :root[data-anti-scroll-locked="true"],
      :root[data-anti-scroll-locked="true"] body {
        overflow: hidden !important;
        overscroll-behavior: none !important;
      }

      :root[data-anti-scroll-locked="true"] {
        scroll-behavior: auto !important;
      }

      :root[data-anti-scroll-locked="true"] * {
        scroll-behavior: auto !important;
        overscroll-behavior: contain !important;
      }

      :root[data-anti-scroll-shield="true"],
      :root[data-anti-scroll-shield="true"] body {
        overflow: hidden !important;
        background: #f7f8f8 !important;
      }

      :root[data-anti-scroll-shield="true"] body > :not(#anti-scroll-shield) {
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #anti-scroll-shield {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        display: grid !important;
        place-items: center !important;
        padding: 24px !important;
        background: #f7f8f8 !important;
        color: #15191d !important;
        font: 500 15px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }

      #anti-scroll-shield strong {
        display: block !important;
        margin-bottom: 6px !important;
        font-size: 18px !important;
        line-height: 1.2 !important;
        letter-spacing: 0 !important;
      }

      #anti-scroll-shield p {
        margin: 0 !important;
        max-width: 360px !important;
        color: #697178 !important;
        text-align: center !important;
      }

      :root[data-anti-scroll-feed-surface="true"] [data-anti-scroll-feed-target="true"] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #anti-scroll-feed-placeholder {
        box-sizing: border-box !important;
        width: min(680px, calc(100% - 24px)) !important;
        min-height: 180px !important;
        display: grid !important;
        place-items: center !important;
        margin: 12px auto !important;
        padding: 24px !important;
        border: 1px solid rgba(21, 25, 29, 0.12) !important;
        border-radius: 8px !important;
        background: #f7f8f8 !important;
        color: #15191d !important;
        font: 500 15px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        text-align: center !important;
      }

      #anti-scroll-feed-placeholder strong {
        display: block !important;
        margin-bottom: 6px !important;
        font-size: 18px !important;
        line-height: 1.2 !important;
        letter-spacing: 0 !important;
      }

      #anti-scroll-feed-placeholder p {
        margin: 0 !important;
        color: #697178 !important;
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function dispatchMainLockState() {
    try {
      document.dispatchEvent(
        new CustomEvent(MAIN_LOCK_EVENT, {
          detail: { locked }
        })
      );
    } catch {
      // CustomEvent can be unavailable in very old embedded documents.
    }
  }

  function isTopFrame() {
    try {
      return root.top === root;
    } catch {
      return false;
    }
  }

  function isEditableTarget(target) {
    if (!target || !(target instanceof Element)) {
      return false;
    }

    return Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [role='textbox']"
      )
    );
  }

  function isDocumentLikeScroller(element) {
    return (
      element === document.documentElement ||
      element === document.body ||
      element === document.scrollingElement
    );
  }

  function isScrollableElement(element) {
    if (!(element instanceof Element) || isDocumentLikeScroller(element)) {
      return false;
    }

    const style = root.getComputedStyle(element);
    const canScrollY =
      SCROLLABLE_OVERFLOW.test(style.overflowY) &&
      element.scrollHeight > element.clientHeight + 1;
    const canScrollX =
      SCROLLABLE_OVERFLOW.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth + 1;

    return canScrollY || canScrollX;
  }

  function getRootScrollPosition() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    return {
      x: root.scrollX || scrollingElement.scrollLeft || 0,
      y: root.scrollY || scrollingElement.scrollTop || 0
    };
  }

  function captureRootScroll() {
    rootPosition = getRootScrollPosition();
  }

  function setRootScrollPosition() {
    const current = getRootScrollPosition();
    if (current.x === rootPosition.x && current.y === rootPosition.y) {
      return;
    }

    if (typeof root.scrollTo === "function") {
      root.scrollTo(rootPosition.x, rootPosition.y);
      return;
    }

    const scrollingElement = document.scrollingElement || document.documentElement;
    scrollingElement.scrollLeft = rootPosition.x;
    scrollingElement.scrollTop = rootPosition.y;
  }

  function registerScrollContainer(element) {
    if (!isScrollableElement(element)) {
      return;
    }

    if (!scrollPositions.has(element)) {
      scrollPositions.set(element, {
        left: element.scrollLeft,
        top: element.scrollTop
      });
    }

    if (scrollContainers.has(element)) {
      return;
    }

    scrollContainers.add(element);
    element.addEventListener("scroll", restoreElementScroll, {
      capture: true,
      passive: true
    });
  }

  function unregisterScrollContainer(element) {
    element.removeEventListener("scroll", restoreElementScroll, {
      capture: true
    });
    scrollContainers.delete(element);
  }

  function restoreElement(element) {
    const position = scrollPositions.get(element);
    if (!position) {
      return;
    }

    if (element.scrollLeft !== position.left) {
      element.scrollLeft = position.left;
    }

    if (element.scrollTop !== position.top) {
      element.scrollTop = position.top;
    }
  }

  function withRestoringScroll(callback) {
    if (restoringScroll) {
      return;
    }

    restoringScroll = true;
    try {
      callback();
    } finally {
      root.requestAnimationFrame(() => {
        restoringScroll = false;
      });
    }
  }

  function restoreAllScrollPositions() {
    if (!locked) {
      return;
    }

    withRestoringScroll(() => {
      setRootScrollPosition();

      for (const element of Array.from(scrollContainers)) {
        if (!element.isConnected) {
          unregisterScrollContainer(element);
          continue;
        }

        restoreElement(element);
      }
    });
  }

  function restoreElementScroll(event) {
    if (!locked || restoringScroll) {
      return;
    }

    const element = event.currentTarget;
    if (!(element instanceof Element)) {
      return;
    }

    withRestoringScroll(() => {
      restoreElement(element);
      setRootScrollPosition();
    });
  }

  function captureEventScrollContainers(event) {
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];

    for (const item of path) {
      if (item instanceof Element) {
        registerScrollContainer(item);
      }
    }
  }

  function scanScrollContainers() {
    if (!locked) {
      return;
    }

    const rootElement = document.body || document.documentElement;
    if (!rootElement) {
      return;
    }

    let scanned = 0;
    const walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_ELEMENT
    );

    registerScrollContainer(rootElement);

    while (scanned < MAX_SCAN_COUNT) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }

      registerScrollContainer(node);
      scanned += 1;
    }
  }

  function scheduleContainerScan() {
    if (!locked || scanTimer) {
      return;
    }

    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanScrollContainers();
      pauseMediaOnShield();
    }, 120);
  }

  function startContainerWatch() {
    if (mutationObserver || !document.documentElement) {
      return;
    }

    mutationObserver = new MutationObserver(scheduleContainerScan);
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    periodicScanTimer = setInterval(scanScrollContainers, 2000);
  }

  function stopContainerWatch() {
    mutationObserver?.disconnect();
    mutationObserver = null;

    clearTimeout(scanTimer);
    scanTimer = null;

    clearInterval(periodicScanTimer);
    periodicScanTimer = null;

    for (const element of Array.from(scrollContainers)) {
      unregisterScrollContainer(element);
    }
  }

  function scheduleSurfaceRefresh() {
    if (!shieldMatch?.active || shieldMatch.type !== "feed" || surfaceTimer) {
      return;
    }

    surfaceTimer = setTimeout(() => {
      surfaceTimer = null;
      applyFeedSurfaceShield();
    }, 120);
  }

  function startSurfaceWatch() {
    if (surfaceObserver || !document.documentElement) {
      return;
    }

    surfaceObserver = new MutationObserver(scheduleSurfaceRefresh);
    surfaceObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopSurfaceWatch() {
    surfaceObserver?.disconnect();
    surfaceObserver = null;
    clearTimeout(surfaceTimer);
    surfaceTimer = null;
  }

  function clearFeedTargets() {
    for (const element of Array.from(surfaceTargets)) {
      if (element instanceof Element) {
        delete element.dataset.antiScrollFeedTarget;
      }
    }

    surfaceTargets.clear();
  }

  function getFeedTargets() {
    const selectors = FEED_SELECTORS[shieldMatch?.presetId] || [];
    const targets = [];

    for (const selector of selectors) {
      let matches = [];

      try {
        matches = Array.from(document.querySelectorAll(selector));
      } catch {
        continue;
      }

      for (const element of matches) {
        if (
          element instanceof HTMLElement &&
          element.id !== "anti-scroll-feed-placeholder" &&
          !element.closest("#anti-scroll-feed-placeholder")
        ) {
          targets.push(element);
        }
      }

      if (targets.length) {
        break;
      }
    }

    return targets.slice(0, 80);
  }

  function targetInsertionParent(target) {
    if (!target || !target.parentElement) {
      return document.body || document.documentElement;
    }

    return target.parentElement;
  }

  function insertFeedPlaceholder(targets) {
    if (!targets.length) {
      document.getElementById("anti-scroll-feed-placeholder")?.remove();
      return;
    }

    const firstTarget = targets[0];
    const parent = targetInsertionParent(firstTarget);
    let placeholder = document.getElementById("anti-scroll-feed-placeholder");

    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.id = "anti-scroll-feed-placeholder";
      placeholder.setAttribute("role", "status");
      placeholder.setAttribute("aria-live", "polite");
    }

    const content = document.createElement("div");
    const heading = document.createElement("strong");
    const copy = document.createElement("p");

    heading.textContent = "Feed blocked";
    copy.textContent = "The rest of the page is still available.";
    content.append(heading, copy);
    placeholder.replaceChildren(content);

    if (firstTarget && firstTarget.parentElement === parent) {
      parent.insertBefore(placeholder, firstTarget);
      return;
    }

    parent.prepend(placeholder);
  }

  function applyFeedSurfaceShield() {
    if (!shieldMatch?.active || shieldMatch.type !== "feed" || !isTopFrame()) {
      hideFeedSurfaceShield();
      return;
    }

    ensureStyle();
    hideFullPageShield();
    document.documentElement.dataset.antiScrollFeedSurface = "true";
    document.documentElement.dataset.antiScrollFeedPreset =
      shieldMatch.presetId || "";

    clearFeedTargets();
    const targets = getFeedTargets();

    for (const target of targets) {
      target.dataset.antiScrollFeedTarget = "true";
      surfaceTargets.add(target);
    }

    insertFeedPlaceholder(targets);
    pauseMediaOnShield();
    startSurfaceWatch();
  }

  function hideFeedSurfaceShield() {
    if (document.documentElement) {
      delete document.documentElement.dataset.antiScrollFeedSurface;
      delete document.documentElement.dataset.antiScrollFeedPreset;
    }

    clearFeedTargets();
    document.getElementById("anti-scroll-feed-placeholder")?.remove();
    stopSurfaceWatch();
  }

  function reportAttempt() {
    if (!activeMatch) {
      return;
    }

    const now = Date.now();
    if (now - lastAttemptAt < 1200) {
      return;
    }

    lastAttemptAt = now;
    api.runtime.sendMessage({
      type: "anti-scroll-attempt",
      presetId: activeMatch.presetId || null,
      matchType: activeMatch.type || null,
      host: activeMatch.host,
      domain: activeMatch.domain,
      label: activeMatch.label
    });
  }

  function pauseMediaOnShield() {
    if (!shieldMatch?.active) {
      return;
    }

    for (const element of document.querySelectorAll("video, audio")) {
      try {
        element.pause();
        element.preload = "none";
      } catch {
        // Media elements can be controlled by site wrappers; best effort only.
      }
    }
  }

  function showFullPageShield() {
    if (
      !shieldMatch?.active ||
      shieldMatch.type === "feed" ||
      !document.documentElement
    ) {
      return;
    }

    ensureStyle();
    hideFeedSurfaceShield();
    document.documentElement.dataset.antiScrollShield = "true";

    let shield = document.getElementById("anti-scroll-shield");
    if (!shield) {
      shield = document.createElement("div");
      shield.id = "anti-scroll-shield";
      shield.setAttribute("role", "status");
      shield.setAttribute("aria-live", "polite");
      document.documentElement.appendChild(shield);
    }

    const title =
      shieldMatch.type === "all" ? "Page blocked" : "Site blocked";
    const detail = "Turn Anti Scroll off to use this page.";
    const content = document.createElement("div");
    const heading = document.createElement("strong");
    const copy = document.createElement("p");

    heading.textContent = title;
    copy.textContent = detail;
    content.append(heading, copy);
    shield.replaceChildren(content);
    pauseMediaOnShield();
  }

  function hideFullPageShield() {
    if (document.documentElement) {
      delete document.documentElement.dataset.antiScrollShield;
    }

    document.getElementById("anti-scroll-shield")?.remove();
  }

  function hideShield() {
    hideFullPageShield();
    hideFeedSurfaceShield();
    shieldMatch = null;
  }

  function updateShield(match) {
    if (!isTopFrame() || !match?.active) {
      hideShield();
      return;
    }

    shieldMatch = match;

    if (shieldMatch.type === "feed") {
      applyFeedSurfaceShield();
      return;
    }

    if (shieldMatch.active) {
      showFullPageShield();
      return;
    }

    hideShield();
  }

  function getCandidateUrls() {
    const urls = [location.href];

    if (document.referrer) {
      urls.push(document.referrer);
    }

    try {
      if (root.top && root.top !== root && root.top.location?.href) {
        urls.push(root.top.location.href);
      }
    } catch {
      // Cross-origin frames cannot expose their top document URL.
    }

    return Array.from(new Set(urls));
  }

  function resolveCurrentMatch() {
    const matches = getCandidateUrls().map((url) =>
      config.matchShield(url, settings)
    );
    return matches.find((match) => match.active) || matches[0];
  }

  function syncLockAttribute() {
    if (locked && settings.lockPage) {
      document.documentElement.dataset.antiScrollLocked = "true";
      return;
    }

    delete document.documentElement.dataset.antiScrollLocked;
  }

  function enableLock() {
    if (locked) {
      syncLockAttribute();
      dispatchMainLockState();
      return;
    }

    ensureStyle();
    captureRootScroll();
    locked = true;
    syncLockAttribute();
    dispatchMainLockState();
    scanScrollContainers();
    startContainerWatch();
  }

  function disableLock() {
    if (!locked) {
      hideShield();
      return;
    }

    releaseLockOnly();
    hideShield();
  }

  function releaseLockOnly() {
    if (!locked) {
      return;
    }

    locked = false;
    syncLockAttribute();
    dispatchMainLockState();
    stopContainerWatch();
  }

  function applyState() {
    const match = resolveCurrentMatch();
    activeMatch = match.active ? match : null;

    if (activeMatch) {
      if (activeMatch.type === "feed") {
        releaseLockOnly();
      } else {
        enableLock();
      }
      updateShield(activeMatch);
    } else {
      updateShield(null);
      disableLock();
    }

    scheduleTimerRefresh();
  }

  function scheduleTimerRefresh() {
    clearTimeout(activeUntilTimer);
    activeUntilTimer = null;

    if (!settings.activeUntil) {
      return;
    }

    const delay = settings.activeUntil - Date.now();
    if (delay <= 0) {
      return;
    }

    activeUntilTimer = setTimeout(applyState, Math.min(delay + 250, 2147483647));
  }

  function shouldAllowEvent(event) {
    if (!locked || !activeMatch) {
      return true;
    }

    if (settings.allowEditableFields && isEditableTarget(event.target)) {
      return true;
    }

    if (event.type === "keydown") {
      return (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !SCROLL_KEYS.has(event.key)
      );
    }

    if (event.type === "mousedown" || event.type === "auxclick") {
      return event.button !== 1;
    }

    if (event.type === "pointermove") {
      if (!pointerStart || event.pointerType === "mouse") {
        return true;
      }

      const distance =
        Math.abs(event.clientX - pointerStart.x) +
        Math.abs(event.clientY - pointerStart.y);
      return distance < 4;
    }

    return false;
  }

  function blockEvent(event) {
    if (shouldAllowEvent(event)) {
      return;
    }

    captureEventScrollContainers(event);

    if (event.cancelable) {
      event.preventDefault();
    }

    event.stopImmediatePropagation();
    restoreAllScrollPositions();
    reportAttempt();
  }

  function onPointerDown(event) {
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId
    };
  }

  function onPointerUp(event) {
    if (!pointerStart || pointerStart.pointerId === event.pointerId) {
      pointerStart = null;
    }
  }

  function notifyLocationChange() {
    captureRootScroll();
    applyState();
  }

  function patchHistory() {
    const pushState = history.pushState;
    const replaceState = history.replaceState;

    history.pushState = function patchedPushState(...args) {
      const result = pushState.apply(this, args);
      queueMicrotask(notifyLocationChange);
      return result;
    };

    history.replaceState = function patchedReplaceState(...args) {
      const result = replaceState.apply(this, args);
      queueMicrotask(notifyLocationChange);
      return result;
    };
  }

  root.addEventListener("wheel", blockEvent, { capture: true, passive: false });
  root.addEventListener("mousewheel", blockEvent, {
    capture: true,
    passive: false
  });
  root.addEventListener("DOMMouseScroll", blockEvent, {
    capture: true,
    passive: false
  });
  root.addEventListener("touchmove", blockEvent, {
    capture: true,
    passive: false
  });
  root.addEventListener("keydown", blockEvent, { capture: true });
  root.addEventListener("mousedown", blockEvent, {
    capture: true,
    passive: false
  });
  root.addEventListener("auxclick", blockEvent, {
    capture: true,
    passive: false
  });
  root.addEventListener("pointerdown", onPointerDown, {
    capture: true,
    passive: true
  });
  root.addEventListener("pointermove", blockEvent, {
    capture: true,
    passive: false
  });
  root.addEventListener("pointerup", onPointerUp, {
    capture: true,
    passive: true
  });
  root.addEventListener("pointercancel", onPointerUp, {
    capture: true,
    passive: true
  });
  root.addEventListener("scroll", restoreAllScrollPositions, {
    capture: true,
    passive: true
  });
  document.addEventListener("scroll", restoreAllScrollPositions, {
    capture: true,
    passive: true
  });
  root.addEventListener("popstate", notifyLocationChange);
  root.addEventListener("hashchange", notifyLocationChange);

  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[config.SETTINGS_KEY]) {
      return;
    }

    settings = config.sanitizeSettings(changes[config.SETTINGS_KEY].newValue);
    applyState();
  });

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "anti-scroll-current-state") {
      sendResponse({
        ok: true,
        match: resolveCurrentMatch(),
        locked
      });
      return true;
    }

    return false;
  });

  patchHistory();
  applyState();

  storageGet(api.storage.sync, {
    [config.SETTINGS_KEY]: config.DEFAULT_SETTINGS
  }).then((stored) => {
    settings = config.sanitizeSettings(stored[config.SETTINGS_KEY]);
    applyState();
  });
})(globalThis);
