async (input) => {
  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article");
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "xiaohongshu" });

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
    findByText,
    query,
    queryAll,
    waitFor,
    setInputValue,
    extractEditableText,
    getClickableNode,
    simulateClick,
    dataUrlToFile,
    uploadImagesViaDocumentInput,
    complete,
    fail,
  } = automation;

  const draftTitle = normalize(payload.draftTitle || "").slice(0, 20);
  const draftBody = String(payload.draftBody || "").replace(/\r\n/g, "\n").trim();
  const draftTags = Array.isArray(payload.draftTags)
    ? payload.draftTags.map((tag) => normalize(tag).replace(/^#+/, "")).filter(Boolean).slice(0, 10)
    : [];
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages : [];
  const tagLine = draftTags.length ? draftTags.map((tag) => `#${tag}`).join(" ") : "";
  const noteBody = [draftBody, tagLine].filter(Boolean).join("\n\n").slice(0, 9000);

  function findTitleInput() {
    return query([
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable="true"][data-placeholder*="标题"]',
      '[contenteditable="true"][placeholder*="标题"]',
      'input[maxlength="20"]',
    ]);
  }

  function findBodyEditor() {
    return query([
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="描述"]',
      'textarea[placeholder*="分享"]',
      '[contenteditable="true"][data-placeholder*="正文"]',
      '[contenteditable="true"][data-placeholder*="描述"]',
      '[contenteditable="true"][placeholder*="正文"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      "textarea",
    ]);
  }

  function findImageInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((node) => {
      const accept = String(node.getAttribute("accept") || "").toLowerCase();
      return !accept || accept.includes("image") || accept.includes(".jpg") || accept.includes(".jpeg") || accept.includes(".png") || accept.includes(".webp") || accept.includes("*");
    }) || null;
  }

  async function revealImageInput() {
    const uploadGraphic = queryAll(['text=上传图文'], true)
      .map((node) => ({ node, label: text(node), clickable: getClickableNode(node) }))
      .filter((item) => item.clickable instanceof HTMLElement && item.label && item.label.length <= 12)
      .sort((left, right) => {
        const leftScore = left.label === "上传图文" ? 0 : 1;
        const rightScore = right.label === "上传图文" ? 0 : 1;
        if (leftScore !== rightScore) return leftScore - rightScore;
        return left.label.length - right.label.length;
      })[0];
    if (uploadGraphic?.clickable instanceof HTMLElement) {
      simulateClick(uploadGraphic.clickable);
      log(`upload_images_reveal_clicked: ${uploadGraphic.label.slice(0, 40)}`);
      await sleep(1500);
      return;
    }
    const words = ["上传图片", "上传图文", "选择图片", "添加图片", "发布笔记", "图文"];
    const candidates = Array.from(document.querySelectorAll("button,[role='button'],a,span,div"))
      .filter((node) => node instanceof HTMLElement)
      .map((node) => {
        const label = text(node);
        return { node, label, clickable: getClickableNode(node) };
      })
      .filter((item) => {
        if (!(item.clickable instanceof HTMLElement)) return false;
        if (!item.label || item.label.length > 40) return false;
        return words.some((word) => item.label.includes(word));
      })
      .map((item) => item.clickable);
    const button = candidates[0];
    if (!button) return;
    simulateClick(button);
    log(`upload_images_reveal_clicked: ${text(button).slice(0, 40)}`);
    await sleep(1200);
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "open xiaohongshu creator publish page");
    if (!window.location.href.includes("creator.xiaohongshu.com")) {
      window.location.href = publishUrl;
      await sleep(3500);
    }

    await waitFor(
      [
        'input[type="file"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'textarea[placeholder*="正文"]',
        '[contenteditable="true"]',
        "button",
      ],
      60000,
      false,
    );

    const graphicTab = findByText(["图文", "发布图文", "笔记"], document, "button,[role='tab'],[role='button'],span,div");
    if (graphicTab instanceof HTMLElement) {
      simulateClick(getClickableNode(graphicTab) || graphicTab);
      await sleep(1000);
      log("load_publish_page_tab_checked: graphic_note");
    }
  }

  async function uploadImages() {
    setStage("prepare_images", "validate xiaohongshu image materials");
    if (!preparedImages.length) {
      throw new Error("小红书图文发布至少需要 1 张图片；当前 payload 未提供可上传图片，已在素材阶段拦截。");
    }

    setStage("upload_images", `upload ${preparedImages.length} xiaohongshu images`);
    let inputNode = findImageInput();
    if (!(inputNode instanceof HTMLInputElement)) {
      await revealImageInput();
      inputNode = findImageInput();
    }
    if (!(inputNode instanceof HTMLInputElement)) {
      log("upload_images_file_input_not_found_after_reveal");
    }

    const uploaded = await uploadImagesViaDocumentInput(preparedImages, {
      acceptNeedles: ["image", ".jpg", ".jpeg", ".png", ".webp"],
      limit: 9,
      expectedIncrease: 1,
      waitMs: 60000,
    });
    if (!uploaded.ok) {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
        .map((node) => `accept=${node.getAttribute("accept") || ""}; class=${node.className || ""}`)
        .join(" | ");
      throw new Error(`xiaohongshu image upload failed: ${uploaded.reason}; fileInputs=${inputs || "none"}; url=${window.location.href}; page=${pageText().slice(0, 400)}`);
    }
    log("upload_images_verified: remote_image_detected");
  }

  async function fillTitle() {
    if (!draftTitle) {
      throw new Error("小红书标题为空");
    }

    setStage("fill_title", "fill xiaohongshu title");
    const titleNode = findTitleInput() || await waitFor(
      ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', 'input[maxlength="20"]'],
      30000,
      true,
    );
    setInputValue(titleNode, draftTitle);
    await sleep(800);
    const written = normalize(titleNode.value || titleNode.innerText || titleNode.textContent || "");
    if (!written.includes(draftTitle.slice(0, Math.min(6, draftTitle.length)))) {
      throw new Error("小红书标题写入后未通过校验");
    }
  }

  async function fillBody() {
    if (!noteBody) {
      throw new Error("小红书正文为空");
    }

    setStage("fill_body", "fill xiaohongshu note body");
    const bodyNode = findBodyEditor() || await waitFor(
      ['textarea[placeholder*="正文"]', 'textarea[placeholder*="描述"]', '[contenteditable="true"]', '[role="textbox"]'],
      30000,
      true,
    );
    setInputValue(bodyNode, noteBody);
    await sleep(1000);
    const written = normalize(extractEditableText(bodyNode));
    if (!written.includes(normalize(noteBody).slice(0, 10))) {
      throw new Error("小红书正文写入后未通过校验");
    }
  }

  async function fillTags() {
    setStage("fill_tags", "verify xiaohongshu tags in body");
    if (!draftTags.length) {
      log("fill_tags: skipped (no tags)");
      return;
    }
    const pg = pageText();
    const missing = draftTags.filter((tag) => !pg.includes(`#${tag}`) && !pg.includes(tag));
    if (missing.length) {
      log(`fill_tags_inline_missing_but_continue: ${missing.join(",")}`);
    } else {
      log(`fill_tags_inline_ok: ${draftTags.length}`);
    }
  }

  async function submit() {
    setStage("submit", "submit xiaohongshu note");
    const button = queryAll(
      [
        'button:has-text("发布")',
        '[role="button"]:has-text("发布")',
        'button:has-text("提交")',
        '[role="button"]:has-text("提交")',
        'text=发布',
      ],
      true,
    )
      .map((node) => getClickableNode(node))
      .find((node) => node instanceof HTMLElement && !node.disabled && !String(node.getAttribute?.("aria-disabled") || "").includes("true"));

    if (!button) {
      throw new Error("未找到小红书发布按钮");
    }

    simulateClick(button);
    log("submit_clicked: xiaohongshu");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      await sleep(1000);
      const pg = pageText();
      if (["发布成功", "提交成功", "审核中", "审核", "已发布", "作品管理"].some((hint) => pg.includes(hint))) {
        const pending = pg.includes("审核");
        return complete({
          status: pending ? "pending_review" : "submitted",
          draftUrl: window.location.href,
          publishUrl: window.location.href,
          externalStatus: pending ? "xiaohongshu_pending_review" : "xiaohongshu_submit_ack",
          verificationEvidence: pending ? "xiaohongshu_pending_review_text" : "xiaohongshu_submit_ack",
        });
      }
      const blockingHint = ["验证码", "扫码", "登录", "风险", "异常", "失败", "违规", "请完善", "请选择", "图片上传", "敏感"].find((hint) => pg.includes(hint));
      if (blockingHint) {
        return complete({
          status: "verification_failed",
          failureStage: "submit",
          errorMessage: `小红书提交后出现平台阻断：${blockingHint}`,
          draftUrl: window.location.href,
          publishUrl: window.location.href,
          verificationEvidence: "xiaohongshu_platform_blocking_text",
        });
      }
    }

    log(`submit_no_clear_ack: ${text(document.body).slice(0, 300)}`);
    return complete({
      status: "submitted",
      draftUrl: window.location.href,
      publishUrl: window.location.href,
      externalStatus: "xiaohongshu_submit_clicked",
      verificationEvidence: "xiaohongshu_submit_clicked_no_clear_ack",
    });
  }

  try {
    await ensurePublishPage();
    await uploadImages();
    await fillTitle();
    await fillBody();
    await fillTags();
    const result = await submit();
    setStage(result.status, "xiaohongshu publish flow submitted");
    return result;
  } catch (error) {
    return fail(error, "小红书自动发布失败");
  }
}
