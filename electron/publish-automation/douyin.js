async (input) => {
  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://creator.douyin.com/creator-micro/content/upload");
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "douyin" });

  if (!automation) {
    return {
      status: "failed",
      failureStage: "init",
      errorMessage: "automation helper not loaded",
      executionLog: [],
      verificationEvidence: "failed_at_init",
    };
  }

  const {
    setStage,
    sleep,
    normalize,
    text,
    findByText,
    query,
    queryAll,
    waitFor,
    setInputValue,
    getClickableNode,
    simulateClick,
    dataUrlToFile,
    uploadImagesViaDocumentInput,
    complete,
    fail,
  } = automation;

  const draftTitle = normalize(payload.draftTitle || "");
  const draftBody = normalize(payload.draftBody || "");
  const draftTags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean) : [];
  const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages.filter(Boolean) : [];
  const draftImagePaths = Array.isArray(payload.draftImagePaths) ? payload.draftImagePaths.filter(Boolean) : [];
  const douyinText = [draftTitle, draftBody, draftTags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2200);

  function findMediaInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((node) => {
      const accept = String(node.getAttribute("accept") || "").toLowerCase();
      return !accept || accept.includes("image") || accept.includes("video") || accept.includes("*");
    }) || null;
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入抖音创作者发布页");
    if (!window.location.href.includes("creator.douyin.com")) {
      window.location.href = publishUrl;
      await sleep(3500);
    }
    await waitFor(
      [
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="标题"]',
        'textarea[placeholder*="说点什么"]',
        '[contenteditable="true"]',
        'input[type="file"]',
        'button',
      ],
      50000,
      false,
    );
    const imageTab = queryAll(['text=发布图文', 'text=图文'], true)
      .map((node) => ({ node, label: text(node), clickable: getClickableNode(node) }))
      .filter((item) => item.clickable instanceof HTMLElement && item.label && item.label.length <= 12)
      .sort((left, right) => {
        const leftScore = left.label === "发布图文" ? 0 : left.label.includes("发布图文") ? 1 : 2;
        const rightScore = right.label === "发布图文" ? 0 : right.label.includes("发布图文") ? 1 : 2;
        if (leftScore !== rightScore) return leftScore - rightScore;
        return left.label.length - right.label.length;
      })[0];
    if (imageTab?.clickable instanceof HTMLElement) {
      simulateClick(imageTab.clickable);
      await sleep(1800);
    }
  }

  async function fillText() {
    setStage("fill_body", "填写抖音发布文案");
    const node = await waitFor(
      [
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="说点什么"]',
        'textarea[placeholder*="标题"]',
        '[contenteditable="true"][data-placeholder*="描述"]',
        '[contenteditable="true"][data-placeholder*="说点什么"]',
        '[contenteditable="true"]',
      ],
      30000,
      false,
    );
    setInputValue(node, douyinText);
    await sleep(1000);
    const written = normalize(node.value || node.innerText || node.textContent);
    if (!written.includes(douyinText.slice(0, 8))) {
      throw new Error("抖音文案写入后未通过校验");
    }
  }

  async function uploadMedia() {
    setStage("upload_images", `上传抖音素材 ${preparedImages.length} 张`);
    if (!preparedImages.length) {
      throw new Error("抖音创作者发布至少需要视频或图片素材；当前 payload 未提供可上传素材。");
    }

    const inputNode = findMediaInput() || await waitFor(['input[type="file"]'], 30000, false);
    if (!(inputNode instanceof HTMLInputElement)) {
      throw new Error("未找到抖音素材上传控件");
    }

    const uploaded = await uploadImagesViaDocumentInput(preparedImages, { acceptNeedles: ["image"], limit: 9, expectedIncrease: 1, waitMs: 70000 });
    if (!uploaded.ok) {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
        .map((node) => `accept=${node.getAttribute("accept") || ""}; class=${node.className || ""}`)
        .join(" | ");
      throw new Error(`douyin media upload failed: ${uploaded.reason}; fileInputs=${inputs || "none"}; url=${window.location.href}; page=${text(document.body).slice(0, 400)}`);
    }
  }

  async function submit() {
    setStage("submit", "提交抖音发布");
    const button =
      findByText(["发布", "立即发布", "提交", "保存并发布"], document, "button,[role='button'],span,div") ||
      query(['button[type="submit"]', '[class*="publish"] button'], true);
    if (!(button instanceof HTMLElement)) {
      throw new Error("未找到抖音发布按钮");
    }
    button.scrollIntoView({ block: "center" });
    button.click();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      await sleep(1000);
      const page = text(document.body);
      if (["发布成功", "提交成功", "审核", "已发布", "作品管理"].some((hint) => page.includes(hint))) {
        return complete({
          status: page.includes("审核") ? "pending_review" : "submitted",
          draftUrl: window.location.href,
          publishUrl: window.location.href,
          externalStatus: "douyin_submit_ack",
          verificationEvidence: page.includes("审核") ? "douyin_pending_review" : "douyin_submit_ack",
        });
      }
      const blockingHint = ["验证码", "扫码", "登录", "风险", "异常", "失败", "未通过", "请完善", "请选择", "作品类型", "封面", "素材", "视频", "图片"].find((hint) =>
        page.includes(hint),
      );
      if (blockingHint) {
        const buttons = Array.from(document.querySelectorAll("button,[role='button'],a"))
          .map((node) => text(node))
          .filter(Boolean)
          .slice(0, 20)
          .join(" | ");
        throw new Error(`抖音提交被平台页面阻断：${blockingHint}；url=${window.location.href}；buttons=${buttons}；text=${page.slice(0, 400)}`);
      }
    }
    const page = text(document.body);
    throw new Error(`抖音提交后未识别到成功或审核反馈；url=${window.location.href}；text=${page.slice(0, 400)}`);
  }

  try {
    if (!douyinText) {
      throw new Error("抖音发布文案为空");
    }
    if (!preparedImages.length && !draftImagePaths.length) {
      setStage("prepare_images", "validate douyin media materials");
      throw new Error("抖音创作者发布至少需要视频或图片素材；当前 payload 未提供素材，已在素材阶段拦截。");
    }
    await ensurePublishPage();
    await uploadMedia();
    await fillText();
    const result = await submit();
    setStage(result.status, "抖音发布流程已提交");
    return result;
  } catch (error) {
    return fail(error, "抖音自动发布失败");
  }
}
