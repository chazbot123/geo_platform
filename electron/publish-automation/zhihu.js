async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "zhihu" });
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
    insertImageWithFallback,
    fail,
    complete,
  } = automation;
  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://zhuanlan.zhihu.com/write");
  const title = normalize(payload.draftTitle || "");
  const body = String(payload.draftBody || "").replace(/\r\n/g, "\n").trim();
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages : [];
  const remoteImageUrls = Array.isArray(payload.draftImageUrls)
    ? payload.draftImageUrls.map((url) => String(url || "").trim()).filter((url) => /^https?:\/\//i.test(url))
    : [];

  async function ensurePage() {
    setStage("load_publish_page", "进入知乎写作页");
    if (!window.location.href.includes("zhihu.com")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    if (window.location.href.includes("signin") || window.location.href.includes("login") || ["登录知乎", "扫码登录", "验证码登录"].some((hint) => pageText().includes(hint))) {
      throw new Error("知乎登录态已失效：页面要求重新登录，无法进入写作页");
    }
    await waitFor(['textarea[placeholder*="标题"]', '[contenteditable="true"]', '[role="textbox"]'], 60000, true);
    if (window.location.href.includes("signin") || window.location.href.includes("login") || ["登录知乎", "扫码登录", "验证码登录"].some((hint) => pageText().includes(hint))) {
      throw new Error("知乎登录态已失效：页面要求重新登录，无法进入写作页");
    }
  }

  async function fillTitle() {
    setStage("fill_title", "填写知乎标题");
    const node = await waitFor(['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]', '[class*="Title"] textarea'], 30000, true);
    setInputValue(node, title);
    await sleep(600);
  }

  async function fillBody() {
    setStage("fill_body", "填写知乎正文");
    const node = await waitFor(['[contenteditable="true"]', '[role="textbox"]', 'textarea[placeholder*="正文"]'], 30000, true);
    setInputValue(node, body);
    await sleep(1000);
    const written = normalize(extractEditableText(node));
    if (!written.includes(normalize(body).slice(0, 10))) {
      throw new Error("知乎正文写入后未通过校验");
    }
    return node;
  }

  async function insertImages(editor) {
    setStage("upload_images", `上传知乎正文图片 ${preparedImages.length} 张`);
    if (remoteImageUrls.length > 0) {
      const beforeCount = editor.querySelectorAll("img").length;
      editor.focus();
      const html = remoteImageUrls
        .slice(0, 9)
        .map((url) => `<p><img src="${url.replace(/"/g, "&quot;")}" /></p>`)
        .join("");
      document.execCommand("insertHTML", false, html);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertHTML", data: "" }));
      await sleep(2500);
      const inserted = Array.from(editor.querySelectorAll("img")).filter((img) => /^https?:\/\//i.test(img.currentSrc || img.src || ""));
      if (inserted.length > beforeCount) {
        log(`upload_images_verified: remote_url_inserted_${inserted.length - beforeCount}`);
        return;
      }
      log("upload_images_remote_url_failed: editor_img_not_detected");
    }
    if (!preparedImages.length) {
      throw new Error("知乎图文发布至少需要 1 张图片；当前 payload 未提供可上传图片");
    }
    const documentUpload = await uploadImagesViaDocumentInput(preparedImages, {
      acceptNeedles: ["image", ".jpg", ".jpeg", ".png", ".webp"],
      limit: 9,
      expectedIncrease: 1,
      waitMs: 60000,
    });
    if (documentUpload.ok) {
      log("upload_images_verified: document_remote_image_detected");
      return;
    }
    log(`upload_images_document_input_failed: ${documentUpload.reason}`);
    const fallbackDeadlineMs = 45000;
    let insertedCount = 0;
    await Promise.race([
      (async () => {
        for (let index = 0; index < preparedImages.length; index += 1) {
          const inserted = await insertImageWithFallback(editor, preparedImages[index], index);
          if (inserted) insertedCount += 1;
          if (insertedCount > 0) return;
        }
      })(),
      new Promise((resolve) => setTimeout(resolve, fallbackDeadlineMs)),
    ]);
    if (insertedCount > 0) {
      log(`upload_images_verified: editor_fallback_inserted_${insertedCount}`);
      return;
    }
    throw new Error(`知乎图片上传未被平台接受：${documentUpload.reason}`);
  }

  async function submit() {
    setStage("submit", "提交知乎发布");
    const button = queryAll(['button:has-text("发布")', '[role="button"]:has-text("发布")', 'button:has-text("发表")', 'text=发布'], true)
      .map((node) => getClickableNode(node))
      .find(Boolean);
    if (!button) throw new Error("未找到知乎发布按钮");
    simulateClick(button);
    log("submit_clicked: zhihu");
    await sleep(6000);
    const pg = pageText();
    if (["发布成功", "已发布", "审核"].some((hint) => pg.includes(hint))) {
      return complete({ status: pg.includes("审核") ? "pending_review" : "published", publishUrl: window.location.href, verificationEvidence: "zhihu_submit_success_text" });
    }
    if (["选择专栏", "验证码", "登录", "审核", "违规"].some((hint) => pg.includes(hint))) {
      return complete({ status: "verification_failed", failureStage: "submit", errorMessage: "知乎提交后出现专栏、验证、审核或登录阻断。", publishUrl: window.location.href, verificationEvidence: "zhihu_platform_blocking_text" });
    }
    return complete({ status: "submitted", publishUrl: window.location.href, verificationEvidence: "zhihu_submit_clicked" });
  }

  try {
    await ensurePage();
    await fillTitle();
    const editor = await fillBody();
    await insertImages(editor);
    return await submit();
  } catch (error) {
    return fail(error, "知乎自动发布失败");
  }
}
