(function installAntiScrollPageLock(root) {
  "use strict";

  const REQUEST_EVENT_NAME = "anti-scroll-main-lock-token-request";
  const RESPONSE_EVENT_NAME = "anti-scroll-main-lock-token-response";
  const STATE_EVENT_NAME = "anti-scroll-main-lock-state";
  const state = {
    locked: false,
    tokenIssued: false
  };
  const token = createToken();

  function createToken() {
    const bytes = new Uint32Array(4);
    try {
      root.crypto.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(36)).join("-");
    } catch {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function shouldBlockScrollCall() {
    return state.locked;
  }

  function syncLockedFromAttribute() {
    state.locked =
      root.document?.documentElement?.dataset.antiScrollLocked === "true";
  }

  function patchMethod(target, name, replacement) {
    if (!target || typeof target[name] !== "function") {
      return;
    }

    const original = target[name];
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        writable: true,
        value: replacement(original)
      });
    } catch {
      target[name] = replacement(original);
    }
  }

  function blockedScrollMethod(original) {
    return function antiScrollBlockedScrollMethod(...args) {
      if (shouldBlockScrollCall()) {
        return undefined;
      }

      return original.apply(this, args);
    };
  }

  patchMethod(root, "scroll", blockedScrollMethod);
  patchMethod(root, "scrollTo", blockedScrollMethod);
  patchMethod(root, "scrollBy", blockedScrollMethod);

  if (root.Element?.prototype) {
    patchMethod(root.Element.prototype, "scroll", blockedScrollMethod);
    patchMethod(root.Element.prototype, "scrollTo", blockedScrollMethod);
    patchMethod(root.Element.prototype, "scrollBy", blockedScrollMethod);
    patchMethod(root.Element.prototype, "scrollIntoView", blockedScrollMethod);
  }

  if (root.HTMLElement?.prototype) {
    patchMethod(root.HTMLElement.prototype, "focus", (original) => {
      return function antiScrollFocus(...args) {
        if (!shouldBlockScrollCall()) {
          return original.apply(this, args);
        }

        const firstArg = args[0];
        if (firstArg && typeof firstArg === "object") {
          return original.call(this, { ...firstArg, preventScroll: true });
        }

        return original.call(this, { preventScroll: true });
      };
    });
  }

  root.document?.addEventListener(REQUEST_EVENT_NAME, () => {
    if (state.tokenIssued) {
      return;
    }

    state.tokenIssued = true;
    root.document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT_NAME, {
        detail: { token }
      })
    );
  });

  root.document?.addEventListener(STATE_EVENT_NAME, (event) => {
    if (event.detail?.token !== token) {
      return;
    }

    state.locked = Boolean(event.detail.locked);
  });

  syncLockedFromAttribute();

  if (root.MutationObserver && root.document?.documentElement) {
    const observer = new MutationObserver(syncLockedFromAttribute);
    observer.observe(root.document.documentElement, {
      attributes: true,
      attributeFilter: ["data-anti-scroll-locked"]
    });
  }
})(globalThis);
