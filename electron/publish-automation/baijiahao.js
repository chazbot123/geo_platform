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
  const draftBody = String(payload.draftBody || "").replace(/\r\n/g, "\n").trim();
  const draftTags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean) : [];
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages.filter(Boolean) : [];

  function ownerWindow(node) {
    return node?.ownerDocument?.defaultView || window;
  }

  function isHtmlElement(node) {
    const view = ownerWindow(node);
    return Boolean(node && view?.HTMLElement && node instanceof view.HTMLElement);
  }

  function isInput(node) {
    const view = ownerWindow(node);
    return Boolean(node && view?.HTMLInputElement && node instanceof view.HTMLInputElement);
  }

  function isTextArea(node) {
    const view = ownerWindow(node);
    return Boolean(node && view?.HTMLTextAreaElement && node instanceof view.HTMLTextAreaElement);
  }

  function visible(node) {
    if (!isHtmlElement(node)) return false;
    const style = ownerWindow(node).getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function pageText() {
    return normalize(document.body?.innerText || document.body?.textContent || "");
  }

  function text(node) {
    return normalize(node?.innerText || node?.textContent || "");
  }

  function extractEditableText(node) {
    if (isInput(node) || isTextArea(node)) {
      return node.value || "";
    }
    return node?.innerText || node?.textContent || "";
  }

  function closestText(node) {
    if (!node?.parentElement && typeof node?.getAttribute !== "function") {
      return "";
    }
    let current = node;
    const chunks = [];
    for (let depth = 0; current && depth < 4; depth += 1) {
      chunks.push(current.getAttribute?.("data-placeholder") || "");
      chunks.push(current.getAttribute?.("aria-label") || "");
      chunks.push(current.textContent || "");
      current = current.parentElement;
    }
    return normalize(chunks.join(" "));
  }

  function containsAnyNeedle(haystack, needles) {
    const target = normalize(haystack);
    return needles.some((needle) => target.includes(normalize(needle)));
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
    const view = ownerWindow(node);
    node.dispatchEvent(new view.Event("input", { bubbles: true }));
    node.dispatchEvent(new view.Event("change", { bubbles: true }));
    node.dispatchEvent(new view.Event("blur", { bubbles: true }));
    if (typeof view.InputEvent === "function") {
      node.dispatchEvent(new view.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: "" }));
    }
  }

  function setInputValue(node, value) {
    if (isInput(node) || isTextArea(node)) {
      const view = ownerWindow(node);
      const proto = isTextArea(node) ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, value);
      dispatchInputEvents(node);
      return;
    }
    if (isHtmlElement(node)) {
      node.focus();
      if (node.isContentEditable) {
        node.ownerDocument.execCommand("selectAll", false);
        node.ownerDocument.execCommand("delete", false);
        node.ownerDocument.execCommand("insertText", false, value);
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

  function focusEditableNode(node) {
    if (!(isHtmlElement(node) || isTextArea(node))) {
      return;
    }
    node.focus();
    if (!isHtmlElement(node) || !node.isContentEditable) {
      return;
    }
    const view = ownerWindow(node);
    const selection = view.getSelection();
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function getTitleRect() {
    const titleNode = query(
      [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[class*="title"] input',
        '[class*="title"] textarea',
      ],
      false,
    );
    return isHtmlElement(titleNode) ? titleNode.getBoundingClientRect() : null;
  }

  function clearEditableNode(node) {
    if (isTextArea(node)) {
      setInputValue(node, "");
      return;
    }
    if (!isHtmlElement(node)) {
      return;
    }
    focusEditableNode(node);
    if (node.isContentEditable) {
      node.ownerDocument.execCommand("selectAll", false);
      node.ownerDocument.execCommand("delete", false);
      if (normalize(node.innerText || node.textContent || "")) {
        node.innerHTML = "";
        node.textContent = "";
      }
      dispatchInputEvents(node);
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatParagraph(value) {
    return `<p>${escapeHtml(value)}</p>`;
  }

  function insertParagraphBlock(node, paragraphHtml, paragraphText) {
    if (isTextArea(node)) {
      const currentValue = node.value || "";
      setInputValue(node, `${currentValue}${currentValue ? "\n" : ""}${paragraphText}`);
      return true;
    }
    if (!isHtmlElement(node) || !node.isContentEditable) {
      return false;
    }
    focusEditableNode(node);
    const view = ownerWindow(node);
    const doc = node.ownerDocument;
    node.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, cancelable: true, view }));
    node.dispatchEvent(new view.MouseEvent("mouseup", { bubbles: true, cancelable: true, view }));
    node.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true, view }));
    const clipboardData = new view.DataTransfer();
    clipboardData.setData("text/html", paragraphHtml);
    clipboardData.setData("text/plain", paragraphText);
    const pasteEvent = new view.ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    const handled = node.dispatchEvent(pasteEvent);
    if (!handled || doc.queryCommandSupported("insertHTML")) {
      doc.execCommand("insertHTML", false, paragraphHtml);
    }
    if (!normalize(node.innerText || node.textContent || "").includes(normalize(paragraphText).slice(0, Math.min(12, paragraphText.length)))) {
      const block = doc.createElement("p");
      block.textContent = paragraphText;
      node.appendChild(block);
    }
    dispatchInputEvents(node);
    return true;
  }

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

  function findFileInputForEditor(editorNode) {
    const ancestors = [];
    let cursor = editorNode instanceof HTMLElement ? editorNode : null;
    for (let depth = 0; cursor && depth < 7; depth += 1) {
      ancestors.unshift(cursor);
      cursor = cursor.parentElement;
    }
    const searchRoots = ancestors.length > 0 ? ancestors : [document];
    for (const root of searchRoots) {
      const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
      const matched = inputs.find((input) => {
        const accept = (input.getAttribute("accept") || "").toLowerCase();
        return !accept || accept.includes("image") || accept.includes("*");
      });
      if (matched instanceof HTMLInputElement) {
        return matched;
      }
    }
    const fallback = Array.from(document.querySelectorAll('input[type="file"]')).find((input) => {
      const accept = (input.getAttribute("accept") || "").toLowerCase();
      return accept.includes("image");
    });
    return fallback instanceof HTMLInputElement ? fallback : null;
  }

  function waitForRealImage(editorNode, prevCount, waitMs = 30000) {
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
        if (imgs.length <= prevCount) {
          return;
        }
        const newest = imgs[imgs.length - 1];
        if (!(newest instanceof HTMLImageElement)) {
          return;
        }
        const src = newest.src || "";
        if (!src || src.startsWith("blob:") || src.startsWith("data:")) {
          return;
        }
        if (newest.naturalWidth === 0) {
          return;
        }
        finalize(true, src);
      };

      const observer = new MutationObserver(check);
      observer.observe(editorNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
      const timer = setTimeout(() => finalize(false, "image_upload_timeout"), waitMs);
      check();
    });
  }

  async function uploadViaFileInput(editorNode, image, index) {
    const input = findFileInputForEditor(editorNode);
    if (!(input instanceof HTMLInputElement)) {
      return { ok: false, reason: "no_file_input" };
    }
    if (!image?.dataUrl) {
      return { ok: false, reason: "no_data_url" };
    }
    log(`upload_image_${index + 1}_file_input_found`);
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
      log(`upload_image_${index + 1}_cdn_url_received: ${String(src).slice(0, 120)}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
    }
  }

  async function uploadViaDrop(editorNode, image, index) {
    if (!image?.dataUrl) {
      return { ok: false, reason: "no_data_url" };
    }
    const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
    const dt = new DataTransfer();
    dt.items.add(file);
    const rect = editorNode.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + Math.min(rect.height / 2, 120);
    const prevCount = editorNode.querySelectorAll("img").length;

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
      log(`upload_image_${index + 1}_cdn_url_received: ${String(src).slice(0, 120)}`);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
    }
  }

  async function uploadViaPaste(editorNode, image, index) {
    if (!image?.dataUrl) {
      return { ok: false, reason: "no_data_url" };
    }
    focusEditableNode(editorNode);
    const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
    const dt = new DataTransfer();
    dt.items.add(file);
    const prevCount = editorNode.querySelectorAll("img").length;
    const evt = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
    editorNode.dispatchEvent(evt);
    dispatchInputEvents(editorNode);
    log(`upload_image_${index + 1}_paste_dispatched`);

    try {
      const src = await waitForRealImage(editorNode, prevCount, 25000);
      log(`upload_image_${index + 1}_cdn_url_received: ${String(src).slice(0, 120)}`);
      return { ok: true };
    } catch (error) {
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

  function getParagraphs(body) {
    return String(body || "")
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function findBodyEditorCandidates() {
    const selectors = [
      '[contenteditable="true"][data-placeholder*="正文"]',
      '[contenteditable="true"][placeholder*="正文"]',
      '[contenteditable="true"][data-placeholder*="内容"]',
      '[contenteditable="true"][placeholder*="内容"]',
      '[contenteditable="true"][aria-label*="正文"]',
      '[contenteditable="true"][aria-label*="内容"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="内容"]',
      '[class*="editor"] [contenteditable="true"]',
      '[class*="edui"] iframe',
      '[id*="ueditor"] iframe',
      'iframe',
      '[class*="content"] [contenteditable="true"]',
      '[class*="article"] [contenteditable="true"]',
      '[contenteditable="true"]',
    ];

    const candidates = selectors.flatMap((selector) => {
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch {
        return [];
      }
    });
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) continue;
        candidates.push(...Array.from(doc.querySelectorAll('body[contenteditable="true"], [contenteditable="true"], textarea')));
      } catch {
        // ignore cross-origin frames
      }
    }
    return Array.from(new Set(candidates));
  }

  function isLikelyTitleNode(node) {
    const contextText = normalize(
      [
        extractEditableText(node),
        closestText(node),
        node?.getAttribute?.("placeholder") || "",
        node?.getAttribute?.("data-placeholder") || "",
        node?.getAttribute?.("aria-label") || "",
        node?.className || "",
      ].join(" "),
    );
    return ["标题", "请输入标题", "title"].some((item) => contextText.includes(item));
  }

  async function findBodyEditor() {
    const startedAt = Date.now();
    const titleRect = getTitleRect();
    while (Date.now() - startedAt < 25000) {
      const candidates = findBodyEditorCandidates().filter((node) => {
        if (!(isHtmlElement(node) || isTextArea(node))) {
          return false;
        }
        if (isHtmlElement(node) && !visible(node)) {
          return false;
        }
        if (isLikelyTitleNode(node)) {
          return false;
        }
        const contextText = normalize(
          [
            extractEditableText(node),
            closestText(node),
            node.getAttribute?.("placeholder") || "",
            node.getAttribute?.("data-placeholder") || "",
            node.getAttribute?.("aria-label") || "",
            node.className || "",
          ].join(" "),
        );
        const isBodyHint = ["正文", "内容", "文章", "请输入正文", "请输入内容", "editor", "content"].some((item) => contextText.includes(item));
        if (isTextArea(node)) {
          return isBodyHint;
        }
        if (isHtmlElement(node) && node.isContentEditable) {
          return isBodyHint || contextText.length > 0;
        }
        return false;
      });

      const scored = candidates
        .map((node) => {
          const rect = isHtmlElement(node) ? node.getBoundingClientRect() : null;
          const contextText = normalize(
            [
              extractEditableText(node),
              closestText(node),
              node.getAttribute?.("placeholder") || "",
              node.getAttribute?.("data-placeholder") || "",
              node.getAttribute?.("aria-label") || "",
              node.className || "",
              node.id || "",
            ].join(" "),
          );
          let score = 0;
          if (["正文", "内容", "文章", "请输入正文", "请输入内容"].some((item) => contextText.includes(item))) score += 8;
          if (String(node.className || "").toLowerCase().includes("editor")) score += 4;
          if (isHtmlElement(node) && node.isContentEditable) score += 3;
          if (rect && rect.width > 400) score += 2;
          if (rect && rect.height > 80) score += 3;
          if (titleRect && rect && rect.top > titleRect.bottom - 10) score += 6;
          if (titleRect && rect && rect.top < titleRect.top + 20) score -= 8;
          if (contextText.includes(draftTitle.slice(0, 8))) score -= 8;
          if (contextText.length > 1200) score -= 2;
          return { node, score, rect, contextText };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);

      const matched = scored[0]?.node;
      if (matched) {
        const rect = isHtmlElement(matched) ? matched.getBoundingClientRect() : null;
        log(
          `body_editor_selected: score=${scored[0].score}; tag=${matched.tagName}; class=${String(matched.className || "").slice(0, 80)}; rect=${rect ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}` : "na"}`,
        );
        return matched;
      }
      await sleep(500);
    }
    throw new Error(`[${currentStage}] 未找到百家号正文编辑器`);
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
        '[contenteditable="true"][data-placeholder*="正文"]',
        '[contenteditable="true"][data-placeholder*="内容"]',
        '[class*="editor"] [contenteditable="true"]',
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
    setInputValue(node, draftTitle);
    await sleep(800);
    const written = normalize(extractEditableText(node));
    if (!written.includes(draftTitle.slice(0, 8)) || written.length < Math.max(4, Math.min(draftTitle.length, 8))) {
      throw new Error("标题写入后未通过校验");
    }
    if (node instanceof HTMLElement) {
      node.blur();
    }
    await sleep(300);
  }

  async function fillBody() {
    setStage("fill_body", "填写百家号正文");
    const node = await findBodyEditor();
    const paragraphs = getParagraphs(draftBody);
    const bodyNeedles = paragraphs.slice(0, 3).map((item) => normalize(item).slice(0, 16)).filter(Boolean);
    if (paragraphs.length === 0) {
      throw new Error("正文为空，无法写入百家号正文区");
    }

    clearEditableNode(node);

    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraphText = paragraphs[index];
      const paragraphHtml = formatParagraph(paragraphText);
      log(`fill_body_paragraph_${index + 1}: ${normalize(paragraphText).slice(0, 24)}`);
      const inserted = insertParagraphBlock(node, paragraphHtml, paragraphText);
      if (!inserted) {
        throw new Error(`正文第 ${index + 1} 段写入失败`);
      }
      await sleep(250);
      const currentText = normalize(extractEditableText(node));
      const documentText = pageText();
      if (
        !currentText.includes(normalize(paragraphText).slice(0, Math.min(12, paragraphText.length))) &&
        !documentText.includes(normalize(paragraphText).slice(0, Math.min(12, paragraphText.length)))
      ) {
        throw new Error(`正文第 ${index + 1} 段未写入正文编辑区`);
      }
    }

    await sleep(1000);
    const written = normalize(extractEditableText(node));
    if (bodyNeedles.length > 0 && !containsAnyNeedle(written, bodyNeedles) && !containsAnyNeedle(pageText(), bodyNeedles)) {
      throw new Error("正文写入后未通过整体校验");
    }
    return node;
  }

  async function uploadImages(editorNode) {
    if (!(editorNode instanceof HTMLElement)) {
      log("upload_images_not_ready: 当前正文节点不是富文本编辑器，跳过图片上传");
      return;
    }
    if (!preparedImages.length) {
      return;
    }
    setStage("upload_images", "上传百家号正文图片");
    for (let index = 0; index < preparedImages.length; index += 1) {
      const uploaded = await insertImageWithFallback(editorNode, preparedImages[index], index);
      if (!uploaded) {
        log(`upload_image_${index + 1}_skipped: 百家号图片控件未接收上传，继续发布纯文本正文`);
        continue;
      }
      focusEditableNode(editorNode);
      if (document.queryCommandSupported("insertHTML")) {
        document.execCommand("insertHTML", false, "<p><br></p>");
      }
      dispatchInputEvents(editorNode);
      await sleep(500);
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
    setInputValue(node, draftTags.slice(0, 5).join(" "));
    await sleep(800);
  }

  function findVerificationHint() {
    const page = text(document.body);
    if (["审核中", "待审核", "审核", "正在审核"].some((hint) => page.includes(hint))) {
      return {
        status: "pending_review",
        externalStatus: "baijiahao_pending_review",
        verificationEvidence: "page_contains_pending_review",
      };
    }
    if (["已发布", "发布成功", "提交成功", "内容管理"].some((hint) => page.includes(hint))) {
      return {
        status: page.includes("已发布") ? "published" : "submitted",
        externalStatus: page.includes("已发布") ? "baijiahao_published" : "baijiahao_submit_ack",
        verificationEvidence: "page_contains_publish_success",
      };
    }
    return null;
  }

  async function submit() {
    setStage("submit", "提交百家号发布");
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],a"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => {
        const label = text(node);
        const rect = node.getBoundingClientRect();
        let score = 0;
        if (label === "发布" || label === "提交" || label === "立即发布") score += 10;
        if (["发布", "提交", "立即发布"].some((item) => label.includes(item))) score += 5;
        if (String(node.className || "").toLowerCase().includes("publish")) score += 3;
        if (rect.right > window.innerWidth * 0.45) score += 1;
        if (rect.bottom > window.innerHeight * 0.45) score += 1;
        if (["发布设置", "发布历史", "发布链接", "自动发布"].some((item) => label.includes(item))) score -= 8;
        if (node.getAttribute("disabled") !== null || node.getAttribute("aria-disabled") === "true") score -= 20;
        return { node, label, score, rect };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    const button =
      candidates[0]?.node ||
      query(['button[type="submit"]', '.publish button', '[class*="publish"] button'], true);
    if (!(button instanceof HTMLElement)) {
      throw new Error("未找到百家号发布按钮");
    }
    const chosenText = text(button);
    log(`submit_button_selected: ${chosenText || button.tagName}`);
    button.scrollIntoView({ block: "center" });
    button.click();
    await sleep(3500);
    const verified = findVerificationHint();
    if (verified) {
      return {
        status: verified.status,
        draftUrl: window.location.href,
        publishUrl: window.location.href,
        verificationUrl: window.location.href,
        externalStatus: verified.externalStatus,
        executionLog: logs,
        verificationEvidence: verified.verificationEvidence,
      };
    }
    return {
      status: "submitted",
      draftUrl: window.location.href,
      publishUrl: window.location.href,
      verificationUrl: window.location.href,
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
    const bodyEditor = await fillBody();
    await uploadImages(bodyEditor);
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
