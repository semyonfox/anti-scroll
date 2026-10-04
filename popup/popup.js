(function startPopup(root) {
  "use strict";

  const config = root.AntiScrollConfig;
  const api = config.getApi();
  const PAUSE_MINUTES = 15;

  const state = {
    settings: config.DEFAULT_SETTINGS,
    analytics: config.EMPTY_ANALYTICS,
    registrationStatus: { missingOrigins: [], error: "" },
    tab: null,
    tabMatch: null,
    query: "",
    saveError: false,
    loadError: false,
    loading: true,
    saving: false,
    actionError: "",
    feedback: "",
  };

  const elements = {};

  function $(id) {
    return document.getElementById(id);
  }

  const { storageGet, storageSet } = config;

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        const result = api.runtime.sendMessage(message, (response) =>
          resolve(response || undefined),
        );
        if (result?.then) {
          result.then(resolve, () => resolve());
        }
      } catch {
        resolve();
      }
    });
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve, reject) => {
      const result = api.tabs.query(queryInfo, resolve);
      if (result?.then) {
        result.then(resolve, reject);
      }
    });
  }

  function requestPermissions(permissions) {
    if (!api.permissions?.request) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      try {
        const result = api.permissions.request(permissions, resolve);
        if (result?.then) {
          result.then(resolve, () => resolve(false));
        }
      } catch {
        resolve(false);
      }
    });
  }

  function neededCurrentOrigins() {
    if (state.settings.mode === config.MODES.ALL) {
      return config.ALL_SITE_MATCH_PATTERNS;
    }

    const host = currentHost();
    if (!host || !isCurrentCustomSelected()) {
      return [];
    }

    return config.getDomainMatchPatterns(host);
  }

  async function ensureHostPermission(origins) {
    if (!origins.length) {
      return true;
    }

    const granted = await requestPermissions({ origins });
    if (!granted) {
      state.actionError = "Permission was not granted. Your settings are unchanged. Try the action again to grant access.";
      root.AntiScrollTelemetry?.error("permission_failed");
      render();
    }
    return granted;
  }

  async function getActiveTab() {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function saveSettings(nextSettings) {
    if (state.loadError || state.loading) {
      return false;
    }
    if (state.saving) {
      render();
      return false;
    }

    const focused = document.activeElement;
    const focusId = focused?.id;
    const removeDomain = focused?.dataset?.removeDomain;
    const addDomain = focused?.dataset?.addDomain;
    const previousSettings = state.settings;
    const updatedSettings = config.sanitizeSettings(nextSettings);
    state.settings = updatedSettings;
    state.saveError = false;
    state.saving = true;
    state.actionError = "";
    state.feedback = "";
    render();
    try {
      await storageSet(api.storage.sync, {
        [config.SETTINGS_KEY]: updatedSettings,
      });
      state.feedback = "Settings saved.";
      return true;
    } catch {
      if (state.settings === updatedSettings) {
        state.settings = previousSettings;
        state.saveError = true;
        render();
      }
      root.AntiScrollTelemetry?.error("storage_failed");
      return false;
    } finally {
      state.saving = false;
      const restoreFocus = !document.activeElement ||
        document.activeElement === document.body ||
        document.activeElement === document.documentElement ||
        document.activeElement.id === focusId;
      render();
      if (restoreFocus && (focusId || removeDomain || addDomain)) {
        const target = focusId ? $(focusId) :
          Array.from(elements.siteList.querySelectorAll?.("button") || []).find(
            (button) => (removeDomain && button.dataset.removeDomain === removeDomain) ||
              (addDomain && button.dataset.addDomain === addDomain),
          );
        (target || elements.siteSearch).focus?.({ preventScroll: true });
      }
    }
  }

  function refreshMatch() {
    state.tabMatch = state.tab?.url
      ? config.matchShield(state.tab.url, state.settings)
      : { active: false, reason: "no-tab" };
  }

  function currentHost() {
    return state.tabMatch?.host || "";
  }

  function canUseCurrentHost() {
    return Boolean(currentHost() && state.tab?.url?.startsWith("http"));
  }

  function currentPausedUntil() {
    const host = currentHost();
    const until = host ? state.settings.pausedUntilByHost[host] : null;
    return typeof until === "number" && until > Date.now() ? until : null;
  }

  function currentPreset() {
    const host = currentHost();
    return (
      config.PRESETS.find((preset) =>
        preset.domains.some((domain) => config.domainMatches(host, domain)),
      ) || null
    );
  }

  function isCurrentCustomSelected() {
    const host = currentHost();
    return state.settings.customDomains.some((domain) =>
      config.domainMatches(host, domain),
    );
  }

  function isCurrentSelected() {
    const preset = currentPreset();
    return Boolean(
      isCurrentCustomSelected() ||
      (preset && state.settings.presets[preset.id] !== false),
    );
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function filteredItems() {
    const query = state.query.trim().toLowerCase();
    const items = [
      ...config.PRESETS.map((preset) => ({
        type: "preset",
        id: preset.id,
        label: preset.label,
        detail: preset.domains.join(", "),
        selected: state.settings.presets[preset.id] !== false,
      })),
      ...state.settings.customDomains.map((domain) => ({
        type: "custom",
        id: domain,
        label: domain,
        detail: "custom",
        selected: true,
      })),
    ];

    if (!query) {
      return items;
    }

    return items.filter((item) =>
      `${item.label} ${item.detail}`.toLowerCase().includes(query),
    );
  }

  function searchedDomain() {
    const query = state.query.trim();
    if (!query || query.includes(" ")) {
      return "";
    }
    const domain = config.normalizeDomainInput(query);
    if (!domain || (!domain.includes(".") && domain !== "localhost")) {
      return "";
    }
    return domain;
  }

  function isPresetDomain(domain) {
    return config.PRESETS.some((preset) =>
      preset.domains.some((presetDomain) =>
        config.domainMatches(domain, presetDomain),
      ),
    );
  }

  function renderStatus() {
    const match = state.tabMatch;
    elements.currentHost.textContent = currentHost() || "No web page selected";
    elements.statusPill.className = "pill";

    if (state.loading) {
      elements.statusPill.textContent = "Loading";
      elements.currentStatus.textContent = "Loading saved settings";
      return;
    }

    if (state.loadError) {
      elements.statusPill.textContent = "Load failed";
      elements.currentStatus.textContent = "Could not load settings";
      return;
    }

    if (state.saveError) {
      elements.statusPill.textContent = "Save failed";
      elements.currentStatus.textContent = "Could not save settings";
      return;
    }

    if (state.settings.mode === config.MODES.DISABLED) {
      elements.statusPill.textContent = "Off";
      elements.currentStatus.textContent = "Blocking is off";
      return;
    }

    if (state.registrationStatus.missingOrigins.length) {
      elements.statusPill.textContent = "Permission";
      elements.statusPill.classList.add("selected");
      elements.currentStatus.textContent = "Permission needed on this browser";
      return;
    }

    if (state.registrationStatus.error) {
      elements.statusPill.textContent = "Setup";
      elements.currentStatus.textContent = "Blocking setup needs attention";
      return;
    }

    if (match?.reason === "timer-ended") {
      elements.statusPill.textContent = "Ended";
      elements.currentStatus.textContent = "Timer ended";
      return;
    }

    if (match?.reason === "paused" && match.pausedUntil) {
      elements.statusPill.textContent = "Paused";
      elements.statusPill.classList.add("selected");
      elements.currentStatus.textContent = `Paused until ${formatTime(match.pausedUntil)}`;
      return;
    }

    if (match?.active) {
      elements.statusPill.textContent =
        match.type === "all"
          ? "All sites"
          : match.type === "custom"
            ? "Blocked"
            : "Feed";
      elements.statusPill.classList.add("blocked");
      elements.currentStatus.textContent =
        match.type === "all"
          ? "All sites are blocked"
          : match.type === "custom"
            ? "This site is blocked"
            : "Feed area is hidden";
      return;
    }

    if (match?.selected && match.reason === "not-feed-like") {
      elements.statusPill.textContent = "Selected";
      elements.statusPill.classList.add("selected");
      elements.currentStatus.textContent = "This page is allowed; its feed routes stay blocked";
      return;
    }

    elements.statusPill.textContent =
      state.settings.mode === config.MODES.ALL ? "All sites" : "Selected";
    elements.statusPill.classList.add("selected");
    elements.currentStatus.textContent =
      match?.reason === "messaging-page"
        ? "Messages are allowed"
        : "This page is allowed";
  }

  function renderModes() {
    elements.modeHint.textContent = state.settings.mode === config.MODES.ALL
      ? "All sites are blocked. You can still type in fields when allowed. Site selections do not limit this mode."
      : state.settings.mode === config.MODES.DISABLED
        ? "Blocking is off. Your site selections are kept for next time."
        : "Presets hide feeds; custom domains block the whole site.";
    for (const button of [
      elements.modeDisabled,
      elements.modeSelected,
      elements.modeAll,
    ]) {
      const active = button.dataset.mode === state.settings.mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function renderTimer() {
    const activeUntil = state.settings.activeUntil;
    if (activeUntil && activeUntil > Date.now()) {
      elements.timerStatus.textContent = `Running until ${formatTime(activeUntil)}`;
      elements.clearTimer.disabled = false;
      return;
    }

    elements.timerStatus.textContent = activeUntil
      ? "Timer ended"
      : state.settings.mode === config.MODES.DISABLED ? "Start also turns on Selected sites mode" : "No time limit. Blocking stays on until you turn it off.";
    elements.clearTimer.disabled = !activeUntil;
  }

  function renderCurrentButton() {
    elements.toggleCurrent.disabled = !canUseCurrentHost();
    elements.toggleCurrent.textContent = isCurrentSelected()
      ? "Remove site"
      : "Add site";
  }

  function renderPauseButton() {
    const pausedUntil = currentPausedUntil();
    const canPause =
      canUseCurrentHost() &&
      state.settings.mode !== config.MODES.DISABLED &&
      (state.settings.mode === config.MODES.ALL || isCurrentSelected());

    elements.pauseCurrent.disabled = !canPause;
    elements.pauseCurrent.textContent = pausedUntil
      ? "Resume"
      : `Pause ${PAUSE_MINUTES} min`;
    elements.pauseCurrent.title = pausedUntil
      ? `Resume ${currentHost()}`
      : `Pause ${currentHost()} for ${PAUSE_MINUTES} minutes`;
  }

  function renderPermissionButton() {
    const missing = state.registrationStatus.missingOrigins;
    elements.grantMissingPermission.hidden = !missing.length;
    elements.grantMissingPermission.disabled = !missing.length;
  }

  function createSiteRow(item) {
    const row = document.createElement("div");
    const checkbox = document.createElement("input");
    const text = document.createElement("label");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    const remove = document.createElement("button");
    const checkboxId = `site-${item.type}-${item.id}`;

    row.className = "site-row";
    row.setAttribute("role", "listitem");
    checkbox.type = "checkbox";
    checkbox.id = checkboxId;
    checkbox.checked = item.selected;
    checkbox.dataset.itemType = item.type;
    checkbox.dataset.itemId = item.id;
    checkbox.setAttribute(
      "aria-label",
      item.type === "custom" ? `Remove ${item.label} from selected sites` : item.label,
    );
    text.className = "site-label";
    text.htmlFor = checkboxId;
    title.textContent = item.label;
    detail.textContent = item.detail;
    text.append(title, detail);
    row.append(checkbox, text);

    if (item.type === "custom") {
      remove.type = "button";
      remove.className = "plain remove";
      remove.textContent = "x";
      remove.title = `Remove ${item.label}`;
      remove.setAttribute("aria-label", `Remove ${item.label}`);
      remove.dataset.removeDomain = item.id;
      row.append(remove);
    } else {
      row.append(document.createElement("span"));
    }

    return row;
  }

  function renderSiteList() {
    const focused = document.activeElement;
    const hadFocus = Boolean(focused && elements.siteList.contains?.(focused));
    const focusId = hadFocus ? focused.id : "";
    const removeDomain = hadFocus ? focused.dataset.removeDomain : "";
    const scrollTop = elements.siteList.scrollTop;
    const items = filteredItems();
    const fragment = document.createDocumentFragment();

    for (const item of items) {
      fragment.append(createSiteRow(item));
    }

    const domain = searchedDomain();
    const existingCustom = state.settings.customDomains.includes(domain);
    const existingPreset = isPresetDomain(domain);

    if (!items.length) {
      const empty = document.createElement("div");
      const text = document.createElement("span");
      empty.className = "empty-row";
      empty.setAttribute("role", "listitem");
      const query = state.query.trim();
      text.textContent = domain
        ? `No match for ${domain}`
        : `No matches for "${query}"`;
      empty.append(text);

      fragment.append(empty);
    }

    if (domain && !existingCustom && !existingPreset) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Add ${domain}`;
      button.dataset.addDomain = domain;
      const addRow = document.createElement("div");
      addRow.className = "empty-row";
      addRow.setAttribute("role", "listitem");
      addRow.append(button);
      fragment.append(addRow);
    }

    elements.siteList.replaceChildren(fragment);
    elements.siteList.scrollTop = scrollTop;
    if (hadFocus) {
      const replacement = focusId ? $(focusId) : Array.from(elements.siteList.querySelectorAll("button")).find((button) => button.dataset.removeDomain === removeDomain);
      (replacement || elements.siteSearch).focus({ preventScroll: true });
    }
    elements.searchResults.textContent = state.query ? `${items.length} matching sites${domain && !existingCustom && !existingPreset ? "; domain can be added" : ""}` : "";
  }

  function renderOptions() {
    elements.strictFeeds.checked = state.settings.strictFeeds;
    elements.allowEditableFields.checked = state.settings.allowEditableFields;
    elements.allowMessagingPages.checked = state.settings.allowMessagingPages;
    elements.anonymousTelemetryEnabled.checked = state.settings.anonymousTelemetryEnabled;
  }

  function renderFeedback() {
    elements.actionMessage.textContent = state.loadError
      ? "Could not load settings. Retry before making changes to keep your saved choices."
      : state.actionError || (state.saveError ? "Could not save settings. Your previous choices were restored. Try the action again." : "");
    elements.actionFeedback.textContent = state.saving ? "Saving settings..." : state.feedback;
    elements.retryLoad.hidden = !state.loadError;
    elements.retryLoad.disabled = state.loading;
    const unavailable = state.loading || state.loadError || state.saving;
    for (const id of ["modeDisabled", "modeSelected", "modeAll", "siteSearch", "durationMinutes", "startTimer", "selectAll", "clearSelected", "strictFeeds", "allowEditableFields", "allowMessagingPages", "resetStats"]) {
      elements[id].disabled = unavailable;
    }
    for (const control of elements.siteList.querySelectorAll?.("input, button") || []) control.disabled = unavailable;
    if (unavailable) for (const id of ["clearTimer", "pauseCurrent", "toggleCurrent", "grantMissingPermission"]) elements[id].disabled = true;
    elements.anonymousTelemetryEnabled.disabled = unavailable || !root.AntiScrollTelemetry?.configured;
  }

  function analyticsEntries(counts, labelForKey) {
    return Object.entries(counts)
      .map(([key, count]) => ({ key, count, label: labelForKey(key) }))
      .sort(
        (left, right) =>
          right.count - left.count || left.label.localeCompare(right.label),
      );
  }

  function siteLabel(site) {
    if (site === "custom") {
      return "Custom sites";
    }
    if (site === "all") {
      return "All sites";
    }
    return config.getPresetById(site)?.label || site;
  }

  function formatLastActivity(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return "No blocked activity yet";
    }

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? "No blocked activity yet"
      : `Last blocked ${date.toLocaleString()}`;
  }

  function appendAnalyticsGroup(fragment, label, entries) {
    const group = document.createElement("section");
    const heading = document.createElement("h3");
    const list = document.createElement("div");

    group.className = "analytics-group";
    heading.textContent = label;
    list.className = "analytics-list";
    list.setAttribute("role", "list");

    for (const entry of entries) {
      const row = document.createElement("div");
      const name = document.createElement("span");
      const count = document.createElement("strong");

      row.className = "analytics-row";
      row.setAttribute("role", "listitem");
      name.textContent = entry.label;
      count.textContent = entry.count.toLocaleString();
      row.append(name, count);
      list.append(row);
    }

    group.append(heading, list);
    fragment.append(group);
  }

  function renderStats() {
    elements.attemptTotal.textContent = `${state.analytics.total.toLocaleString()} blocked`;
    elements.analyticsLastAt.textContent = formatLastActivity(
      state.analytics.lastAt,
    );

    const siteEntries = analyticsEntries(state.analytics.bySite, siteLabel);
    const domainEntries = analyticsEntries(
      state.analytics.byDomain,
      (domain) => domain,
    );
    const fragment = document.createDocumentFragment();

    if (!siteEntries.length && !domainEntries.length) {
      const empty = document.createElement("p");
      empty.className = "analytics-empty";
      empty.textContent = "No site activity yet.";
      fragment.append(empty);
    } else {
      if (siteEntries.length) {
        appendAnalyticsGroup(fragment, "By site", siteEntries);
      }
      if (domainEntries.length) {
        appendAnalyticsGroup(fragment, "By domain", domainEntries);
      }
    }

    elements.analyticsBreakdown.replaceChildren(fragment);
  }

  function render() {
    refreshMatch();
    renderStatus();
    renderModes();
    renderTimer();
    renderCurrentButton();
    renderPauseButton();
    renderPermissionButton();
    renderSiteList();
    renderOptions();
    renderStats();
    renderFeedback();
  }

  async function setMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (
      mode === config.MODES.ALL &&
      !(await ensureHostPermission(config.ALL_SITE_MATCH_PATTERNS))
    ) {
      return;
    }

    await saveSettings({
      ...state.settings,
      mode,
    });
  }

  async function startTimer() {
    const minutes = Number(elements.durationMinutes.value);
    const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
    elements.durationMinutes.setAttribute("aria-invalid", String(!valid));
    if (!valid) {
      state.actionError = "Enter a whole number of minutes between 1 and 1440.";
      renderFeedback();
      elements.durationMinutes.focus();
      return;
    }
    elements.durationMinutes.value = String(minutes);
    await saveSettings({
      ...state.settings,
      mode:
        state.settings.mode === config.MODES.DISABLED
          ? config.MODES.SELECTED
          : state.settings.mode,
      activeUntil: Date.now() + minutes * 60 * 1000,
    });
  }

  async function clearTimer() {
    await saveSettings({
      ...state.settings,
      activeUntil: null,
    });
  }

  async function toggleCurrentSite() {
    const host = currentHost();
    if (!host) {
      return;
    }

    if (isCurrentCustomSelected()) {
      await saveSettings({
        ...state.settings,
        customDomains: state.settings.customDomains.filter(
          (domain) => !config.domainMatches(host, domain),
        ),
      });
      return;
    }

    const preset = currentPreset();
    if (preset && state.settings.presets[preset.id] !== false) {
      await saveSettings({
        ...state.settings,
        presets: {
          ...state.settings.presets,
          [preset.id]: false,
        },
      });
      return;
    }

    if (!(await ensureHostPermission(config.getDomainMatchPatterns(host)))) {
      return;
    }

    await saveSettings({
      ...state.settings,
      customDomains: config.uniqueDomains([
        ...state.settings.customDomains,
        host,
      ]),
    });
  }

  async function togglePauseCurrentSite() {
    const host = currentHost();
    if (!host) {
      return;
    }

    const pausedUntil = currentPausedUntil();
    const pausedUntilByHost = { ...state.settings.pausedUntilByHost };

    if (pausedUntil) {
      delete pausedUntilByHost[host];
    } else {
      pausedUntilByHost[host] = Date.now() + PAUSE_MINUTES * 60 * 1000;
    }

    await saveSettings({
      ...state.settings,
      pausedUntilByHost,
    });
  }

  async function grantMissingPermission() {
    const origins = state.registrationStatus.missingOrigins.length
      ? state.registrationStatus.missingOrigins
      : neededCurrentOrigins();
    if (!(await ensureHostPermission(origins))) {
      return;
    }

    await sendMessage({ type: "anti-scroll-sync-content-scripts" });
    state.actionError = "";
    state.saveError = false;
    state.feedback = "Permission granted. Checking site access...";
    renderFeedback();
  }

  async function toggleSite(event) {
    const checkbox = event.target.closest("input[type='checkbox']");
    if (!checkbox?.dataset.itemId) {
      return;
    }

    if (checkbox.dataset.itemType === "preset") {
      await saveSettings({
        ...state.settings,
        presets: {
          ...state.settings.presets,
          [checkbox.dataset.itemId]: checkbox.checked,
        },
      });
      return;
    }

    const domain = checkbox.dataset.itemId;
    await saveSettings({
      ...state.settings,
      customDomains: checkbox.checked
        ? config.uniqueDomains([...state.settings.customDomains, domain])
        : state.settings.customDomains.filter((item) => item !== domain),
    });
  }

  async function addCustomDomain(domain) {
    if (state.loading || state.loadError || state.saving) return;
    if (!(await ensureHostPermission(config.getDomainMatchPatterns(domain)))) {
      return;
    }

    const saved = await saveSettings({
      ...state.settings,
      customDomains: config.uniqueDomains([
        ...state.settings.customDomains,
        domain,
      ]),
    });
    if (!saved) return;
    elements.siteSearch.value = "";
    state.query = "";
    state.feedback = `Added ${domain} to Selected sites. Custom domains block the whole site.`;
    render();
    elements.siteSearch.focus();
  }

  async function clickSiteList(event) {
    const removeDomain = event.target.dataset.removeDomain;
    const addDomain = event.target.dataset.addDomain;

    if (removeDomain) {
      event.preventDefault();
      await saveSettings({
        ...state.settings,
        customDomains: state.settings.customDomains.filter(
          (domain) => domain !== removeDomain,
        ),
      });
      return;
    }

    if (addDomain) {
      await addCustomDomain(addDomain);
    }
  }

  async function selectAll() {
    await saveSettings({
      ...state.settings,
      presets: Object.fromEntries(
        config.PRESETS.map((preset) => [preset.id, true]),
      ),
    });
  }

  async function clearSelected() {
    await saveSettings({
      ...state.settings,
      presets: Object.fromEntries(
        config.PRESETS.map((preset) => [preset.id, false]),
      ),
      customDomains: [],
    });
  }

  async function toggleOption(event) {
    await saveSettings({
      ...state.settings,
      [event.currentTarget.id]: event.currentTarget.checked,
    });
  }

  async function resetStats() {
    const response = await sendMessage({ type: "anti-scroll-reset-analytics" });
    // no response means the write failed; keep the real numbers instead of flashing zeros
    if (!response?.analytics) {
      state.actionError = "Could not reset local activity. Your counts are unchanged. Try again.";
      root.AntiScrollTelemetry?.error("storage_failed");
      renderFeedback();
      return;
    }
    state.actionError = "";
    state.saveError = false;
    state.analytics = config.sanitizeAnalytics(response.analytics);
    renderStats();
    state.feedback = "Local activity reset.";
    renderFeedback();
  }

  async function loadInitialState() {
    const retryHadFocus = document.activeElement === elements.retryLoad;
    state.loading = true;
    render();
    try {
      const [storedSettings, storedAnalytics, storedStatus, tab] =
        await Promise.all([
          storageGet(api.storage.sync, {
            [config.SETTINGS_KEY]: config.DEFAULT_SETTINGS,
          }),
          storageGet(api.storage.local, {
            [config.ANALYTICS_KEY]: config.EMPTY_ANALYTICS,
          }),
          storageGet(api.storage.local, {
            [config.REGISTRATION_STATUS_KEY]: {
              missingOrigins: [],
              error: "",
            },
          }),
          getActiveTab(),
        ]);

      state.settings = config.sanitizeSettings(
        storedSettings[config.SETTINGS_KEY],
      );
      state.analytics = config.sanitizeAnalytics(
        storedAnalytics[config.ANALYTICS_KEY],
      );
      state.registrationStatus = sanitizeRegistrationStatus(
        storedStatus[config.REGISTRATION_STATUS_KEY],
      );
      state.tab = tab;
      state.loadError = false;
    } catch {
      state.loadError = true;
      root.AntiScrollTelemetry?.error("storage_failed");
    }
    state.loading = false;
    render();
    if (!state.loadError) {
      if (retryHadFocus) elements.modeSelected.focus({ preventScroll: true });
      root.AntiScrollTelemetry?.open();
    }
  }

  function sanitizeRegistrationStatus(status) {
    return {
      missingOrigins: Array.isArray(status?.missingOrigins)
        ? status.missingOrigins.filter((origin) => typeof origin === "string")
        : [],
      error: typeof status?.error === "string" ? status.error : "",
    };
  }

  function bindElements() {
    for (const id of [
      "currentHost",
      "statusPill",
      "modeDisabled",
      "modeSelected",
      "modeAll",
      "durationMinutes",
      "startTimer",
      "clearTimer",
      "timerStatus",
      "currentStatus",
      "grantMissingPermission",
      "pauseCurrent",
      "toggleCurrent",
      "siteSearch",
      "selectAll",
      "clearSelected",
      "siteList",
      "strictFeeds",
      "allowEditableFields",
      "allowMessagingPages",
      "analyticsLastAt",
      "analyticsBreakdown",
      "attemptTotal",
      "resetStats",
      "modeHint",
      "actionMessage",
      "actionFeedback",
      "retryLoad",
      "searchResults",
      "anonymousTelemetryEnabled",
    ]) {
      elements[id] = $(id);
    }
  }

  function bindEvents() {
    for (const button of [
      elements.modeDisabled,
      elements.modeSelected,
      elements.modeAll,
    ]) {
      button.addEventListener("click", setMode);
    }

    elements.startTimer.addEventListener("click", startTimer);
    elements.retryLoad.addEventListener("click", loadInitialState);
    elements.anonymousTelemetryEnabled.addEventListener("change", toggleOption);
    elements.durationMinutes.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      await startTimer();
    });
    elements.clearTimer.addEventListener("click", clearTimer);
    elements.grantMissingPermission.addEventListener(
      "click",
      grantMissingPermission,
    );
    elements.pauseCurrent.addEventListener("click", togglePauseCurrentSite);
    elements.toggleCurrent.addEventListener("click", toggleCurrentSite);
    elements.siteSearch.addEventListener("input", () => {
      elements.siteSearch.setAttribute("aria-invalid", "false");
      state.actionError = "";
      renderFeedback();
      state.query = elements.siteSearch.value;
      renderSiteList();
    });
    elements.siteSearch.addEventListener("keydown", async (event) => {
      if (event.key === "Escape" && elements.siteSearch.value) {
        elements.siteSearch.value = "";
        state.query = "";
        renderSiteList();
        return;
      }

      if (event.key === "ArrowDown") {
        const first = elements.siteList.querySelector(
          "input[type='checkbox'], button",
        );
        if (first) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      const domain = searchedDomain();
      if (
        !domain ||
        state.settings.customDomains.includes(domain) ||
        isPresetDomain(domain)
      ) {
        if (!domain) {
          state.actionError = "Enter a domain such as example.com, or select a site from the results.";
          elements.siteSearch.setAttribute("aria-invalid", "true");
          renderFeedback();
        }
        return;
      }

      event.preventDefault();
      await addCustomDomain(domain);
    });
    elements.siteList.addEventListener("change", toggleSite);
    elements.siteList.addEventListener("click", clickSiteList);
    elements.selectAll.addEventListener("click", selectAll);
    elements.clearSelected.addEventListener("click", clearSelected);
    elements.strictFeeds.addEventListener("change", toggleOption);
    elements.allowEditableFields.addEventListener("change", toggleOption);
    elements.allowMessagingPages.addEventListener("change", toggleOption);
    elements.resetStats.addEventListener("click", resetStats);

    api.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes[config.SETTINGS_KEY]) {
        state.settings = config.sanitizeSettings(
          changes[config.SETTINGS_KEY].newValue,
        );
        render();
        return;
      }

      if (areaName === "local" && changes[config.REGISTRATION_STATUS_KEY]) {
        state.registrationStatus = sanitizeRegistrationStatus(
          changes[config.REGISTRATION_STATUS_KEY].newValue,
        );
        render();
      }

      if (areaName === "local" && changes[config.ANALYTICS_KEY]) {
        state.analytics = config.sanitizeAnalytics(
          changes[config.ANALYTICS_KEY].newValue,
        );
        renderStats();
      }
    });

    setInterval(() => {
      refreshMatch();
      renderStatus();
      renderTimer();
      renderPauseButton();
      renderFeedback();
    }, 15000);
  }

  if (!api?.storage || !api?.tabs) {
    document.body.textContent =
      "This browser does not expose extension storage.";
    return;
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindElements();
    bindEvents();
    loadInitialState();
  });
})(globalThis);
