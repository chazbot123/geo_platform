async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "wechat" });
  if (!automation) {
    return {
      status: "failed",
      failureStage: "init",
      errorMessage: "automation helper not loaded",
      executionLog: [],
      verificationEvidence: "failed_at_init",
      draftUrl: window.location.href,
    };
  }

  const {
    log,
    setStage,
    sleep,
    normalize,
    text,
    pageText,
    queryAll,
    waitFor,
    setInputValue,
    setHtmlValue,
    extractEditableText,
    getClickableNode,
    simulateClick,
    escapeHtml,
    getParagraphs,
    insertImageWithFallback,
    uploadImagesViaDocumentInput,
    computeImagePositions,
    complete,
    fail,
  } = automation;

  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10");
  const draftTitle = normalize(payload.draftTitle || "");
  const draftBodyRaw = String(payload.draftBody || "").trim();
  const draftBody = normalize(draftBodyRaw);
  const images = Array.isArray(payload.preparedImages) ? payload.preparedImages : [];

  function getSearchDocuments() {
    const docs = [document];
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        if (frame.contentDocument?.body) {
          docs.push(frame.contentDocument);
        }
      } catch (_) {
        // Cross-origin iframes cannot be inspected; the editor iframe is same-origin in normal MP pages.
      }
    }
    return docs;
  }

  function queryInDocuments(selectors, visibleOnly = true) {
    for (const doc of getSearchDocuments()) {
      const matched = queryAll(selectors, visibleOnly, doc);
      if (matched.length > 0) return matched[0];
      if (
        selectors.includes("body") &&
        doc.body &&
        (!visibleOnly || doc === document || doc.body.getBoundingClientRect().height >= 0)
      ) {
        return doc.body;
      }
    }
    return null;
  }

  async function waitForInDocuments(selectors, waitMs = 30000, visibleOnly = true) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      const node = queryInDocuments(selectors, visibleOnly);
      if (node) return node;
      await sleep(500);
    }
    const diagnostics = getSearchDocuments()
      .flatMap((doc, docIndex) =>
        Array.from(doc.querySelectorAll("input,textarea,[contenteditable='true'],[role='textbox'],iframe,div,span"))
          .filter((node) => {
            if (!(node instanceof HTMLElement)) return false;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const label = normalize([
              node.id,
              node.className,
              node.getAttribute("placeholder"),
              node.getAttribute("data-placeholder"),
              node.getAttribute("aria-label"),
              node.textContent,
            ].filter(Boolean).join(" "));
            return /标题|正文|内容|title|editor|js_title|appmsg|ueditor/i.test(label);
          })
          .slice(0, 20)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const label = normalize([
              node.id,
              node.className,
              node.getAttribute("placeholder"),
              node.getAttribute("data-placeholder"),
              node.getAttribute("aria-label"),
              node.textContent,
            ].filter(Boolean).join(" "));
            return `doc${docIndex}:${node.tagName};rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)};label=${label.slice(0, 100)}`;
          }),
      )
      .slice(0, 80)
      .join(" | ");
    log(`wait_for_missing_diagnostics: ${diagnostics || "none"}`);
    throw new Error(`target element not found: ${selectors[0] || "unknown"}`);
  }

  function buildArticleHtml() {
    const paragraphs = getParagraphs(draftBodyRaw);
    return paragraphs.length
      ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
      : `<p>${escapeHtml(draftBody)}</p>`;
  }

  function hasLoginText() {
    const page = pageText();
    return ["扫码登录", "请使用微信", "登录公众平台", "账号密码登录", "请重新登录"].some((hint) => page.includes(hint));
  }

  function extractMpToken() {
    const urls = [window.location.href, ...Array.from(document.querySelectorAll("a[href]")).map((node) => node.href || "")];
    for (const url of urls) {
      try {
        const token = new URL(url, window.location.href).searchParams.get("token");
        if (token && /^\d+$/.test(token)) return token;
      } catch (_) {
        // Ignore malformed links from page templates.
      }
    }
    const match = pageText().match(/token[=:]\s*(\d{4,})/i);
    return match?.[1] || "";
  }

  async function resolveTokenizedEditUrl() {
    const currentToken = extractMpToken();
    if (currentToken) {
      return `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&token=${currentToken}&lang=zh_CN`;
    }
    setStage("resolve_publish_token", "进入微信公众号首页解析 token");
    window.location.href = "https://mp.weixin.qq.com/cgi-bin/home?t=home/index";
    await sleep(5000);
    if (hasLoginText()) {
      throw new Error("微信公众号登录态已失效：首页要求重新登录，无法解析发布 token");
    }
    const token = extractMpToken();
    if (!token) {
      log(`resolve_publish_token_failed_url: ${window.location.href}`);
      log(`resolve_publish_token_failed_text: ${pageText().slice(0, 800) || "empty"}`);
      throw new Error("微信公众号已登录但未能解析发布 token，无法进入图文编辑器");
    }
    return `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&token=${token}&lang=zh_CN`;
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入微信公众号图文编辑页");
    if (!window.location.href.includes("mp.weixin.qq.com")) {
      window.location.href = publishUrl;
      await sleep(3500);
    }

    const currentUrl = window.location.href;
    const needsTokenizedEntry =
      hasLoginText() ||
      !currentUrl.includes("/cgi-bin/appmsg") ||
      !new URL(currentUrl, window.location.href).searchParams.get("token");
    if (needsTokenizedEntry) {
      const tokenizedUrl = await resolveTokenizedEditUrl();
      log(`load_publish_page_tokenized_url: ${tokenizedUrl.replace(/token=\d+/, "token=***")}`);
      window.location.href = tokenizedUrl;
      await sleep(5000);
    }

    if (hasLoginText()) {
      throw new Error("微信公众号登录态已失效：页面要求重新登录，无法进入图文编辑器");
    }

    await waitFor(
      [
        'iframe[id*="ueditor"]',
        'iframe[src*="ueditor"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        '[contenteditable="true"]',
        "body",
      ],
      50000,
      false,
    );
    const controls = Array.from(document.querySelectorAll("input,textarea,button,a,[role='button'],iframe,[contenteditable='true'],div,span"))
      .filter((node) => node instanceof HTMLElement)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const label = normalize([
          node.id,
          node.className,
          node.getAttribute("placeholder"),
          node.getAttribute("data-placeholder"),
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.textContent,
        ].filter(Boolean).join(" "));
        return { node, rect, label };
      })
      .filter((item) => item.rect.width > 0 && item.rect.height > 0)
      .slice(0, 80)
      .map((item) => `${item.node.tagName};rect=${Math.round(item.rect.left)},${Math.round(item.rect.top)},${Math.round(item.rect.width)},${Math.round(item.rect.height)};label=${item.label.slice(0, 100)}`)
      .join(" | ");
    log(`load_publish_page_url: ${window.location.href}`);
    log(`load_publish_page_text: ${pageText().slice(0, 800) || "empty"}`);
    log(`load_publish_page_controls: ${controls || "none"}`);
  }

  async function fillTitle() {
    setStage("fill_title", "填写微信公众号标题");
    const titleNode = await waitForInDocuments(
      [
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[name="title"]',
        'textarea[name="title"]',
        "#title",
        '#title[contenteditable="true"]',
        ".js_title",
        '.js_title[contenteditable="true"]',
        '[id*="title"][contenteditable="true"]',
        '[class*="title"][contenteditable="true"]',
        '[class*="title"] input',
        '[class*="title"] textarea',
        '[data-placeholder*="请输入标题"]',
        '[contenteditable="true"][data-placeholder*="标题"]',
        '[contenteditable="true"][placeholder*="标题"]',
      ],
      30000,
      false,
    );
    setInputValue(titleNode, draftTitle);
    await sleep(800);
    const written = normalize(extractEditableText(titleNode));
    if (!written.includes(draftTitle.slice(0, Math.min(8, draftTitle.length)))) {
      throw new Error("微信公众号标题写入后未通过校验");
    }
  }

  async function findBodyEditor() {
    const iframeBody = queryInDocuments(["body"], false);
    const candidate = queryInDocuments(
      [
        '[contenteditable="true"][data-placeholder*="正文"]',
        '[contenteditable="true"][placeholder*="正文"]',
        '[contenteditable="true"][class*="editor"]',
        '[contenteditable="true"]',
        ".ProseMirror",
        ".ql-editor",
        "#js_editor_area",
      ],
      false,
    );
    return candidate || iframeBody;
  }

  async function fillBody() {
    setStage("fill_body", "填写微信公众号正文");
    const editor = await waitForInDocuments(
      [
        '[contenteditable="true"][data-placeholder*="正文"]',
        '[contenteditable="true"][placeholder*="正文"]',
        '[contenteditable="true"][class*="editor"]',
        '[contenteditable="true"]',
        ".ProseMirror",
        ".ql-editor",
        "#js_editor_area",
        "body",
      ],
      30000,
      false,
    );

    setHtmlValue(editor, buildArticleHtml(), draftBodyRaw || draftBody);
    await sleep(1200);
    const written = normalize(extractEditableText(editor));
    if (!written.includes(draftBody.slice(0, Math.min(12, draftBody.length)))) {
      throw new Error("微信公众号正文写入后未通过校验");
    }
    return editor;
  }

  async function insertImages(editor) {
    if (!images.length) return;
    const documentUpload = await uploadImagesViaDocumentInput(images, {
      acceptNeedles: ["image", ".jpg", ".jpeg", ".png", ".webp"],
      limit: images.length,
      expectedIncrease: 1,
      waitMs: 60000,
    });
    if (documentUpload.ok) {
      log("upload_images_verified: document_remote_image_detected");
      return;
    }
    log(`upload_images_document_input_failed: ${documentUpload.reason}`);
    setStage("upload_images", "上传微信公众号正文图片");
    const paragraphs = getParagraphs(draftBodyRaw);
    const imagePositions = computeImagePositions(Math.max(paragraphs.length, 1), images.length);
    for (const [, indexes] of imagePositions.entries()) {
      for (const imageIndex of indexes) {
        const inserted = await insertImageWithFallback(editor, images[imageIndex], imageIndex);
        if (!inserted) {
          throw new Error(`微信公众号第 ${imageIndex + 1} 张图片上传失败`);
        }
      }
    }
  }

  function findSubmitButton() {
    const labels = [
      "发表",
      "发布",
      "群发",
      "保存并群发",
      "保存并发表",
      "保存",
    ];
    const nodes = queryAll(
      [
        'button:has-text-any("发表|发布|群发|保存并群发|保存并发表|保存")',
        '[role="button"]:has-text-any("发表|发布|群发|保存并群发|保存并发表|保存")',
        'a:has-text-any("发表|发布|群发|保存并群发|保存并发表|保存")',
        'text=发表',
        'text=发布',
        'text=群发',
        'text=保存',
      ],
      true,
    );
    return (
      nodes
        .map((node) => ({ node: getClickableNode(node), label: text(node) }))
        .filter((item) => item.node)
        .sort((left, right) => {
          const leftScore = labels.findIndex((label) => left.label.includes(label));
          const rightScore = labels.findIndex((label) => right.label.includes(label));
          return (leftScore < 0 ? 999 : leftScore) - (rightScore < 0 ? 999 : rightScore);
        })[0]?.node || null
    );
  }

  async function submit() {
    setStage("submit", "提交微信公众号发布");
    const button = findSubmitButton();
    if (!button) {
      throw new Error("未找到微信公众号发布、发表、群发或保存按钮");
    }
    simulateClick(button);
    await sleep(3500);

    const confirmButton = queryAll(
      [
        'button:has-text-any("确定|确认|继续|发表|发布|群发")',
        '[role="button"]:has-text-any("确定|确认|继续|发表|发布|群发")',
        'a:has-text-any("确定|确认|继续|发表|发布|群发")',
      ],
      true,
    )
      .map((node) => getClickableNode(node))
      .find(Boolean);
    if (confirmButton) {
      setStage("confirm_publish", "确认微信公众号发布弹层");
      simulateClick(confirmButton);
      await sleep(3500);
    }

    const page = pageText();
    const currentUrl = window.location.href;
    if (["成功", "已发表", "已发布", "审核", "已保存"].some((hint) => page.includes(hint))) {
      return complete({
        status: page.includes("审核") ? "pending_review" : "submitted",
        draftUrl: currentUrl,
        publishUrl: currentUrl,
        externalStatus: "wechat_submit_ack",
        verificationEvidence: "wechat_submit_ack",
      });
    }

    return complete({
      status: "submitted",
      draftUrl: currentUrl,
      publishUrl: currentUrl,
      externalStatus: "wechat_submit_clicked",
      verificationEvidence: "wechat_submit_clicked",
    });
  }

  try {
    if (!draftTitle) throw new Error("微信公众号发布标题为空");
    if (!draftBody) throw new Error("微信公众号发布正文为空");
    await ensurePublishPage();
    await fillTitle();
    const editor = await fillBody();
    await insertImages(editor);
    const result = await submit();
    setStage(result.status, "微信公众号发布流程已提交");
    return result;
  } catch (error) {
    return fail(error, "微信公众号自动发布失败");
  }
}
