const state = {
  auth: sessionStorage.getItem("geo-admin-auth") || "",
  selectedFeedback: null,
};

const statusLabels = {
  new: "新建",
  processing: "处理中",
  resolved: "已处理",
  ignored: "忽略",
};

const $ = (selector) => document.querySelector(selector);

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
      "Content-Type": "application/json",
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
      <span class="row-title">${item.type}</span>
      <span class="badge">${statusLabels[item.status] || item.status}</span>
      <span class="muted clamp">${item.message}</span>
      <span class="meta">${item.appVersion || "-"} · ${formatDate(item.createdAt)}</span>
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
    <h3>${item.type}</h3>
    <p class="message">${item.message}</p>
    <dl>
      <dt>联系方式</dt><dd>${item.contact || "-"}</dd>
      <dt>版本</dt><dd>${item.appVersion || "-"}</dd>
      <dt>设备</dt><dd>${item.deviceFingerprint || "-"}</dd>
      <dt>平台</dt><dd>${item.os || "-"}</dd>
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
      <textarea id="handlerNote">${item.handlerNote || ""}</textarea>
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

async function loadSimpleList(path, target, render) {
  const payload = await api(path);
  const key = Object.keys(payload)[0];
  const list = $(`#${target}`);
  list.innerHTML = "";
  if (!payload[key].length) {
    list.innerHTML = '<div class="empty">暂无记录。</div>';
    return;
  }
  payload[key].forEach((item) => {
    const node = document.createElement("div");
    node.className = "plain-item";
    node.innerHTML = render(item);
    list.appendChild(node);
  });
}

function bindEvents() {
  $("#loginButton").addEventListener("click", async () => {
    const username = $("#usernameInput").value;
    const password = $("#passwordInput").value;
    state.auth = `Basic ${btoa(`${username}:${password}`)}`;
    try {
      await loadFeedback();
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

  $("#refreshFeedbackButton").addEventListener("click", () => loadFeedback().catch((error) => showToast(error.message, "error")));
  ["typeFilter", "statusFilter", "versionFilter", "deviceFilter"].forEach((id) => {
    $(`#${id}`).addEventListener("change", () => loadFeedback().catch((error) => showToast(error.message, "error")));
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      ["feedback", "devices", "licenses", "bindings"].forEach((name) => {
        $(`#${name}Tab`).classList.toggle("hidden", tab.dataset.tab !== name);
      });
    });
  });

  $("#refreshDevicesButton").addEventListener("click", () =>
    loadSimpleList("/api/admin/devices", "devicesList", (item) => `<strong>${item.fingerprint}</strong><span>${item.status} · ${formatDate(item.last_seen_at)}</span>`),
  );
  $("#refreshLicensesButton").addEventListener("click", () =>
    loadSimpleList("/api/admin/license-codes", "licensesList", (item) => `<strong>${item.code}</strong><span>${item.status} · max ${item.max_devices}</span>`),
  );
  $("#refreshBindingsButton").addEventListener("click", () =>
    loadSimpleList("/api/admin/device-license-bindings", "bindingsList", (item) => `<strong>${item.code}</strong><span>${item.fingerprint} · ${item.status}</span>`),
  );
}

bindEvents();
setLoggedIn(Boolean(state.auth));
if (state.auth) {
  loadFeedback().catch(() => setLoggedIn(false));
}
