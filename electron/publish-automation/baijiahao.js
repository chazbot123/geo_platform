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
    getClickableNode,
    simulateClick,
    focusEditableNode,
    clearEditableNode,
    formatParagraph,
    getParagraphs,
    insertParagraphBlock,
    insertImageWithFallback,
    uploadImagesViaDocumentInput,
    fail,
    complete,
  } = automation;

  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://baijiahao.baidu.com/builder/rc/edit?type=news");
  const draftTitle = normalize(payload.draftTitle || "").slice(0, 64);
  const draftBody = String(payload.draftBody || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
  const draftTags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean) : [];
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages.filter(Boolean) : [];

  function isHtmlElement(node) {
    return node instanceof HTMLElement;
  }

  function isTextArea(node) {
    return node instanceof HTMLTextAreaElement;
  }

  function isIFrame(node) {
    return node instanceof HTMLIFrameElement;
  }

  function resolveEditableNode(node) {
    if (!isIFrame(node)) return node;
    try {
      const doc = node.contentDocument || node.contentWindow?.document;
      if (!doc) return node;
      const editables = Array.from(doc.querySelectorAll('[contenteditable="true"], textarea, body[contenteditable="true"]'))
        .filter((item) => isHtmlElement(item) || isTextArea(item))
        .map((item) => {
          const rect = isHtmlElement(item) ? item.getBoundingClientRect() : null;
          const itemText = normalize([
            extractEditableText(item),
            closestText(item),
            item.getAttribute?.("placeholder") || "",
            item.getAttribute?.("data-placeholder") || "",
            item.getAttribute?.("aria-label") || "",
            item.className || "",
          ].join(" "));
          let score = 0;
          if (["正文", "内容", "文章", "请输入正文", "请输入内容"].some((hint) => itemText.includes(hint))) score += 20;
          if (itemText.includes("标题") || itemText.includes("18/64") || itemText.includes("64")) score -= 8;
          if (rect && rect.height > 100) score += 6;
          if (rect && rect.top > 120) score += 6;
          if (isHtmlElement(item) && item.isContentEditable) score += 4;
          return { item, rect, itemText, score };
        })
        .sort((left, right) => right.score - left.score);
      const selected = editables[0]?.item || doc.body || node;
      log(`iframe_editor_selected: ${editables.slice(0, 5).map((entry) => `${entry.item.tagName};score=${entry.score};rect=${entry.rect ? `${Math.round(entry.rect.left)},${Math.round(entry.rect.top)},${Math.round(entry.rect.width)},${Math.round(entry.rect.height)}` : "na"};text=${entry.itemText.slice(0, 50)}`).join(" | ") || "none"}`);
      return selected;
    } catch {
      return node;
    }
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
        const isExplicitBodyHint = ["正文", "内容", "文章", "请输入正文", "请输入内容"].some((item) => contextText.includes(item));
        if (rect && rect.left > window.innerWidth * 0.62 && rect.width < 520) return false;
        if (rect && rect.height < 120 && !isExplicitBodyHint) return false;
        if (rect && rect.width < 360) return false;
        if (isIFrame(node)) return !rect || (rect.width >= 360 && rect.height >= 120);
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
          if (isIFrame(node)) score += 8;
          if (isHtmlElement(node) && node.isContentEditable) score += 3;
          if (rect && rect.left < window.innerWidth * 0.62) score += 4;
          if (rect && rect.left > window.innerWidth * 0.62) score -= 8;
          if (rect && rect.width > 400) score += 2;
          if (rect && rect.width > 700) score += 3;
          if (rect && rect.width < 360) score -= 8;
          if (rect && rect.height > 120) score += 3;
          if (rect && rect.height > 180) score += 3;
          if (rect && rect.height < 120) score -= 12;
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
        return resolveEditableNode(matched);
      }
      if (Date.now() - startedAt > 20000) {
        const diagnostics = findBodyEditorCandidates()
          .filter((node) => isHtmlElement(node) || isTextArea(node))
          .slice(0, 12)
          .map((node) => {
            const rect = isHtmlElement(node) ? node.getBoundingClientRect() : null;
            return `${node.tagName}; rect=${rect ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}` : "na"}; text=${normalize([extractEditableText(node), closestText(node), node.getAttribute?.("placeholder") || "", node.getAttribute?.("data-placeholder") || "", node.className || ""].join(" ")).slice(0, 80)}`;
          })
          .join(" | ");
        log(`body_editor_candidates: ${diagnostics || "none"}`);
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
    if (editorNode?.nodeType === 9 && editorNode.body) {
      editorNode = editorNode.body;
    }
    if (!editorNode?.querySelectorAll && editorNode?.ownerDocument?.body) {
      editorNode = editorNode.ownerDocument.body;
    }
    if (!editorNode?.querySelectorAll) {
      throw new Error("当前正文节点不是富文本编辑器，无法上传百家号图片");
    }
    if (!preparedImages.length) return;
    setStage("upload_images", "上传百家号正文图片");
    async function revealUploadControl() {
      const ueditorImageButtons = queryAll(
        [
          ".edui-for-simpleupload",
          ".edui-for-insertimage",
          ".edui-for-image",
          ".edui-for-webapp",
          ".edui-icon-image",
          ".edui-icon-simpleupload",
          ".edui-icon-insertimage",
        ],
        true,
      )
        .map((node) => getClickableNode(node) || node)
        .filter((node) => node instanceof HTMLElement);
      for (const button of ueditorImageButtons.slice(0, 4)) {
        simulateClick(button);
        log(`upload_images_ueditor_button_clicked: ${String(button.className || "").slice(0, 80)}`);
        await sleep(1200);
      }
      const labels = ["插入", "图片", "上传图片", "本地图片", "图库"];
      for (const label of labels) {
        const button = queryAll([`text=${label}`, `button:has-text("${label}")`, `[role="button"]:has-text("${label}")`, `a:has-text("${label}")`], true)
          .map((node) => ({ node, label: text(node), clickable: getClickableNode(node) }))
          .filter((item) => item.clickable instanceof HTMLElement && item.label && item.label.length <= 20)
          .sort((left, right) => left.label.length - right.label.length)[0]?.clickable;
        if (button instanceof HTMLElement) {
          simulateClick(button);
          log(`upload_images_reveal_clicked: ${label}`);
          await sleep(900);
        }
      }
      const visibleControls = Array.from(document.querySelectorAll("button,[role='button'],a,li,span,div,input"))
        .filter((node) => node instanceof HTMLElement && visible(node))
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const label = text(node) || node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("placeholder") || "";
          const accept = node instanceof HTMLInputElement ? node.getAttribute("accept") || "" : "";
          return `${node.tagName};text=${label.slice(0, 30)};accept=${accept};rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)};class=${String(node.className || "").slice(0, 40)}`;
        })
        .filter((item) => /图|片|上传|本地|图库|素材|media|image|upload|video|accept=/i.test(item))
        .slice(0, 80)
        .join(" | ");
      log(`upload_images_visible_controls: ${visibleControls || "none"}`);
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
        .map((node) => `accept=${node.getAttribute("accept") || ""}; class=${node.className || ""}`)
        .join(" | ");
      log(`upload_images_file_inputs: ${inputs || "none"}`);
    }

    for (let index = 0; index < preparedImages.length; index += 1) {
      const uploaded = await insertImageWithFallback(editorNode, preparedImages[index], index);
      if (!uploaded) {
        if (index === 0) {
          await revealUploadControl();
          const toolbarButton = queryAll(
            [
              'button:has-text("图片")',
              '[role="button"]:has-text("图片")',
              'a:has-text("图片")',
              'button:has-text("插入图片")',
              '[role="button"]:has-text("插入图片")',
              '[aria-label*="图片"]',
              '[title*="图片"]',
            ],
            true,
          )
            .map((node) => getClickableNode(node))
            .find((node) => node instanceof HTMLElement && !node.disabled && !String(node.getAttribute?.("aria-disabled") || "").includes("true"));
          if (toolbarButton) {
            simulateClick(toolbarButton);
            log("upload_images_toolbar_clicked");
            await sleep(1200);
          }
          const documentUploaded = await uploadImagesViaDocumentInput(preparedImages, { limit: preparedImages.length, expectedIncrease: 1, waitMs: 60000 });
          if (documentUploaded.ok) {
            log("upload_images_verified: document_file_input");
            return;
          }
          log(`upload_images_document_input_failed: ${documentUploaded.reason}`);
        }
        throw new Error(`第 ${index + 1} 张百家号图片上传失败（已尝试 file_input / drop / paste 三种策略）`);
      }
      focusEditableNode(editorNode);
      const editorDocument = editorNode.ownerDocument || document;
      if (editorDocument.queryCommandSupported?.("insertHTML")) {
        editorDocument.execCommand("insertHTML", false, "<p><br></p>");
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
