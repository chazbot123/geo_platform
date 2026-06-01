async (input) => {
  const logs = [];
  const payload = input?.payload ?? {};
  const timeoutMs = Number(input?.timeoutMs) || 180000;
  let currentStage = "init";

  const log = (message) => {
    logs.push(message);
    console.log(`[geo-toutiao] ${message}`);
  };
  const setStage = (stage, message) => {
    currentStage = stage;
    log(`${stage}: ${message}`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const dedupe = (items) => Array.from(new Set(items.filter(Boolean)));
  const draftTitle = normalize(payload.draftTitle || "");
  const draftBody = normalize(payload.draftBody || "");
  const draftBodyExcerpt = draftBody.slice(0, 32);
  const draftTitleNeedles = dedupe([
    draftTitle,
    draftTitle.slice(0, 24),
    draftTitle.slice(0, 18),
    draftTitle.slice(0, 12),
  ]).filter((item) => item.length >= 6);
  const bodyNeedles = dedupe([
    draftBody.slice(0, 32),
    draftBody.slice(0, 24),
    draftBody.slice(0, 16),
  ]).filter((item) => item.length >= 10);
  const publishUrl = String(input?.publishUrl || "https://mp.toutiao.com/profile_v4/graphic/publish");

  function visible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function parseHasTextSelector(selector) {
    const single = selector.match(/^(.*):has-text\("(.+)"\)$/);
    if (single) {
      return {
        baseSelector: single[1]?.trim() || "*",
        texts: [normalize(single[2])],
      };
    }

    const multi = selector.match(/^(.*):has-text-any\("(.+)"\)$/);
    if (multi) {
      return {
        baseSelector: multi[1]?.trim() || "*",
        texts: multi[2].split("|").map((item) => normalize(item)),
      };
    }

    return null;
  }

  function findByText(text, root = document, baseSelector = "*") {
    const nodes = Array.from(root.querySelectorAll(baseSelector));
    return nodes.find((node) => normalize(node.textContent || "").includes(text)) || null;
  }

  function query(selectors, visibleOnly = true) {
    for (const selector of selectors) {
      try {
        if (selector.startsWith("text=")) {
          const matched = findByText(normalize(selector.slice(5)));
          if (matched && (!visibleOnly || visible(matched))) return matched;
          continue;
        }

        const textSelector = parseHasTextSelector(selector);
        if (textSelector) {
          const nodes = Array.from(document.querySelectorAll(textSelector.baseSelector || "*"));
          const matched = nodes.find((node) => {
            const text = normalize(node.textContent || "");
            return textSelector.texts.some((item) => text.includes(item)) && (!visibleOnly || visible(node));
          });
          if (matched) return matched;
          continue;
        }

        const nodes = Array.from(document.querySelectorAll(selector));
        const matched = nodes.find((node) => (visibleOnly ? visible(node) : true));
        if (matched) return matched;
      } catch (_) {
        // ignore invalid selectors
      }
    }
    return null;
  }

  function queryAll(selectors, visibleOnly = true, root = document) {
    const results = [];
    for (const selector of selectors) {
      try {
        if (selector.startsWith("text=")) {
          const text = normalize(selector.slice(5));
          const nodes = Array.from(root.querySelectorAll("*")).filter((node) => {
            const matched = normalize(node.textContent || "").includes(text);
            return matched && (!visibleOnly || visible(node));
          });
          results.push(...nodes);
          continue;
        }

        const textSelector = parseHasTextSelector(selector);
        if (textSelector) {
          const nodes = Array.from(root.querySelectorAll(textSelector.baseSelector || "*")).filter((node) => {
            const text = normalize(node.textContent || "");
            return textSelector.texts.some((item) => text.includes(item)) && (!visibleOnly || visible(node));
          });
          results.push(...nodes);
          continue;
        }

        const nodes = Array.from(root.querySelectorAll(selector)).filter((node) => (visibleOnly ? visible(node) : true));
        results.push(...nodes);
      } catch (_) {
        // ignore invalid selectors
      }
    }
    return Array.from(new Set(results));
  }

  async function waitFor(selectors, waitMs = 30000, visibleOnly = true) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      const node = query(selectors, visibleOnly);
      if (node) return node;
      await sleep(400);
    }
    throw new Error(`[${currentStage}] 未找到目标元素：${selectors[0] || "unknown"}`);
  }

  async function click(selectors, waitMs = 30000) {
    const node = await waitFor(selectors, waitMs, true);
    if (!(node instanceof HTMLElement)) {
      throw new Error("目标元素不可点击");
    }
    node.scrollIntoView({ block: "center", inline: "center" });
    node.click();
    await sleep(1200);
    return node;
  }

  function dispatchInputEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setInputValue(node, value) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, value);
      dispatchInputEvents(node);
      return;
    }
    if (node instanceof HTMLElement) {
      node.focus();
      if (node.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("selectAll", false);
        document.execCommand("delete", false);
        dispatchInputEvents(node);
        document.execCommand("insertText", false, value);
        if (!normalize(node.textContent || "").includes(normalize(value).slice(0, 12))) {
          node.innerHTML = "";
          node.textContent = value;
        }
        dispatchInputEvents(node);
        return;
      }
      node.textContent = "";
      dispatchInputEvents(node);
      document.execCommand("insertText", false, value);
      if (!node.textContent?.trim()) {
        node.textContent = value;
      }
      dispatchInputEvents(node);
    }
  }

  function setHtmlValue(node, html, fallbackText) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, fallbackText);
      dispatchInputEvents(node);
      return;
    }
    if (node instanceof HTMLElement) {
      node.focus();
      if (node.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("selectAll", false);
        document.execCommand("delete", false);
        dispatchInputEvents(node);

        const clipboardData = new DataTransfer();
        clipboardData.setData("text/html", html);
        clipboardData.setData("text/plain", fallbackText);

        const pasteEvent = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboardData,
        });

        const handled = node.dispatchEvent(pasteEvent);
        if (!handled || document.queryCommandSupported("insertHTML")) {
          document.execCommand("insertHTML", false, html);
        }

        dispatchInputEvents(node);
        return;
      }
      node.textContent = fallbackText;
      dispatchInputEvents(node);
    }
  }

  function pageText() {
    return normalize(document.body?.innerText || document.body?.textContent || "");
  }

  function extractEditableText(node) {
    if (!node) {
      return "";
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return normalize(node.value || "");
    }
    if (node instanceof HTMLElement) {
      return normalize(node.innerText || node.textContent || "");
    }
    return "";
  }

  function containsAnyNeedle(text, needles) {
    const normalizedText = normalize(text || "");
    return needles.some((item) => item && normalizedText.includes(item));
  }

  function closestText(node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }
    return normalize(node.closest("label,div,section,article,form")?.textContent || "");
  }

  function extractItemIdFromUrl(url) {
    const normalizedUrl = String(url || "");
    const matched = normalizedUrl.match(/(?:item_id|article_id|group_id|content_id|id)=([a-zA-Z0-9_-]+)/);
    return matched?.[1] || "";
  }

  function getNodeHref(node) {
    if (!node) {
      return "";
    }
    if (typeof node.getAttribute === "function") {
      const href = node.getAttribute("href");
      if (href) {
        return href;
      }
    }
    const closestLink = typeof node.closest === "function" ? node.closest("a[href]") : null;
    return closestLink?.getAttribute?.("href") || "";
  }

  function getManageUrlCandidates() {
    try {
      const url = new URL(publishUrl);
      return dedupe([
        `${url.origin}/profile_v4/graphic`,
        `${url.origin}/profile_v4/graphic/manage`,
        `${url.origin}/profile_v4/manage`,
        `${url.origin}/profile_v4/graphic/publish-management`,
      ]);
    } catch {
      return [
        "https://mp.toutiao.com/profile_v4/graphic",
        "https://mp.toutiao.com/profile_v4/graphic/manage",
      ];
    }
  }

  function buildVerificationEvidence(kind, extra = "") {
    return normalize([kind, draftTitle, extra].filter(Boolean).join(" | "));
  }

  function isManagePage() {
    const text = pageText();
    return (
      ["作品管理", "内容管理", "图文", "我的作品", "全部作品"].some((item) => text.includes(item)) ||
      Boolean(
        query(
          [
            'a[href*="profile_v4/graphic"]',
            'a[href*="article"]',
            'button:has-text-any("作品管理|内容管理|图文")',
            '[class*="table"]',
            '[class*="list"]',
            '[class*="article"]',
          ],
          false,
        ),
      )
    );
  }

  function isLikelyDetailPage() {
    const currentUrl = String(window.location.href || "");
    const text = pageText();
    return Boolean(
      ["item_id=", "article_id=", "group_id=", "/article/", "/detail/"].some((item) => currentUrl.includes(item)) ||
        (draftTitleNeedles.some((item) => item && text.includes(item)) && draftBodyExcerpt && text.includes(draftBodyExcerpt)),
    );
  }

  function findTitleMatchElements() {
    if (draftTitleNeedles.length === 0) {
      return [];
    }

    const candidates = Array.from(
      document.querySelectorAll(
        [
          "a",
          "button",
          "article",
          "tr",
          "li",
          '[class*="item"]',
          '[class*="row"]',
          '[class*="card"]',
          '[class*="title"]',
          "span",
          "div",
        ].join(","),
      ),
    );

    const scored = candidates
      .filter((node) => visible(node))
      .map((node) => {
        const text = normalize(node.textContent || "");
        if (!text || text.length > 300) {
          return null;
        }
        let score = 0;
        if (draftTitle && text === draftTitle) score += 8;
        if (draftTitle && text.includes(draftTitle)) score += 6;
        if (draftTitleNeedles.some((item) => item && text.includes(item))) score += 4;
        if (draftBodyExcerpt && text.includes(draftBodyExcerpt)) score += 2;
        if (["刚刚", "分钟前", "今天", "审核中", "发布成功"].some((hint) => text.includes(hint))) score += 1;
        if (node.tagName === "A") score += 1;
        if (getNodeHref(node)) score += 1;
        return score > 0 ? { node, text, score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    return scored.slice(0, 5);
  }

  function getClickableNode(node) {
    if (!node) return null;
    if (node instanceof HTMLAnchorElement || node instanceof HTMLButtonElement) {
      return node;
    }
    return node.closest?.('a, button, [role="button"], [tabindex="0"]') || node;
  }

  function simulateClick(element) {
    if (!element) return;
    element.scrollIntoView({ block: "center", inline: "center" });
    element.click();
    try {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (e) {
      // ignore
    }
  }

  function getPreviewDialogRoot() {
    const candidates = Array.from(document.querySelectorAll("div,section,article"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => ({
        node,
        text: normalize(node.textContent || ""),
      }))
      .filter((item) => item.text.includes("返回编辑") && item.text.includes("确认发布"))
      .sort((left, right) => left.text.length - right.text.length);
    return candidates[0]?.node || null;
  }

  function isPreviewDialogOpen() {
    const dialogRoot = getPreviewDialogRoot();
    if (dialogRoot) {
      return true;
    }
    const text = pageText();
    return text.includes("返回编辑") && text.includes("确认发布");
  }

  function findPreviewPublishButton() {
    const nodes = queryAll(
      [
        'button:has-text("预览并发布")',
        '[role="button"]:has-text("预览并发布")',
        'text=预览并发布',
        'button:has-text("立即发布")',
        '[role="button"]:has-text("立即发布")',
      ],
      true,
    );
    return (
      nodes
        .map((node) => getClickableNode(node))
        .find((node) => node instanceof HTMLElement && !node.closest?.('[role="dialog"], .modal, .dialog, .semi-portal')) || null
    );
  }

  function findConfirmPublishButton() {
    const dialogRoot = getPreviewDialogRoot();
    const searchRoot = dialogRoot || document;
    const nodes = queryAll(
      [
        'button:has-text("确认发布")',
        '[role="button"]:has-text("确认发布")',
        'text=确认发布',
      ],
      true,
      searchRoot,
    );
    return nodes.map((node) => getClickableNode(node)).find((node) => node instanceof HTMLElement) || null;
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入今日头条图文发布页");
    if (!window.location.href.includes("/graphic/publish")) {
      window.location.href = publishUrl;
      await sleep(2800);
    }
    await waitFor(
      [
        'input[type="file"][accept*="image"]',
        'input[placeholder*="请输入标题"]',
        'textarea[placeholder*="请输入标题"]',
        'input[placeholder*="填写标题"]',
        'textarea[placeholder*="填写标题"]',
        'div[contenteditable="true"]',
        'button:has-text-any("上传图片|添加图片|图片|素材")',
        'div[role="button"]:has-text-any("上传图片|添加图片|图片|素材")',
        'text=文章',
      ],
      30000,
      false,
    );
    const articleMode = query(
      [
        'button:has-text-any("文章|图文")',
        'div[role="tab"]:has-text-any("文章|图文")',
        'span:has-text-any("文章|图文")',
      ],
      true,
    );
    if (articleMode instanceof HTMLElement) {
      articleMode.click();
      await sleep(1000);
    }
  }

  async function fillTitle(title) {
    setStage("fill_title", "填写标题");
    const node = await waitFor(
      [
        'input[placeholder*="请输入标题"]',
        'textarea[placeholder*="请输入标题"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[placeholder*="填写标题"]',
        'textarea[placeholder*="填写标题"]',
      ],
      20000,
      false,
    );
    setInputValue(node, title);
    await sleep(800);
    const value = extractEditableText(node) || closestText(node);
    if (!containsAnyNeedle(value, draftTitleNeedles)) {
      throw new Error("标题写入后未通过内容校验");
    }
    await sleep(1000);
  }

  async function fillBody(body, images = []) {
    setStage("fill_body", "填写正文");
    const selectors = [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder*="正文"]',
      'div[contenteditable="true"][data-placeholder*="内容"]',
      'div[contenteditable="true"][data-placeholder*="文章"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-slate-editor="true"]',
      'textarea[placeholder*="正文"]',
      'div[contenteditable="true"]',
    ];
    await waitFor(selectors, 25000, false);
    const candidates = selectors.flatMap((selector) => {
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch {
        return [];
      }
    });

    const paragraphs = body.split(/\n+/).map((item) => item.trim()).filter(Boolean);

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    const formatParagraph = (text) => {
      const formattedText = escapeHtml(text);
      return `<p>${formattedText}</p>`;
    };

    function dataUrlToFile(dataUrl, filename, mimeType) {
      const arr = String(dataUrl || "").split(",");
      if (arr.length < 2) {
        throw new Error("图片 dataUrl 无效，无法转换为 File");
      }
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mimeType });
    }

    function countInsertedImages(root = document) {
      return root.querySelectorAll(
        [
          "img",
          "figure img",
          "[class*='image'] img",
          "[class*='upload'] img",
          "[data-testid*='image']",
        ].join(","),
      ).length;
    }

    function focusEditableNode(node) {
      if (!(node instanceof HTMLElement || node instanceof HTMLTextAreaElement)) {
        return;
      }
      node.focus();
      if (!(node instanceof HTMLElement) || !node.isContentEditable) {
        return;
      }
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    function clearEditableNode(node) {
      if (node instanceof HTMLTextAreaElement) {
        setInputValue(node, "");
        return;
      }
      if (!(node instanceof HTMLElement)) {
        return;
      }
      focusEditableNode(node);
      if (node.isContentEditable) {
        document.execCommand("selectAll", false);
        document.execCommand("delete", false);
        if (normalize(node.innerText || node.textContent || "")) {
          node.innerHTML = "";
          node.textContent = "";
        }
        dispatchInputEvents(node);
      }
    }

    function insertParagraphBlock(node, paragraphHtml, paragraphText) {
      if (node instanceof HTMLTextAreaElement) {
        const currentValue = node.value || "";
        setInputValue(node, `${currentValue}${currentValue ? "\n" : ""}${paragraphText}`);
        return true;
      }
      if (!(node instanceof HTMLElement) || !node.isContentEditable) {
        return false;
      }
      focusEditableNode(node);
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/html", paragraphHtml);
      clipboardData.setData("text/plain", paragraphText);
      const pasteEvent = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      const handled = node.dispatchEvent(pasteEvent);
      if (!handled || document.queryCommandSupported("insertHTML")) {
        document.execCommand("insertHTML", false, paragraphHtml);
      }
      dispatchInputEvents(node);
      return true;
    }

    function findFileInputForEditor(editorNode) {
      // 头条工具栏里的隐藏文件 input，优先选 accept 含 image 的；范围限定在编辑器附近祖先节点
      const ancestors = [];
      let cursor = editorNode instanceof HTMLElement ? editorNode : null;
      for (let depth = 0; cursor && depth < 6; depth += 1) {
        ancestors.unshift(cursor);
        cursor = cursor.parentElement;
      }
      const roots = ancestors.length > 0 ? ancestors : [document];

      for (const root of roots) {
        const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
        const matched = inputs.find((input) => {
          const accept = (input.getAttribute("accept") || "").toLowerCase();
          return !accept || accept.includes("image") || accept.includes("*");
        });
        if (matched instanceof HTMLInputElement) {
          return matched;
        }
      }
      // 兜底：整个文档里第一个 accept 含 image 的 file input
      const globalCandidates = Array.from(document.querySelectorAll('input[type="file"]'));
      const fallback = globalCandidates.find((input) => {
        const accept = (input.getAttribute("accept") || "").toLowerCase();
        return accept.includes("image");
      });
      return fallback instanceof HTMLInputElement ? fallback : null;
    }

    function waitForRealImage(editorNode, prevCount, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finalize = (ok, payload) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          if (ok) resolve(payload);
          else reject(new Error(payload || "image_upload_timeout"));
        };

        const check = () => {
          const imgs = editorNode.querySelectorAll("img");
          if (imgs.length <= prevCount) return;
          const newest = imgs[imgs.length - 1];
          if (!(newest instanceof HTMLImageElement)) return;
          const src = newest.src || "";
          if (!src || src.startsWith("blob:") || src.startsWith("data:")) return;
          if (newest.naturalWidth === 0) return;
          finalize(true, src);
        };

        const observer = new MutationObserver(check);
        observer.observe(editorNode, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["src"],
        });
        const timer = setTimeout(() => finalize(false, "image_upload_timeout"), timeoutMs);
        check();
      });
    }

    async function uploadViaFileInput(editorNode, image, index) {
      const input = findFileInputForEditor(editorNode);
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, reason: "no_file_input" };
      }
      log(`upload_image_${index + 1}_file_input_found`);
      if (!image?.dataUrl) {
        return { ok: false, reason: "no_data_url" };
      }
      const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
      const dt = new DataTransfer();
      dt.items.add(file);

      const prevCount = editorNode.querySelectorAll("img").length;
      try {
        Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      } catch (_) {
        try {
          input.files = dt.files;
        } catch (__) {
          return { ok: false, reason: "files_assign_failed" };
        }
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
      log(`upload_image_${index + 1}_change_dispatched`);

      try {
        const src = await waitForRealImage(editorNode, prevCount, 30000);
        log(`upload_image_${index + 1}_cdn_url_received: ${src.slice(0, 120)}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
      }
    }

    async function uploadViaDrop(editorNode, image, index) {
      if (!image?.dataUrl) return { ok: false, reason: "no_data_url" };
      const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
      const dt = new DataTransfer();
      dt.items.add(file);

      const prevCount = editorNode.querySelectorAll("img").length;
      const rect = editorNode.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + Math.min(rect.height / 2, 80);

      const dispatch = (type) => {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX,
          clientY,
        });
        editorNode.dispatchEvent(event);
      };
      dispatch("dragenter");
      dispatch("dragover");
      dispatch("drop");
      log(`upload_image_${index + 1}_drop_dispatched`);

      try {
        const src = await waitForRealImage(editorNode, prevCount, 30000);
        log(`upload_image_${index + 1}_cdn_url_received: ${src.slice(0, 120)}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
      }
    }

    async function uploadViaPaste(editorNode, image, index) {
      focusEditableNode(editorNode);
      const dt = new DataTransfer();
      if (image?.dataUrl) {
        dt.items.add(dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png"));
      } else if (typeof image === "string") {
        dt.setData("text/html", `<figure><img src="${image}" alt="" /></figure>`);
        dt.setData("text/plain", image);
      } else {
        return { ok: false, reason: "unsupported_image" };
      }

      const prevCount = editorNode.querySelectorAll("img").length;
      const evt = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      editorNode.dispatchEvent(evt);
      dispatchInputEvents(editorNode);
      log(`upload_image_${index + 1}_paste_dispatched`);

      try {
        const src = await waitForRealImage(editorNode, prevCount, typeof image === "string" ? 8000 : 25000);
        log(`upload_image_${index + 1}_cdn_url_received: ${src.slice(0, 120)}`);
        return { ok: true };
      } catch (error) {
        if (typeof image === "string") {
          return { ok: true };
        }
        return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
      }
    }

    async function insertImageWithFallback(editorNode, image, index) {
      log(`upload_image_${index + 1}_strategy_A_try`);
      const a = await uploadViaFileInput(editorNode, image, index);
      if (a.ok) {
        log(`upload_image_${index + 1}_done: strategy_A`);
        return true;
      }
      log(`upload_image_${index + 1}_strategy_A_failed: ${a.reason}`);

      log(`upload_image_${index + 1}_strategy_B_try`);
      const b = await uploadViaDrop(editorNode, image, index);
      if (b.ok) {
        log(`upload_image_${index + 1}_done: strategy_B`);
        return true;
      }
      log(`upload_image_${index + 1}_strategy_B_failed: ${b.reason}`);

      log(`upload_image_${index + 1}_strategy_C_try`);
      const c = await uploadViaPaste(editorNode, image, index);
      if (c.ok) {
        log(`upload_image_${index + 1}_done: strategy_C`);
        return true;
      }
      log(`upload_image_${index + 1}_strategy_C_failed: ${c.reason}`);
      return false;
    }

    function computeImagePositions(paragraphCount, imageCount) {
      // 均匀分布：在第 round(M * k / (N+1)) 段后插入第 k 张图
      const positions = new Map();
      if (imageCount <= 0 || paragraphCount <= 0) return positions;
      for (let k = 1; k <= imageCount; k += 1) {
        const idx = Math.max(1, Math.min(paragraphCount, Math.round((paragraphCount * k) / (imageCount + 1))));
        const list = positions.get(idx) ?? [];
        list.push(k - 1);
        positions.set(idx, list);
      }
      return positions;
    }

    const prefersRichEditor = images.length > 0;

    for (const node of candidates) {
      if (!(node instanceof HTMLElement || node instanceof HTMLTextAreaElement)) {
        continue;
      }
      const contextText = normalize(
        [extractEditableText(node), closestText(node), node.getAttribute?.("data-placeholder") || "", node.getAttribute?.("aria-label") || ""].join(" "),
      );
      const isHighPriority =
        ["正文", "内容", "文章", "请输入正文"].some((item) => contextText.includes(item)) ||
        node instanceof HTMLTextAreaElement;
      if (!isHighPriority && !(node instanceof HTMLElement && node.isContentEditable)) {
        continue;
      }

      if (prefersRichEditor && (!(node instanceof HTMLElement) || !node.isContentEditable)) {
        continue;
      }

      clearEditableNode(node);
      const imagePositions = computeImagePositions(paragraphs.length, images.length);
      log(`image_distribution_plan: ${JSON.stringify(Array.from(imagePositions.keys()))}`);

      for (let i = 0; i < paragraphs.length; i += 1) {
        const pHtml = formatParagraph(paragraphs[i]);
        const pText = paragraphs[i];
        log(`fill_body_paragraph_${i + 1}: ${normalize(pText).slice(0, 24)}`);
        const inserted = insertParagraphBlock(node, pHtml, pText);
        if (!inserted) {
          throw new Error(`正文第 ${i + 1} 段写入失败`);
        }
        await sleep(250);

        const slot = imagePositions.get(i + 1);
        if (Array.isArray(slot) && slot.length > 0 && node instanceof HTMLElement) {
          for (const imageIndex of slot) {
            const imgItem = images[imageIndex];
            const uploaded = await insertImageWithFallback(node, imgItem, imageIndex);
            if (!uploaded) {
              throw new Error(`第 ${imageIndex + 1} 张图片上传失败（已尝试 file_input / drop / paste 三种策略）`);
            }
            focusEditableNode(node);
            if (document.queryCommandSupported("insertHTML")) {
              document.execCommand("insertHTML", false, "<p><br></p>");
            }
            dispatchInputEvents(node);
            await sleep(400);
          }
        }
      }

      await sleep(1200);
      const nodeText = extractEditableText(node);
      const nearbyText = closestText(node);
      const documentText = pageText();
      if (containsAnyNeedle(nodeText, bodyNeedles) || containsAnyNeedle(nearbyText, bodyNeedles) || containsAnyNeedle(documentText, bodyNeedles)) {
        log(`fill_body_verified: ${bodyNeedles[0] || draftBody.slice(0, 16)}`);
        await sleep(600);
        return;
      }
    }
    throw new Error("已找到编辑器候选节点，但正文写入后未通过内容校验");
  }

  async function fillTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) {
      return;
    }

    const node = query(
      [
        'input[placeholder*="标签"]',
        'textarea[placeholder*="标签"]',
        'input[placeholder*="#"]',
      ],
      false,
    );

    if (!node) {
      return;
    }

    setStage("fill_tags", "填写标签");
    setInputValue(node, tags.join(" "));
    await sleep(600);
    const currentText = extractEditableText(node) || closestText(node);
    const tagNeedles = tags.map((item) => normalize(item)).filter((item) => item.length >= 2);
    if (tagNeedles.length > 0 && !containsAnyNeedle(currentText, tagNeedles)) {
      log("fill_tags_verify_skipped: 标签控件未返回稳定回显，继续后续提交");
    }
    await sleep(800);
  }

  function getCoverDialogRoot() {
    const COVER_HINTS = ["选择封面", "请选择封面", "添加封面", "上传封面", "封面图片"];
    const candidates = Array.from(document.querySelectorAll("div,section,article"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => ({ node, text: normalize(node.textContent || "") }))
      .filter((item) => COVER_HINTS.some((hint) => item.text.includes(hint)))
      // 排除预览弹层
      .filter((item) => !(item.text.includes("返回编辑") && item.text.includes("确认发布")))
      .sort((left, right) => left.text.length - right.text.length);
    return candidates[0]?.node || null;
  }

  function isCoverDialogOpen() {
    return getCoverDialogRoot() !== null;
  }

  async function handleCoverDialog() {
    const root = getCoverDialogRoot();
    if (!(root instanceof HTMLElement)) {
      return false;
    }
    setStage("select_cover", "处理封面选择弹层");
    log(`cover_dialog_dump: ${(root.outerHTML || "").slice(0, 2000)}`);

    // 自动选第一张候选缩略图
    const thumbs = Array.from(root.querySelectorAll('img, [role="img"], [class*="thumb"], [class*="image-item"], [class*="cover-item"]'))
      .filter((node) => node instanceof HTMLElement && visible(node));
    const thumb = thumbs.find((node) => {
      if (node instanceof HTMLImageElement) {
        return node.naturalWidth > 40 && node.naturalHeight > 40;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    });
    if (thumb instanceof HTMLElement) {
      simulateClick(getClickableNode(thumb) || thumb);
      log("cover_thumb_clicked");
      await sleep(600);
    } else {
      log("cover_thumb_not_found");
    }

    // 点击"确定"/"完成"/"确认"按钮
    const confirmBtn = Array.from(root.querySelectorAll('button,[role="button"]'))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .find((node) => {
        const text = normalize(node.textContent || "");
        return ["确定", "完成", "确认", "保存"].some((hint) => text === hint || text.includes(hint));
      });
    if (confirmBtn instanceof HTMLElement) {
      simulateClick(confirmBtn);
      log("cover_confirm_clicked");
      await sleep(1000);
    } else {
      log("cover_confirm_not_found");
    }

    // 等弹层消失
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      if (!isCoverDialogOpen()) {
        log("cover_selected");
        return true;
      }
      await sleep(300);
    }
    return !isCoverDialogOpen();
  }

  async function openPreviewPublish() {
    setStage("preview_publish", "点击预览并发布");
    if (isPreviewDialogOpen()) {
      log("preview_publish_ready: 已进入预览确认层");
      return;
    }
    const button = findPreviewPublishButton();
    if (!(button instanceof HTMLElement)) {
      throw new Error("未找到主编辑页中的预览并发布按钮");
    }
    simulateClick(button);
    log("preview_publish: 点击预览并发布");
    const startedAt = Date.now();
    let handledCover = false;
    while (Date.now() - startedAt < 20000) {
      const text = pageText();
      if (isPreviewDialogOpen()) {
        log("preview_publish_ready: 已进入预览确认层");
        await sleep(800);
        return;
      }
      if (!handledCover && isCoverDialogOpen()) {
        handledCover = true;
        const ok = await handleCoverDialog();
        if (!ok) {
          throw new Error("封面选择弹层未能完成");
        }
        // 封面选完后头条通常会自动进预览层；若没进，再点一次预览
        await sleep(800);
        if (!isPreviewDialogOpen()) {
          const retryButton = findPreviewPublishButton();
          if (retryButton instanceof HTMLElement) {
            simulateClick(retryButton);
            log("preview_publish_retry: 选完封面后再次点击预览并发布");
          }
        }
        continue;
      }
      if (["发布失败", "请完善", "网络异常"].some((hint) => text.includes(hint))) {
        throw new Error(["发布失败", "请完善", "网络异常"].find((hint) => text.includes(hint)) || "未进入预览确认弹层");
      }
      await sleep(600);
    }
    throw new Error("未进入预览确认弹层");
  }

  async function confirmPreviewPublish() {
    setStage("confirm_publish", "点击确认发布");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      if (isPreviewDialogOpen()) {
        break;
      }
      await sleep(400);
    }
    if (!isPreviewDialogOpen()) {
      throw new Error("预览确认弹层未就绪，无法执行确认发布");
    }
    const button = findConfirmPublishButton();
    if (!(button instanceof HTMLElement)) {
      throw new Error("未找到预览层底部的确认发布按钮");
    }
    simulateClick(button);
    log("confirm_publish: 点击确认发布");
    await sleep(1200);
    log("confirm_publish_done: 已触发正式发布提交");
  }

  async function submit() {
    await openPreviewPublish();
    await confirmPreviewPublish();
    setStage("submit", "等待平台反馈");

    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const text = pageText();
      if (["发布成功", "提交成功", "审核中", "发布完成"].some((hint) => text.includes(hint))) {
        const pendingReview = text.includes("审核中");
        return {
          status: pendingReview ? "pending_review" : "submitted",
          verificationEvidence: pendingReview ? "toutiao_submit_pending_review" : "toutiao_submit_ack",
        };
      }
      if (["发布失败", "上传失败", "请完善", "网络异常"].some((hint) => text.includes(hint))) {
        throw new Error(["发布失败", "上传失败", "请完善", "网络异常"].find((hint) => text.includes(hint)) || "发布失败");
      }
      if (isManagePage() || isLikelyDetailPage()) {
        return {
          status: "submitted",
          verificationEvidence: "toutiao_submit_navigation_ack",
        };
      }
      await sleep(1000);
    }
    throw new Error("未识别到今日头条正式发布反馈");
  }

  async function openManagePage() {
    setStage("open_manage_page", "进入今日头条作品列表");

    if (isManagePage()) {
      log(`manage_page_ready: ${window.location.href}`);
      return window.location.href;
    }

    const menuSelectors = [
      'a:has-text-any("作品管理|内容管理|全部作品|图文")',
      'button:has-text-any("作品管理|内容管理|全部作品|图文")',
      'span:has-text-any("作品管理|内容管理|全部作品|图文")',
      '[role="tab"]:has-text-any("作品管理|内容管理|全部作品|图文")',
      'text=作品管理',
      'text=内容管理',
    ];

    const menuNode = query(menuSelectors, true);
    if (menuNode instanceof HTMLElement) {
      menuNode.scrollIntoView({ block: "center", inline: "center" });
      menuNode.click();
      await sleep(2200);
      if (isManagePage()) {
        log(`manage_page_ready: ${window.location.href}`);
        return window.location.href;
      }
    }

    const candidates = getManageUrlCandidates();
    for (const candidate of candidates) {
      log(`open_manage_candidate: ${candidate}`);
      window.location.href = candidate;
      await sleep(2600);
      if (isManagePage()) {
        log(`manage_page_ready: ${window.location.href}`);
        return window.location.href;
      }
    }

    throw new Error("未成功进入今日头条作品管理页");
  }

  async function openPublishedItem(match) {
    setStage("open_published_item", "打开疑似匹配的作品详情");
    const clickable = getClickableNode(match?.node);
    if (!(clickable instanceof HTMLElement)) {
      throw new Error("未找到可打开的作品详情入口");
    }

    const beforeUrl = window.location.href;
    clickable.scrollIntoView({ block: "center", inline: "center" });
    clickable.click();
    await sleep(2400);

    if (window.location.href !== beforeUrl) {
      log(`detail_page_ready: ${window.location.href}`);
      return {
        opened: true,
        verificationUrl: window.location.href,
      };
    }

    const directHref = getNodeHref(clickable);
    if (directHref) {
      window.location.href = directHref.startsWith("http") ? directHref : new URL(directHref, window.location.href).toString();
      await sleep(2400);
      return {
        opened: true,
        verificationUrl: window.location.href,
      };
    }

    return {
      opened: false,
      verificationUrl: beforeUrl,
    };
  }

  async function verifyPublishedItem(manageUrl, submitResult) {
    setStage("find_published_item", "在今日头条作品列表中查找刚发布的内容");
    const startedAt = Date.now();
    let attempts = 0;

    if (isLikelyDetailPage()) {
      const detailText = pageText();
      if (draftTitleNeedles.some((item) => detailText.includes(item)) || (draftBodyExcerpt && detailText.includes(draftBodyExcerpt))) {
        return {
          status: "published",
          verificationEvidence: buildVerificationEvidence("toutiao_direct_detail_match"),
          verificationAttempts: attempts,
          verificationUrl: window.location.href,
          platformItemId: extractItemIdFromUrl(window.location.href),
          externalStatus: submitResult.status === "pending_review" ? "pending_review_direct_detail_verified" : "submitted_direct_detail_verified",
        };
      }
    }

    while (Date.now() - startedAt < Math.min(timeoutMs, 120000)) {
      attempts += 1;
      log(`verify_attempt_${attempts}: ${window.location.href}`);
      if (!isManagePage()) {
        window.location.href = manageUrl;
        await sleep(2200);
      }

      const matches = findTitleMatchElements();
      if (matches.length > 0) {
        const match = matches[0];
        log(`verify_match_found: ${match.text.slice(0, 120)}`);

        const opened = await openPublishedItem(match).catch((error) => {
          const message = error instanceof Error ? error.message : "打开详情失败";
          log(`open_published_item_failed: ${message}`);
          return null;
        });

        if (opened?.opened) {
          setStage("verify_published_item", "在详情页确认发布结果");
          const detailText = pageText();
          const detailTitleMatched = draftTitle && detailText.includes(draftTitle);
          const detailBodyMatched = draftBodyExcerpt && detailText.includes(draftBodyExcerpt);
          if (detailTitleMatched || detailBodyMatched) {
            return {
              status: "published",
              verificationEvidence: buildVerificationEvidence(
                detailBodyMatched ? "toutiao_detail_title_body_match" : "toutiao_detail_title_match",
                match.text.slice(0, 60),
              ),
              verificationAttempts: attempts,
              verificationUrl: opened.verificationUrl,
              platformItemId: extractItemIdFromUrl(opened.verificationUrl),
              externalStatus: submitResult.status === "pending_review" ? "pending_review_verified" : "submitted_verified",
            };
          }

          throw new Error("详情页未出现标题或正文指纹，无法确认是本次发布结果");
        }

        return {
          status: "published",
          verificationEvidence: buildVerificationEvidence("toutiao_list_title_match", match.text.slice(0, 60)),
          verificationAttempts: attempts,
          verificationUrl: manageUrl,
          platformItemId: extractItemIdFromUrl(match?.node?.getAttribute?.("href") || ""),
          externalStatus: submitResult.status === "pending_review" ? "pending_review_list_verified" : "submitted_list_verified",
        };
      }

      await sleep(5000);
      window.location.reload();
      await sleep(2200);
    }

    return {
      status: submitResult.status === "pending_review" ? "pending_review" : "verification_failed",
      verificationEvidence: submitResult.verificationEvidence,
      verificationAttempts: attempts,
      verificationUrl: window.location.href,
      externalStatus: submitResult.status === "pending_review" ? "pending_review_no_match" : "submitted_no_match",
    };
  }

  try {
    await ensurePublishPage();
    await fillTitle(draftTitle);
    await fillBody(draftBody, Array.isArray(payload.preparedImages) ? payload.preparedImages : (Array.isArray(payload.draftImages) ? payload.draftImages : []));
    await fillTags(Array.isArray(payload.draftTags) ? payload.draftTags.slice(0, 8) : []);
    const submitResult = await submit();
    const draftUrl = window.location.href;

    const manageUrl = await openManagePage();
    const verificationResult = await verifyPublishedItem(manageUrl, submitResult);
    return {
      status: verificationResult.status,
      draftUrl,
      publishUrl: draftUrl,
      verificationUrl: verificationResult.verificationUrl,
      executionLog: logs,
      verificationEvidence: verificationResult.verificationEvidence,
      verificationAttempts: verificationResult.verificationAttempts,
      platformItemId: verificationResult.platformItemId,
      externalStatus: verificationResult.externalStatus,
      failureStage:
        verificationResult.status === "verification_failed" || verificationResult.status === "pending_review"
          ? "find_published_item"
          : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "今日头条自动发布失败";
    log(`error: ${message}`);
    return {
      status: "failed",
      errorMessage: message,
      failureStage: currentStage,
      executionLog: logs,
      draftUrl: window.location.href,
      verificationUrl: currentStage === "open_manage_page" || currentStage === "find_published_item" || currentStage === "open_published_item" || currentStage === "verify_published_item" ? window.location.href : undefined,
    };
  }
}
