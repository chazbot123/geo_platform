async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "videohao" });
  if (!automation) {
    return { status: "failed", failureStage: "init", errorMessage: "automation helper not loaded", executionLog: [], verificationEvidence: "failed_at_init", draftUrl: window.location.href };
  }

  const {
    log,
    setStage,
    sleep,
    normalize,
    pageText,
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
  const publishUrl = String(input?.publishUrl || "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate");
  const title = normalize(payload.draftTitle || "");
  const body = normalize(payload.draftBody || "");
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages : [];
  const tags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean).slice(0, 5) : [];
  const textBody = normalize([title, body, tags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" ")].filter(Boolean).join("\n\n"));

  async function ensurePage() {
    setStage("load_publish_page", "进入视频号助手发布页");
    if (!window.location.href.includes("channels.weixin.qq.com")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    if (window.location.href.includes("/login") || ["扫码登录", "请使用微信", "微信扫一扫", "登录"].some((hint) => pageText().includes(hint))) {
      throw new Error("视频号助手登录态已失效：页面要求重新登录，无法进入发布编辑器");
    }
    await waitFor(['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="file"]'], 60000, false);
    if (window.location.href.includes("/login") || ["扫码登录", "请使用微信", "微信扫一扫"].some((hint) => pageText().includes(hint))) {
      throw new Error("视频号助手登录态已失效：页面要求重新登录，无法进入发布编辑器");
    }
  }

  async function uploadImages() {
    setStage("upload_images", `上传视频号图文素材 ${preparedImages.length} 张`);
    if (!preparedImages.length) {
      throw new Error("视频号图文发布至少需要 1 张图片；当前 payload 未提供可上传图片");
    }
    const uploaded = await uploadImagesViaDocumentInput(preparedImages, {
      acceptNeedles: ["image", ".jpg", ".jpeg", ".png", ".webp"],
      limit: 9,
      expectedIncrease: 1,
      waitMs: 70000,
    });
    if (!uploaded.ok) {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
        .map((node) => `accept=${node.getAttribute("accept") || ""}; class=${node.className || ""}`)
        .join(" | ");
      throw new Error(`videohao image upload failed: ${uploaded.reason}; fileInputs=${inputs || "none"}; url=${window.location.href}; page=${pageText().slice(0, 400)}`);
    }
    log("upload_images_verified: remote_image_detected");
  }

  async function fillBody() {
    setStage("fill_body", "填写视频号文案");
    const editor = await waitFor(['textarea[placeholder*="描述"]', 'textarea[placeholder*="文案"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'], 30000, true);
    setInputValue(editor, textBody.slice(0, 1200));
    await sleep(800);
    const written = normalize(extractEditableText(editor));
    if (!written.includes(title.slice(0, Math.min(8, title.length))) && !written.includes(body.slice(0, 10))) {
      throw new Error("视频号文案写入后未通过校验");
    }
  }

  async function submit() {
    setStage("submit", "提交视频号发布");
    const button = queryAll(['button:has-text("发表")', 'button:has-text("发布")', '[role="button"]:has-text("发表")', '[role="button"]:has-text("发布")', 'text=发表'], true)
      .map((node) => getClickableNode(node))
      .find(Boolean);
    if (!button) throw new Error("未找到视频号发布按钮");
    simulateClick(button);
    log("submit_clicked: videohao");
    await sleep(6000);
    const pg = pageText();
    if (["发表成功", "发布成功", "审核"].some((hint) => pg.includes(hint))) {
      return complete({ status: pg.includes("审核") ? "pending_review" : "published", publishUrl: window.location.href, verificationEvidence: "videohao_submit_success_text" });
    }
    if (["上传视频", "添加视频", "验证码", "审核", "不能为空"].some((hint) => pg.includes(hint))) {
      return complete({ status: "verification_failed", failureStage: "submit", errorMessage: "视频号提交后出现素材、验证、审核或必填项阻断。", publishUrl: window.location.href, verificationEvidence: "videohao_platform_blocking_text" });
    }
    return complete({ status: "submitted", publishUrl: window.location.href, verificationEvidence: "videohao_submit_clicked" });
  }

  try {
    await ensurePage();
    await uploadImages();
    await fillBody();
    return await submit();
  } catch (error) {
    return fail(error, "视频号自动发布失败");
  }
}
