async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "csdn" });
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
    setInputValue,
    extractEditableText,
    closestText,
    getClickableNode,
    simulateClick,
    fail,
    complete,
  } = automation;

  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://editor.csdn.net/md/");
  const title = normalize(payload.draftTitle || "");
  const body = String(payload.draftBody || "").replace(/\r\n/g, "\n").trim();
  const tags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean).slice(0, 5) : [];
  const markdown = [body, tags.length ? `\n\n标签：${tags.join("、")}` : ""].join("");
  const titleNeedles = [title, title.slice(0, 18), title.slice(0, 12)].filter((item) => item.length >= 6);
  const bodyNeedles = [body.slice(0, 28), body.slice(0, 18)].filter((item) => item.length >= 10);

  function installCsdnHeaderCapture() {
    if (window.__geoCsdnHeaderCaptureInstalled) return;
    window.__geoCsdnHeaderCaptureInstalled = true;
    window.__geoCsdnSaveArticleHeaders = {};
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalFetch = window.fetch;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__geoCsdnRequestUrl = String(url || "");
      this.__geoCsdnRequestHeaders = {};
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
      const headerName = String(name || "");
      if (/^x-ca-/i.test(headerName) || headerName.toLowerCase() === "content-type") {
        this.__geoCsdnRequestHeaders[headerName] = String(value || "");
      }
      return originalSetRequestHeader.call(this, name, value);
    };
    XMLHttpRequest.prototype.send = function patchedSend(...args) {
      if (String(this.__geoCsdnRequestUrl || "").includes("/mdeditor/saveArticle")) {
        window.__geoCsdnSaveArticleHeaders = { ...(this.__geoCsdnRequestHeaders || {}) };
      }
      return originalSend.apply(this, args);
    };
    if (typeof originalFetch === "function") {
      window.fetch = function patchedFetch(resource, init = {}) {
        const url = typeof resource === "string" ? resource : resource?.url;
        if (String(url || "").includes("/mdeditor/saveArticle")) {
          const capturedHeaders = {};
          const headers = new Headers(init?.headers || resource?.headers || {});
          headers.forEach((value, name) => {
            if (/^x-ca-/i.test(name) || name.toLowerCase() === "content-type") {
              capturedHeaders[name] = String(value || "");
            }
          });
          window.__geoCsdnSaveArticleHeaders = capturedHeaders;
        }
        return originalFetch.apply(this, arguments);
      };
    }
  }

  function textOf(node) {
    return normalize(node?.innerText || node?.textContent || "");
  }

  function isDisabled(node) {
    return Boolean(
      node?.disabled ||
        String(node?.getAttribute?.("disabled") || "").toLowerCase() === "true" ||
        String(node?.getAttribute?.("aria-disabled") || "").toLowerCase() === "true" ||
        String(node?.className || "").includes("disabled"),
    );
  }

  function getVisibleControls(limit = 40) {
    return Array.from(document.querySelectorAll("button,[role='button'],a,input,textarea,[contenteditable='true'],.el-select,.ant-select,.select"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return [
          node.tagName,
          textOf(node).slice(0, 40),
          node.getAttribute("placeholder") ? `ph=${node.getAttribute("placeholder")}` : "",
          node.getAttribute("aria-label") ? `aria=${node.getAttribute("aria-label")}` : "",
          `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`,
        ].filter(Boolean).join(" ");
      })
      .slice(0, limit);
  }

  function logDiagnostics(stage) {
    log(`${stage}_url: ${window.location.href}`);
    log(`${stage}_controls: ${getVisibleControls().join(" | ").slice(0, 1600) || "none"}`);
    log(`${stage}_page_text: ${pageText().slice(0, 900) || "empty"}`);
  }

  function findClickableByTexts(texts, root = document) {
    const selectors = texts.flatMap((item) => [
      `button:has-text("${item}")`,
      `[role="button"]:has-text("${item}")`,
      `a:has-text("${item}")`,
      `text=${item}`,
    ]);
    return queryAll(selectors, true, root)
      .map((node) => getClickableNode(node))
      .filter((node) => node instanceof HTMLElement && visible(node) && !isDisabled(node))
      .sort((left, right) => {
        const leftText = textOf(left);
        const rightText = textOf(right);
        const leftExact = texts.some((item) => leftText === item) ? 0 : 1;
        const rightExact = texts.some((item) => rightText === item) ? 0 : 1;
        if (leftExact !== rightExact) return leftExact - rightExact;
        return leftText.length - rightText.length;
      })[0] || null;
  }

  function findVisibleNodeByTexts(texts, root = document) {
    return queryAll(
      texts.flatMap((item) => [
        `button:has-text("${item}")`,
        `[role="button"]:has-text("${item}")`,
        `a:has-text("${item}")`,
        `text=${item}`,
      ]),
      true,
      root,
    )
      .filter((node) => node instanceof HTMLElement && visible(node))
      .sort((left, right) => {
        const leftText = textOf(left);
        const rightText = textOf(right);
        const leftExact = texts.some((item) => leftText === item) ? 0 : 1;
        const rightExact = texts.some((item) => rightText === item) ? 0 : 1;
        if (leftExact !== rightExact) return leftExact - rightExact;
        return leftText.length - rightText.length;
      })[0] || null;
  }

  async function clickFirstText(texts, stageName, root = document) {
    const node = findClickableByTexts(texts, root);
    if (!node) return false;
    simulateClick(node);
    log(`${stageName}_clicked: ${textOf(node).slice(0, 80) || texts.join("/")}`);
    await sleep(800);
    return true;
  }

  function findSettingsPanelRoot() {
    const candidates = Array.from(document.querySelectorAll("div,section,aside"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .map((node) => ({ node, nodeText: textOf(node), rect: node.getBoundingClientRect() }))
      .filter(
        (item) =>
          item.nodeText.includes("文章标签") &&
          item.nodeText.includes("分类专栏") &&
          item.nodeText.includes("文章类型") &&
          item.nodeText.includes("可见范围"),
      )
      .sort((left, right) => {
        const leftArea = left.rect.width * left.rect.height;
        const rightArea = right.rect.width * right.rect.height;
        return leftArea - rightArea;
      });
    return candidates[0]?.node || null;
  }

  async function clickFinalPublishButton(stageName) {
    const root = findSettingsPanelRoot();
    if (root instanceof HTMLElement) {
      root.scrollTop = root.scrollHeight;
      root.scrollIntoView({ block: "end", inline: "nearest" });
    }
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(900);

    const searchRoot = root || document;
    const candidates = queryAll(
      ['button:has-text("发布文章")', '[role="button"]:has-text("发布文章")', 'button:has-text("发布")', '[role="button"]:has-text("发布")'],
      false,
      searchRoot,
    )
      .map((node) => getClickableNode(node))
      .filter((node) => node instanceof HTMLElement && !isDisabled(node))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftVisible = visible(left) ? 1 : 0;
        const rightVisible = visible(right) ? 1 : 0;
        if (leftVisible !== rightVisible) return leftVisible - rightVisible;
        if (leftRect.top !== rightRect.top) return leftRect.top - rightRect.top;
        return leftRect.left - rightRect.left;
      });

    const button = candidates[candidates.length - 1];
    if (!(button instanceof HTMLElement)) {
      logDiagnostics(`${stageName}_final_publish_missing`);
      return false;
    }
    const rect = button.getBoundingClientRect();
    simulateClick(button);
    log(`${stageName}_clicked: ${textOf(button).slice(0, 80) || "发布文章"} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`);
    await sleep(1000);
    return true;
  }

  async function ensurePage() {
    setStage("load_publish_page", "进入 CSDN 编辑器");
    if (!window.location.href.includes("editor.csdn.net")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    await waitFor(["input", "textarea", '[contenteditable="true"]', ".CodeMirror", '[role="textbox"]'], 60000, false);
  }

  async function fillTitle() {
    setStage("fill_title", "填写 CSDN 标题");
    const selectors = [
      "#txtTitle",
      "input[name='title']",
      "input[placeholder*='标题']",
      "textarea[placeholder*='标题']",
      "[contenteditable='true'][data-placeholder*='标题']",
      "[contenteditable='true'][placeholder*='标题']",
      "[aria-label*='标题']",
      "[class*='title'] input",
      "[class*='title'] textarea",
      "[class*='title'] [contenteditable='true']",
      ".article-title-box input",
      ".article-title input",
      ".title-input",
    ];
    let node = query(selectors, false);
    if (!node) {
      const inputs = queryAll(["input", "textarea", "[contenteditable='true']", "[role='textbox']"], false);
      node = inputs.find((item) => {
        const attrs = normalize([
          item.id,
          item.className,
          item.getAttribute?.("name"),
          item.getAttribute?.("placeholder"),
          item.getAttribute?.("aria-label"),
          item.getAttribute?.("data-placeholder"),
          item.textContent,
        ].filter(Boolean).join(" "));
        return attrs.includes("标题") || attrs.toLowerCase().includes("title");
      }) || null;
    }
    if (!node) {
      logDiagnostics("fill_title_missing");
      throw new Error("未找到 CSDN 标题输入框");
    }
    setInputValue(node, title);
    await sleep(600);
    const written = normalize(extractEditableText(node));
    if (titleNeedles.length && !titleNeedles.some((needle) => written.includes(needle) || pageText().includes(needle))) {
      log(`fill_title_verify_soft_failed: ${written.slice(0, 80)}`);
    }
    await sleep(300);
    await clickFirstText(["保存草稿", "保存"], "save_draft_after_title");
  }

  async function fillBody() {
    setStage("fill_body", "填写 CSDN 正文");
    const selectors = [
      "textarea.editor",
      ".CodeMirror textarea",
      "textarea",
      ".editor__inner",
      "pre[contenteditable='true']",
      "[contenteditable='true']",
    ];
    const candidates = queryAll(selectors, false).filter((node) => {
      if (!(node instanceof HTMLElement || node instanceof HTMLTextAreaElement)) return false;
      const context = normalize([
        extractEditableText(node),
        closestText(node),
        node.getAttribute?.("placeholder") || "",
        node.getAttribute?.("aria-label") || "",
        node.getAttribute?.("class") || "",
      ].join(" "));
      if (context.includes("标题") || context.toLowerCase().includes("title")) return false;
      const rect = node.getBoundingClientRect?.();
      if (rect && rect.width < 120 && rect.height < 40) return false;
      return true;
    });
    const node = candidates[0];
    if (!node) {
      logDiagnostics("fill_body_missing");
      throw new Error("未找到 CSDN 正文编辑器");
    }
    setInputValue(node, markdown);
    await sleep(1000);
    const written = normalize(extractEditableText(node));
    if (!bodyNeedles.some((needle) => written.includes(needle) || pageText().includes(needle))) {
      log("fill_body_verify_soft_failed: 编辑器可能使用隐藏 textarea，继续提交前检查页面文本。");
    }
  }

  async function fillPublishSettings() {
    setStage("publish_settings", "处理 CSDN 发布设置");
    await sleep(1200);

    const pg = pageText();
    if (!["发布设置", "文章类型", "分类", "标签", "确认发布", "公开"].some((hint) => pg.includes(hint))) {
      log("publish_settings_not_detected");
      return;
    }

    const originalNode = findVisibleNodeByTexts(["原创"]);
    if (originalNode) {
      simulateClick(getClickableNode(originalNode) || originalNode);
      log("publish_settings_original_clicked");
      await sleep(700);
    }

    const visibilityNode = findVisibleNodeByTexts(["全部可见", "公开", "仅我可见"]);
    if (visibilityNode) {
      simulateClick(getClickableNode(visibilityNode) || visibilityNode);
      log(`publish_settings_visibility_clicked: ${textOf(visibilityNode).slice(0, 40)}`);
      await sleep(700);
    }

    const inputs = Array.from(document.querySelectorAll("input,textarea")).filter((node) => {
      if (!(node instanceof HTMLElement) || !visible(node)) return false;
      const rect = node.getBoundingClientRect();
      return rect.left > 300 && rect.top > 100;
    });
    for (const node of inputs) {
      const context = normalize([
        node.getAttribute?.("placeholder") || "",
        node.getAttribute?.("aria-label") || "",
        closestText(node),
        textOf(node),
      ].join(" "));
      if (context.includes("标签") || context.includes("关键词")) {
        setInputValue(node, tags.length ? tags.join(",") : "GEO,AI搜索,自动化发布");
        log("publish_settings_tags_filled");
        await sleep(500);
      }
      if (context.includes("摘要") || context.includes("简介")) {
        const summary = body.split(/\n+/).map((item) => item.trim()).filter(Boolean)[0] || body.slice(0, 180);
        setInputValue(node, summary);
        log("publish_settings_summary_filled");
        await sleep(500);
      }
    }

    const selectLike = Array.from(
      document.querySelectorAll(".el-select,.ant-select,[class*='select'],[role='combobox'],input[placeholder*='分类'],input[placeholder*='专栏']"),
    ).filter((node) => node instanceof HTMLElement && visible(node));
    for (const node of selectLike.slice(0, 4)) {
      const context = normalize([closestText(node), textOf(node), node.getAttribute?.("placeholder") || ""].join(" "));
      if (!["分类", "专栏", "频道", "类型"].some((hint) => context.includes(hint))) continue;
      simulateClick(node);
      log(`publish_settings_select_opened: ${context.slice(0, 80)}`);
      await sleep(900);
      const createCategory = findVisibleNodeByTexts(["新建分类专栏", "新建分类", "创建分类", "创建专栏"]);
      if (createCategory instanceof HTMLElement) {
        simulateClick(getClickableNode(createCategory) || createCategory);
        log("publish_settings_create_category_clicked");
        await sleep(1800);
        const categoryInputs = Array.from(document.querySelectorAll("input,textarea")).filter((input) => {
          if (!(input instanceof HTMLElement) || !visible(input)) return false;
          if (String(input.getAttribute?.("type") || "").toLowerCase() === "file") return false;
          const rect = input.getBoundingClientRect();
          const context = normalize([
            input.getAttribute?.("placeholder") || "",
            input.getAttribute?.("aria-label") || "",
            closestText(input),
          ].join(" "));
          return (
            rect.left > 250 &&
            ["分类", "专栏", "名称", "标题", "输入"].some((hint) => context.includes(hint)) &&
            !["文章摘要", "标签", "搜索"].some((hint) => context.includes(hint))
          );
        });
        if (categoryInputs[0]) {
          setInputValue(categoryInputs[0], "GEO自动化");
          log("publish_settings_category_created_name_filled");
          await sleep(800);
          await clickFirstText(["确定", "确认", "保存", "创建", "完成"], "publish_settings_category_create_confirm");
          await sleep(1200);
        } else {
          logDiagnostics("publish_settings_category_create_no_input");
        }
      }
      const option = queryAll(["[role='option']", ".el-select-dropdown__item", ".ant-select-item-option", "li", "div"], true)
        .filter((item) => item instanceof HTMLElement && visible(item))
        .find((item) => {
          const optionText = textOf(item);
          return (
            optionText &&
            optionText.length <= 30 &&
            !["请选择", "搜索", "暂无数据", "返回", "发布文章", "保存草稿", title].some((hint) => hint && optionText.includes(hint))
          );
        });
      if (option instanceof HTMLElement) {
        simulateClick(option);
        log(`publish_settings_option_selected: ${textOf(option).slice(0, 60)}`);
        await sleep(800);
      } else {
        const categoryInput = query(
          [
            'input[placeholder*="分类"]',
            'input[placeholder*="专栏"]',
            'input[placeholder*="名称"]',
            'input[placeholder*="输入"]',
            'textarea[placeholder*="名称"]',
          ],
          false,
        );
        if (categoryInput) {
          setInputValue(categoryInput, "GEO自动化");
          log("publish_settings_category_text_filled");
          await sleep(700);
        }
      }
    }

    const categoryChips = Array.from(document.querySelectorAll("span,button,[role='button'],label,div"))
      .filter((node) => node instanceof HTMLElement && visible(node))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const nodeText = textOf(node);
        return (
          rect.left >= 330 &&
          rect.left <= 540 &&
          rect.top >= 400 &&
          rect.top <= 470 &&
          rect.width > 8 &&
          rect.width < 140 &&
          !nodeText.includes("新建") &&
          !nodeText.includes("添加") &&
          !nodeText.includes("发布")
        );
      });
    for (const chip of categoryChips.slice(0, 4)) {
      simulateClick(getClickableNode(chip) || chip);
      log(`publish_settings_category_chip_clicked: ${textOf(chip).slice(0, 40) || "empty_chip"}`);
      await sleep(500);
    }

    await clickFirstText(["保存草稿", "保存"], "publish_settings_save_draft");
    await clickFirstText(["保存", "确定", "确认", "下一步"], "publish_settings_confirm");
  }

  async function submit() {
    setStage("submit", "提交 CSDN 发布");
    const firstButton = findClickableByTexts(["发布文章", "发布"]);
    if (!firstButton) {
      logDiagnostics("submit_button_missing");
      throw new Error("未找到 CSDN 发布按钮");
    }
    simulateClick(firstButton);
    log("submit_first_clicked: csdn");
    await sleep(2500);

    await fillPublishSettings();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const clicked = await clickFinalPublishButton(`submit_confirm_${attempt}`) || await clickFirstText(["确认发布", "发布文章", "立即发布", "发布"], `submit_confirm_${attempt}`);
      if (!clicked) break;
      await sleep(3500);
      const pg = pageText();
      if (["发布成功", "提交成功", "审核中", "已发布"].some((hint) => pg.includes(hint))) {
        return complete({
          status: pg.includes("审核中") ? "pending_review" : "published",
          publishUrl: window.location.href,
          verificationEvidence: "csdn_submit_success_text",
          executionLog: logs,
        });
      }
    }

    await sleep(4000);
    const pg = pageText();
    if (["发布成功", "提交成功", "审核中", "已发布"].some((hint) => pg.includes(hint))) {
      return complete({
        status: pg.includes("审核中") ? "pending_review" : "published",
        publishUrl: window.location.href,
        verificationEvidence: "csdn_submit_success_text",
        executionLog: logs,
      });
    }
    const directResult = await directPublishViaSaveArticle();
    if (directResult) {
      return directResult;
    }
    if (["请选择", "分类", "验证码", "审核", "不能为空", "必填", "未完成", "风险", "登录"].some((hint) => pg.includes(hint))) {
      logDiagnostics("submit_blocked");
      return complete({
        status: "verification_failed",
        failureStage: "submit",
        errorMessage: "CSDN 提交后仍存在分类、验证码、审核、登录或必填项阻断。",
        publishUrl: window.location.href,
        verificationEvidence: "csdn_platform_blocking_text",
        executionLog: logs,
      });
    }
    return complete({
      status: "submitted",
      publishUrl: window.location.href,
      verificationEvidence: "csdn_submit_clicked",
      executionLog: logs,
    });
  }

  async function directPublishViaSaveArticle() {
    setStage("direct_publish_api", "尝试 CSDN 保存接口直接发布");
    const articleId = Number(new URL(window.location.href).searchParams.get("articleId") || 0) || "";
    const description = body.split(/\n+/).map((item) => item.trim()).filter(Boolean)[0]?.slice(0, 180) || title;
    const htmlContent = `<p>${markdown.replace(/[<&>]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char])).replace(/\n+/g, "</p><p>")}</p>\n\n`;
    const capturedHeaders = Object.fromEntries(
      Object.entries(window.__geoCsdnSaveArticleHeaders || {}).filter(([name, value]) => /^x-ca-/i.test(name) && value),
    );
    log(`direct_publish_captured_headers: ${Object.keys(capturedHeaders).sort().join(",") || "none"}`);
    const basePayload = {
      articleId,
      title,
      markdowncontent: `${markdown}\n`,
      content: htmlContent,
      readType: "public",
      level: 0,
      tags: tags.length ? tags.join(",") : "自动化,运维",
      categories: "",
      type: "original",
      original_link: "",
      authorized_status: false,
      Description: description,
      not_auto_saved: "1",
      source: "pc_mdeditor",
      cover_images: [],
      cover_type: 1,
      is_new: articleId ? 0 : 1,
      vote_id: 0,
      resource_id: "",
      creation_statement: 0,
      creator_activity_id: "",
    };
    const attempts = [
      { ...basePayload, status: 1, pubStatus: "publish" },
      { ...basePayload, status: 2, pubStatus: "publish" },
      { ...basePayload, status: 0, pubStatus: "publish" },
    ];
    for (const requestBody of attempts) {
      try {
        log(`direct_publish_attempt: status=${requestBody.status}; articleId=${articleId || "new"}`);
        const response = await fetch("https://bizapi.csdn.net/blog-console-api/v3/mdeditor/saveArticle", {
          method: "POST",
          headers: { ...capturedHeaders, "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(requestBody),
        });
        const text = await response.text();
        log(`direct_publish_response_${requestBody.status}: ${text.slice(0, 800)}`);
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (_) {
          // keep raw response log
        }
        const code = data?.code ?? data?.status;
        const message = normalize(data?.msg || data?.message || data?.error || text);
        const ok =
          response.ok &&
          (code === 200 || code === 0 || data?.success === true || data?.data?.articleId || data?.data?.id) &&
          !["分类", "验证码", "不能为空", "必填", "失败", "错误"].some((hint) => message.includes(hint));
        if (ok) {
          return complete({
            status: message.includes("审核") ? "pending_review" : "published",
            publishUrl: window.location.href,
            verificationEvidence: "csdn_direct_save_article_publish",
            externalStatus: message || `saveArticle:${code ?? response.status}`,
            executionLog: logs,
            platformItemId: String(data?.data?.articleId || data?.data?.id || articleId || ""),
          });
        }
      } catch (error) {
        log(`direct_publish_error_${requestBody.status}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return null;
  }

  try {
    installCsdnHeaderCapture();
    await ensurePage();
    await fillTitle();
    await fillBody();
    return await submit();
  } catch (error) {
    return fail(error, "CSDN 自动发布失败");
  }
}
