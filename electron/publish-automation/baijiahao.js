async (input) => {
  const logs = [];
  const payload = input?.payload ?? {};
  const timeoutMs = Number(input?.timeoutMs) || 180000;
  const publishUrl = String(input?.publishUrl || "https://baijiahao.baidu.com/builder/rc/edit?type=news");
  let currentStage = "init";

  const log = (message) => {
    logs.push(message);
    console.log(`[geo-baijiahao] ${message}`);
  };
  const setStage = (stage, message) => {
    currentStage = stage;
    log(`${stage}: ${message}`);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const draftTitle = normalize(payload.draftTitle || "");
  const draftBody = normalize(payload.draftBody || "");
  const draftTags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean) : [];

  function visible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function text(node) {
    return normalize(node?.innerText || node?.textContent || "");
  }

  function findByText(words, selector = "*") {
    const needles = Array.isArray(words) ? words : [words];
    return Array.from(document.querySelectorAll(selector)).find((node) => visible(node) && needles.some((word) => text(node).includes(word))) || null;
  }

  function query(selectors, visibleOnly = true) {
    for (const selector of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        const matched = nodes.find((node) => (visibleOnly ? visible(node) : true));
        if (matched) return matched;
      } catch {
        // ignore invalid selectors
      }
    }
    return null;
  }

  async function waitFor(selectors, waitMs = 30000, visibleOnly = true) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      const node = query(selectors, visibleOnly);
      if (node) return node;
      await sleep(500);
    }
    throw new Error(`[${currentStage}] 未找到元素：${selectors[0] || "unknown"}`);
  }

  function dispatchInputEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setValue(node, value) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, value);
      dispatchInputEvents(node);
      return;
    }
    if (node instanceof HTMLElement) {
      node.focus();
      if (node.isContentEditable) {
        document.execCommand("selectAll", false);
        document.execCommand("delete", false);
        document.execCommand("insertText", false, value);
        if (!normalize(node.textContent).includes(value.slice(0, 8))) {
          node.textContent = value;
        }
        dispatchInputEvents(node);
        return;
      }
      node.textContent = value;
      dispatchInputEvents(node);
    }
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入百家号发布页");
    if (!window.location.href.includes("baijiahao.baidu.com")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    await waitFor(
      [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[contenteditable="true"]',
        'textarea[placeholder*="正文"]',
        'textarea[placeholder*="内容"]',
      ],
      45000,
      false,
    );
  }

  async function fillTitle() {
    setStage("fill_title", "填写百家号标题");
    const node = await waitFor(
      [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[class*="title"] input',
        '[class*="title"] textarea',
      ],
      25000,
      false,
    );
    setValue(node, draftTitle);
    await sleep(800);
    if (!normalize(node.value || node.textContent).includes(draftTitle.slice(0, 8))) {
      throw new Error("标题写入后未通过校验");
    }
  }

  async function fillBody() {
    setStage("fill_body", "填写百家号正文");
    const node = await waitFor(
      [
        '[contenteditable="true"][data-placeholder*="正文"]',
        '[contenteditable="true"][data-placeholder*="内容"]',
        '[contenteditable="true"]',
        'textarea[placeholder*="正文"]',
        'textarea[placeholder*="内容"]',
      ],
      25000,
      false,
    );
    setValue(node, draftBody);
    await sleep(1000);
    const written = normalize(node.value || node.innerText || node.textContent);
    if (!written.includes(draftBody.slice(0, 12))) {
      throw new Error("正文写入后未通过校验");
    }
  }

  async function fillTags() {
    if (!draftTags.length) return;
    setStage("fill_tags", "填写百家号标签");
    const node = query(
      [
        'input[placeholder*="标签"]',
        'input[placeholder*="关键词"]',
        'textarea[placeholder*="标签"]',
      ],
      false,
    );
    if (!node) {
      log("fill_tags: 未找到标签输入框，跳过");
      return;
    }
    setValue(node, draftTags.slice(0, 5).join(" "));
    await sleep(800);
  }

  async function submit() {
    setStage("submit", "提交百家号发布");
    const button =
      findByText(["发布", "提交", "立即发布"], "button,[role='button'],a,span,div") ||
      query(['button[type="submit"]', '.publish button', '[class*="publish"] button'], true);
    if (!(button instanceof HTMLElement)) {
      throw new Error("未找到百家号发布按钮");
    }
    button.scrollIntoView({ block: "center" });
    button.click();
    await sleep(3500);
    const page = text(document.body);
    if (["发布成功", "提交成功", "审核", "已发布", "内容管理"].some((hint) => page.includes(hint))) {
      return {
        status: page.includes("审核") ? "pending_review" : "submitted",
        draftUrl: window.location.href,
        publishUrl: window.location.href,
        externalStatus: "baijiahao_submit_ack",
        executionLog: logs,
        verificationEvidence: "baijiahao_submit_ack",
      };
    }
    return {
      status: "submitted",
      draftUrl: window.location.href,
      publishUrl: window.location.href,
      externalStatus: "baijiahao_submit_unknown",
      executionLog: logs,
      verificationEvidence: "baijiahao_submit_clicked",
    };
  }

  try {
    if (!draftTitle || !draftBody) {
      throw new Error("发布稿标题或正文为空");
    }
    await ensurePublishPage();
    await fillTitle();
    await fillBody();
    await fillTags();
    const result = await submit();
    setStage(result.status, "百家号发布流程已提交");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "百家号自动发布失败";
    log(`error: ${message}`);
    return {
      status: "failed",
      failureStage: currentStage,
      errorMessage: message,
      executionLog: logs,
    };
  }
}
