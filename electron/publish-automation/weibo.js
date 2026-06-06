async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "weibo" });
  if (!automation) {
    return { status: "failed", failureStage: "init", errorMessage: "automation helper not loaded", executionLog: [], verificationEvidence: "failed_at_init", draftUrl: window.location.href };
  }

  const {
    log,
    setStage,
    sleep,
    normalize,
    pageText,
    query,
    queryAll,
    waitFor,
    setInputValue,
    extractEditableText,
    getClickableNode,
    simulateClick,
    uploadImagesViaDocumentInput,
    fail,
    complete,
  } = automation;

  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://weibo.com/");
  const title = normalize(payload.draftTitle || "");
  const body = normalize(payload.draftBody || "");
  const tags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean).slice(0, 5) : [];
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages.filter(Boolean) : [];
  const textBody = normalize([title, body, tags.map((tag) => `#${tag.replace(/^#+/, "")}#`).join(" ")].filter(Boolean).join("\n\n"));

  async function ensurePage() {
    setStage("load_publish_page", "进入微博发布页");
    if (!window.location.href.includes("weibo.com")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    await waitFor(['textarea', '[contenteditable="true"]', '[role="textbox"]'], 45000, true);
  }

  async function fillBody() {
    setStage("fill_body", "填写微博正文");
    const editor = await waitFor(
      [
        'textarea[placeholder*="分享"]',
        'textarea[placeholder*="说点"]',
        '[contenteditable="true"][placeholder*="分享"]',
        '[contenteditable="true"][aria-label*="发布"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        'textarea',
      ],
      30000,
      true,
    );
    setInputValue(editor, textBody.slice(0, 1800));
    await sleep(800);
    const written = normalize(extractEditableText(editor));
    if (!written.includes(title.slice(0, Math.min(8, title.length))) && !written.includes(body.slice(0, 10))) {
      throw new Error("微博正文写入后未通过校验");
    }
  }

  async function revealImageInput() {
    const candidates = queryAll(
      [
        'button:has-text("图片")',
        '[role="button"]:has-text("图片")',
        'a:has-text("图片")',
        'button:has-text("照片")',
        '[role="button"]:has-text("照片")',
        'a:has-text("照片")',
        'button:has-text("相册")',
        '[role="button"]:has-text("相册")',
        'a:has-text("相册")',
        '[aria-label*="图片"]',
        '[aria-label*="照片"]',
        '[title*="图片"]',
        '[title*="照片"]',
      ],
      true,
    )
      .map((node) => getClickableNode(node))
      .filter(Boolean);
    const button = candidates.find((node) => !node.disabled && !String(node.getAttribute?.("aria-disabled") || "").includes("true"));
    if (button) {
      simulateClick(button);
      await sleep(1200);
    }
  }

  async function uploadImages() {
    setStage("upload_images", `upload weibo images ${preparedImages.length}`);
    if (!preparedImages.length) {
      throw new Error("微博图文发布至少需要 1 张图片；当前 payload 未提供可上传图片");
    }
    await revealImageInput();
    const uploaded = await uploadImagesViaDocumentInput(preparedImages, { limit: 9, expectedIncrease: 1, waitMs: 60000 });
    if (!uploaded.ok) {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
        .map((node) => `accept=${node.getAttribute("accept") || ""}; class=${node.className || ""}`)
        .join(" | ");
      throw new Error(`weibo image upload failed: ${uploaded.reason}; fileInputs=${inputs || "none"}; url=${window.location.href}; page=${pageText().slice(0, 400)}`);
    }
    log("upload_images_verified: remote_image_detected");
  }

  async function submit() {
    setStage("submit", "提交微博发布");
    const candidates = queryAll(
      [
        'button:has-text("发布")',
        '[role="button"]:has-text("发布")',
        'a:has-text("发布")',
        'button:has-text("发送")',
        '[role="button"]:has-text("发送")',
        'text=发布',
        'text=发送',
      ],
      true,
    )
      .map((node) => getClickableNode(node))
      .filter(Boolean);
    const button = candidates.find((node) => !node.disabled && !String(node.getAttribute?.("aria-disabled") || "").includes("true"));
    if (!button) {
      throw new Error("未找到微博发布按钮");
    }
    simulateClick(button);
    log("submit_clicked: weibo");
    await sleep(5000);
    const pg = pageText();
    if (["发布成功", "发送成功", "已发布"].some((hint) => pg.includes(hint))) {
      return complete({ status: "published", publishUrl: window.location.href, verificationEvidence: "weibo_submit_success_text" });
    }
    if (["验证码", "安全验证", "频繁", "审核", "违规"].some((hint) => pg.includes(hint))) {
      return complete({ status: "verification_failed", failureStage: "submit", errorMessage: "微博提交后出现验证、审核或风控提示。", publishUrl: window.location.href, verificationEvidence: "weibo_platform_blocking_text" });
    }
    return complete({ status: "submitted", publishUrl: window.location.href, verificationEvidence: "weibo_submit_clicked" });
  }

  try {
    await ensurePage();
    await fillBody();
    await uploadImages();
    return await submit();
  } catch (error) {
    return fail(error, "微博自动发布失败");
  }
}
