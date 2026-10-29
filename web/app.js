const PROVIDER_ORDER = [
  "KT", "LG", "SK", "DAUM", "NAVER", "TVING", "WAVVE", "SPOTV", "KBS", "MBC", "SBS",
];
const DEFAULT_ID_FORMAT = "{ServiceId}.{Source.lower()}";
const IDLE_POLL_MS = 10000;
const BUSY_POLL_MS = 1500;
const LS_KPI = "ko-epggrab.kpi-collapsed";
const LS_SELECTED_ONLY = "ko-epggrab.selected-only";
const LS_PROVIDER = "ko-epggrab.active-provider";
const TAB_KEYS = { "1": "channels", "2": "settings", "3": "logs" };

const state = {
  status: null,
  config: null,
  savedSelection: new Set(),
  selection: new Set(),
  channelsByProvider: {},
  channelsFlat: [],
  channelsExists: false,
  activeProvider: null,
  activeCategory: "전체",
  search: "",
  selectedOnly: false,
  kpiCollapsed: false,
  lastShiftIndex: null,
  lastVisibleRows: [],
  pollTimer: null,
  wasBusy: false,
  logsFollow: true,
};

const $ = (id) => document.getElementById(id);

function channelKey(provider, serviceId) {
  return `${provider}::${String(serviceId)}`;
}

function categoryLabel(cat) {
  return cat && String(cat).trim() ? cat : "미분류";
}

function providerAbbrev(provider) {
  if (!provider) return "?";
  if (provider.length <= 2) return provider;
  return provider.slice(0, 2);
}

function formatBytes(n) {
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return formatTime(iso);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금 전";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}시간 전`;
  return formatTime(iso);
}

function toast(message, ok = true) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("is-ok", ok);
  el.classList.toggle("is-err", !ok);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 4200);
}

