const state = {
  auth: sessionStorage.getItem("geo-admin-auth") || "",
  selectedFeedback: null,
  activeTab: "authorization",
};

const statusLabels = {
  new: "新建",
  processing: "处理中",
  resolved: "已处理",
  ignored: "忽略",
};

const licenseStatusLabels = {
  available: "可用",
  active: "已绑定",
  expired: "已过期",
  disabled: "已禁用",
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(text, tone = "info") {
  const toast = $("#toast");
  toast.textContent = text;
  toast.className = `toast ${tone}`;
  window.setTimeout(() => {
    toast.className = "toast hidden";
  }, 2600);
}

function authHeaders() {
  return state.auth ? { Authorization: state.auth } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof ArrayBuffer ? {} : { "Content-Type": "application/json" }),
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "请求失败");
  }
  return body;
}

function setLoggedIn(loggedIn) {
  $("#loginPanel").classList.toggle("hidden", loggedIn);
  $("#adminPanel").classList.toggle("hidden", !loggedIn);
  $("#logoutButton").classList.toggle("hidden", !loggedIn);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function maskHash(hash) {
  if (!hash) return "-";
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

function feedbackQuery() {
  const params = new URLSearchParams();
  for (const [id, key] of [
    ["typeFilter", "type"],
    ["statusFilter", "status"],
    ["versionFilter", "version"],
    ["deviceFilter", "device"],
  ]) {
    const value = $(`#${id}`).value.trim();
    if (value) params.set(key, value);
  }
  return params.toString();
}

async function loadFeedback() {
  const query = feedbackQuery();
  const payload = await api(`/api/admin/feedback${query ? `?${query}` : ""}`);
  const list = $("#feedbackList");
  list.innerHTML = "";

  if (!payload.feedback.length) {
    list.innerHTML = '<div class="empty">暂无反馈。</div>';
    $("#feedbackDetail").innerHTML = "请选择一条反馈。";
    $("#feedbackDetail").className = "detail empty";
    return;
  }

  for (const item of payload.feedback) {
    const button = document.createElement("button");
    button.className = "feedback-item";
    button.innerHTML = `
      <span class="row-title">${escapeHtml(item.type)}</span>
      <span class="badge">${escapeHtml(statusLabels[item.status] || item.status)}</span>
      <span class="muted clamp">${escapeHtml(item.message)}</span>
      <span class="meta">${escapeHtml(item.appVersion || "-")} · ${formatDate(item.createdAt)}</span>
    `;
    button.addEventListener("click", () => showFeedbackDetail(item.id));
    list.appendChild(button);
  }
}

async function showFeedbackDetail(id) {
  const payload = await api(`/api/admin/feedback/${encodeURIComponent(id)}`);
  const item = payload.feedback;
  state.selectedFeedback = item;
  $("#feedbackDetail").className = "detail";
  $("#feedbackDetail").innerHTML = `
    <h3>${escapeHtml(item.type)}</h3>
    <p class="message">${escapeHtml(item.message)}</p>
    <dl>
      <dt>联系方式</dt><dd>${escapeHtml(item.contact || "-")}</dd>
      <dt>版本</dt><dd>${escapeHtml(item.appVersion || "-")}</dd>
      <dt>设备</dt><dd>${escapeHtml(item.deviceFingerprint || "-")}</dd>
      <dt>平台</dt><dd>${escapeHtml(item.os || "-")}</dd>
      <dt>客户端时间</dt><dd>${formatDate(item.clientTime)}</dd>
      <dt>服务端时间</dt><dd>${formatDate(item.serverTime)}</dd>
    </dl>
    <label>
      <span>处理状态</span>
      <select id="detailStatus">
        ${Object.entries(statusLabels)
          .map(([value, label]) => `<option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>`)
          .join("")}
      </select>
    </label>
    <label>
      <span>处理备注</span>
      <textarea id="handlerNote">${escapeHtml(item.handlerNote || "")}</textarea>
    </label>
    <button id="saveStatusButton">保存状态</button>
  `;
  $("#saveStatusButton").addEventListener("click", saveFeedbackStatus);
}

async function saveFeedbackStatus() {
  if (!state.selectedFeedback) return;
  await api(`/api/admin/feedback/${encodeURIComponent(state.selectedFeedback.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: $("#detailStatus").value,
      handlerNote: $("#handlerNote").value,
    }),
  });
  showToast("状态已保存", "success");
  await loadFeedback();
}

async function loadAuthorization() {
  const [licensePayload, bindingPayload] = await Promise.all([
    api("/api/admin/license-codes"),
    api("/api/admin/device-license-bindings"),
  ]);

  renderLicenses(licensePayload.licenseCodes || []);
  renderBindings(bindingPayload.bindings || []);
}

function renderLicenses(licenses) {
  const list = $("#licensesList");
  list.innerHTML = "";
  if (!licenses.length) {
    list.innerHTML = '<div class="empty">暂无授权码。</div>';
    return;
  }

  for (const item of licenses) {
    const node = document.createElement("div");
    const statusLabel = licenseStatusLabels[item.status] || item.status;
    const displayCode = item.code || maskHash(item.codeHash);
    node.className = "record-item";
    node.innerHTML = `
      <div class="record-header">
        <strong class="record-title code-value">${escapeHtml(displayCode)}</strong>
        <span class="badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="record-meta">
        <span><strong>发放对象</strong> ${escapeHtml(item.issuedTo || "未填写")}</span>
        <span><strong>设备数</strong> ${item.maxDevices} 台 · <strong>到期</strong> ${formatDate(item.expiresAt)}</span>
      </div>
      <div class="item-actions">
        <button class="secondary" data-reset-license="${item.id}">重置绑定</button>
        <button class="secondary danger" data-disable-license="${item.id}" ${item.status === "disabled" ? "disabled" : ""}>禁用</button>
      </div>
    `;
    list.appendChild(node);
  }

  list.querySelectorAll("[data-reset-license]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/license-codes/${encodeURIComponent(button.dataset.resetLicense)}/reset-binding`, { method: "POST" });
      showToast("绑定已重置", "success");
      await loadAuthorization();
    });
  });

  list.querySelectorAll("[data-disable-license]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/license-codes/${encodeURIComponent(button.dataset.disableLicense)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "disabled", disabledReason: "Disabled in admin web" }),
      });
      showToast("授权已禁用", "success");
      await loadAuthorization();
    });
  });
}

