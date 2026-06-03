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
    throw new Error(`target element not found: ${selectors[0] || "unknown"}`);
  }

  function buildArticleHtml() {
    const paragraphs = getParagraphs(draftBodyRaw);
    return paragraphs.length
      ? paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
      : `<p>${escapeHtml(draftBody)}</p>`;
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入微信公众号图文编辑页");
    if (!window.location.href.includes("mp.weixin.qq.com")) {
      window.location.href = publishUrl;
      await sleep(3500);
    }

    const page = pageText();
    if (["扫码登录", "请使用微信", "登录公众平台", "账号密码登录"].some((hint) => page.includes(hint))) {
      throw new Error("微信公众号页面仍停留在登录态，请重新登录后再发布");
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
        ".js_title",
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
