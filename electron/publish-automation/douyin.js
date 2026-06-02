async (input) => {
  const logs = [];
  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://creator.douyin.com/creator-micro/content/upload");
  let currentStage = "init";

  const log = (message) => {
    logs.push(message);
    console.log(`[geo-douyin] ${message}`);
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
  const douyinText = [draftTitle, draftBody, draftTags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2200);

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
    setStage("load_publish_page", "进入抖音创作者发布页");
    if (!window.location.href.includes("creator.douyin.com")) {
      window.location.href = publishUrl;
      await sleep(3500);
    }
    await waitFor(
      [
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="标题"]',
        'textarea[placeholder*="说点什么"]',
        '[contenteditable="true"]',
        'input[type="file"]',
        'button',
      ],
      50000,
      false,
    );
  }

  async function fillText() {
    setStage("fill_body", "填写抖音发布文案");
    const node = await waitFor(
      [
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="说点什么"]',
        'textarea[placeholder*="标题"]',
        '[contenteditable="true"][data-placeholder*="描述"]',
        '[contenteditable="true"][data-placeholder*="说点什么"]',
        '[contenteditable="true"]',
      ],
      30000,
      false,
    );
    setValue(node, douyinText);
    await sleep(1000);
    const written = normalize(node.value || node.innerText || node.textContent);
    if (!written.includes(douyinText.slice(0, 8))) {
      throw new Error("抖音文案写入后未通过校验");
    }
  }

  async function submit() {
    setStage("submit", "提交抖音发布");
    const button =
      findByText(["发布", "立即发布", "提交", "保存并发布"], "button,[role='button'],span,div") ||
      query(['button[type="submit"]', '[class*="publish"] button'], true);
    if (!(button instanceof HTMLElement)) {
      throw new Error("未找到抖音发布按钮");
    }
    button.scrollIntoView({ block: "center" });
    button.click();
    await sleep(4000);
    const page = text(document.body);
    if (["发布成功", "提交成功", "审核", "已发布", "作品管理"].some((hint) => page.includes(hint))) {
      return {
        status: page.includes("审核") ? "pending_review" : "submitted",
        draftUrl: window.location.href,
        publishUrl: window.location.href,
        externalStatus: "douyin_submit_ack",
        executionLog: logs,
        verificationEvidence: "douyin_submit_ack",
      };
    }
    return {
      status: "submitted",
      draftUrl: window.location.href,
      publishUrl: window.location.href,
      externalStatus: "douyin_submit_unknown",
      executionLog: logs,
      verificationEvidence: "douyin_submit_clicked",
    };
  }

  try {
    if (!douyinText) {
      throw new Error("抖音发布文案为空");
    }
    await ensurePublishPage();
    await fillText();
    const result = await submit();
    setStage(result.status, "抖音发布流程已提交");
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "抖音自动发布失败";
    log(`error: ${message}`);
    return {
      status: "failed",
      failureStage: currentStage,
      errorMessage: message,
      executionLog: logs,
    };
  }
}