function renderBindings(bindings) {
  const list = $("#bindingsList");
  list.innerHTML = "";
  if (!bindings.length) {
    list.innerHTML = '<div class="empty">暂无绑定记录。</div>';
    return;
  }

  for (const item of bindings) {
    const node = document.createElement("div");
    node.className = "record-item";
    node.innerHTML = `
      <div class="record-header">
        <strong class="record-title">${escapeHtml(item.fingerprint)}</strong>
        <span class="badge ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
      </div>
      <div class="record-meta">
        <span><strong>机器码</strong> ${escapeHtml(item.machine_code || "-")}</span>
        <span><strong>绑定时间</strong> ${formatDate(item.bound_at)}</span>
      </div>
    `;
    list.appendChild(node);
  }
}

async function createLicense() {
  const response = await api("/api/admin/license-codes", {
    method: "POST",
    body: JSON.stringify({
      code: $("#licenseCodeInput").value.trim(),
      issuedTo: $("#licenseIssuedToInput").value.trim(),
      maxDevices: Number.parseInt($("#licenseMaxDevicesInput").value, 10) || 1,
      expiresAt: $("#licenseExpiresAtInput").value ? new Date($("#licenseExpiresAtInput").value).toISOString() : "",
      notes: $("#licenseNotesInput").value.trim(),
    }),
  });

  ["licenseCodeInput", "licenseIssuedToInput", "licenseExpiresAtInput", "licenseNotesInput"].forEach((id) => {
    $(`#${id}`).value = "";
  });
  $("#licenseMaxDevicesInput").value = "1";
  $("#createdLicenseOutput").textContent = response.license?.code ? `新授权码：${response.license.code}` : "授权码已创建";
  showToast("授权码已创建", "success");
  await loadAuthorization();
}

