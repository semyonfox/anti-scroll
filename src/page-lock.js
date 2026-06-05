(function installAntiScrollPageLock(root) {
  "use strict";

  const EVENT_NAME = "anti-scroll-main-lock-state";
  const state = {
    locked: false,
    restoring: false
  };

  function shouldBlockScrollCall() {
    return state.locked && !state.restoring;
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

  root.document?.addEventListener(EVENT_NAME, (event) => {
    state.locked = Boolean(event.detail?.locked);
  });
})(globalThis);
