async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "baijiahao" });
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
    logs,
    log,
    setStage,
    sleep,
    normalize,
    visible,
    pageText,
    text,
    query,
    queryAll,
    waitFor,
    dispatchInputEvents,
    setInputValue,
    extractEditableText,
    closestText,
    containsAnyNeedle,
    focusEditableNode,
    clearEditableNode,
    formatParagraph,
    getParagraphs,
    insertParagraphBlock,
    insertImageWithFallback,
    fail,
    complete,
  } = automation;

  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://baijiahao.baidu.com/builder/rc/edit?type=news");
  const draftTitle = normalize(payload.draftTitle || "");
  const draftBody = String(payload.draftBody || "").replace(/\r\n/g, "\n").trim();
  const draftTags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean) : [];
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages.filter(Boolean) : [];

  function isHtmlElement(node) {
    return node instanceof HTMLElement;
  }

  function isTextArea(node) {
    return node instanceof HTMLTextAreaElement;
  }

  function getTitleRect() {
    const titleNode = query(
      ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '[class*="title"] input', '[class*="title"] textarea'],
      false,
    );
    return isHtmlElement(titleNode) ? titleNode.getBoundingClientRect() : null;
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
      try { return Array.from(document.querySelectorAll(selector)); } catch { return []; }
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
        if (!(isHtmlElement(node) || isTextArea(node))) return false;
        if (isHtmlElement(node) && !visible(node)) return false;
        if (isLikelyTitleNode(node)) return false;
        const rect = isHtmlElement(node) ? node.getBoundingClientRect() : null;
        if (rect && rect.left > window.innerWidth * 0.62 && rect.width < 520) return false;
        if (rect && rect.width < 360 && rect.height < 120) return false;
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
        if (isTextArea(node)) return isBodyHint && (!rect || rect.width >= 360 || rect.height >= 120);
        if (isHtmlElement(node) && node.isContentEditable) return isBodyHint || contextText.length > 0;
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
          if (rect && rect.left < window.innerWidth * 0.62) score += 4;
          if (rect && rect.left > window.innerWidth * 0.62) score -= 8;
          if (rect && rect.width > 400) score += 2;
          if (rect && rect.width > 700) score += 3;
          if (rect && rect.width < 360) score -= 8;
          if (rect && rect.height > 80) score += 3;
          if (rect && rect.height > 180) score += 3;
          if (rect && rect.height < 80) score -= 6;
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
    throw new Error(`[fill_body] 未找到百家号正文编辑器`);
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
      ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '[class*="title"] input', '[class*="title"] textarea'],
      25000,
      false,
    );
    setInputValue(node, draftTitle);
    await sleep(800);
    const written = normalize(extractEditableText(node));
    if (!written.includes(draftTitle.slice(0, 8)) || written.length < Math.max(4, Math.min(draftTitle.length, 8))) {
      throw new Error("标题写入后未通过校验");
    }
    if (node instanceof HTMLElement) node.blur();
    await sleep(300);
  }

  async function fillBody() {
    setStage("fill_body", "填写百家号正文");
    const node = await findBodyEditor();
    const paragraphs = getParagraphs(draftBody);
    const bodyNeedles = paragraphs.slice(0, 3).map((item) => normalize(item).slice(0, 16)).filter(Boolean);
    if (paragraphs.length === 0) throw new Error("正文为空，无法写入百家号正文区");

    clearEditableNode(node);

    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraphText = paragraphs[index];
      const paragraphHtml = formatParagraph(paragraphText);
      log(`fill_body_paragraph_${index + 1}: ${normalize(paragraphText).slice(0, 24)}`);
      const inserted = insertParagraphBlock(node, paragraphHtml, paragraphText);
      if (!inserted) throw new Error(`正文第 ${index + 1} 段写入失败`);
      await sleep(250);
      const currentText = normalize(extractEditableText(node));
      const documentText = pageText();
      const needle = normalize(paragraphText).slice(0, Math.min(12, paragraphText.length));
      if (!currentText.includes(needle) && !documentText.includes(needle)) {
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
    if (!preparedImages.length) return;
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
      ['input[placeholder*="标签"]', 'input[placeholder*="关键词"]', 'textarea[placeholder*="标签"]'],
      false,
    );
    if (!node) { log("fill_tags: 未找到标签输入框，跳过"); return; }
    setInputValue(node, draftTags.slice(0, 5).join(" "));
    await sleep(800);
  }

  function findVerificationHint() {
    const pg = text(document.body);
    if (["审核中", "待审核", "审核", "正在审核"].some((hint) => pg.includes(hint))) {
      return { status: "pending_review", externalStatus: "baijiahao_pending_review", verificationEvidence: "page_contains_pending_review" };
    }
    if (["已发布", "发布成功", "提交成功", "内容管理"].some((hint) => pg.includes(hint))) {
      return {
        status: pg.includes("已发布") ? "published" : "submitted",
        externalStatus: pg.includes("已发布") ? "baijiahao_published" : "baijiahao_submit_ack",
        verificationEvidence: "page_contains_publish_success",
      };
    }
    return null;
  }

  function getVisibleButtonLabels(limit = 20) {
    return Array.from(document.querySelectorAll("button,[role='button'],a"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => text(node))
      .filter(Boolean)
      .slice(0, limit);
  }

  function getBlockingHint() {
    const pg = pageText();
    const hints = [
      "验证码",
      "滑块",
      "扫码",
      "登录",
      "请先登录",
      "风险",
      "异常",
      "失败",
      "未通过",
      "违规",
      "请完善",
      "请选择",
      "必填",
      "标题",
      "正文",
      "分类",
      "封面",
      "声明",
      "原创",
      "质量",
      "审核",
    ];
    return hints.find((hint) => pg.includes(hint)) || "";
  }

  function logPageDiagnostics(prefix) {
    const sample = pageText().slice(0, 500);
    const buttons = getVisibleButtonLabels().join(" | ");
    log(`${prefix}_url: ${window.location.href}`);
    log(`${prefix}_buttons: ${buttons || "none"}`);
    log(`${prefix}_page_text: ${sample || "empty"}`);
  }

  async function submit() {
    setStage("submit", "提交百家号发布");
    function findActionButton({ allowPreview = false, preferDialog = false } = {}) {
      const positiveLabels = ["发布", "提交", "立即发布", "确认发布", "确定发布", "发表"];
      const previewLabels = ["预览", "预览并发布"];
      const negativeLabels = ["发布设置", "发布历史", "发布链接", "自动发布", "取消", "关闭", "返回", "保存草稿"];
      const candidates = Array.from(document.querySelectorAll("button,[role='button'],a"))
        .filter((node) => node instanceof HTMLElement && visible(node))
        .map((node) => {
          const label = text(node);
          const rect = node.getBoundingClientRect();
          let score = 0;
          if (positiveLabels.some((item) => label === item)) score += 12;
          if (positiveLabels.some((item) => label.includes(item))) score += 7;
          if (allowPreview && previewLabels.some((item) => label === item || label.includes(item))) score += 5;
          if (String(node.className || "").toLowerCase().includes("publish")) score += 3;
          if (preferDialog && node.closest('[role="dialog"],[class*="modal"],[class*="dialog"],[class*="popover"]')) score += 4;
          if (rect.right > window.innerWidth * 0.45) score += 1;
          if (rect.bottom > window.innerHeight * 0.45) score += 1;
          if (negativeLabels.some((item) => label.includes(item))) score -= 12;
          if (node.getAttribute("disabled") !== null || node.getAttribute("aria-disabled") === "true") score -= 20;
          return { node, label, score };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);

      return candidates[0] || null;
    }

    async function waitForVerification(timeoutMs) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const verified = findVerificationHint();
        if (verified) return verified;
        await sleep(800);
      }
      return null;
    }

    const first = findActionButton({ allowPreview: true });
    const button = first?.node || query(['button[type="submit"]', '.publish button', '[class*="publish"] button'], true);
    if (!(button instanceof HTMLElement)) throw new Error("未找到百家号发布按钮");
    log(`submit_button_selected: ${text(button) || button.tagName}`);
    button.scrollIntoView({ block: "center" });
    button.click();
    await sleep(2500);

    let verified = await waitForVerification(5000);
    if (!verified) {
      const second = findActionButton({ preferDialog: true });
      if (second?.node instanceof HTMLElement && second.node !== button) {
        log(`confirm_button_selected: ${second.label || second.node.tagName}`);
        second.node.scrollIntoView({ block: "center" });
        second.node.click();
        await sleep(2500);
        verified = await waitForVerification(20000);
      }
    }

    if (verified) {
      return complete({
        status: verified.status,
        draftUrl: window.location.href,
        publishUrl: window.location.href,
        verificationUrl: window.location.href,
        externalStatus: verified.externalStatus,
        verificationEvidence: verified.verificationEvidence,
      });
    }
    const blockingHint = getBlockingHint();
    logPageDiagnostics("submit_unverified");
    throw new Error(
      blockingHint
        ? `百家号提交后未识别到成功反馈，页面疑似阻断：${blockingHint}`
        : "百家号提交后未识别到平台发布成功、提交成功或审核中反馈",
    );
  }

  try {
    if (!draftTitle || !draftBody) throw new Error("发布稿标题或正文为空");
    await ensurePublishPage();
    await fillTitle();
    const bodyEditor = await fillBody();
    await uploadImages(bodyEditor);
    await fillTags();
    const result = await submit();
    setStage(result.status, "百家号发布流程已提交");
    return result;
  } catch (error) {
    return fail(error, "百家号自动发布失败");
  }
}