async function loadReleases() {
  const payload = await api("/api/admin/releases");
  const list = $("#releasesList");
  list.innerHTML = "";
  const releases = payload.releases || [];
  if (!releases.length) {
    list.innerHTML = '<div class="empty">暂无版本包。</div>';
    return;
  }

  for (const item of releases) {
    const node = document.createElement("div");
    node.className = "plain-item";
    node.innerHTML = `
      <strong>${escapeHtml(item.version)} · ${escapeHtml(item.platform)}/${escapeHtml(item.arch)}</strong>
      <span>${item.publishedAt ? `已发布 ${formatDate(item.publishedAt)}` : "未发布"} · ${formatBytes(item.size)} · ${maskHash(item.sha256)}</span>
      <span class="break-all">${escapeHtml(item.downloadUrl)}</span>
      <div class="item-actions">
        <button class="secondary" data-publish-release="${item.id}" ${item.publishedAt ? "disabled" : ""}>发布</button>
        <a class="button-link secondary" href="${escapeHtml(item.downloadUrl)}" target="_blank" rel="noreferrer">下载</a>
      </div>
    `;
    list.appendChild(node);
  }

  list.querySelectorAll("[data-publish-release]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/admin/releases/${encodeURIComponent(button.dataset.publishRelease)}/publish`, { method: "POST" });
      showToast("版本已发布", "success");
      await loadReleases();
    });
  });
}

async function uploadRelease() {
  const file = $("#releaseFileInput").files?.[0];
  const version = $("#releaseVersionInput").value.trim();
  if (!file || !version) {
    showToast("请填写版本号并选择更新包", "error");
    return;
  }

  const buffer = await file.arrayBuffer();
  await api("/api/admin/releases", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Release-Version": version,
      "X-Release-Platform": $("#releasePlatformInput").value.trim() || "win32",
      "X-Release-Arch": $("#releaseArchInput").value.trim() || "x64",
      "X-Release-Min-Supported-Version": $("#releaseMinVersionInput").value.trim(),
      "X-Release-Mandatory": $("#releaseMandatoryInput").checked ? "true" : "false",
      "X-Release-File-Name": encodeURIComponent(file.name),
      "X-Release-Notes": encodeURIComponent($("#releaseNotesInput").value.trim()),
    },
    body: buffer,
  });

  $("#releaseFileInput").value = "";
  $("#releaseNotesInput").value = "";
  showToast("版本包已上传，发布后客户端才会收到更新", "success");
  await loadReleases();
}

async function loadActiveTab() {
  if (state.activeTab === "authorization") {
    await loadAuthorization();
  } else if (state.activeTab === "feedback") {
    await loadFeedback();
  } else if (state.activeTab === "releases") {
    await loadReleases();
  }
}

function bindEvents() {
  $("#loginButton").addEventListener("click", async () => {
    const username = $("#usernameInput").value;
    const password = $("#passwordInput").value;
    state.auth = `Basic ${btoa(`${username}:${password}`)}`;
    try {
      await loadAuthorization();
      sessionStorage.setItem("geo-admin-auth", state.auth);
      setLoggedIn(true);
    } catch (error) {
      state.auth = "";
      showToast(error.message, "error");
    }
  });

  $("#logoutButton").addEventListener("click", () => {
    state.auth = "";
    sessionStorage.removeItem("geo-admin-auth");
    setLoggedIn(false);
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      state.activeTab = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      ["authorization", "feedback", "releases"].forEach((name) => {
        $(`#${name}Tab`).classList.toggle("hidden", state.activeTab !== name);
      });
      try {
        await loadActiveTab();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  $("#refreshAuthorizationButton").addEventListener("click", () => loadAuthorization().catch((error) => showToast(error.message, "error")));
  $("#createLicenseButton").addEventListener("click", () => createLicense().catch((error) => showToast(error.message, "error")));
  $("#refreshFeedbackButton").addEventListener("click", () => loadFeedback().catch((error) => showToast(error.message, "error")));
  ["typeFilter", "statusFilter", "versionFilter", "deviceFilter"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => loadFeedback().catch((error) => showToast(error.message, "error")));
  });
  $("#refreshReleasesButton").addEventListener("click", () => loadReleases().catch((error) => showToast(error.message, "error")));
  $("#uploadReleaseButton").addEventListener("click", () => uploadRelease().catch((error) => showToast(error.message, "error")));
}

bindEvents();
setLoggedIn(Boolean(state.auth));
if (state.auth) {
  loadAuthorization().catch(() => setLoggedIn(false));
}
