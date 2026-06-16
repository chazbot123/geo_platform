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

  function isManagePage() {
    const currentUrl = String(window.location.href || "");
    const pg = pageText();
    return (
      currentUrl.includes("/creator-micro/content/manage") ||
      ["作品管理", "内容管理", "全部作品", "已发布", "图文"].some((item) => pg.includes(item)) ||
      Boolean(
        query(
          [
            'a[href*="content/manage"]',
            '[class*="table"]',
            '[class*="list"]',
            '[class*="item"]',
            '[class*="card"]',
          ],
          false,
        ),
      )
    );
  }

  function isLikelyDetailPage() {
    const currentUrl = String(window.location.href || "");
    const pg = pageText();
    return Boolean(
      ["aweme_id=", "item_id=", "itemId=", "/detail/", "/work/"].some((item) => currentUrl.includes(item)) ||
        (draftTitleNeedles.some((item) => item && pg.includes(item)) && bodyNeedles.some((item) => item && pg.includes(item))),
    );
  }

  function findTitleMatchElements() {
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
