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
    logs,
    log,
    setStage,
    sleep,
    normalize,
    visible,
    text,
    pageText,
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
  const timeoutMs = Number(input?.timeoutMs) || 180000;
  const dedupe = (items) => Array.from(new Set(items.filter(Boolean)));
  const draftTitleNeedles = dedupe([
    draftTitle,
    draftTitle.slice(0, 24),
    draftTitle.slice(0, 18),
    draftTitle.slice(0, 12),
  ]).filter((item) => item.length >= 6);
  const bodyNeedles = dedupe([
    draftBody.slice(0, 32),
    draftBody.slice(0, 24),
    draftBody.slice(0, 16),
  ]).filter((item) => item.length >= 10);
  const douyinText = [draftTitle, draftBody, draftTags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2200);

  function getManageUrlCandidates() {
    try {
      const url = new URL(publishUrl);
      return dedupe([
        `${url.origin}/creator-micro/content/manage`,
        `${url.origin}/creator-micro/content/manage?enter_from=publish_page`,
        `${url.origin}/creator-micro/home`,
      ]);
    } catch {
      return [
        "https://creator.douyin.com/creator-micro/content/manage",
        "https://creator.douyin.com/creator-micro/content/manage?enter_from=publish_page",
      ];
    }
  }

  function getDouyinImagePublishUrl() {
    try {
      const url = new URL(publishUrl);
      return `${url.origin}/creator-micro/content/post/image?enter_from=publish_page&media_type=image&type=new`;
    } catch {
      return "https://creator.douyin.com/creator-micro/content/post/image?enter_from=publish_page&media_type=image&type=new";
    }
  }

  function buildVerificationEvidence(kind, extra = "") {
    return normalize([kind, draftTitle, extra].filter(Boolean).join(" | "));
  }

  function getNodeHref(node) {
    if (!node) return "";
    if (typeof node.getAttribute === "function") {
      const href = node.getAttribute("href");
      if (href) return href;
    }
    const closestLink = typeof node.closest === "function" ? node.closest("a[href]") : null;
    return closestLink?.getAttribute?.("href") || "";
  }

  function extractItemIdFromUrl(url) {
    const normalizedUrl = String(url || "");
    const matched = normalizedUrl.match(/(?:item_id|itemId|aweme_id|awemeId|group_id|content_id|id)=([a-zA-Z0-9_-]+)/);
    return matched?.[1] || "";
  }

  function isPublishEditorPage() {
    const currentUrl = String(window.location.href || "");
    return (
      currentUrl.includes("/creator-micro/content/upload") ||
      currentUrl.includes("/creator-micro/content/post/image") ||
      currentUrl.includes("/creator-micro/content/post/video")
    );
  }

  function isDouyinImagePublishPage() {
    const currentUrl = String(window.location.href || "");
    return currentUrl.includes("/creator-micro/content/post/image");
  }

  function isManagePage() {
    if (isPublishEditorPage()) return false;
    const currentUrl = String(window.location.href || "");
    const pg = pageText();
    return (
      currentUrl.includes("/creator-micro/content/manage") ||
      ["作品管理", "内容管理", "全部作品"].filter((item) => pg.includes(item)).length >= 2 ||
      Boolean(query(['a[href*="content/manage"]'], false))
    );
  }

  function isLikelyDetailPage() {
    if (isPublishEditorPage()) return false;
    const currentUrl = String(window.location.href || "");
    return ["aweme_id=", "item_id=", "itemId=", "/detail/", "/work/"].some((item) => currentUrl.includes(item));
  }

  function findTitleMatchElements() {
    if (isPublishEditorPage()) return [];
    if (!isManagePage()) return [];
    if (draftTitleNeedles.length === 0) return [];
    const candidates = Array.from(
      document.querySelectorAll(
        ["a", "button", "article", "tr", "li", '[class*="item"]', '[class*="row"]', '[class*="card"]', '[class*="title"]', "span", "div"].join(","),
      ),
    );
    const scored = candidates
      .filter((node) => visible(node))
      .map((node) => {
        const nodeText = normalize(node.textContent || "");
        if (!nodeText || nodeText.length > 360) return null;
        let score = 0;
        if (draftTitle && nodeText === draftTitle) score += 8;
        if (draftTitle && nodeText.includes(draftTitle)) score += 6;
        if (draftTitleNeedles.some((item) => item && nodeText.includes(item))) score += 4;
        if (bodyNeedles.some((item) => item && nodeText.includes(item))) score += 2;
        if (["刚刚", "分钟前", "今天", "审核", "已发布", "发布成功"].some((hint) => nodeText.includes(hint))) score += 1;
        if (node.tagName === "A") score += 1;
        if (getNodeHref(node)) score += 1;
        return score > 0 ? { node, text: nodeText, score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
    return scored.slice(0, 5);
  }

  function findMediaInput() {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.find((node) => {
      const accept = String(node.getAttribute("accept") || "").toLowerCase();
      return !accept || accept.includes("image") || accept.includes("video") || accept.includes("*");
    }) || null;
  }

  function findPlatformBlockingHint() {
    const platformBlockingSelectors = [
      '[role="alert"]',
      '[role="dialog"]',
      '[class*="toast"]',
      '[class*="Toast"]',
      '[class*="message"]',
      '[class*="Message"]',
      '[class*="error"]',
      '[class*="Error"]',
      '[class*="warning"]',
      '[class*="Warning"]',
      '[class*="notice"]',
      '[class*="Notice"]',
      '[class*="modal"]',
      '[class*="Modal"]',
      '[class*="popover"]',
      '[class*="Popover"]',
    ];
    const blockingHints = [
      "验证码",
      "扫码",
      "请登录",
      "登录失效",
      "账号风险",
      "发布风险",
      "风控",
      "异常",
      "发布失败",
      "未通过",
      "请完善",
      "请选择",
      "作品类型",
      "封面",
      "素材上传失败",
      "图片上传失败",
      "视频上传失败",
    ];
    const alertTexts = Array.from(document.querySelectorAll(platformBlockingSelectors.join(",")))
      .filter((node) => visible(node))
      .map((node) => text(node))
      .filter(Boolean);
    for (const alertText of alertTexts) {
      const matched = blockingHints.find((hint) => alertText.includes(hint));
      if (matched) return matched;
    }
    return "";
  }

  function isDisabledAction(node) {
    if (!(node instanceof HTMLElement)) return true;
    if (node.disabled) return true;
    const ariaDisabled = String(node.getAttribute("aria-disabled") || "").toLowerCase();
    const disabledClass = String(node.className || "").toLowerCase();
    return ariaDisabled === "true" || disabledClass.includes("disabled") || disabledClass.includes("disable");
  }

  function getActionLabel(node) {
    return normalize(
      [
        node?.getAttribute?.("aria-label"),
        node?.getAttribute?.("title"),
        node?.textContent,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  function getVisibleActionCandidates(root = document) {
    const nodes = Array.from(root.querySelectorAll("button,[role='button'],a"));
    const unique = Array.from(new Set(nodes.map((node) => getClickableNode(node)).filter(Boolean)));
    return unique
      .filter((node) => node instanceof HTMLElement && visible(node) && !isDisabledAction(node))
      .map((node) => ({ node, label: getActionLabel(node) }))
      .filter((item) => item.label && item.label.length <= 48);
  }

  function findDouyinPublishButton() {
    const positiveLabels = ["高清发布", "立即发布", "发布作品", "保存并发布", "发布", "提交"];
    const negativeLabels = ["发布图文", "发布视频", "草稿", "定时发布", "预约发布", "内容管理", "作品管理", "取消", "返回"];
    return (
      getVisibleActionCandidates()
        .filter((item) => positiveLabels.some((label) => item.label === label || item.label.includes(label)))
        .filter((item) => !negativeLabels.some((label) => item.label.includes(label)))
        .sort((left, right) => {
          const leftExact = positiveLabels.findIndex((label) => left.label === label);
          const rightExact = positiveLabels.findIndex((label) => right.label === label);
          const leftScore = leftExact >= 0 ? leftExact : positiveLabels.findIndex((label) => left.label.includes(label)) + 20;
          const rightScore = rightExact >= 0 ? rightExact : positiveLabels.findIndex((label) => right.label.includes(label)) + 20;
          if (leftScore !== rightScore) return leftScore - rightScore;
          return left.label.length - right.label.length;
        })[0]?.node || null
    );
  }

  function findDouyinConfirmPublishButton() {
    const roots = [
      ...Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="Modal"],[class*="popover"],[class*="Popover"]')),
    ];
    if (roots.length === 0) return null;
    const positiveLabels = ["确认发布", "确定发布", "继续发布", "立即发布", "发布", "确认", "确定", "继续"];
    const negativeLabels = ["发布图文", "发布视频", "草稿", "定时发布", "预约发布", "内容管理", "作品管理", "取消", "返回", "暂不", "稍后", "保存草稿"];
    for (const root of roots) {
      const matched = getVisibleActionCandidates(root)
        .filter((item) => positiveLabels.some((label) => item.label === label || item.label.includes(label)))
        .filter((item) => !negativeLabels.some((label) => item.label.includes(label)))
        .sort((left, right) => {
          const leftExact = positiveLabels.findIndex((label) => left.label === label);
          const rightExact = positiveLabels.findIndex((label) => right.label === label);
          const leftScore = leftExact >= 0 ? leftExact : positiveLabels.findIndex((label) => left.label.includes(label)) + 20;
          const rightScore = rightExact >= 0 ? rightExact : positiveLabels.findIndex((label) => right.label.includes(label)) + 20;
          if (leftScore !== rightScore) return leftScore - rightScore;
          return left.label.length - right.label.length;
        })[0];
      if (matched?.node instanceof HTMLElement) return matched.node;
    }
    return null;
  }

  function getVisibleButtonLabels(limit = 24) {
    return getVisibleActionCandidates()
      .map((item) => item.label)
      .slice(0, limit)
      .join(" | ");
  }

  async function driveDouyinSubmitFlow() {
    const button = findDouyinPublishButton();
    if (!(button instanceof HTMLElement)) {
      throw new Error(`未找到抖音发布按钮；buttons=${getVisibleButtonLabels() || "none"}`);
    }
    simulateClick(button);
    log(`submit_clicked: ${getActionLabel(button) || "douyin_publish"}`);

    const startedAt = Date.now();
    let confirmClicks = 0;
    let retryClicks = 0;
    while (Date.now() - startedAt < 45000) {
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
      if (!isPublishEditorPage() && (isManagePage() || isLikelyDetailPage())) {
        return complete({
          status: "submitted",
          draftUrl: window.location.href,
          publishUrl: window.location.href,
          externalStatus: "douyin_submit_navigation_ack",
          verificationEvidence: "douyin_submit_navigation_ack",
        });
      }
      const confirmButton = findDouyinConfirmPublishButton();
      if (confirmButton instanceof HTMLElement && confirmClicks < 3) {
        confirmClicks += 1;
        simulateClick(confirmButton);
        log(`confirm_publish_clicked_${confirmClicks}: ${getActionLabel(confirmButton) || "confirm"}`);
        await sleep(1800);
        continue;
      }
      const blockingHint = findPlatformBlockingHint();
      if (blockingHint) {
        throw new Error(`抖音提交被平台页面阻断：${blockingHint}；url=${window.location.href}；buttons=${getVisibleButtonLabels() || "none"}；text=${page.slice(0, 400)}`);
      }
      if (isPublishEditorPage() && retryClicks < 2 && Date.now() - startedAt > (retryClicks + 1) * 8000) {
        const retryButton = findDouyinPublishButton();
        if (retryButton instanceof HTMLElement) {
          retryClicks += 1;
          simulateClick(retryButton);
          log(`submit_retry_clicked_${retryClicks}: ${getActionLabel(retryButton) || "douyin_publish"}`);
          await sleep(1500);
        }
      }
    }
    const page = text(document.body);
    throw new Error(`抖音提交后未识别到成功或审核反馈；url=${window.location.href}；buttons=${getVisibleButtonLabels() || "none"}；text=${page.slice(0, 400)}`);
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入抖音创作者发布页");
    const targetPublishUrl = preparedImages.length ? getDouyinImagePublishUrl() : publishUrl;
    if (!window.location.href.includes("creator.douyin.com") || (preparedImages.length > 0 && !isDouyinImagePublishPage())) {
      window.location.href = targetPublishUrl;
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

    if (preparedImages.length > 0 && isDouyinImagePublishPage()) {
      return;
    }

    const imageTab = queryAll(['text=发布图文', 'text=图文'], true)
      .map((node) => ({ node, label: text(node), clickable: getClickableNode(node) }))
      .filter((item) => item.clickable instanceof HTMLElement && item.label && item.label.length <= 24)
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
    if (!isDouyinImagePublishPage()) {
      log(`load_publish_page_image_fallback: ${window.location.href}`);
      window.location.href = getDouyinImagePublishUrl();
      await sleep(3500);
    }
    if (!isDouyinImagePublishPage()) {
      throw new Error(`未进入抖音图文发布页；url=${window.location.href}；buttons=${getVisibleButtonLabels() || "none"}；text=${text(document.body).slice(0, 300)}`);
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
    return driveDouyinSubmitFlow();
  }

  async function openManagePage() {
    setStage("open_manage_page", "进入抖音作品管理页");
    if (isManagePage()) {
      log(`manage_page_ready: ${window.location.href}`);
      return window.location.href;
    }

    const menuNode = query(
      [
        'a:has-text-any("作品管理|内容管理|全部作品")',
        'button:has-text-any("作品管理|内容管理|全部作品")',
        'span:has-text-any("作品管理|内容管理|全部作品")',
        '[role="tab"]:has-text-any("作品管理|内容管理|全部作品")',
        'text=作品管理',
        'text=内容管理',
      ],
      true,
    );
    const clickable = getClickableNode(menuNode);
    if (clickable instanceof HTMLElement) {
      simulateClick(clickable);
      await sleep(2400);
      if (isManagePage()) {
        log(`manage_page_ready: ${window.location.href}`);
        return window.location.href;
      }
    }

    const candidates = getManageUrlCandidates();
    for (const candidate of candidates) {
      log(`open_manage_candidate: ${candidate}`);
      window.location.href = candidate;
      await sleep(2800);
      if (isManagePage()) {
        log(`manage_page_ready: ${window.location.href}`);
        return window.location.href;
      }
    }
    throw new Error("未成功进入抖音作品管理页");
  }

  async function openPublishedItem(match) {
    setStage("open_published_item", "打开疑似匹配的抖音作品详情");
    const clickable = getClickableNode(match?.node);
    if (!(clickable instanceof HTMLElement)) throw new Error("未找到可打开的抖音作品详情入口");
    const beforeUrl = window.location.href;
    simulateClick(clickable);
    await sleep(2400);
    if (window.location.href !== beforeUrl) {
      log(`detail_page_ready: ${window.location.href}`);
      return { opened: true, verificationUrl: window.location.href };
    }
    const directHref = getNodeHref(clickable);
    if (directHref) {
      window.location.href = directHref.startsWith("http") ? directHref : new URL(directHref, window.location.href).toString();
      await sleep(2400);
      return { opened: true, verificationUrl: window.location.href };
    }
    return { opened: false, verificationUrl: beforeUrl };
  }

  async function verifyPublishedItem(manageUrl, submitResult) {
    setStage("find_published_item", "在抖音作品管理中查找刚提交的内容");
    const startedAt = Date.now();
    let attempts = 0;

    if (isLikelyDetailPage()) {
      const detailText = pageText();
      if (draftTitleNeedles.some((item) => detailText.includes(item)) || bodyNeedles.some((item) => detailText.includes(item))) {
        return {
          status: detailText.includes("审核") ? "pending_review" : "published",
          verificationEvidence: buildVerificationEvidence(detailText.includes("审核") ? "douyin_detail_pending_review" : "douyin_direct_detail_match"),
          verificationAttempts: attempts,
          verificationUrl: window.location.href,
          platformItemId: extractItemIdFromUrl(window.location.href),
          externalStatus: detailText.includes("审核") ? "douyin_pending_review_verified" : "douyin_detail_verified",
        };
      }
    }

    while (Date.now() - startedAt < Math.min(timeoutMs, 120000)) {
      attempts += 1;
      log(`verify_attempt_${attempts}: ${window.location.href}`);
      if (!isManagePage()) {
        window.location.href = manageUrl;
        await sleep(2400);
      }
      const matches = findTitleMatchElements();
      if (matches.length > 0) {
        const match = matches[0];
        log(`verify_match_found: ${match.text.slice(0, 120)}`);
        const pendingReview = match.text.includes("审核") || match.text.includes("审核中") || match.text.includes("待审核");
        const opened = await openPublishedItem(match).catch((error) => {
          log(`open_published_item_failed: ${error instanceof Error ? error.message : "打开详情失败"}`);
          return null;
        });
        if (opened?.opened) {
          setStage("verify_published_item", "在抖音作品详情页确认发布结果");
          const detailText = pageText();
          const detailTitleMatched = draftTitleNeedles.some((item) => item && detailText.includes(item));
          const detailBodyMatched = bodyNeedles.some((item) => item && detailText.includes(item));
          if (detailTitleMatched || detailBodyMatched) {
            const detailPendingReview = detailText.includes("审核") || detailText.includes("审核中") || detailText.includes("待审核");
            return {
              status: detailPendingReview ? "pending_review" : "published",
              verificationEvidence: buildVerificationEvidence(
                detailPendingReview ? "douyin_detail_pending_review" : "douyin_detail_title_match",
                match.text.slice(0, 60),
              ),
              verificationAttempts: attempts,
              verificationUrl: opened.verificationUrl,
              platformItemId: extractItemIdFromUrl(opened.verificationUrl),
              externalStatus: detailPendingReview ? "douyin_pending_review_verified" : "douyin_detail_verified",
            };
          }
        }
        return {
          status: pendingReview ? "pending_review" : "published",
          verificationEvidence: buildVerificationEvidence(pendingReview ? "douyin_list_pending_review" : "douyin_list_title_match", match.text.slice(0, 60)),
          verificationAttempts: attempts,
          verificationUrl: window.location.href || manageUrl,
          platformItemId: extractItemIdFromUrl(getNodeHref(match?.node)),
          externalStatus: pendingReview ? "douyin_pending_review_list_verified" : "douyin_list_verified",
        };
      }
      await sleep(5000);
      window.location.reload();
      await sleep(2400);
    }

    return {
      status: submitResult.status === "pending_review" ? "pending_review" : "verification_failed",
      verificationEvidence: submitResult.verificationEvidence,
      verificationAttempts: attempts,
      verificationUrl: window.location.href,
      externalStatus: submitResult.status === "pending_review" ? "pending_review_no_match" : "submitted_no_match",
    };
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
    const submitResult = await submit();
    const draftUrl = window.location.href;
    const manageUrl = await openManagePage();
    const verificationResult = await verifyPublishedItem(manageUrl, submitResult);
    setStage(verificationResult.status, "抖音发布流程已提交并完成核验");
    return complete({
      status: verificationResult.status,
      draftUrl,
      publishUrl: draftUrl,
      verificationUrl: verificationResult.verificationUrl,
      executionLog: logs,
      verificationEvidence: verificationResult.verificationEvidence,
      verificationAttempts: verificationResult.verificationAttempts,
      platformItemId: verificationResult.platformItemId,
      externalStatus: verificationResult.externalStatus,
      failureStage:
        verificationResult.status === "verification_failed" || verificationResult.status === "pending_review"
          ? "find_published_item"
          : undefined,
    });
  } catch (error) {
    return fail(error, "抖音自动发布失败");
  }
}
