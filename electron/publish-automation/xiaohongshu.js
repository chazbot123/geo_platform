async (input) => {
  const logs = [];
  const payload = input?.payload ?? {};
  const timeoutMs = Number(input?.timeoutMs) || 180000;
  let currentStage = "init";

  const log = (message) => {
    logs.push(message);
    console.log(`[geo-xiaohongshu] ${message}`);
  };
  const setStage = (stage, message) => {
    currentStage = stage;
    log(`${stage}: ${message}`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function visible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getNodeDepth(node, root = document) {
    let depth = 0;
    let current = node;
    while (current && current !== root.body && current !== root.documentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function getNodeArea(node) {
    const rect = node.getBoundingClientRect();
    return Math.max(1, rect.width * rect.height);
  }

  function collectTextMatches(text, root = document, baseSelector = "*") {
    const normalizedText = normalize(text);
    const nodes = Array.from(root.querySelectorAll(baseSelector)).filter((node) => {
      const content = normalize(node.textContent || "");
      if (!content || !content.includes(normalizedText)) {
        return false;
      }
      if (node === root.documentElement || node === root.body) {
        return false;
      }
      return true;
    });

    return nodes
      .filter((node) => {
        const descendants = Array.from(node.querySelectorAll("*"));
        return !descendants.some((child) => normalize(child.textContent || "").includes(normalizedText));
      })
      .sort((left, right) => {
        const leftText = normalize(left.textContent || "");
        const rightText = normalize(right.textContent || "");
        if (leftText.length !== rightText.length) {
          return leftText.length - rightText.length;
        }
        const leftArea = getNodeArea(left);
        const rightArea = getNodeArea(right);
        if (leftArea !== rightArea) {
          return leftArea - rightArea;
        }
        return getNodeDepth(right, root) - getNodeDepth(left, root);
      });
  }

  function findByText(text, root = document, baseSelector = "*") {
    return collectTextMatches(text, root, baseSelector)[0] || null;
  }

  function isLikelyClickable(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches("button, a, label, summary, input, textarea, select, [role='button'], [role='tab'], [role='menuitem']")) {
      return true;
    }
    const className = String(node.className || "").toLowerCase();
    const style = window.getComputedStyle(node);
    return Boolean(
      node.onclick ||
        node.getAttribute("onclick") ||
        node.tabIndex >= 0 ||
        style.cursor === "pointer" ||
        className.includes("btn") ||
        className.includes("button") ||
        className.includes("tab") ||
        className.includes("card") ||
        className.includes("upload"),
    );
  }

  function toClickableTarget(node, root = document) {
    let current = node instanceof HTMLElement ? node : null;
    while (current && current !== root.body && current !== root.documentElement) {
      if (isLikelyClickable(current) && visible(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return node instanceof HTMLElement && visible(node) ? node : null;
  }

  function findClickableByText(text, root = document, baseSelector = "*") {
    const matches = collectTextMatches(text, root, baseSelector);
    for (const match of matches) {
      const clickable = toClickableTarget(match, root);
      if (!clickable) continue;
      const summary = summarizeNode(clickable);
      if (summary.includes("html#") || summary.includes("body#")) {
        continue;
      }
      if (normalize(clickable.textContent || "").length > 120) {
        continue;
      }
      return clickable;
    }
    return null;
  }

  function queryInRoot(root, selectors, visibleOnly = true) {
    for (const selector of selectors) {
      try {
        if (selector.startsWith("text=")) {
          const matched = findClickableByText(normalize(selector.slice(5)), root);
          if (matched && (!visibleOnly || visible(matched))) {
            return matched;
          }
          continue;
        }

        const hasTextMatch = selector.match(/^(.*):has-text\("(.+)"\)$/);
        if (hasTextMatch) {
          const baseSelector = hasTextMatch[1]?.trim() || "*";
          const text = normalize(hasTextMatch[2]);
          const matched = findClickableByText(text, root, baseSelector);
          if (matched && (!visibleOnly || visible(matched))) {
            return matched;
          }
          continue;
        }

        const nodes = Array.from(root.querySelectorAll(selector));
        const matched = nodes.find((node) => (visibleOnly ? visible(node) : true));
        if (matched) {
          return matched;
        }
      } catch (_) {
        // ignore invalid selectors
      }
    }
    return null;
  }

  function query(selectors, visibleOnly = true) {
    return queryInRoot(document, selectors, visibleOnly);
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
      node.textContent = "";
      document.execCommand("insertText", false, value);
      if (!node.textContent?.trim()) {
        node.textContent = value;
      }
      dispatchInputEvents(node);
    }
  }

  function getVisibleEditableNodes(root = document) {
    const nodes = Array.from(
      root.querySelectorAll(
        [
          'input:not([type="hidden"]):not([type="file"])',
          "textarea",
          '[contenteditable="true"]',
          '[contenteditable="plaintext-only"]',
          'div[role="textbox"]',
        ].join(", "),
      ),
    ).filter((node) => visible(node));
    return Array.from(new Set(nodes));
  }

  function summarizeNode(node) {
    if (!(node instanceof HTMLElement)) return "";
    const rect = node.getBoundingClientRect();
    const label = normalize(
      node.getAttribute("placeholder") ||
        node.getAttribute("data-placeholder") ||
        node.getAttribute("aria-label") ||
        node.textContent ||
        "",
    ).slice(0, 30);
    return `${node.tagName.toLowerCase()}#${node.id || ""}.${String(node.className || "").slice(0, 30)}@${Math.round(rect.top)},${Math.round(rect.height)}:${label}`;
  }

  function buildEditorDomSnapshot() {
    const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
    const editables = getVisibleEditableNodes();
    const keywordHits = ["标题", "正文", "描述", "发布", "完成", "下一步", "继续编辑"]
      .map((keyword) => {
        const node = findByText(keyword);
        return node ? `${keyword}:${summarizeNode(node)}` : "";
      })
      .filter(Boolean);

    return JSON.stringify({
      url: window.location.href,
      pageTextSample: pageText.slice(0, 180),
      visibleEditableCount: editables.length,
      visibleEditables: editables.slice(0, 6).map((node) => summarizeNode(node)),
      keywordHits,
    });
  }

  async function dataUrlToFile(dataUrl, fileName, mimeType) {
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`预处理图片读取失败：${response.status}`);
    }
    const blob = await response.blob();
    return new File([blob], fileName, {
      type: mimeType || blob.type || "image/png",
    });
  }

  async function click(selectors, waitMs = 30000) {
    const node = await waitFor(selectors, waitMs, true);
    if (!(node instanceof HTMLElement)) {
      throw new Error("目标元素不可点击");
    }
    node.scrollIntoView({ block: "center", inline: "center" });
    node.click();
    await sleep(800);
    return node;
  }

  async function fetchFile(url, index) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`图片下载失败：${response.status}`);
    }
    const blob = await response.blob();
    return new File([blob], `cover-${index + 1}.png`, {
      type: blob.type || "image/png",
    });
  }

  async function uploadImages(urls) {
    const nearbyFileInput = findFileInputNearText(["上传图文", "上传图片", "上传图片，或写文字生成图片"]);
    const inputNode =
      nearbyFileInput.node ??
      (await waitFor(
        ['input[type="file"][accept*="image"]', 'input[type="file"][multiple]', 'input[type="file"]'],
        30000,
        false,
      ));
    if (!(inputNode instanceof HTMLInputElement)) {
      throw new Error("未找到图片上传输入框");
    }
    log(`upload_images_target_input: ${nearbyFileInput.matchedSelector || "global_file_input"}`);

    const transfer = new DataTransfer();
    const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages : [];
    if (preparedImages.length > 0) {
      log(`upload_images_prepare_file: use_prepared (${preparedImages.length})`);
      for (let index = 0; index < preparedImages.length; index += 1) {
        const prepared = preparedImages[index] || {};
        transfer.items.add(
          await dataUrlToFile(
            String(prepared.dataUrl || ""),
            String(prepared.name || `cover-${index + 1}.png`),
            String(prepared.mimeType || "image/png"),
          ),
        );
      }
    } else {
      log(`upload_images_prepare_file: fetch_remote (${urls.length})`);
      for (let index = 0; index < urls.length; index += 1) {
        transfer.items.add(await fetchFile(urls[index], index));
      }
    }

    log("upload_images_set_input: dispatch_files");
    inputNode.files = transfer.files;
    inputNode.dispatchEvent(new Event("input", { bubbles: true }));
    inputNode.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(2500);
  }

  async function waitForHints(successHints, failureHints, errorMessage) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      if (failureHints.some((hint) => pageText.includes(hint))) {
        throw new Error(failureHints.find((hint) => pageText.includes(hint)) || "平台返回失败");
      }
      if (successHints.some((hint) => pageText.includes(hint))) {
        return;
      }
      await sleep(1000);
    }
    throw new Error(errorMessage);
  }

  async function waitForSubmitAcknowledgement() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      if (["发布失败", "请完善", "请先上传", "请填写标题", "网络异常"].some((hint) => pageText.includes(hint))) {
        throw new Error(["发布失败", "请完善", "请先上传", "请填写标题", "网络异常"].find((hint) => pageText.includes(hint)) || "平台返回失败");
      }
      if (["发布成功", "笔记发布成功", "审核中", "发布中"].some((hint) => pageText.includes(hint))) {
        return {
          acknowledged: true,
          reviewState: pageText.includes("审核中") || pageText.includes("发布中") ? "pending_review" : "submitted",
        };
      }
      await sleep(1000);
    }
    throw new Error("未识别到小红书发布提交反馈");
  }

  async function openManagePage() {
    const candidateUrls = [
      "https://creator.xiaohongshu.com/publish/published",
      "https://creator.xiaohongshu.com/creator/post-list",
      "https://creator.xiaohongshu.com/publish/notes",
    ];

    for (const url of candidateUrls) {
      try {
        window.location.href = url;
        await sleep(2200);
        await waitForHints(["笔记", "作品", "管理", "发布"], ["404", "访问异常"], "管理列表尚未就绪");
        return url;
      } catch (_) {
        // try next candidate
      }
    }
    throw new Error("无法进入小红书作品管理页");
  }

  async function verifyCreatedItem() {
    const title = normalize(payload.draftTitle || "");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const matched = anchors.find((anchor) => {
        const text = normalize(anchor.textContent || "");
        const shortTitle = title.slice(0, 12);
        return title && text && (text.includes(title) || title.includes(text) || (shortTitle && text.includes(shortTitle)));
      });
      if (matched) {
        const href = matched.getAttribute("href") || "";
        return {
          publishUrl: href.startsWith("http") ? href : new URL(href, window.location.origin).toString(),
          verificationEvidence: "title_match_in_list",
          platformItemId: href || textContentId(matched.textContent || ""),
        };
      }

      const cards = Array.from(document.querySelectorAll("[class*='note'], [class*='post'], [class*='item'], li, article"));
      const matchedCard = cards.find((card) => {
        const text = normalize(card.textContent || "");
        const shortTitle = title.slice(0, 12);
        return !!title && (text.includes(title) || (shortTitle && text.includes(shortTitle)));
      });
      if (matchedCard) {
        const anchor = matchedCard.querySelector("a[href]");
        const href = anchor?.getAttribute("href") || window.location.href;
        return {
          publishUrl: href.startsWith("http") ? href : new URL(href, window.location.origin).toString(),
          verificationEvidence: "card_match_in_list",
          platformItemId: href || textContentId(matchedCard.textContent || ""),
        };
      }

      await sleep(1500);
    }

    return null;
  }

  function textContentId(value) {
    return normalize(value).slice(0, 60);
  }

  function detectLoginRequired() {
    const currentUrl = window.location.href;
    const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
    if (["/login", "passport", "signin", "signup"].some((hint) => currentUrl.includes(hint))) {
      return `当前页面跳转到了登录相关地址：${currentUrl}`;
    }
    const matchedText = ["登录", "手机号登录", "验证码登录", "扫码登录", "请先登录", "立即登录"].find((hint) => pageText.includes(hint));
    if (matchedText) {
      return `当前页面显示登录提示：${matchedText}`;
    }
    return "";
  }

  function getPageText() {
    return normalize(document.body?.innerText || document.body?.textContent || "");
  }

  function getImageModeUrl() {
    try {
      const url = new URL(window.location.href);
      url.pathname = "/publish/publish";
      url.searchParams.set("from", "tab_switch");
      url.searchParams.set("target", "image");
      return url.toString();
    } catch (_) {
      return "https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=image";
    }
  }

  function isImageModeUrl() {
    return window.location.href.includes("target=image");
  }

  function isImageModeLandingPage() {
    const pageText = getPageText();
    const markers = ["上传视频", "上传图文", "写长文", "发播客"].filter((item) => pageText.includes(item));
    return markers.length >= 3 && getVisibleEditableNodes().length === 0;
  }

  function getTitleSelectors() {
    return [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'div[contenteditable="true"][placeholder*="标题"]',
      'div[contenteditable="true"][data-placeholder*="标题"]',
      'div[contenteditable="plaintext-only"][placeholder*="标题"]',
      'div[contenteditable="plaintext-only"][data-placeholder*="标题"]',
      '[class*="title"] input',
      '[class*="title"] textarea',
      '[class*="title"] [contenteditable="true"]',
      '[class*="header"] input',
      '[class*="header"] textarea',
      '[class*="header"] [contenteditable="true"]',
      'input[maxlength]',
      'textarea[maxlength]',
      'div[role="textbox"][contenteditable="true"]',
    ];
  }

  function getBodySelectors() {
    return [
      'div.tiptap.ProseMirror',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder*="描述"]',
      'div[contenteditable="true"][data-placeholder*="正文"]',
      'div[contenteditable="true"][data-placeholder*="写"]',
      'div[contenteditable="true"][data-placeholder*="分享"]',
      'div[contenteditable="true"][placeholder*="描述"]',
      'div[contenteditable="true"][placeholder*="正文"]',
      'div[contenteditable="true"][placeholder*="写"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="写"]',
    ];
  }

  function findEditableNearText(labelTexts) {
    for (const labelText of labelTexts) {
      const labelNode = findByText(labelText);
      const container = labelNode?.closest("section, article, form, div");
      if (!container) continue;
      const local = queryInRoot(
        container,
        [
          'input:not([type="hidden"]):not([type="file"])',
          "textarea",
          '[contenteditable="true"]',
          '[contenteditable="plaintext-only"]',
          'div[role="textbox"]',
        ],
        true,
      );
      if (local) {
        return { node: local, matchedSelector: `near_text:${labelText}` };
      }
    }

    return { node: null, matchedSelector: "" };
  }

  function findFileInputNearText(labelTexts) {
    for (const labelText of labelTexts) {
      const labelNode = findByText(labelText);
      const container = labelNode?.closest("section, article, form, div");
      if (!container) continue;
      const local = queryInRoot(
        container,
        ['input[type="file"][accept*="image"]', 'input[type="file"][multiple]', 'input[type="file"]'],
        false,
      );
      if (local instanceof HTMLInputElement) {
        return { node: local, matchedSelector: `file_near_text:${labelText}` };
      }
    }

    return { node: null, matchedSelector: "" };
  }

  function findTitleNode() {
    const selectors = getTitleSelectors();
    const direct = query(selectors, true);
    if (direct) {
      return { node: direct, matchedSelector: selectors.find((selector) => {
        try {
          if (selector.startsWith("text=") || selector.includes(":has-text(")) return false;
          return Array.from(document.querySelectorAll(selector)).includes(direct);
        } catch (_) {
          return false;
        }
      }) || "title_selector" };
    }

    const nearby = findEditableNearText(["标题", "填写标题", "笔记标题"]);
    if (nearby.node) {
      return nearby;
    }

    const editables = getVisibleEditableNodes()
      .filter((node) => {
        const hint = normalize(
          node.getAttribute?.("placeholder") ||
            node.getAttribute?.("data-placeholder") ||
            node.getAttribute?.("aria-label") ||
            "",
        );
        return !["描述", "正文", "分享", "话题", "标签"].some((keyword) => hint.includes(keyword));
      })
      .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);

    for (const node of editables) {
      const rect = node.getBoundingClientRect();
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (!node.value.trim() && rect.height <= 100) {
          return { node, matchedSelector: "top_editable_input_fallback" };
        }
      } else if (rect.height <= 120) {
        return { node, matchedSelector: "top_editable_contenteditable_fallback" };
      }
    }

    return { node: null, matchedSelector: "" };
  }

  function findBodyNode() {
    const selectors = getBodySelectors();
    const direct = query(selectors, true);
    if (direct) {
      return {
        node: direct,
        matchedSelector:
          selectors.find((selector) => {
            try {
              if (selector.startsWith("text=") || selector.includes(":has-text(")) return false;
              return Array.from(document.querySelectorAll(selector)).includes(direct);
            } catch (_) {
              return false;
            }
          }) || "body_selector",
      };
    }

    const nearby = findEditableNearText(["正文", "描述", "内容", "写点什么", "分享你的想法"]);
    if (nearby.node) {
      return nearby;
    }

    const titleNode = findTitleNode().node;
    const editables = getVisibleEditableNodes()
      .filter((node) => node !== titleNode)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.height * rightRect.width - leftRect.height * leftRect.width;
      });

    if (editables[0]) {
      return { node: editables[0], matchedSelector: "largest_editable_fallback" };
    }

    return { node: null, matchedSelector: "" };
  }

  function isImageEditorReady() {
    if (isImageModeLandingPage()) {
      return false;
    }
    return Boolean(findTitleNode().node || findBodyNode().node || getVisibleEditableNodes().length >= 2);
  }

  async function ensureImageMode() {
    const startedAt = Date.now();
    let jumpedToImageUrl = false;
    while (Date.now() - startedAt < 25000) {
      if (isImageEditorReady()) {
        return { ready: true, reason: "image_editor_ready" };
      }

      if (!isImageModeUrl()) {
        const imageModeUrl = getImageModeUrl();
        log(`ensure_image_mode: navigate (${imageModeUrl})`);
        window.location.href = imageModeUrl;
        jumpedToImageUrl = true;
        await sleep(2500);
        continue;
      }

      const imageEntryAction = query(
        [
          'button:has-text("上传图文")',
          'div:has-text("上传图文")',
          'text=上传图文',
          'button:has-text("发布笔记")',
          'div:has-text("发布笔记")',
          'text=发布笔记',
          'button:has-text("图文")',
          'div:has-text("图文")',
          'text=图文',
        ],
        true,
      );
      if (imageEntryAction instanceof HTMLElement && isImageModeLandingPage()) {
        const label = normalize(imageEntryAction.textContent || imageEntryAction.getAttribute("aria-label") || "上传图文");
        log(`ensure_image_mode_target: ${imageEntryAction.tagName.toLowerCase()}`);
        log(`ensure_image_mode_target_summary: ${summarizeNode(imageEntryAction)}`);
        log(`ensure_image_mode: click (${label})`);
        imageEntryAction.scrollIntoView({ block: "center", inline: "center" });
        imageEntryAction.click();
        await sleep(1800);
        continue;
      }

      if (jumpedToImageUrl && isImageModeLandingPage()) {
        log("ensure_image_mode: image_landing_page_detected");
      }

      await sleep(800);
    }

    return { ready: false, reason: isImageModeLandingPage() ? "image_mode_not_entered" : "image_mode_switch_failed" };
  }

  async function settlePostUploadTransitions() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const transitionAction = query(
        [
          'button:has-text("完成")',
          'button:has-text("下一步")',
          'button:has-text("确认")',
          'button:has-text("继续编辑")',
          'button:has-text("我知道了")',
          'div[role="button"]:has-text("完成")',
          'div[role="button"]:has-text("下一步")',
          'div[role="button"]:has-text("确认")',
          'text=完成',
          'text=下一步',
          'text=确认',
          'text=继续编辑',
        ],
        true,
      );
      if (transitionAction instanceof HTMLElement) {
        const label = normalize(transitionAction.textContent || transitionAction.getAttribute("aria-label") || "unknown");
        log(`post_upload_transition: click (${label})`);
        transitionAction.scrollIntoView({ block: "center", inline: "center" });
        transitionAction.click();
        await sleep(1200);
        continue;
      }

      const titleProbe = findTitleNode().node;
      const bodyProbe = findBodyNode().node;
      if (titleProbe || bodyProbe) {
        return { settled: true, reason: titleProbe ? "title_probe_ready" : "body_probe_ready" };
      }

      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      const overlay = ["处理中", "上传中", "生成封面", "裁剪", "继续编辑", "请稍后"].find((hint) => pageText.includes(hint)) || "";
      if (overlay) {
        log(`post_upload_transition: wait (${overlay})`);
      }
      await sleep(800);
    }
    return { settled: false, reason: "post_upload_transition_timeout" };
  }

  async function waitForEditorReady() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const titleProbe = findTitleNode().node;
      const bodyProbe = findBodyNode().node;
      const publishButton = query(
        [
          'button:has-text("发布")',
          'div[role="button"]:has-text("发布")',
          'text=发布',
        ],
        true,
      );
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      const blockingOverlay =
        ["处理中", "上传中", "生成封面", "裁剪", "继续编辑"].find((hint) => pageText.includes(hint)) || "";
      if (titleProbe || bodyProbe) {
        return {
          ready: true,
          reason: titleProbe ? "title_probe_ready" : "body_probe_ready",
        };
      }
      if (publishButton) {
        log("post_upload_wait_editor_ready: publish_button_only");
      }
      if (blockingOverlay) {
        log(`post_upload_wait_editor_ready: overlay_detected (${blockingOverlay})`);
      }
      await sleep(800);
    }
    return { ready: false, reason: "editor_not_ready_timeout" };
  }

  try {
    if (!Array.isArray(payload.draftImages) || payload.draftImages.length === 0) {
      throw new Error("小红书图文发布需要至少一张图片");
    }

    setStage("prepare_mode", "准备切换到图文发布态");
    const imageMode = await ensureImageMode();
    log(`ensure_image_mode: ${imageMode.reason}`);
    if (!imageMode.ready) {
      setStage(imageMode.reason, "未能进入小红书图文编辑模式");
      log(`editor_dom_snapshot: ${buildEditorDomSnapshot()}`);
      throw new Error("未能进入小红书图文编辑模式");
    }

    const loginRequiredReason = detectLoginRequired();
    if (loginRequiredReason) {
      log(`login_required: ${loginRequiredReason}`);
      return {
        status: "failed",
        errorMessage: loginRequiredReason,
        failureStage: "login_required",
        draftUrl: window.location.href,
        executionLog: logs,
      };
    }

    setStage("upload_images", "上传图片");
    await uploadImages(payload.draftImages);

    setStage("post_upload_transition", "处理上传后的过渡步骤");
    const transition = await settlePostUploadTransitions();
    log(`post_upload_transition_result: ${transition.reason}`);

    setStage("post_upload_wait_editor_ready", "等待上传后编辑区稳定");
    log(`fill_title_probe_selectors: ${getTitleSelectors().join(" | ")}`);
    const editorReady = await waitForEditorReady();
    if (!editorReady.ready) {
      setStage("editor_not_ready", "上传后仍未进入可编辑态");
      log(`editor_dom_snapshot: ${buildEditorDomSnapshot()}`);
      throw new Error("上传后仍未进入可编辑态");
    }
    log(`editor_ready_detected: ${editorReady.reason}`);

    setStage("fill_title", "填写标题");
    const titleResult = findTitleNode();
    const titleNode = titleResult.node;
    if (!titleNode) {
      setStage("title_input_missing", "标题输入区域定位失败");
      log(`editor_dom_snapshot: ${buildEditorDomSnapshot()}`);
      throw new Error("未找到小红书标题输入区域");
    }
    log(`fill_title_found_node: ${titleResult.matchedSelector || titleNode.tagName.toLowerCase()}`);
    setInputValue(titleNode, String(payload.draftTitle || "").trim());
    await sleep(1000);

    setStage("fill_body", "填写正文与标签");
    const bodyResult = findBodyNode();
    const bodyNode = bodyResult.node;
    if (!bodyNode) {
      setStage("body_input_missing", "正文输入区域定位失败");
      log(`editor_dom_snapshot: ${buildEditorDomSnapshot()}`);
      throw new Error("未找到小红书正文输入区域");
    }
    log(`fill_body_found_node: ${bodyResult.matchedSelector || bodyNode.tagName.toLowerCase()}`);
    const tagText = (payload.draftTags || [])
      .map((tag) => String(tag || "").replace(/^#+/, "").trim())
      .filter(Boolean)
      .map((tag) => `#${tag}`)
      .join(" ");
    setInputValue(bodyNode, [String(payload.draftBody || "").trim(), tagText].filter(Boolean).join("\n"));
    await sleep(1000);

    setStage("click_submit", "点击发布");
    await click(
      [
        "button.ce-btn.bg-red",
        'button.bg-red:has-text("发布")',
        'button.ce-btn:has-text("发布")',
        'button:has-text("发布")',
        'div[role="button"]:has-text("发布")',
        'text=发布',
      ],
      30000,
    );

    setStage("submit_ack", "等待提交反馈");
    const submitAck = await waitForSubmitAcknowledgement();
    const submitUrl = window.location.href;

    setStage("open_manage_page", "进入作品管理列表做二次核验");
    const verificationUrl = await openManagePage();

    setStage("verify_created_item", "在列表中查找新发布笔记");
    const verifiedItem = await verifyCreatedItem();
    if (verifiedItem) {
      return {
        status: "published",
        draftUrl: submitUrl,
        publishUrl: verifiedItem.publishUrl,
        verificationUrl,
        externalStatus: "verified",
        verificationEvidence: verifiedItem.verificationEvidence,
        verificationAttempts: 1,
        platformItemId: verifiedItem.platformItemId,
        executionLog: logs,
      };
    }

    return {
      status: submitAck.reviewState === "pending_review" ? "pending_review" : "verification_failed",
      draftUrl: submitUrl,
      verificationUrl,
      externalStatus: submitAck.reviewState,
      verificationEvidence: "list_item_not_found",
      verificationAttempts: 1,
      failureStage: "verify_item_missing",
      errorMessage: "已提交发布，但未在小红书作品列表中核验到新内容，不能标记为成功。",
      executionLog: logs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "小红书图文发布失败";
    log(`error: ${errorMessage}`);
    return {
      status: "failed",
      errorMessage,
      failureStage: currentStage,
      draftUrl: window.location.href,
      executionLog: logs,
    };
  }
}
