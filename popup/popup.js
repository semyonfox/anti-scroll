(function startPopup(root) {
  "use strict";

  const config = root.AntiScrollConfig;
  const api = config.getApi();

  const state = {
    settings: config.DEFAULT_SETTINGS,
    analytics: config.EMPTY_ANALYTICS,
    tab: null,
    tabMatch: null,
    query: ""
  };

  const elements = {};

  function $(id) {
    return document.getElementById(id);
  }

  function storageGet(area, defaults) {
    return new Promise((resolve) => {
      const result = area.get(defaults, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function storageSet(area, value) {
    return new Promise((resolve) => {
      const result = area.set(value, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      const result = api.runtime.sendMessage(message, (response) => resolve(response));
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve) => {
      const result = api.tabs.query(queryInfo, resolve);
      if (result?.then) {
        result.then(resolve);
      }
    });
  }

  async function getActiveTab() {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function saveSettings(nextSettings) {
    state.settings = config.sanitizeSettings(nextSettings);
    await storageSet(api.storage.sync, {
      [config.SETTINGS_KEY]: state.settings
    });
    refreshMatch();
    render();
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

  function currentPreset() {
    const host = currentHost();
    return (
      config.PRESETS.find((preset) =>
        preset.domains.some((domain) => config.domainMatches(host, domain))
      ) || null
    );
  }

  function isCurrentCustomSelected() {
    const host = currentHost();
    return state.settings.customDomains.some((domain) =>
      config.domainMatches(host, domain)
    );
  }

  function isCurrentSelected() {
    const preset = currentPreset();
    return Boolean(
      isCurrentCustomSelected() ||
        (preset && state.settings.presets[preset.id] !== false)
    );
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
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
        selected: state.settings.presets[preset.id] !== false
      })),
      ...state.settings.customDomains.map((domain) => ({
        type: "custom",
        id: domain,
        label: domain,
        detail: "custom",
        selected: true
      }))
    ];

    if (!query) {
      return items;
    }

    return items.filter((item) =>
      `${item.label} ${item.detail}`.toLowerCase().includes(query)
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
      preset.domains.some((presetDomain) => config.domainMatches(domain, presetDomain))
    );
  }

  function renderStatus() {
    const match = state.tabMatch;
    elements.currentHost.textContent = currentHost() || "No web page selected";
    elements.statusPill.className = "pill";

    if (state.settings.mode === config.MODES.DISABLED) {
      elements.statusPill.textContent = "Off";
      elements.currentStatus.textContent = "Blocking is off";
      return;
    }

    if (match?.reason === "timer-ended") {
      elements.statusPill.textContent = "Ended";
      elements.currentStatus.textContent = "Timer ended";
      return;
    }

    if (match?.active) {
      elements.statusPill.textContent =
        match.type === "all"
          ? "All Sites"
          : match.type === "custom"
            ? "Blocked"
            : "Feed";
      elements.statusPill.classList.add("blocked");
      elements.currentStatus.textContent =
        match.type === "all"
          ? "All sites are blocked"
          : match.type === "custom"
            ? "This site is blocked"
            : "This feed is blocked";
      return;
    }

    if (match?.selected && match.reason === "not-feed-like") {
      elements.statusPill.textContent = "Selected";
      elements.statusPill.classList.add("selected");
      elements.currentStatus.textContent = "Feed pages are blocked";
      return;
    }

    elements.statusPill.textContent =
      state.settings.mode === config.MODES.ALL ? "All Sites" : "Selected";
    elements.statusPill.classList.add("selected");
    elements.currentStatus.textContent =
      match?.reason === "messaging-page"
        ? "Messages are allowed"
        : "This page is allowed";
  }

  function renderModes() {
    for (const button of [
      elements.modeDisabled,
      elements.modeSelected,
      elements.modeAll
    ]) {
      button.classList.toggle("active", button.dataset.mode === state.settings.mode);
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
      : "No timer set";
    elements.clearTimer.disabled = !activeUntil;
  }

  function renderCurrentButton() {
    elements.toggleCurrent.disabled = !canUseCurrentHost();
    elements.toggleCurrent.textContent = isCurrentSelected()
      ? "Remove Site"
      : "Add Site";
  }

  function createSiteRow(item) {
    const row = document.createElement("label");
    const checkbox = document.createElement("input");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    const remove = document.createElement("button");

    row.className = "site-row";
    row.setAttribute("role", "listitem");
    checkbox.type = "checkbox";
    checkbox.checked = item.selected;
    checkbox.dataset.itemType = item.type;
    checkbox.dataset.itemId = item.id;
    title.textContent = item.label;
    detail.textContent = item.detail;
    text.append(title, detail);
    row.append(checkbox, text);

    if (item.type === "custom") {
      remove.type = "button";
      remove.className = "plain remove";
      remove.textContent = "x";
      remove.title = `Remove ${item.label}`;
      remove.dataset.removeDomain = item.id;
      row.append(remove);
    } else {
      row.append(document.createElement("span"));
    }

    return row;
  }

  function renderSiteList() {
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
      text.textContent = domain
        ? `No match for ${domain}`
        : "No matching sites";
      empty.append(text);

      if (domain && !existingCustom && !existingPreset) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `Add ${domain}`;
        button.dataset.addDomain = domain;
        empty.append(button);
      }

      fragment.append(empty);
    }

    elements.siteList.replaceChildren(fragment);
  }

  function renderOptions() {
    elements.strictFeeds.checked = state.settings.strictFeeds;
    elements.allowEditableFields.checked = state.settings.allowEditableFields;
    elements.allowMessagingPages.checked = state.settings.allowMessagingPages;
  }

  function renderStats() {
    elements.attemptTotal.textContent = `${state.analytics.total.toLocaleString()} blocked`;
  }

  function render() {
    refreshMatch();
    renderStatus();
    renderModes();
    renderTimer();
    renderCurrentButton();
    renderSiteList();
    renderOptions();
    renderStats();
  }

  async function setMode(event) {
    await saveSettings({
      ...state.settings,
      mode: event.currentTarget.dataset.mode
    });
  }

  async function startTimer() {
    const minutes = Math.max(
      1,
      Math.min(1440, Number.parseInt(elements.durationMinutes.value, 10) || 30)
    );
    elements.durationMinutes.value = String(minutes);
    await saveSettings({
      ...state.settings,
      mode:
        state.settings.mode === config.MODES.DISABLED
          ? config.MODES.SELECTED
          : state.settings.mode,
      activeUntil: Date.now() + minutes * 60 * 1000
    });
  }

  async function clearTimer() {
    await saveSettings({
      ...state.settings,
      activeUntil: null
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
          (domain) => !config.domainMatches(host, domain)
        )
      });
      return;
    }

    const preset = currentPreset();
    if (preset && state.settings.presets[preset.id] !== false) {
      await saveSettings({
        ...state.settings,
        presets: {
          ...state.settings.presets,
          [preset.id]: false
        }
      });
      return;
    }

    await saveSettings({
      ...state.settings,
      customDomains: config.uniqueDomains([...state.settings.customDomains, host])
    });
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
          [checkbox.dataset.itemId]: checkbox.checked
        }
      });
      return;
    }

    const domain = checkbox.dataset.itemId;
    await saveSettings({
      ...state.settings,
      customDomains: checkbox.checked
        ? config.uniqueDomains([...state.settings.customDomains, domain])
        : state.settings.customDomains.filter((item) => item !== domain)
    });
  }

  async function addCustomDomain(domain) {
    await saveSettings({
      ...state.settings,
      customDomains: config.uniqueDomains([
        ...state.settings.customDomains,
        domain
      ])
    });
    elements.siteSearch.value = "";
    state.query = "";
    render();
  }

  async function clickSiteList(event) {
    const removeDomain = event.target.dataset.removeDomain;
    const addDomain = event.target.dataset.addDomain;

    if (removeDomain) {
      event.preventDefault();
      await saveSettings({
        ...state.settings,
        customDomains: state.settings.customDomains.filter(
          (domain) => domain !== removeDomain
        )
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
        config.PRESETS.map((preset) => [preset.id, true])
      )
    });
  }

  async function clearSelected() {
    await saveSettings({
      ...state.settings,
      presets: Object.fromEntries(
        config.PRESETS.map((preset) => [preset.id, false])
      ),
      customDomains: []
    });
  }

  async function toggleOption(event) {
    await saveSettings({
      ...state.settings,
      [event.currentTarget.id]: event.currentTarget.checked
    });
  }

  async function resetStats() {
    const response = await sendMessage({ type: "anti-scroll-reset-analytics" });
    state.analytics = config.sanitizeAnalytics(response?.analytics);
    renderStats();
  }

  async function loadInitialState() {
    const [storedSettings, storedAnalytics, tab] = await Promise.all([
      storageGet(api.storage.sync, {
        [config.SETTINGS_KEY]: config.DEFAULT_SETTINGS
      }),
      storageGet(api.storage.local, {
        [config.ANALYTICS_KEY]: config.EMPTY_ANALYTICS
      }),
      getActiveTab()
    ]);

    state.settings = config.sanitizeSettings(storedSettings[config.SETTINGS_KEY]);
    state.analytics = config.sanitizeAnalytics(
      storedAnalytics[config.ANALYTICS_KEY]
    );
    state.tab = tab;
    render();
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
      "toggleCurrent",
      "siteSearch",
      "selectAll",
      "clearSelected",
      "siteList",
      "strictFeeds",
      "allowEditableFields",
      "allowMessagingPages",
      "attemptTotal",
      "resetStats"
    ]) {
      elements[id] = $(id);
    }
  }

  function bindEvents() {
    for (const button of [
      elements.modeDisabled,
      elements.modeSelected,
      elements.modeAll
    ]) {
      button.addEventListener("click", setMode);
    }

    elements.startTimer.addEventListener("click", startTimer);
    elements.clearTimer.addEventListener("click", clearTimer);
    elements.toggleCurrent.addEventListener("click", toggleCurrentSite);
    elements.siteSearch.addEventListener("input", () => {
      state.query = elements.siteSearch.value;
      renderSiteList();
    });
    elements.siteSearch.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      const domain = searchedDomain();
      if (
        !domain ||
        state.settings.customDomains.includes(domain) ||
        isPresetDomain(domain)
      ) {
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
      if (areaName !== "sync" || !changes[config.SETTINGS_KEY]) {
        return;
      }

      state.settings = config.sanitizeSettings(
        changes[config.SETTINGS_KEY].newValue
      );
      render();
    });

    setInterval(renderTimer, 15000);
  }

  if (!api?.storage || !api?.tabs) {
    document.body.textContent = "This browser does not expose extension storage.";
    return;
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindElements();
    bindEvents();
    loadInitialState();
  });
})(globalThis);
