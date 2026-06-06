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
  let feedShieldMatch = null;
  let locked = false;
  let rootPosition = { x: 0, y: 0 };
  let restoringScroll = false;
  let lastAttemptAt = 0;
  let activeUntilTimer = null;
  let scanTimer = null;
  let periodicScanTimer = null;
  let mutationObserver = null;
  let pointerStart = null;

  const scrollContainers = new Set();
  const scrollPositions = new WeakMap();

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

      :root[data-anti-scroll-feed-shield="true"],
      :root[data-anti-scroll-feed-shield="true"] body {
        overflow: hidden !important;
        background: #f7f8f8 !important;
      }

      :root[data-anti-scroll-feed-shield="true"] body > :not(#anti-scroll-feed-shield) {
        visibility: hidden !important;
        pointer-events: none !important;
      }

      #anti-scroll-feed-shield {
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

      #anti-scroll-feed-shield strong {
        display: block !important;
        margin-bottom: 6px !important;
        font-size: 18px !important;
        line-height: 1.2 !important;
        letter-spacing: 0 !important;
      }

      #anti-scroll-feed-shield p {
        margin: 0 !important;
        max-width: 360px !important;
        color: #697178 !important;
        text-align: center !important;
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
      pauseMediaOnFeed();
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

  function pauseMediaOnFeed() {
    if (!feedShieldMatch?.active) {
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

  function showFeedShield() {
    if (!feedShieldMatch?.active || !document.documentElement) {
      return;
    }

    ensureStyle();
    document.documentElement.dataset.antiScrollFeedShield = "true";

    let shield = document.getElementById("anti-scroll-feed-shield");
    if (!shield) {
      shield = document.createElement("div");
      shield.id = "anti-scroll-feed-shield";
      shield.setAttribute("role", "status");
      shield.setAttribute("aria-live", "polite");
      shield.innerHTML = "<div><strong>Feed blocked</strong><p>Open a specific page or turn Anti Scroll off.</p></div>";
      document.documentElement.appendChild(shield);
    }

    pauseMediaOnFeed();
  }

  function hideFeedShield() {
    if (document.documentElement) {
      delete document.documentElement.dataset.antiScrollFeedShield;
    }

    document.getElementById("anti-scroll-feed-shield")?.remove();
    feedShieldMatch = null;
  }

  function updateFeedShield(match) {
    if (!isTopFrame() || !match?.active) {
      hideFeedShield();
      return;
    }

    feedShieldMatch = config.matchFeedShield(location.href, match, settings);

    if (feedShieldMatch.active) {
      showFeedShield();
      return;
    }

    hideFeedShield();
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
      config.matchUrl(url, settings)
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
      return;
    }

    locked = false;
    syncLockAttribute();
    dispatchMainLockState();
    hideFeedShield();
    stopContainerWatch();
  }

  function applyState() {
    const match = resolveCurrentMatch();
    activeMatch = match.active ? match : null;

    if (activeMatch) {
      enableLock();
      updateFeedShield(activeMatch);
    } else {
      updateFeedShield(null);
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