function setBusyButtons(busy) {
  const fetchBtn = $("btn-fetch");
  const genBtn = $("btn-generate");
  fetchBtn.disabled = busy;
  genBtn.disabled = busy;
  fetchBtn.classList.toggle("is-loading", busy && state.status?.state === "fetching_channels");
  genBtn.classList.toggle("is-loading", busy && state.status?.state === "generating_xmltv");
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function selectionFromConfig(cfg) {
  const set = new Set();
  const selected = (cfg && cfg.selected_channels) || {};
  for (const [provider, channels] of Object.entries(selected)) {
    for (const ch of channels || []) {
      set.add(channelKey(provider, ch.ServiceId));
    }
  }
  return set;
}

function configFromSelection(baseCfg, selection) {
  const selected = {};
  for (const ch of state.channelsFlat) {
    const key = channelKey(ch.provider, ch.ServiceId);
    if (!selection.has(key)) continue;
    if (!selected[ch.provider]) selected[ch.provider] = [];
    selected[ch.provider].push({
      Name: ch.Name,
      No: ch.No || undefined,
      ServiceId: ch.ServiceId,
      Category: ch.Category || "",
      Icon_url: ch.Icon_url || undefined,
      Id: ch.Id,
    });
  }
  // Preserve previously saved channels that are not in the current DB
  // (e.g. temporarily missing after a fetch).
  const prev = (baseCfg && baseCfg.selected_channels) || {};
  for (const [provider, channels] of Object.entries(prev)) {
    for (const ch of channels || []) {
      const key = channelKey(provider, ch.ServiceId);
      if (!selection.has(key)) continue;
      const already = (selected[provider] || []).some(
        (x) => String(x.ServiceId) === String(ch.ServiceId),
      );
      if (already) continue;
      if (!selected[provider]) selected[provider] = [];
      selected[provider].push(ch);
    }
  }
  return {
    ...baseCfg,
    selected_channels: selected,
  };
}

function isDirty() {
  if (state.selection.size !== state.savedSelection.size) return true;
  for (const k of state.selection) {
    if (!state.savedSelection.has(k)) return true;
  }
  return false;
}

function updateDirtyBar() {
  const bar = $("dirty-bar");
  const dirty = isDirty();
  bar.hidden = !dirty;
  if (dirty) {
    $("dirty-message").textContent =
      `저장되지 않은 변경사항이 있습니다 (선택된 채널: ${state.savedSelection.size}개 → ${state.selection.size}개)`;
  }
  $("tab-selected-count").textContent = String(state.selection.size);
  $("selected-only-count").textContent = String(state.selection.size);
}

function flattenChannels(providersObj) {
  const flat = [];
  const byProvider = {};
  for (const [provider, result] of Object.entries(providersObj || {})) {
    const list = (result && result.CHANNELS) || [];
    byProvider[provider] = list.map((ch) => ({ ...ch, provider }));
    for (const ch of list) {
      flat.push({ ...ch, provider });
    }
  }
  return { flat, byProvider };
}

function providerCounts() {
  const totals = {};
  const selected = {};
  for (const ch of state.channelsFlat) {
    totals[ch.provider] = (totals[ch.provider] || 0) + 1;
  }
  for (const key of state.selection) {
    const provider = key.split("::")[0];
    selected[provider] = (selected[provider] || 0) + 1;
  }
  return { totals, selected };
}

function pickDefaultProvider() {
  const { selected } = providerCounts();
  for (const p of PROVIDER_ORDER) {
    if ((selected[p] || 0) > 0 && state.channelsByProvider[p]) return p;
  }
  for (const p of PROVIDER_ORDER) {
    if (state.channelsByProvider[p]) return p;
  }
  return Object.keys(state.channelsByProvider)[0] || null;
}

function filteredChannels() {
  const q = state.search.trim().toLowerCase();
  return state.channelsFlat.filter((ch) => {
    if (state.activeProvider && ch.provider !== state.activeProvider) return false;
    if (state.selectedOnly && !state.selection.has(channelKey(ch.provider, ch.ServiceId))) {
      return false;
    }
    if (state.activeCategory !== "전체") {
      if (categoryLabel(ch.Category) !== state.activeCategory) return false;
    }
    if (!q) return true;
    const hay = `${ch.Name || ""} ${ch.No || ""} ${ch.ServiceId || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function categoriesForActiveProvider() {
  const counts = new Map();
  for (const ch of state.channelsFlat) {
    if (state.activeProvider && ch.provider !== state.activeProvider) continue;
    if (state.selectedOnly && !state.selection.has(channelKey(ch.provider, ch.ServiceId))) continue;
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      const hay = `${ch.Name || ""} ${ch.No || ""} ${ch.ServiceId || ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const label = categoryLabel(ch.Category);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const names = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, "ko"));
  const total = names.reduce((sum, n) => sum + counts.get(n), 0);
  return [{ name: "전체", count: total }, ...names.map((name) => ({ name, count: counts.get(name) }))];
}

function updateVisibleCounts(rows) {
  const selectedInView = rows.filter((ch) =>
    state.selection.has(channelKey(ch.provider, ch.ServiceId)),
  ).length;
  $("visible-count").textContent = `표시 ${rows.length.toLocaleString("ko-KR")}`;
  $("visible-selected-count").textContent = `이 목록 ${selectedInView.toLocaleString("ko-KR")}개 선택`;
  const header = $("header-check");
  if (!header) return;
  if (rows.length === 0) {
    header.checked = false;
    header.indeterminate = false;
    return;
  }
  header.checked = selectedInView === rows.length;
  header.indeterminate = selectedInView > 0 && selectedInView < rows.length;
}

function applyKpiCollapsed(collapsed) {
  state.kpiCollapsed = collapsed;
  document.querySelector(".shell")?.classList.toggle("is-kpi-collapsed", collapsed);
  const btn = $("btn-toggle-kpi");
  if (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    $("kpi-toggle-label").textContent = collapsed ? "요약 펼치기" : "요약 접기";
  }
  try {
    localStorage.setItem(LS_KPI, collapsed ? "1" : "0");
  } catch (_) { /* ignore */ }
}

function persistViewPrefs() {
  try {
    localStorage.setItem(LS_SELECTED_ONLY, state.selectedOnly ? "1" : "0");
    if (state.activeProvider) localStorage.setItem(LS_PROVIDER, state.activeProvider);
    else localStorage.removeItem(LS_PROVIDER);
  } catch (_) { /* ignore */ }
}

function restoreViewPrefs() {
  try {
    applyKpiCollapsed(localStorage.getItem(LS_KPI) === "1");
    state.selectedOnly = localStorage.getItem(LS_SELECTED_ONLY) === "1";
    const savedProvider = localStorage.getItem(LS_PROVIDER);
    if (savedProvider) state.activeProvider = savedProvider;
  } catch (_) { /* ignore */ }
}

function patchRowSelection(tr, selected) {
  if (!tr) return;
  tr.classList.toggle("is-selected", selected);
  const cb = tr.querySelector("input.row-check");
  if (cb) cb.checked = selected;
}

function refreshSelectionChrome(rows = state.lastVisibleRows) {
  renderProviders();
  updateDirtyBar();
  renderStatusSelected();
  updateVisibleCounts(rows || []);
}

function renderProviders() {
  const root = $("provider-list");
  const { totals, selected } = providerCounts();
  const allTotal = state.channelsFlat.length;
  const allSelected = state.selection.size;

  const items = [
    { id: null, label: "전체", sel: allSelected, total: allTotal },
    ...PROVIDER_ORDER.filter((p) => totals[p]).map((p) => ({
      id: p,
      label: p,
      sel: selected[p] || 0,
      total: totals[p] || 0,
    })),
  ];

  // Include unknown providers not in the fixed order.
  for (const p of Object.keys(totals)) {
    if (!PROVIDER_ORDER.includes(p)) {
      items.push({ id: p, label: p, sel: selected[p] || 0, total: totals[p] || 0 });
    }
  }

  root.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "provider-btn" + ((state.activeProvider === item.id) ? " is-active" : "");
    btn.innerHTML = `<span>${item.label}</span><span class="provider-badge ${item.sel ? "has-selected" : ""}">${item.sel}/${item.total}</span>`;
    btn.addEventListener("click", () => {
      state.activeProvider = item.id;
      state.activeCategory = "전체";
      persistViewPrefs();
      renderProviders();
      renderCategoryChips();
      renderTable();
    });
    frag.appendChild(btn);
  }
  root.appendChild(frag);
}

function renderCategoryChips() {
  const root = $("category-chips");
  root.innerHTML = "";
  for (const cat of categoriesForActiveProvider()) {
    const active = state.activeCategory === cat.name;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (active ? " is-active" : "");
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.innerHTML = `${escapeHTML(cat.name)}<span class="chip-count">${cat.count}</span>`;
    btn.addEventListener("click", () => {
      state.activeCategory = cat.name;
      renderCategoryChips();
      renderTable();
    });
    root.appendChild(btn);
  }
}

function iconHTML(ch) {
  const abbrev = providerAbbrev(ch.provider);
  if (ch.Icon_url) {
    return `<img class="ch-icon" src="${escapeAttr(ch.Icon_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ch-fallback',textContent:'${abbrev}'}))" />`;
  }
  return `<span class="ch-fallback">${abbrev}</span>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderTable() {
  const tbody = $("channel-tbody");
  const empty = $("channels-empty");
  if (!state.channelsExists) {
    empty.classList.remove("hidden");
    tbody.innerHTML = "";
    state.lastVisibleRows = [];
    updateVisibleCounts([]);
    return;
  }
  empty.classList.add("hidden");

  const rows = filteredChannels();
  state.lastVisibleRows = rows;
  updateVisibleCounts(rows);

  const frag = document.createDocumentFragment();
  rows.forEach((ch, index) => {
    const key = channelKey(ch.provider, ch.ServiceId);
    const checked = state.selection.has(key);
    const tr = document.createElement("tr");
    tr.dataset.key = key;
    tr.dataset.index = String(index);
    if (checked) tr.classList.add("is-selected");
    const no = ch.No ? `<span class="no-badge">Ch. ${escapeHTML(ch.No)}</span>` : "";
    const cat = categoryLabel(ch.Category);
    tr.innerHTML = `
      <td class="col-check"><input class="row-check" type="checkbox" ${checked ? "checked" : ""} tabindex="-1" aria-label="${escapeAttr(ch.Name || "채널")} 선택" /></td>
      <td class="col-icon">${iconHTML(ch)}</td>
      <td>
        <div class="ch-name">${escapeHTML(ch.Name || "")}</div>
        <div class="ch-meta-mobile">${escapeHTML(ch.provider)} · ${escapeHTML(cat)} · ${escapeHTML(String(ch.ServiceId))}</div>
      </td>
      <td class="col-no">${no}</td>
      <td class="col-provider"><span class="tag">${escapeHTML(ch.provider)}</span></td>
      <td class="col-category"><span class="tag">${escapeHTML(cat)}</span></td>
      <td class="col-id">${escapeHTML(String(ch.ServiceId))}</td>
    `;
    tr.addEventListener("click", (e) => onRowClick(e, rows, index, key));
    frag.appendChild(tr);
  });
  tbody.innerHTML = "";
  tbody.appendChild(frag);
}

function onRowClick(e, rows, index, key) {
  e.preventDefault();
  const wantSelect = !state.selection.has(key);
  const touched = [];
  if (e.shiftKey && state.lastShiftIndex != null) {
    const from = Math.min(state.lastShiftIndex, index);
    const to = Math.max(state.lastShiftIndex, index);
    for (let i = from; i <= to; i += 1) {
      const ch = rows[i];
      const k = channelKey(ch.provider, ch.ServiceId);
      if (wantSelect) state.selection.add(k);
      else state.selection.delete(k);
      touched.push(k);
    }
  } else if (wantSelect) {
    state.selection.add(key);
    touched.push(key);
  } else {
    state.selection.delete(key);
    touched.push(key);
  }
  state.lastShiftIndex = index;

  const tbody = $("channel-tbody");
  for (const k of touched) {
    const tr = tbody.querySelector(`tr[data-key="${CSS.escape(k)}"]`);
    patchRowSelection(tr, state.selection.has(k));
  }
  refreshSelectionChrome(rows);
  if (state.selectedOnly) renderTable();
}

function renderStatusSelected() {
  $("stat-selected-primary").textContent = `${state.selection.size}개 채널 활성`;
  const { selected } = providerCounts();
  const pills = Object.entries(selected)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `<span class="provider-pill">${escapeHTML(p)} ${n}</span>`)
    .join("");
  $("stat-selected-secondary").innerHTML = pills || "선택된 채널 없음";
}

function renderStatus(status) {
  state.status = status;
  const badge = $("status-badge");
  const text = badge.querySelector(".status-text");
  const busy = status.state !== "idle";
  badge.classList.toggle("is-busy", busy);
  badge.classList.toggle("is-idle", !busy);
  if (status.state === "fetching_channels") text.textContent = "채널 DB 갱신 중...";
  else if (status.state === "generating_xmltv") text.textContent = "XMLTV 생성 및 전송 중...";
  else text.textContent = "대기 중";

  setBusyButtons(busy);

  const db = status.channels_db || {};
  if (!db.exists) {
    $("stat-db-primary").textContent = "채널 목록 없음 — 갱신 필요";
    $("stat-db-secondary").textContent = "";
  } else {
    $("stat-db-primary").textContent =
      `${db.providers || 0}개 제공사 · ${(db.total_channels || 0).toLocaleString("ko-KR")}개`;
    $("stat-db-secondary").textContent = db.updated ? `갱신: ${formatTime(db.updated)}` : "";
  }

  renderStatusSelected();

  const xml = status.xmltv || {};
  if (!xml.exists) {
    $("stat-xmltv-primary").textContent = "없음";
  } else {
    $("stat-xmltv-primary").textContent =
      `${formatBytes(xml.size)} (${relativeTime(xml.mtime) || formatTime(xml.mtime)})`;
  }

  const sock = status.socket || {};
  const sockState = [];
  if (sock.enabled) sockState.push("전송 ON");
  else sockState.push("전송 OFF");
  if (sock.exists) sockState.push("연결됨");
  else sockState.push("소켓 미감지");
  if (sock.last_send) {
    sockState.push(sock.last_send.success ? `성공 ${relativeTime(sock.last_send.at)}` : `실패 ${relativeTime(sock.last_send.at)}`);
  }
  $("stat-socket-primary").textContent = sockState.join(" · ");
  $("stat-socket-secondary").textContent = sock.path || "";
  $("socket-path-hint").textContent = `소켓 경로: ${sock.path || ""} (변경: 환경변수)`;

  $("next-fetch").textContent = formatTime(status.next_channel_fetch) || "—";
  $("next-generate").textContent = formatTime(status.next_xmltv_generate) || "—";

  if (status.paths) {
    const p = status.paths;
    $("paths-box").textContent =
      `KO_EPGGRAB_CONF      ${p.ko_epggrab_conf}\n` +
      `EPG2XML_CHANNEL_CONF ${p.epg2xml_channel_conf}\n` +
      `EPG2XML_PROGRAM_CONF ${p.epg2xml_program_conf}\n` +
      `XMLTV_XML_PATH       ${p.xmltv_xml_path}\n` +
      `XMLTV_SOCK_PATH      ${p.xmltv_sock_path}`;
  }
}

function fillSettingsForm(cfg) {
  state.config = cfg;
  $("cron-fetch").value = cfg.cron_channel_fetch || "";
  $("cron-generate").value = cfg.cron_generate_xmltv || "";
  $("send-to-socket").checked = !!cfg.send_to_socket;
  const g = cfg.epg2xml_global || {};
  const limit = String(g.FETCH_LIMIT || 2);
  for (const input of document.querySelectorAll('input[name="fetch-limit"]')) {
    input.checked = input.value === limit;
  }
  $("id-format").value = g.ID_FORMAT || DEFAULT_ID_FORMAT;
  $("http-proxy").value = g.HTTP_PROXY == null ? "" : String(g.HTTP_PROXY);
  $("opt-epnum").checked = !!g.ADD_EPNUM_TO_TITLE;
  $("opt-desc").checked = !!g.ADD_DESCRIPTION;
  $("opt-icon").checked = !!g.ADD_CHANNEL_ICON;
  $("opt-rebroadcast").checked = !!g.ADD_REBROADCAST_TO_TITLE;
  $("opt-xmltv-ns").checked = !!g.ADD_XMLTV_NS;
  $("opt-more-details").checked = !!g.GET_MORE_DETAILS;
}

function readSettingsForm() {
  const limitEl = document.querySelector('input[name="fetch-limit"]:checked');
  const proxyRaw = $("http-proxy").value.trim();
  return {
    cron_channel_fetch: $("cron-fetch").value.trim(),
    cron_generate_xmltv: $("cron-generate").value.trim(),
    send_to_socket: $("send-to-socket").checked,
    epg2xml_global: {
      ENABLED: true,
      FETCH_LIMIT: Number(limitEl ? limitEl.value : 2),
      ID_FORMAT: $("id-format").value.trim() || DEFAULT_ID_FORMAT,
      ADD_REBROADCAST_TO_TITLE: $("opt-rebroadcast").checked,
      ADD_EPNUM_TO_TITLE: $("opt-epnum").checked,
      ADD_DESCRIPTION: $("opt-desc").checked,
      ADD_XMLTV_NS: $("opt-xmltv-ns").checked,
      GET_MORE_DETAILS: $("opt-more-details").checked,
      ADD_CHANNEL_ICON: $("opt-icon").checked,
      HTTP_PROXY: proxyRaw === "" ? null : proxyRaw,
    },
    selected_channels: (state.config && state.config.selected_channels) || {},
  };
}

function renderLogs(data) {
  const view = $("logs-view");
  const lines = (data && data.lines) || [];
  view.innerHTML = lines
    .map((line) => {
      const err = /\[ERROR\]|fail|Traceback|Error/i.test(line);
      return `<div class="${err ? "log-err" : ""}">${escapeHTML(line)}</div>`;
    })
    .join("");
  if (state.logsFollow) view.scrollTop = view.scrollHeight;

  const job = data && data.last_job;
  if (!job) {
    $("logs-meta").textContent = "최근 작업 없음";
    return;
  }
  const typeLabel = job.type === "fetch_channels" ? "채널 갱신" : "XMLTV 생성";
  const status = job.success ? "성공" : "실패";
  $("logs-meta").textContent =
    `${typeLabel} · ${formatTime(job.started_at)} · ${job.duration_ms || 0}ms · ${status}` +
    (job.error ? ` · ${job.error}` : "");
}

async function loadChannels() {
  const data = await api("/api/channels");
  state.channelsExists = !!data.exists;
  const { flat, byProvider } = flattenChannels(data.providers || {});
  state.channelsFlat = flat;
  state.channelsByProvider = byProvider;
  if (!state.activeProvider || (state.activeProvider && !byProvider[state.activeProvider])) {
    state.activeProvider = pickDefaultProvider();
  }
  renderProviders();
  renderCategoryChips();
  renderTable();
  updateDirtyBar();
}

async function loadAll() {
  const [status, cfg] = await Promise.all([api("/api/status"), api("/api/config")]);
  fillSettingsForm(cfg);
  state.savedSelection = selectionFromConfig(cfg);
  state.selection = new Set(state.savedSelection);
  renderStatus(status);
  await loadChannels();
  updateDirtyBar();
  const logs = await api("/api/logs");
  renderLogs(logs);
}

async function saveConfig({ triggerGenerate = false, fromSettings = false } = {}) {
  let cfg;
  if (fromSettings) {
    cfg = readSettingsForm();
    // Keep current (possibly dirty) channel selection when saving settings.
    cfg = configFromSelection(cfg, state.selection);
  } else {
    cfg = configFromSelection(readSettingsForm(), state.selection);
  }
  const q = triggerGenerate ? "?trigger=generate" : "";
  const saved = await api(`/api/config${q}`, {
    method: "PUT",
    body: JSON.stringify(cfg),
  });
  fillSettingsForm(saved);
  state.savedSelection = selectionFromConfig(saved);
  state.selection = new Set(state.savedSelection);
  updateDirtyBar();
  renderProviders();
  renderTable();
  renderStatusSelected();
  toast(triggerGenerate ? "저장되었습니다. XMLTV 생성을 시작합니다." : "설정이 저장되었습니다.");
  if (triggerGenerate) schedulePoll(true);
}

function switchTab(name) {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of document.querySelectorAll(".panel")) {
    const active = panel.id === `panel-${name}`;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }
}

function schedulePoll(forceBusy = false) {
  clearTimeout(state.pollTimer);
  const busy = forceBusy || (state.status && state.status.state !== "idle");
  const delay = busy ? BUSY_POLL_MS : IDLE_POLL_MS;
  state.pollTimer = setTimeout(poll, delay);
}

async function poll() {
  try {
    const status = await api("/api/status");
    const wasBusy = state.wasBusy;
    const busy = status.state !== "idle";
    renderStatus(status);

    if (busy || $("panel-logs").classList.contains("is-active")) {
      const logs = await api("/api/logs");
      renderLogs(logs);
    }

    if (wasBusy && !busy) {
      const logs = await api("/api/logs");
      renderLogs(logs);
      const job = logs.last_job;
      if (job) {
        if (job.success) {
          toast(
            job.type === "fetch_channels"
              ? "채널 DB 갱신이 완료되었습니다."
              : "XMLTV 생성 및 소켓 전송이 완료되었습니다.",
          );
        } else {
          toast(`작업 실패: 실행 로그 탭을 확인하세요.`, false);
        }
        if (job.type === "fetch_channels") {
          await loadChannels();
        }
        // Refresh status cards (xmltv size etc.)
        renderStatus(await api("/api/status"));
      }
    }
    state.wasBusy = busy;
  } catch (err) {
    console.error(err);
  }
  schedulePoll();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function bindEvents() {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  }

  $("btn-toggle-kpi").addEventListener("click", () => {
    applyKpiCollapsed(!state.kpiCollapsed);
  });

  $("header-check").addEventListener("change", (e) => {
    const rows = filteredChannels();
    if (e.target.checked) {
      for (const ch of rows) state.selection.add(channelKey(ch.provider, ch.ServiceId));
    } else {
      for (const ch of rows) state.selection.delete(channelKey(ch.provider, ch.ServiceId));
    }
    if (state.selectedOnly) renderTable();
    else {
      for (const tr of $("channel-tbody").querySelectorAll("tr")) {
        patchRowSelection(tr, state.selection.has(tr.dataset.key));
      }
      refreshSelectionChrome(rows);
    }
  });

  $("btn-fetch").addEventListener("click", async () => {
    try {
      await api("/api/actions/fetch-channels", { method: "POST" });
      state.wasBusy = true;
      toast("채널 DB 갱신을 시작했습니다.");
      switchTab("logs");
      schedulePoll(true);
      await poll();
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  $("btn-generate").addEventListener("click", async () => {
    if (state.savedSelection.size === 0) {
      toast("선택된 채널이 없습니다. 먼저 채널 선택 탭에서 최소 1개 이상의 채널을 선택하고 저장해 주세요.", false);
      switchTab("channels");
      return;
    }
    if (isDirty()) {
      toast("저장되지 않은 채널 변경사항이 있습니다. 먼저 저장해 주세요.", false);
      return;
    }
    try {
      await api("/api/actions/generate-xmltv", { method: "POST" });
      state.wasBusy = true;
      toast("XMLTV 생성을 시작했습니다.");
      switchTab("logs");
      schedulePoll(true);
      await poll();
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  const openSelectedOnly = () => {
    switchTab("channels");
    $("toggle-selected-only").checked = true;
    state.selectedOnly = true;
    persistViewPrefs();
    renderCategoryChips();
    renderTable();
  };
  $("card-selected").addEventListener("click", openSelectedOnly);
  $("card-selected").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSelectedOnly();
    }
  });

  $("btn-copy-xmltv-url").addEventListener("click", async () => {
    const url = `${location.origin}/xmltv.xml`;
    try {
      await navigator.clipboard.writeText(url);
      toast("XMLTV URL을 복사했습니다.");
    } catch {
      toast(url);
    }
  });

  const onSearch = debounce(() => {
    state.search = $("search-input").value;
    renderCategoryChips();
    renderTable();
  }, 150);
  $("search-input").addEventListener("input", onSearch);

  $("toggle-selected-only").addEventListener("change", (e) => {
    state.selectedOnly = e.target.checked;
    persistViewPrefs();
    renderCategoryChips();
    renderTable();
  });

  $("btn-select-visible").addEventListener("click", () => {
    const rows = filteredChannels();
    for (const ch of rows) state.selection.add(channelKey(ch.provider, ch.ServiceId));
    renderTable();
    refreshSelectionChrome(rows);
  });

  $("btn-deselect-visible").addEventListener("click", () => {
    const rows = filteredChannels();
    for (const ch of rows) state.selection.delete(channelKey(ch.provider, ch.ServiceId));
    renderTable();
    refreshSelectionChrome(rows);
  });

  $("btn-revert").addEventListener("click", () => {
    state.selection = new Set(state.savedSelection);
    renderTable();
    refreshSelectionChrome();
  });

  $("btn-save").addEventListener("click", async () => {
    try {
      await saveConfig({ triggerGenerate: false });
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  $("btn-save-generate").addEventListener("click", async () => {
    try {
      await saveConfig({ triggerGenerate: true });
      state.wasBusy = true;
      schedulePoll(true);
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  $("btn-settings-save").addEventListener("click", async () => {
    try {
      await saveConfig({ fromSettings: true });
      renderStatus(await api("/api/status"));
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  $("btn-settings-save-generate").addEventListener("click", async () => {
    try {
      await saveConfig({ fromSettings: true, triggerGenerate: true });
      state.wasBusy = true;
      schedulePoll(true);
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  $("btn-reset-id-format").addEventListener("click", () => {
    $("id-format").value = DEFAULT_ID_FORMAT;
  });

  for (const btn of document.querySelectorAll("#cron-fetch-presets .chip")) {
    btn.addEventListener("click", () => {
      $("cron-fetch").value = btn.dataset.cron;
    });
  }
  for (const btn of document.querySelectorAll("#cron-generate-presets .chip")) {
    btn.addEventListener("click", () => {
      $("cron-generate").value = btn.dataset.cron;
    });
  }

  $("logs-follow").addEventListener("change", (e) => {
    state.logsFollow = e.target.checked;
  });
  $("btn-logs-refresh").addEventListener("click", async () => {
    renderLogs(await api("/api/logs"));
  });
  $("btn-logs-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("logs-view").innerText);
      toast("로그를 복사했습니다.");
    } catch (err) {
      toast(String(err.message || err), false);
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      switchTab("channels");
      $("search-input").focus();
    }
    if (e.key === "Escape" && document.activeElement === $("search-input")) {
      $("search-input").value = "";
      state.search = "";
      renderCategoryChips();
      renderTable();
      $("search-input").blur();
    }
    if (!typing && TAB_KEYS[e.key]) {
      e.preventDefault();
      switchTab(TAB_KEYS[e.key]);
    }
  });
}

async function main() {
  restoreViewPrefs();
  bindEvents();
  try {
    await loadAll();
    $("toggle-selected-only").checked = state.selectedOnly;
    if (state.activeProvider && !state.channelsByProvider[state.activeProvider]) {
      state.activeProvider = pickDefaultProvider();
    }
    renderProviders();
    renderCategoryChips();
    renderTable();
  } catch (err) {
    toast(`초기 로드 실패: ${err.message || err}`, false);
  }
  schedulePoll();
}

main();
