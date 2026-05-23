async (input) => {
  const logs = [];
  const payload = input?.payload ?? {};
  const timeoutMs = Number(input?.timeoutMs) || 180000;
  let currentStage = "init";

  const log = (message) => {
    logs.push(message);
    console.log(`[geo-douyin] ${message}`);
  };
  const setStage = (stage, message) => {
    currentStage = stage;
    log(`${stage}: ${message}`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function visible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findByText(text, root = document, baseSelector = "*") {
    const nodes = Array.from(root.querySelectorAll(baseSelector));
    return nodes.find((node) => normalize(node.textContent || "").includes(text)) || null;
  }

  function query(selectors, visibleOnly = true) {
    for (const selector of selectors) {
      try {
        if (selector.startsWith("text=")) {
          const matched = findByText(normalize(selector.slice(5)));
          if (matched && (!visibleOnly || visible(matched))) {
            return matched;
          }
          continue;
        }

        const hasTextMatch = selector.match(/^(.*):has-text\("(.+)"\)$/);
        if (hasTextMatch) {
          const baseSelector = hasTextMatch[1]?.trim() || "*";
          const text = normalize(hasTextMatch[2]);
          const matched = findByText(text, document, baseSelector);
          if (matched && (!visibleOnly || visible(matched))) {
            return matched;
          }
          continue;
        }

        const nodes = Array.from(document.querySelectorAll(selector));
        const matched = nodes.find((node) => (visibleOnly ? visible(node) : true));
        if (matched) {
          return matched;
        }
      } catch (_) {
        // ignore invalid selectors
      }
    }
    return null;
  }

  async function waitFor(selectors, waitMs = 30000, visibleOnly = true) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      const node = query(selectors, visibleOnly);
      if (node) return node;
      await sleep(400);
    }
    throw new Error(`[${currentStage}] 未找到目标元素：${selectors[0] || "unknown"}`);
  }

  async function click(selectors, waitMs = 30000) {
    const node = await waitFor(selectors, waitMs, true);
    if (!(node instanceof HTMLElement)) {
      throw new Error("目标元素不可点击");
    }
    node.scrollIntoView({ block: "center", inline: "center" });
    node.click();
    await sleep(900);
    return node;
  }

  function dispatchInputEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function placeCaretAtEnd(node) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function clearEditable(node) {
    if (!(node instanceof HTMLElement)) return;
    node.focus();
    node.textContent = "";
    dispatchInputEvents(node);
    placeCaretAtEnd(node);
  }

  function setInputValue(node, value) {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, value);
      dispatchInputEvents(node);
      return;
    }
    if (node instanceof HTMLElement) {
      clearEditable(node);
      document.execCommand("insertText", false, value);
      if (!node.textContent?.trim()) {
        node.textContent = value;
      }
      dispatchInputEvents(node);
      placeCaretAtEnd(node);
    }
  }

  async function dataUrlToFile(dataUrl, fileName, mimeType) {
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`预处理图片读取失败：${response.status}`);
    }
    const blob = await response.blob();
    return new File([blob], fileName, {
      type: mimeType || blob.type || "image/png",
    });
  }

  async function fetchFile(url, index) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`图片下载失败：${response.status}`);
    }
    const blob = await response.blob();
    return new File([blob], `douyin-${index + 1}.png`, {
      type: blob.type || "image/png",
    });
  }

  async function uploadImages(urls) {
    await click(
      [
        'button.container-drag-btn-k6XmB4:has-text("上传图文")',
        'button:has-text("上传图文")',
        'text=上传图文',
      ],
      5000,
    ).catch(() => null);

    const inputNode = await waitFor(
      [
        'input[type="file"][accept*="image/png"]',
        'input[type="file"][accept*="image/jpeg"]',
        'input[type="file"][accept*="image/webp"]',
        'input[type="file"][accept*="image/*"]',
        'input[type="file"][multiple]',
        'input[type="file"]',
      ],
      15000,
      false,
    );
    if (!(inputNode instanceof HTMLInputElement)) {
      throw new Error("未找到抖音图文上传输入框");
    }

    const transfer = new DataTransfer();
    const preparedImages = Array.isArray(payload.preparedImages) ? payload.preparedImages : [];
    if (preparedImages.length > 0) {
      log(`upload_images_prepare_file: use_prepared (${preparedImages.length})`);
      for (let index = 0; index < preparedImages.length; index += 1) {
        const prepared = preparedImages[index] || {};
        transfer.items.add(
          await dataUrlToFile(
            String(prepared.dataUrl || ""),
            String(prepared.name || `douyin-${index + 1}.png`),
            String(prepared.mimeType || "image/png"),
          ),
        );
      }
    } else {
      log(`upload_images_prepare_file: fetch_remote (${urls.length})`);
      for (let index = 0; index < urls.length; index += 1) {
        transfer.items.add(await fetchFile(urls[index], index));
      }
    }

    log("upload_images_set_input: dispatch_files");
    inputNode.files = transfer.files;
    inputNode.dispatchEvent(new Event("input", { bubbles: true }));
    inputNode.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(2600);
  }

  async function waitForHints(successHints, failureHints, errorMessage) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      if (failureHints.some((hint) => pageText.includes(hint))) {
        throw new Error(failureHints.find((hint) => pageText.includes(hint)) || "平台返回失败");
      }
      if (successHints.some((hint) => pageText.includes(hint))) {
        return;
      }
      await sleep(1000);
    }
    throw new Error(errorMessage);
  }

  async function waitForSubmitAcknowledgement() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      if (["发布失败", "上传失败", "请完善", "请填写", "网络异常"].some((hint) => pageText.includes(hint))) {
        throw new Error(["发布失败", "上传失败", "请完善", "请填写", "网络异常"].find((hint) => pageText.includes(hint)) || "平台返回失败");
      }
      if (["发布成功", "作品发布成功", "审核中", "发布完成"].some((hint) => pageText.includes(hint))) {
        return {
          acknowledged: true,
          reviewState: pageText.includes("审核中") ? "pending_review" : "submitted",
        };
      }
      await sleep(1000);
    }
    throw new Error("未识别到抖音发布提交反馈");
  }

  async function openManagePage() {
    const candidateUrls = [
      "https://creator.douyin.com/creator-micro/content/manage",
      "https://creator.douyin.com/creator-micro/content/post/manage",
      "https://creator.douyin.com/creator-micro/content/publish",
    ];

    for (const url of candidateUrls) {
      try {
        window.location.href = url;
        await sleep(2400);
        await waitForHints(["内容管理", "作品管理", "作品", "内容"], ["404", "访问异常"], "内容管理页尚未就绪");
        return url;
      } catch (_) {
        // try next candidate
      }
    }
    throw new Error("无法进入抖音内容管理页");
  }

  function textContentId(value) {
    return normalize(value).slice(0, 60);
  }

  async function verifyCreatedItem() {
    const title = normalize(payload.draftTitle || "");
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const matched = anchors.find((anchor) => {
        const text = normalize(anchor.textContent || "");
        const shortTitle = title.slice(0, 12);
        return title && text && (text.includes(title) || title.includes(text) || (shortTitle && text.includes(shortTitle)));
      });
      if (matched) {
        const href = matched.getAttribute("href") || "";
        return {
          publishUrl: href.startsWith("http") ? href : new URL(href, window.location.origin).toString(),
          verificationEvidence: "title_match_in_list",
          platformItemId: href || textContentId(matched.textContent || ""),
        };
      }

      const cards = Array.from(document.querySelectorAll("[class*='content'], [class*='item'], [class*='card'], li, article"));
      const matchedCard = cards.find((card) => {
        const text = normalize(card.textContent || "");
        const shortTitle = title.slice(0, 12);
        return !!title && (text.includes(title) || (shortTitle && text.includes(shortTitle)));
      });
      if (matchedCard) {
        const anchor = matchedCard.querySelector("a[href]");
        const href = anchor?.getAttribute("href") || window.location.href;
        return {
          publishUrl: href.startsWith("http") ? href : new URL(href, window.location.origin).toString(),
          verificationEvidence: "card_match_in_list",
          platformItemId: href || textContentId(matchedCard.textContent || ""),
        };
      }

      await sleep(1500);
    }

    return null;
  }

  async function fillTopics(editor, tags) {
    for (const tag of tags) {
      const current = normalize(editor.textContent || "");
      setInputValue(editor, `${current}${current ? " " : ""}#${tag}`);
      await sleep(800);
    }
  }

  function detectLoginRequired() {
    const currentUrl = window.location.href;
    const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
    if (["/login", "passport", "signin", "sso"].some((hint) => currentUrl.includes(hint))) {
      return `当前页面跳转到了登录相关地址：${currentUrl}`;
    }
    const matchedText = ["登录", "验证码登录", "扫码登录", "手机号登录", "请先登录", "立即登录"].find((hint) => pageText.includes(hint));
    if (matchedText) {
      return `当前页面显示登录提示：${matchedText}`;
    }
    return "";
  }

  try {
    if (!Array.isArray(payload.draftImages) || payload.draftImages.length === 0) {
      throw new Error("抖音图文发布需要至少一张图片");
    }

    setStage("prepare_mode", "切换为图文发布");
    await click(
      [
        'button:has-text("高清发布")',
        'div:has-text("高清发布")',
        'text=高清发布',
      ],
      3000,
    ).catch(() => null);
    await click(
      [
        'button:has-text("发布图文")',
        '[role="tab"]:has-text("发布图文")',
        'div:has-text("发布图文")',
        'text=发布图文',
        'button:has-text("图文")',
        'text=图文',
      ],
      6000,
    ).catch(() => null);
    await sleep(1200);

    const loginRequiredReason = detectLoginRequired();
    if (loginRequiredReason) {
      log(`login_required: ${loginRequiredReason}`);
      return {
        status: "failed",
        errorMessage: loginRequiredReason,
        failureStage: "login_required",
        draftUrl: window.location.href,
        executionLog: logs,
      };
    }

    setStage("upload_images", "上传图片");
    await uploadImages(payload.draftImages);

    setStage("fill_title", "填写标题");
    const titleNode = await waitFor(['input[placeholder="添加作品标题"]', 'input[placeholder*="作品标题"]', 'textarea[placeholder*="标题"]']);
    setInputValue(titleNode, String(payload.draftTitle || "").trim());
    await sleep(1000);

    setStage("fill_body", "填写正文");
    const bodyNode = await waitFor(
      [
        'div.zone-container.editor-kit-container[contenteditable="true"][data-placeholder="添加作品描述..."]',
        'div.zone-container[contenteditable="true"][data-placeholder="添加作品描述..."]',
        'div[contenteditable="true"][data-placeholder*="作品描述"]',
        'div[contenteditable="true"][data-placeholder*="描述"]',
        'div[contenteditable="true"]',
      ],
      30000,
      true,
    );
    setInputValue(bodyNode, String(payload.draftBody || "").trim());
    await sleep(800);
    const tags = (payload.draftTags || []).map((tag) => String(tag || "").replace(/^#+/, "").trim()).filter(Boolean);
    await fillTopics(bodyNode, tags);

    setStage("set_declaration", "尝试选择无需自主声明");
    await click(
      [
        'div.selectBox-buZRzi',
        '[class*="selectBox"]:has-text("请选择自主声明")',
        '[class*="selectText"]:has-text("请选择自主声明")',
        'text=请选择自主声明',
      ],
      3000,
    ).catch(() => null);
    await click(
      [
        'label.semi-radio:has-text("无需添加自主声明")',
        'label:has-text("无需添加自主声明")',
        '[class*="semi-radio"]:has-text("无需添加自主声明")',
        'text=无需添加自主声明',
      ],
      3000,
    ).catch(() => null);
    await click(['button:has-text("确定")', '[role="button"]:has-text("确定")', 'text=确定'], 3000).catch(() => null);

    setStage("click_submit", "点击发布");
    await click(
      [
        'button.button-dhlUZE.primary-cECiOJ.fixed-J9O8Yw',
        'button:has-text("发布")',
        '[role="button"]:has-text("发布")',
        'text=发布',
      ],
      30000,
    );

    setStage("submit_ack", "等待提交反馈");
    const submitAck = await waitForSubmitAcknowledgement();
    const submitUrl = window.location.href;

    setStage("open_manage_page", "进入内容管理页做二次核验");
    const verificationUrl = await openManagePage();

    setStage("verify_created_item", "在列表中查找新发布作品");
    const verifiedItem = await verifyCreatedItem();
    if (verifiedItem) {
      return {
        status: "published",
        draftUrl: submitUrl,
        publishUrl: verifiedItem.publishUrl,
        verificationUrl,
        externalStatus: "verified",
        verificationEvidence: verifiedItem.verificationEvidence,
        verificationAttempts: 1,
        platformItemId: verifiedItem.platformItemId,
        executionLog: logs,
      };
    }

    return {
      status: submitAck.reviewState === "pending_review" ? "pending_review" : "verification_failed",
      draftUrl: submitUrl,
      verificationUrl,
      externalStatus: submitAck.reviewState,
      verificationEvidence: "list_item_not_found",
      verificationAttempts: 1,
      failureStage: "verify_item_missing",
      errorMessage: "已提交发布，但未在抖音内容管理列表中核验到新作品，不能标记为成功。",
      executionLog: logs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "抖音图文发布失败";
    log(`error: ${errorMessage}`);
    return {
      status: "failed",
      errorMessage,
      failureStage: currentStage,
      draftUrl: window.location.href,
      executionLog: logs,
    };
  }
}
