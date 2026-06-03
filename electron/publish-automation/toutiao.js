async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "toutiao" });
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
    dataUrlToFile,
    findFileInputForEditor,
    waitForRealImage,
    uploadViaFileInput,
    uploadViaDrop,
    uploadViaPaste,
    insertImageWithFallback,
    computeImagePositions,
    fail,
  } = automation;

  const payload = input?.payload ?? {};
  const timeoutMs = Number(input?.timeoutMs) || 180000;
  const draftTitle = normalize(payload.draftTitle || "");
  const draftBody = normalize(payload.draftBody || "");
  const draftBodyExcerpt = draftBody.slice(0, 32);
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
  const publishUrl = String(input?.publishUrl || "https://mp.toutiao.com/profile_v4/graphic/publish");

  function getNodeHref(node) {
    if (!node) return "";
    if (typeof node.getAttribute === "function") {
      const href = node.getAttribute("href");
      if (href) return href;
    }
    const closestLink = typeof node.closest === "function" ? node.closest("a[href]") : null;
    return closestLink?.getAttribute?.("href") || "";
  }

  function getManageUrlCandidates() {
    try {
      const url = new URL(publishUrl);
      return dedupe([
        `${url.origin}/profile_v4/graphic`,
        `${url.origin}/profile_v4/graphic/manage`,
        `${url.origin}/profile_v4/manage`,
        `${url.origin}/profile_v4/graphic/publish-management`,
      ]);
    } catch {
      return [
        "https://mp.toutiao.com/profile_v4/graphic",
        "https://mp.toutiao.com/profile_v4/graphic/manage",
      ];
    }
  }

  function buildVerificationEvidence(kind, extra = "") {
    return normalize([kind, draftTitle, extra].filter(Boolean).join(" | "));
  }

  function isManagePage() {
    const pg = pageText();
    return (
      ["作品管理", "内容管理", "图文", "我的作品", "全部作品"].some((item) => pg.includes(item)) ||
      Boolean(
        query(
          [
            'a[href*="profile_v4/graphic"]',
            'a[href*="article"]',
            'button:has-text-any("作品管理|内容管理|图文")',
            '[class*="table"]',
            '[class*="list"]',
            '[class*="article"]',
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
      ["item_id=", "article_id=", "group_id=", "/article/", "/detail/"].some((item) => currentUrl.includes(item)) ||
        (draftTitleNeedles.some((item) => item && pg.includes(item)) && draftBodyExcerpt && pg.includes(draftBodyExcerpt)),
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
        if (!nodeText || nodeText.length > 300) return null;
        let score = 0;
        if (draftTitle && nodeText === draftTitle) score += 8;
        if (draftTitle && nodeText.includes(draftTitle)) score += 6;
        if (draftTitleNeedles.some((item) => item && nodeText.includes(item))) score += 4;
        if (draftBodyExcerpt && nodeText.includes(draftBodyExcerpt)) score += 2;
        if (["刚刚", "分钟前", "今天", "审核中", "发布成功"].some((hint) => nodeText.includes(hint))) score += 1;
        if (node.tagName === "A") score += 1;
        if (getNodeHref(node)) score += 1;
        return score > 0 ? { node, text: nodeText, score } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);
    return scored.slice(0, 5);
  }

  function extractItemIdFromUrl(url) {
    const normalizedUrl = String(url || "");
    const matched = normalizedUrl.match(/(?:item_id|article_id|group_id|content_id|id)=([a-zA-Z0-9_-]+)/);
    return matched?.[1] || "";
  }

  function getPreviewDialogRoot() {
    const candidates = Array.from(document.querySelectorAll("div,section,article"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => ({ node, nodeText: normalize(node.textContent || "") }))
      .filter((item) =>
        (
          item.nodeText.includes("返回编辑") ||
          item.nodeText.includes("预览") ||
          item.nodeText.includes("发布预览")
        ) &&
        (
          item.nodeText.includes("确认发布") ||
          item.nodeText.includes("发布") ||
          item.nodeText.includes("立即发布")
        ),
      )
      .sort((left, right) => left.nodeText.length - right.nodeText.length);
    return candidates[0]?.node || null;
  }

  function isPreviewDialogOpen() {
    if (getPreviewDialogRoot()) return true;
    const pg = pageText();
    return (
      (pg.includes("返回编辑") || pg.includes("预览") || pg.includes("发布预览")) &&
      (pg.includes("确认发布") || pg.includes("立即发布"))
    );
  }

  function findPreviewPublishButton() {
    const nodes = queryAll(
      [
        'button:has-text("预览并发布")',
        '[role="button"]:has-text("预览并发布")',
        'text=预览并发布',
        'button:has-text("预览")',
        '[role="button"]:has-text("预览")',
        'button:has-text("立即发布")',
        '[role="button"]:has-text("立即发布")',
      ],
      true,
    );
    return (
      nodes
        .map((node) => getClickableNode(node))
        .find((node) => node instanceof HTMLElement && !node.closest?.('[role="dialog"], .modal, .dialog, .semi-portal')) || null
    );
  }

  function findConfirmPublishButton() {
    const dialogRoot = getPreviewDialogRoot();
    const searchRoot = dialogRoot || document;
    const nodes = queryAll(
      [
        'button:has-text("确认发布")',
        '[role="button"]:has-text("确认发布")',
        'text=确认发布',
        'button:has-text("立即发布")',
        '[role="button"]:has-text("立即发布")',
        'button:has-text("发布")',
        '[role="button"]:has-text("发布")',
      ],
      true,
      searchRoot,
    );
    return nodes.map((node) => getClickableNode(node)).find((node) => node instanceof HTMLElement) || null;
  }

  function getVisibleButtonLabels(limit = 24) {
    return Array.from(document.querySelectorAll("button,[role='button'],a"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => normalize(node.textContent || ""))
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
    log(`${prefix}_url: ${window.location.href}`);
    log(`${prefix}_buttons: ${getVisibleButtonLabels().join(" | ") || "none"}`);
    log(`${prefix}_page_text: ${pageText().slice(0, 500) || "empty"}`);
  }

  function getCoverDialogRoot() {
    const COVER_HINTS = ["选择封面", "请选择封面", "添加封面", "上传封面", "封面图片"];
    const candidates = Array.from(document.querySelectorAll("div,section,article"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => ({ node, nodeText: normalize(node.textContent || "") }))
      .filter((item) => COVER_HINTS.some((hint) => item.nodeText.includes(hint)))
      .filter((item) => !(item.nodeText.includes("返回编辑") && item.nodeText.includes("确认发布")))
      .sort((left, right) => left.nodeText.length - right.nodeText.length);
    return candidates[0]?.node || null;
  }

  function isCoverDialogOpen() {
    return getCoverDialogRoot() !== null;
  }

  async function ensurePublishPage() {
    setStage("load_publish_page", "进入今日头条图文发布页");
    if (!window.location.href.includes("/graphic/publish")) {
      window.location.href = publishUrl;
      await sleep(2800);
    }
    await waitFor(
      [
        'input[type="file"][accept*="image"]',
        'input[placeholder*="请输入标题"]',
        'textarea[placeholder*="请输入标题"]',
        'input[placeholder*="填写标题"]',
        'textarea[placeholder*="填写标题"]',
        'div[contenteditable="true"]',
        'button:has-text-any("上传图片|添加图片|图片|素材")',
        'div[role="button"]:has-text-any("上传图片|添加图片|图片|素材")',
        'text=文章',
      ],
      30000,
      false,
    );
    const articleMode = query(
      ['button:has-text-any("文章|图文")', 'div[role="tab"]:has-text-any("文章|图文")', 'span:has-text-any("文章|图文")'],
      true,
    );
    if (articleMode instanceof HTMLElement) {
      articleMode.click();
      await sleep(1000);
    }
  }

  async function fillTitle(title) {
    setStage("fill_title", "填写标题");
    const node = await waitFor(
      [
        'input[placeholder*="请输入标题"]',
        'textarea[placeholder*="请输入标题"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[placeholder*="填写标题"]',
        'textarea[placeholder*="填写标题"]',
      ],
      20000,
      false,
    );
    setInputValue(node, title);
    await sleep(800);
    const value = extractEditableText(node) || closestText(node);
    if (!containsAnyNeedle(value, draftTitleNeedles)) {
      throw new Error("标题写入后未通过内容校验");
    }
    await sleep(1000);
  }

  async function fillBody(body, images = []) {
    setStage("fill_body", "填写正文");
    const selectors = [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder*="正文"]',
      'div[contenteditable="true"][data-placeholder*="内容"]',
      'div[contenteditable="true"][data-placeholder*="文章"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-slate-editor="true"]',
      'textarea[placeholder*="正文"]',
      'div[contenteditable="true"]',
    ];
    await waitFor(selectors, 25000, false);
    const candidates = selectors.flatMap((selector) => {
      try { return Array.from(document.querySelectorAll(selector)); } catch { return []; }
    });
    const paragraphs = getParagraphs(body);
    const prefersRichEditor = images.length > 0;

    for (const node of candidates) {
      if (!(node instanceof HTMLElement || node instanceof HTMLTextAreaElement)) continue;
      const contextText = normalize(
        [extractEditableText(node), closestText(node), node.getAttribute?.("data-placeholder") || "", node.getAttribute?.("aria-label") || ""].join(" "),
      );
      const isHighPriority =
        ["正文", "内容", "文章", "请输入正文"].some((item) => contextText.includes(item)) || node instanceof HTMLTextAreaElement;
      if (!isHighPriority && !(node instanceof HTMLElement && node.isContentEditable)) continue;
      if (prefersRichEditor && (!(node instanceof HTMLElement) || !node.isContentEditable)) continue;

      clearEditableNode(node);
      const imagePositions = computeImagePositions(paragraphs.length, images.length);
      log(`image_distribution_plan: ${JSON.stringify(Array.from(imagePositions.keys()))}`);

      for (let i = 0; i < paragraphs.length; i += 1) {
        const pHtml = formatParagraph(paragraphs[i]);
        const pText = paragraphs[i];
        log(`fill_body_paragraph_${i + 1}: ${normalize(pText).slice(0, 24)}`);
        const inserted = insertParagraphBlock(node, pHtml, pText);
        if (!inserted) throw new Error(`正文第 ${i + 1} 段写入失败`);
        await sleep(250);

        const slot = imagePositions.get(i + 1);
        if (Array.isArray(slot) && slot.length > 0 && node instanceof HTMLElement) {
          for (const imageIndex of slot) {
            const imgItem = images[imageIndex];
            const uploaded = await insertImageWithFallback(node, imgItem, imageIndex);
            if (!uploaded) throw new Error(`第 ${imageIndex + 1} 张图片上传失败（已尝试 file_input / drop / paste 三种策略）`);
            focusEditableNode(node);
            if (document.queryCommandSupported("insertHTML")) {
              document.execCommand("insertHTML", false, "<p><br></p>");
            }
            dispatchInputEvents(node);
            await sleep(400);
          }
        }
      }

      await sleep(1200);
      const nodeText = extractEditableText(node);
      const nearbyText = closestText(node);
      const documentText = pageText();
      if (containsAnyNeedle(nodeText, bodyNeedles) || containsAnyNeedle(nearbyText, bodyNeedles) || containsAnyNeedle(documentText, bodyNeedles)) {
        log(`fill_body_verified: ${bodyNeedles[0] || draftBody.slice(0, 16)}`);
        await sleep(600);
        return;
      }
    }
    throw new Error("已找到编辑器候选节点，但正文写入后未通过内容校验");
  }

  async function fillTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return;
    const node = query(
      ['input[placeholder*="标签"]', 'textarea[placeholder*="标签"]', 'input[placeholder*="#"]'],
      false,
    );
    if (!node) return;
    setStage("fill_tags", "填写标签");
    setInputValue(node, tags.join(" "));
    await sleep(600);
    const currentText = extractEditableText(node) || closestText(node);
    const tagNeedles = tags.map((item) => normalize(item)).filter((item) => item.length >= 2);
    if (tagNeedles.length > 0 && !containsAnyNeedle(currentText, tagNeedles)) {
      log("fill_tags_verify_skipped: 标签控件未返回稳定回显，继续后续提交");
    }
    await sleep(800);
  }

  async function handleCoverDialog() {
    const root = getCoverDialogRoot();
    if (!(root instanceof HTMLElement)) return false;
    setStage("select_cover", "处理封面选择弹层");
    log(`cover_dialog_dump: ${(root.outerHTML || "").slice(0, 2000)}`);

    const thumbs = Array.from(root.querySelectorAll('img, [role="img"], [class*="thumb"], [class*="image-item"], [class*="cover-item"]'))
      .filter((node) => node instanceof HTMLElement && visible(node));
    const thumb = thumbs.find((node) => {
      if (node instanceof HTMLImageElement) return node.naturalWidth > 40 && node.naturalHeight > 40;
      const rect = node.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    });
    if (thumb instanceof HTMLElement) {
      simulateClick(getClickableNode(thumb) || thumb);
      log("cover_thumb_clicked");
      await sleep(600);
    } else {
      log("cover_thumb_not_found");
    }

    const confirmBtn = Array.from(root.querySelectorAll('button,[role="button"]'))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .find((node) => {
        const nodeText = normalize(node.textContent || "");
        return ["确定", "完成", "确认", "保存"].some((hint) => nodeText === hint || nodeText.includes(hint));
      });
    if (confirmBtn instanceof HTMLElement) {
      simulateClick(confirmBtn);
      log("cover_confirm_clicked");
      await sleep(1000);
    } else {
      log("cover_confirm_not_found");
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      if (!isCoverDialogOpen()) { log("cover_selected"); return true; }
      await sleep(300);
    }
    return !isCoverDialogOpen();
  }

  async function openPreviewPublish() {
    setStage("preview_publish", "点击预览并发布");
    if (isPreviewDialogOpen()) { log("preview_publish_ready: 已进入预览确认层"); return; }
    const button = findPreviewPublishButton();
    if (!(button instanceof HTMLElement)) throw new Error("未找到主编辑页中的预览并发布按钮");
    simulateClick(button);
    log("preview_publish: 点击预览并发布");
    const startedAt = Date.now();
    let handledCover = false;
    while (Date.now() - startedAt < 20000) {
      const pg = pageText();
      if (isPreviewDialogOpen()) { log("preview_publish_ready: 已进入预览确认层"); await sleep(800); return; }
      if (!handledCover && isCoverDialogOpen()) {
        handledCover = true;
        const ok = await handleCoverDialog();
        if (!ok) throw new Error("封面选择弹层未能完成");
        await sleep(800);
        if (!isPreviewDialogOpen()) {
          const retryButton = findPreviewPublishButton();
          if (retryButton instanceof HTMLElement) { simulateClick(retryButton); log("preview_publish_retry: 选完封面后再次点击预览并发布"); }
        }
        continue;
      }
      if (["发布失败", "请完善", "网络异常"].some((hint) => pg.includes(hint))) {
        logPageDiagnostics("preview_blocked");
        throw new Error(["发布失败", "请完善", "网络异常"].find((hint) => pg.includes(hint)) || "未进入预览确认弹层");
      }
      await sleep(600);
    }
    logPageDiagnostics("preview_unopened");
    const blockingHint = getBlockingHint();
    throw new Error(blockingHint ? `未进入预览确认弹层，页面疑似阻断：${blockingHint}` : "未进入预览确认弹层");
  }

  async function confirmPreviewPublish() {
    setStage("confirm_publish", "点击确认发布");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      if (isPreviewDialogOpen()) break;
      await sleep(400);
    }
    if (!isPreviewDialogOpen()) throw new Error("预览确认弹层未就绪，无法执行确认发布");
    const button = findConfirmPublishButton();
    if (!(button instanceof HTMLElement)) {
      logPageDiagnostics("confirm_button_missing");
      throw new Error("未找到预览层底部的确认发布按钮");
    }
    simulateClick(button);
    log("confirm_publish: 点击确认发布");
    await sleep(1200);
    log("confirm_publish_done: 已触发正式发布提交");
  }

  async function submit() {
    await openPreviewPublish();
    await confirmPreviewPublish();
    setStage("submit", "等待平台反馈");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const pg = pageText();
      if (["发布成功", "提交成功", "审核中", "发布完成"].some((hint) => pg.includes(hint))) {
        const pendingReview = pg.includes("审核中");
        return {
          status: pendingReview ? "pending_review" : "submitted",
          verificationEvidence: pendingReview ? "toutiao_submit_pending_review" : "toutiao_submit_ack",
        };
      }
      if (["发布失败", "上传失败", "请完善", "网络异常"].some((hint) => pg.includes(hint))) {
        throw new Error(["发布失败", "上传失败", "请完善", "网络异常"].find((hint) => pg.includes(hint)) || "发布失败");
      }
      if (isManagePage() || isLikelyDetailPage()) {
        return { status: "submitted", verificationEvidence: "toutiao_submit_navigation_ack" };
      }
      await sleep(1000);
    }
    throw new Error("未识别到今日头条正式发布反馈");
  }

  async function openManagePage() {
    setStage("open_manage_page", "进入今日头条作品列表");
    if (isManagePage()) { log(`manage_page_ready: ${window.location.href}`); return window.location.href; }
    const menuSelectors = [
      'a:has-text-any("作品管理|内容管理|全部作品|图文")',
      'button:has-text-any("作品管理|内容管理|全部作品|图文")',
      'span:has-text-any("作品管理|内容管理|全部作品|图文")',
      '[role="tab"]:has-text-any("作品管理|内容管理|全部作品|图文")',
      'text=作品管理',
      'text=内容管理',
    ];
    const menuNode = query(menuSelectors, true);
    if (menuNode instanceof HTMLElement) {
      menuNode.scrollIntoView({ block: "center", inline: "center" });
      menuNode.click();
      await sleep(2200);
      if (isManagePage()) { log(`manage_page_ready: ${window.location.href}`); return window.location.href; }
    }
    const candidates = getManageUrlCandidates();
    for (const candidate of candidates) {
      log(`open_manage_candidate: ${candidate}`);
      window.location.href = candidate;
      await sleep(2600);
      if (isManagePage()) { log(`manage_page_ready: ${window.location.href}`); return window.location.href; }
    }
    throw new Error("未成功进入今日头条作品管理页");
  }

  async function openPublishedItem(match) {
    setStage("open_published_item", "打开疑似匹配的作品详情");
    const clickable = getClickableNode(match?.node);
    if (!(clickable instanceof HTMLElement)) throw new Error("未找到可打开的作品详情入口");
    const beforeUrl = window.location.href;
    clickable.scrollIntoView({ block: "center", inline: "center" });
    clickable.click();
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
    setStage("find_published_item", "在今日头条作品列表中查找刚发布的内容");
    const startedAt = Date.now();
    let attempts = 0;

    if (isLikelyDetailPage()) {
      const detailText = pageText();
      if (draftTitleNeedles.some((item) => detailText.includes(item)) || (draftBodyExcerpt && detailText.includes(draftBodyExcerpt))) {
        return {
          status: "published",
          verificationEvidence: buildVerificationEvidence("toutiao_direct_detail_match"),
          verificationAttempts: attempts,
          verificationUrl: window.location.href,
          platformItemId: extractItemIdFromUrl(window.location.href),
          externalStatus: submitResult.status === "pending_review" ? "pending_review_direct_detail_verified" : "submitted_direct_detail_verified",
        };
      }
    }

    while (Date.now() - startedAt < Math.min(timeoutMs, 120000)) {
      attempts += 1;
      log(`verify_attempt_${attempts}: ${window.location.href}`);
      if (!isManagePage()) {
        window.location.href = manageUrl;
        await sleep(2200);
      }
      const matches = findTitleMatchElements();
      if (matches.length > 0) {
        const match = matches[0];
        log(`verify_match_found: ${match.text.slice(0, 120)}`);
        const opened = await openPublishedItem(match).catch((error) => {
          log(`open_published_item_failed: ${error instanceof Error ? error.message : "打开详情失败"}`);
          return null;
        });
        if (opened?.opened) {
          setStage("verify_published_item", "在详情页确认发布结果");
          const detailText = pageText();
          const detailTitleMatched = draftTitle && detailText.includes(draftTitle);
          const detailBodyMatched = draftBodyExcerpt && detailText.includes(draftBodyExcerpt);
          if (detailTitleMatched || detailBodyMatched) {
            return {
              status: "published",
              verificationEvidence: buildVerificationEvidence(
                detailBodyMatched ? "toutiao_detail_title_body_match" : "toutiao_detail_title_match",
                match.text.slice(0, 60),
              ),
              verificationAttempts: attempts,
              verificationUrl: opened.verificationUrl,
              platformItemId: extractItemIdFromUrl(opened.verificationUrl),
              externalStatus: submitResult.status === "pending_review" ? "pending_review_verified" : "submitted_verified",
            };
          }
          throw new Error("详情页未出现标题或正文指纹，无法确认是本次发布结果");
        }
        return {
          status: "published",
          verificationEvidence: buildVerificationEvidence("toutiao_list_title_match", match.text.slice(0, 60)),
          verificationAttempts: attempts,
          verificationUrl: manageUrl,
          platformItemId: extractItemIdFromUrl(match?.node?.getAttribute?.("href") || ""),
          externalStatus: submitResult.status === "pending_review" ? "pending_review_list_verified" : "submitted_list_verified",
        };
      }
      await sleep(5000);
      window.location.reload();
      await sleep(2200);
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
    await ensurePublishPage();
    await fillTitle(draftTitle);
    await fillBody(
      draftBody,
      Array.isArray(payload.preparedImages) ? payload.preparedImages : (Array.isArray(payload.draftImages) ? payload.draftImages : []),
    );
    await fillTags(Array.isArray(payload.draftTags) ? payload.draftTags.slice(0, 8) : []);
    const submitResult = await submit();
    const draftUrl = window.location.href;
    const manageUrl = await openManagePage();
    const verificationResult = await verifyPublishedItem(manageUrl, submitResult);
    return {
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
    };
  } catch (error) {
    return fail(error, "今日头条自动发布失败");
  }
}
