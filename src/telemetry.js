(function configureDiagnostics(root) {
  "use strict";

  // configure only after the self-hosted collector and its access policy are approved
  const endpoint = "";
  const config = root.AntiScrollConfig;
  const api = config.getApi();
  let allowedEndpoint = null;
  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/v1/events") allowedEndpoint = url;
  } catch {}

  let enabled = false;
  let preferenceVersion = 0;
  let inFlight = false;
  let total = 0;
  let windowStart = 0;
  let windowCount = 0;
  const errors = new Map();
  const errorNames = new Set(["storage_failed", "permission_failed"]);

  function privacyAllows() {
    try {
      return root.navigator.globalPrivacyControl !== true &&
        root.navigator.doNotTrack !== "1" && root.navigator.doNotTrack !== "yes" &&
        root.doNotTrack !== "1";
    } catch { return false; }
  }

  api?.storage?.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[config.SETTINGS_KEY]) {
      preferenceVersion += 1;
      enabled = changes[config.SETTINGS_KEY].newValue?.anonymousTelemetryEnabled === true;
    }
  });

  function hasPermission() {
    return new Promise((resolve) => {
      try {
        if (!api.permissions?.contains) { resolve(false); return; }
        const finish = (granted) => {
          try { resolve(!api.runtime.lastError && granted === true); }
          catch { resolve(false); }
        };
        const result = api.permissions.contains({ origins: [`${allowedEndpoint.origin}/*`] }, finish);
        if (result?.then) result.then(finish, () => resolve(false));
      } catch { resolve(false); }
    });
  }

  async function emit(kind, name) {
    if (!allowedEndpoint || inFlight || total >= 200 || !privacyAllows()) return;
    inFlight = true;
    let timeout = null;
    try {
      if (!(await hasPermission()) || !privacyAllows()) return;
      // reread the boolean before every send, including after another popup changes it
      const version = preferenceVersion;
      const stored = await config.storageGet(api.storage.sync, { [config.SETTINGS_KEY]: {} });
      if (version !== preferenceVersion) return;
      enabled = stored[config.SETTINGS_KEY]?.anonymousTelemetryEnabled === true;
      if (!enabled || !privacyAllows()) return;
      const now = Date.now();
      if (now - windowStart >= 60000) { windowStart = now; windowCount = 0; }
      if (windowCount >= 20 || (kind === "error" && errors.has(name) && now - errors.get(name) < 60000)) return;
      const controller = new root.AbortController();
      timeout = root.setTimeout(() => { try { controller.abort(); } catch {} }, 2000);
      if (!enabled || !privacyAllows()) return;
      total += 1;
      windowCount += 1;
      if (kind === "error") errors.set(name, now);
      await root.fetch(allowedEndpoint.href, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, app: "anti-scroll", kind, name, surface: "extension", route: "popup" }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      // diagnostics must never interrupt blocking or settings recovery
    } finally {
      if (timeout !== null) { try { root.clearTimeout(timeout); } catch {} }
      inFlight = false;
    }
  }

  root.AntiScrollTelemetry = Object.freeze({
    configured: Boolean(allowedEndpoint),
    open() { void emit("count", "app_open").catch(() => {}); },
    error(name) { if (errorNames.has(name)) void emit("error", name).catch(() => {}); },
  });
})(globalThis);
