(function () {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const debugPrefix = "[ai-superweb-publish]";
  const randomBetween = (min, max) => {
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return Math.floor(lower + Math.random() * (upper - lower + 1));
  };
  const randomFloatBetween = (min, max) => {
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return lower + Math.random() * (upper - lower);
  };
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  let lastMousePosition = null;

  function resolveTypingDelay(char, index, text, minDelay, maxDelay) {
    const baseDelay = randomBetween(minDelay, maxDelay);
    if (/[\n\r]/.test(char)) {
      return baseDelay + randomBetween(180, 420);
    }
    if (/[。！？!?；;，,、：:）)\]}】」』]/.test(char)) {
      return baseDelay + randomBetween(80, 260);
    }
    if (/\s/.test(char)) {
      return Math.max(35, baseDelay - randomBetween(20, 55));
    }
    if (index > 0 && index % randomBetween(18, 32) === 0) {
      return baseDelay + randomBetween(120, 360);
    }
    if (text.length > 120 && index > 0 && index % randomBetween(45, 70) === 0) {
      return baseDelay + randomBetween(260, 620);
    }
    return baseDelay;
  }

  function findScrollableParent(node) {
    let current = node?.parentElement || null;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const canScrollY = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
      if (canScrollY && current.scrollHeight > current.clientHeight + 8) {
        return current;
      }
      current = current.parentElement;
    }
    return window;
  }

  function getScrollViewport(scrollTarget) {
    if (scrollTarget === window) {
      return {
        top: 0,
        height: window.innerHeight || document.documentElement.clientHeight || 800,
      };
    }
    const rect = scrollTarget.getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  }

  function dispatchWheelPulse(node, deltaY) {
    if (typeof WheelEvent === "undefined") {
      return;
    }
    node.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY,
        deltaMode: 0,
        clientX: Math.round(window.innerWidth * randomFloatBetween(0.35, 0.65)),
        clientY: Math.round(window.innerHeight * randomFloatBetween(0.35, 0.65)),
      }),
    );
  }

  async function humanScrollElementIntoView(node, options = {}) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const scrollTarget = findScrollableParent(node);
    const maxSteps = options.scrollSteps ?? randomBetween(4, 8);
    const targetRatio = options.scrollTargetRatio ?? randomFloatBetween(0.42, 0.58);
    const pauseMin = options.scrollPauseMin ?? 90;
    const pauseMax = options.scrollPauseMax ?? 220;

    for (let step = 0; step < maxSteps; step += 1) {
      const rect = node.getBoundingClientRect();
      const viewport = getScrollViewport(scrollTarget);
      const desiredTop = viewport.top + viewport.height * targetRatio - rect.height / 2;
      const delta = rect.top - desiredTop;
      if (Math.abs(delta) <= 18) {
        break;
      }

      const maxDistance = randomBetween(260, 560);
      const scrollDelta = clamp(delta * randomFloatBetween(0.38, 0.68), -maxDistance, maxDistance);
      dispatchWheelPulse(node, scrollDelta);
      if (scrollTarget === window) {
        window.scrollBy({ top: scrollDelta, left: 0, behavior: "auto" });
      } else {
        scrollTarget.scrollBy({ top: scrollDelta, left: 0, behavior: "auto" });
      }
      await sleep(randomBetween(pauseMin, pauseMax));
    }

    const finalRect = node.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    if (finalRect.top < 12 || finalRect.bottom > viewportHeight - 12) {
      node.scrollIntoView({ block: "center", inline: "center" });
      await sleep(randomBetween(pauseMin, pauseMax));
    }
  }

  function pickClickPoint(rect) {
    const xPadding = Math.min(10, Math.max(2, rect.width / 3));
    const yPadding = Math.min(10, Math.max(2, rect.height / 3));
    const minX = rect.left + xPadding;
    const maxX = rect.right - xPadding;
    const minY = rect.top + yPadding;
    const maxY = rect.bottom - yPadding;
    return {
      clientX: Math.round(randomFloatBetween(Math.min(minX, maxX), Math.max(minX, maxX))),
      clientY: Math.round(randomFloatBetween(Math.min(minY, maxY), Math.max(minY, maxY))),
    };
  }

  function dispatchPointerMove(node, type, clientX, clientY, overrides = {}) {
    if (typeof PointerEvent === "undefined") {
      return;
    }
    node.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX,
        clientY,
        button: 0,
        buttons: 0,
        ...overrides,
      }),
    );
  }

  function dispatchMouseMove(node, type, clientX, clientY, overrides = {}) {
    node.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons: 0,
        ...overrides,
      }),
    );
  }

  async function moveMouseAlongPath(node, clientX, clientY, options = {}) {
    const start = lastMousePosition || {
      clientX: randomBetween(24, Math.max(48, (window.innerWidth || 1024) - 24)),
      clientY: randomBetween(24, Math.max(48, (window.innerHeight || 768) - 24)),
    };
    const steps = options.pathSteps ?? randomBetween(6, 12);
    const pauseMin = options.pathPauseMin ?? 12;
    const pauseMax = options.pathPauseMax ?? 38;
    const curveX = (start.clientX + clientX) / 2 + randomBetween(-90, 90);
    const curveY = (start.clientY + clientY) / 2 + randomBetween(-70, 70);

    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const eased = t * t * (3 - 2 * t);
      const oneMinus = 1 - eased;
      const nextX =
        oneMinus * oneMinus * start.clientX + 2 * oneMinus * eased * curveX + eased * eased * clientX;
      const nextY =
        oneMinus * oneMinus * start.clientY + 2 * oneMinus * eased * curveY + eased * eased * clientY;
      const jitter = index === steps ? 0 : randomFloatBetween(-1.8, 1.8);
      dispatchPointerMove(node, "pointermove", Math.round(nextX + jitter), Math.round(nextY - jitter));
      dispatchMouseMove(node, "mousemove", Math.round(nextX + jitter), Math.round(nextY - jitter));
      await sleep(randomBetween(pauseMin, pauseMax));
    }
    lastMousePosition = { clientX, clientY };
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function debugLog(scope, detail, extra) {
    if (typeof extra === "undefined") {
      console.log(`${debugPrefix}[${scope}] ${detail}`);
      return;
    }
    console.log(`${debugPrefix}[${scope}] ${detail}`, extra);
  }

  function inferFileName(url, fallbackName) {
    try {
      const pathname = new URL(url).pathname;
      const raw = pathname.split("/").pop() || fallbackName;
      return raw.includes(".") ? raw : fallbackName;
    } catch (_) {
      return fallbackName;
    }
  }

  async function fetchFile(url, index, kind) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`素材下载失败：${response.status}`);
    }
    const blob = await response.blob();
    const extension = kind === "video" ? "mp4" : "png";
    const fileName = inferFileName(url, `${kind}-${index + 1}.${extension}`);
    return new File([blob], fileName, {
      type: blob.type || (kind === "video" ? "video/mp4" : "image/png"),
    });
  }

  function matchesVisibility(node) {
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

  function collectSearchRoots(root = document, results = [], visited = new Set()) {
    if (!root || visited.has(root)) {
      return results;
    }
    visited.add(root);
    results.push(root);

    const hostElements =
      "querySelectorAll" in root ? Array.from(root.querySelectorAll("*")) : [];
    for (const element of hostElements) {
      const shadowRoot = element && "shadowRoot" in element ? element.shadowRoot : null;
      if (shadowRoot) {
        collectSearchRoots(shadowRoot, results, visited);
      }
    }

    const frameElements = Array.from(root.querySelectorAll("iframe"));
    for (const frame of frameElements) {
      try {
        const frameDocument = frame.contentDocument;
        if (frameDocument) {
          collectSearchRoots(frameDocument, results, visited);
        }
      } catch (_) {
        // ignore cross-origin iframe
      }
    }

    return results;
  }

  function queryFirst(selectors, root = document, visibleOnly = true) {
    const searchRoots = collectSearchRoots(root);
    for (const selector of selectors) {
      for (const currentRoot of searchRoots) {
        try {
          let matched = null;
          if (selector.startsWith("text=")) {
            matched = findByText(normalize(selector.slice(5)), currentRoot);
          } else {
            const hasTextMatch = selector.match(/^(.*):has-text\("(.+)"\)$/);
            if (hasTextMatch) {
              const baseSelector = hasTextMatch[1]?.trim() || "*";
              const text = normalize(hasTextMatch[2]);
              matched = findByText(text, currentRoot, baseSelector);
            } else {
              const nodes = Array.from(currentRoot.querySelectorAll(selector));
              matched = nodes.find((node) => (visibleOnly ? matchesVisibility(node) : true)) || null;
            }
          }

          if (matched && (!visibleOnly || matchesVisibility(matched))) {
            return matched;
          }
        } catch (_) {
          // ignore invalid selector
        }
      }
    }
    return null;
  }

  async function waitForVisible(selectors, timeoutMs = 30000, root = document, visibleOnly = true) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const node = queryFirst(selectors, root, visibleOnly);
      if (node) {
        return node;
      }
      await sleep(400);
    }
    throw new Error(`未找到目标元素：${selectors[0] || "unknown"}`);
  }

  async function humanClickElement(node, options = {}) {
    if (!(node instanceof HTMLElement)) {
      throw new Error("目标元素不可点击");
    }

    const beforeMoveMin = options.beforeMoveMin ?? 120;
    const beforeMoveMax = options.beforeMoveMax ?? 260;
    const movePauseMin = options.movePauseMin ?? 80;
    const movePauseMax = options.movePauseMax ?? 180;
    const holdPauseMin = options.holdPauseMin ?? 90;
    const holdPauseMax = options.holdPauseMax ?? 160;
    const afterClickMin = options.afterClickMin ?? 220;
    const afterClickMax = options.afterClickMax ?? 420;

    await humanScrollElementIntoView(node, options);
    await sleep(randomBetween(beforeMoveMin, beforeMoveMax));

    const rect = node.getBoundingClientRect();
    const { clientX, clientY } = pickClickPoint(rect);

    const dispatchPointer = (type, overrides = {}) => {
      if (typeof PointerEvent === "undefined") {
        return;
      }
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX,
          clientY,
          button: 0,
          buttons: 1,
          ...overrides,
        }),
      );
    };

    const dispatchMouse = (type, overrides = {}) => {
      node.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX,
          clientY,
          button: 0,
          buttons: 1,
          ...overrides,
        }),
      );
    };

    node.focus();
    await moveMouseAlongPath(node, clientX, clientY, options);
    dispatchPointer("pointerover");
    dispatchMouse("mouseover");
    dispatchPointer("pointerenter");
    dispatchMouse("mouseenter");
    await sleep(randomBetween(movePauseMin, movePauseMax));
    dispatchPointer("pointermove");
    dispatchMouse("mousemove");
    await sleep(randomBetween(movePauseMin, movePauseMax));
    dispatchPointer("pointerdown");
    dispatchMouse("mousedown");
    await sleep(randomBetween(holdPauseMin, holdPauseMax));
    dispatchPointer("pointerup", { buttons: 0 });
    dispatchMouse("mouseup", { buttons: 0 });
    node.click();
    await sleep(randomBetween(afterClickMin, afterClickMax));
  }

  async function clickFirst(selectors, timeoutMs = 30000, root = document, options = {}) {
    const node = await waitForVisible(selectors, timeoutMs, root, true);
    if (node instanceof HTMLElement) {
      await humanClickElement(node, options);
      return node;
    }
    throw new Error("目标元素不可点击");
  }

  function dispatchInputEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setNativeInputValue(node, value) {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      return;
    }
    const prototype =
      node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(node, value);
  }

  function clearFormControl(node) {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      return;
    }
    node.focus();
    setNativeInputValue(node, "");
    dispatchInputEvents(node);
  }

  async function typeFormControlHuman(node, text, minDelay = 95, maxDelay = 180) {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      return;
    }
    const normalized = String(text || "");
    if (!normalized) {
      return;
    }
    node.focus();
    const chars = Array.from(normalized);
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      setNativeInputValue(node, `${node.value || ""}${char}`);
      dispatchInputEvents(node);
      await sleep(resolveTypingDelay(char, index, normalized, minDelay, maxDelay));
    }
  }

  async function fillFirst(selectors, value, timeoutMs = 30000, root = document, options = {}) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return null;
    }

    const node = await waitForVisible(selectors, timeoutMs, root, true);
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      if (options.preferHumanType) {
        clearFormControl(node);
        await sleep(randomBetween(180, 320));
        await typeFormControlHuman(node, normalized, options.perCharMin ?? 95, options.perCharMax ?? 180);
      } else {
        node.focus();
        setNativeInputValue(node, normalized);
        dispatchInputEvents(node);
      }
      return node;
    }

    if (node instanceof HTMLElement) {
      if (options.preferHumanType) {
        clearEditable(node);
        await sleep(randomBetween(180, 320));
        await typeEditableTextHuman(node, normalized, options.perCharMin ?? 95, options.perCharMax ?? 165);
      } else {
        node.focus();
        node.textContent = normalized;
        dispatchInputEvents(node);
      }
      return node;
    }

    return null;
  }

  async function appendText(selectors, value, timeoutMs = 30000, root = document, options = {}) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return null;
    }

    const node = await waitForVisible(selectors, timeoutMs, root, true);
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      if (options.preferHumanType) {
        node.focus();
        await sleep(randomBetween(140, 260));
        await typeFormControlHuman(node, normalized, options.perCharMin ?? 95, options.perCharMax ?? 180);
      } else {
        node.focus();
        setNativeInputValue(node, `${node.value || ""}${normalized}`);
        dispatchInputEvents(node);
      }
      return node;
    }

    if (node instanceof HTMLElement) {
      if (options.preferHumanType) {
        node.focus();
        placeCaretAtEnd(node);
        await sleep(randomBetween(140, 260));
        await typeEditableTextHuman(node, normalized, options.perCharMin ?? 95, options.perCharMax ?? 165);
      } else {
        node.focus();
        const nextValue = `${node.textContent || ""}${normalized}`;
        node.textContent = nextValue;
        dispatchInputEvents(node);
      }
      return node;
    }

    return null;
  }

  function placeCaretAtEnd(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function clearEditable(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    node.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand("delete", false);
    node.textContent = "";
    dispatchInputEvents(node);
    placeCaretAtEnd(node);
  }

  function insertEditableText(node, text) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    node.focus();
    placeCaretAtEnd(node);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        node.textContent = `${node.textContent || ""}${text}`;
      } else {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    dispatchInputEvents(node);
    placeCaretAtEnd(node);
  }

  async function typeEditableTextHuman(node, text, minDelay = 70, maxDelay = 120) {
    const normalized = String(text || "");
    if (!normalized) {
      return;
    }
    const chars = Array.from(normalized);
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      insertEditableText(node, char);
      await sleep(resolveTypingDelay(char, index, normalized, minDelay, maxDelay));
    }
  }

  async function pressEditableEnter(node) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    node.focus();
    placeCaretAtEnd(node);
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    const inserted =
      document.execCommand("insertParagraph", false) ||
      document.execCommand("insertLineBreak", false) ||
      document.execCommand("insertHTML", false, "<div><br></div>");
    if (!inserted) {
      insertEditableText(node, "\n");
    } else {
      dispatchInputEvents(node);
    }
    node.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    placeCaretAtEnd(node);
    await sleep(randomBetween(240, 420));
  }

  function douyinSlowClickOptions() {
    return {
      beforeMoveMin: 260,
      beforeMoveMax: 520,
      movePauseMin: 160,
      movePauseMax: 320,
      holdPauseMin: 140,
      holdPauseMax: 260,
      afterClickMin: 420,
      afterClickMax: 760,
    };
  }

  function douyinSlowActionClickOptions() {
    return {
      beforeMoveMin: 240,
      beforeMoveMax: 500,
      movePauseMin: 150,
      movePauseMax: 300,
      holdPauseMin: 130,
      holdPauseMax: 240,
      afterClickMin: 360,
      afterClickMax: 680,
    };
  }

  function douyinSlowPublishClickOptions() {
    return {
      beforeMoveMin: 320,
      beforeMoveMax: 620,
      movePauseMin: 200,
      movePauseMax: 380,
      holdPauseMin: 170,
      holdPauseMax: 320,
      afterClickMin: 520,
      afterClickMax: 960,
    };
  }

  function escapeHasText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  function normalizeTags(tags) {
    return Array.from(
      new Set(
        (tags || [])
          .map((tag) => String(tag || "").replace(/^#+/, "").trim())
          .filter(Boolean),
      ),
    );
  }

  async function clickKuaishouTagCandidate(tag) {
    const safeTag = escapeHasText(tag);
    const selectors = [
      `span._at-tag-name_eho7l_222:has-text("${safeTag}")`,
      `span[class*="at-tag-name"]:has-text("${safeTag}")`,
      `span:has-text("${safeTag}")`,
      `div:has-text("${safeTag}")`,
    ];
    return clickFirst(selectors, 5000, document, {
      beforeMoveMin: 160,
      beforeMoveMax: 320,
      movePauseMin: 100,
      movePauseMax: 220,
      holdPauseMin: 110,
      holdPauseMax: 180,
      afterClickMin: 260,
      afterClickMax: 520,
    })
      .then(() => true)
      .catch(() => false);
  }

  async function fillKuaishouDescription(job) {
    const editor = await waitForVisible(
      [
        "div#work-description-edit",
        'div._description_eho7l_59#work-description-edit',
        'div[contenteditable="true"]#work-description-edit',
        'div[contenteditable="true"][placeholder*="添加合适的话题"]',
        'div[contenteditable="true"]',
      ],
      20000,
      document,
      true,
    );
    if (!(editor instanceof HTMLElement)) {
      throw new Error("未找到快手描述输入框");
    }

    await humanClickElement(editor, {
      beforeMoveMin: 180,
      beforeMoveMax: 360,
      movePauseMin: 120,
      movePauseMax: 240,
      holdPauseMin: 120,
      holdPauseMax: 220,
      afterClickMin: 260,
      afterClickMax: 520,
    });
    await sleep(randomBetween(180, 320));
    clearEditable(editor);
    await sleep(randomBetween(180, 320));

    const title = String(job?.draftTitle || "").trim();
    const body = String(job?.draftBody || "").trim();
    const tags = normalizeTags(job?.draftTags);

    if (title) {
      await typeEditableTextHuman(editor, title, 80, 135);
    }
    await pressEditableEnter(editor);

    if (body) {
      await typeEditableTextHuman(editor, body, 80, 135);
    }

    for (const tag of tags) {
      await pressEditableEnter(editor);
      await typeEditableTextHuman(editor, `#${tag}`, 85, 140);
      await sleep(randomBetween(500, 900));
      await clickKuaishouTagCandidate(tag);
      await sleep(randomBetween(380, 720));
    }
  }

  async function uploadFiles(selectors, urls, kind, root = document) {
    if (!Array.isArray(urls) || urls.length === 0) {
      return;
    }
    const input = await waitForVisible(selectors, 30000, root, false);
    if (!(input instanceof HTMLInputElement) || input.type !== "file") {
      throw new Error("未找到可上传文件输入框");
    }

    const files = [];
    for (let index = 0; index < urls.length; index += 1) {
      files.push(await fetchFile(urls[index], index, kind));
    }

    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitForHints(successHints, failureHints, timeoutErrorMessage, timeoutMs = 120000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
      if (failureHints.some((hint) => pageText.includes(hint))) {
        throw new Error(failureHints.find((hint) => pageText.includes(hint)) || "发布失败");
      }
      if (successHints.some((hint) => pageText.includes(hint))) {
        return;
      }
      await sleep(1200);
    }
    throw new Error(timeoutErrorMessage);
  }

  async function gotoUrl(url) {
    if (window.location.href.startsWith(url)) {
      debugLog("goto", "skip same url", { currentUrl: window.location.href, targetUrl: url });
      return;
    }
    debugLog("goto", "navigate", { currentUrl: window.location.href, targetUrl: url });
    window.location.assign(url);
    await sleep(2500);
  }

  async function ensureKuaishouPublishReady(isVideo) {
    await sleep(1500);
    const entryTitle = isVideo ? "发布视频" : "发布图文";
    const uploadLabel = isVideo ? "上传视频" : "上传图片";

    await clickFirst(
      [
        `div.item:has-text("${entryTitle}")`,
        `div[class*="item"]:has-text("${entryTitle}")`,
        `div:has-text("${entryTitle}")`,
        `text=${entryTitle}`,
      ],
      10000,
      document,
      {
        beforeMoveMin: 180,
        beforeMoveMax: 360,
        movePauseMin: 120,
        movePauseMax: 240,
        holdPauseMin: 120,
        holdPauseMax: 220,
        afterClickMin: 320,
        afterClickMax: 700,
      },
    );

    await sleep(1000);

    await clickFirst(
      [
        isVideo ? "button._upload-btn_1j3uy_87" : "button._upload-btn_ysbff_57",
        `button:has-text("${uploadLabel}")`,
        `[role="button"]:has-text("${uploadLabel}")`,
        `div:has-text("${uploadLabel}")`,
        `text=${uploadLabel}`,
      ],
      10000,
      document,
      {
        beforeMoveMin: 160,
        beforeMoveMax: 320,
        movePauseMin: 100,
        movePauseMax: 220,
        holdPauseMin: 100,
        holdPauseMax: 180,
        afterClickMin: 260,
        afterClickMax: 520,
      },
    ).catch(() => null);

    await sleep(700);
  }

  function assertKuaishouLoginStillValid() {
    const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
    if (pageText.includes("您的登录状态已过期") || pageText.includes("点击确定重新登录")) {
      throw new Error("快手登录已失效，请重新登录后再发布");
    }
  }

  function isKuaishouProfilePage() {
    return window.location.href.startsWith("https://cp.kuaishou.com/profile");
  }

  function isKuaishouEditorPage(isVideo) {
    const inputSelectors = isVideo
      ? ['input[type="file"][accept*="video"]', 'input[type="file"]']
      : [
          'input[type="file"][accept*="image/png"]',
          'input[type="file"][accept*="image/jpeg"]',
          'input[type="file"][accept*="image/webp"]',
          'input[type="file"][accept*="image/*"]',
          'input[accept*="image/png"]',
          'input[accept*="image/jpeg"]',
          'input[accept*="image/webp"]',
          'input[accept*="image/*"]',
          'input[type="file"][accept*="image"]',
          'input[type="file"]',
        ];
    return Boolean(
      queryFirst(
        [
          "div#work-description-edit",
          'div[contenteditable="true"]#work-description-edit',
          ...inputSelectors,
        ],
        document,
        false,
      ),
    );
  }

  async function ensureXiaohongshuPublishReady(isVideo) {
    await sleep(1200);
    await clickFirst(
      [
        'button:has-text("发布笔记")',
        'div:has-text("发布笔记")',
        'text=发布笔记',
        'button:has-text("去发布")',
        'div:has-text("去发布")',
        'text=去发布',
        'button:has-text("创建笔记")',
        'div:has-text("创建笔记")',
        'text=创建笔记',
      ],
      5000,
      document,
      {
        beforeMoveMin: 260,
        beforeMoveMax: 520,
        movePauseMin: 160,
        movePauseMax: 320,
        holdPauseMin: 140,
        holdPauseMax: 260,
        afterClickMin: 420,
        afterClickMax: 760,
      },
    ).catch(() => null);
    await sleep(1800);

    if (!isVideo) {
      await clickFirst(
        [
          'button:has-text("上传图文")',
          '[role="button"]:has-text("上传图文")',
          'div:has-text("上传图文")',
          'text=上传图文',
          'button:has-text("图文")',
          'text=图文',
        ],
        5000,
        document,
        {
          beforeMoveMin: 240,
          beforeMoveMax: 500,
          movePauseMin: 150,
          movePauseMax: 300,
          holdPauseMin: 130,
          holdPauseMax: 240,
          afterClickMin: 360,
          afterClickMax: 680,
        },
      ).catch(() => null);
      await sleep(900);
    }
  }

  async function ensureDouyinImagePublishReady() {
    debugLog("douyin-image", "ensure-ready-start", { url: window.location.href });
    await sleep(1200);
    await clickFirst(
      [
        'button:has-text("高清发布")',
        'div:has-text("高清发布")',
        'text=高清发布',
      ],
      3000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    await sleep(1000);

    await clickFirst(
      [
        'button:has-text("发布图文")',
        '[role="tab"]:has-text("发布图文")',
        'div:has-text("发布图文")',
        'text=发布图文',
        'button:has-text("图文")',
        'text=图文',
      ],
      6000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    await sleep(1200);
    debugLog("douyin-image", "ensure-ready-finished", { url: window.location.href });
  }

  async function enterDouyinImagePublishFromHome() {
    debugLog("douyin-image", "enter-from-home-start", { url: window.location.href });
    await gotoUrl("https://creator.douyin.com/creator-micro/home");
    await sleep(1600);
    await clickFirst(
      [
        'div.bg-tCBPTN:has-text("发布图文")',
        'div.bg-tCBPTN:has(div.title-HvY9Az:has-text("发布图文"))',
        'div.content-V1koTs:has(div.title-HvY9Az:has-text("发布图文"))',
        'div.title-HvY9Az:has-text("发布图文")',
      ],
      12000,
      document,
      douyinSlowClickOptions(),
    );
    await sleep(2200);
    debugLog("douyin-image", "enter-from-home-finished", { url: window.location.href });
  }

  async function openDouyinImageUpload() {
    debugLog("douyin-image", "open-upload-start", { url: window.location.href });
    const readyInput = queryFirst(
      [
        'input[type="file"][accept*="image/png"]',
        'input[type="file"][accept*="image/jpeg"]',
        'input[type="file"][accept*="image/webp"]',
        'input[type="file"][accept*="image/*"]',
        'input[accept*="image/png"]',
        'input[accept*="image/jpeg"]',
        'input[accept*="image/webp"]',
        'input[accept*="image/*"]',
        'input[type="file"][multiple]',
        'input[type="file"]',
      ],
      document,
      false,
    );
    if (readyInput instanceof HTMLInputElement) {
      debugLog("douyin-image", "file-input-already-ready", {
        className: readyInput.className || "",
        accept: readyInput.accept || "",
      });
      return;
    }

    const uploadButton = queryFirst(
      [
        'button.container-drag-btn-k6XmB4:has-text("上传图文")',
        'button.semi-button.semi-button-primary.container-drag-btn-k6XmB4:has-text("上传图文")',
      ],
      document,
      true,
    );
    debugLog("douyin-image", "upload-button-detected", {
      found: Boolean(uploadButton),
      className: uploadButton instanceof HTMLElement ? uploadButton.className : "",
      text: uploadButton instanceof HTMLElement ? normalize(uploadButton.textContent || "") : "",
      currentUrl: window.location.href,
    });

    await clickFirst(
      [
        'button.container-drag-btn-k6XmB4:has-text("上传图文")',
        'button.semi-button.semi-button-primary.container-drag-btn-k6XmB4:has-text("上传图文")',
      ],
      10000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    const fileInput = await waitForVisible(
      [
        'input[type="file"][accept*="image/png"]',
        'input[type="file"][accept*="image/jpeg"]',
        'input[type="file"][accept*="image/webp"]',
        'input[type="file"][accept*="image/*"]',
        'input[accept*="image/png"]',
        'input[accept*="image/jpeg"]',
        'input[accept*="image/webp"]',
        'input[accept*="image/*"]',
        'input[type="file"][multiple]',
        'input[type="file"]',
      ],
      10000,
      document,
      false,
    ).catch(() => null);
    debugLog("douyin-image", "open-upload-finished", {
      fileInputReady: Boolean(fileInput),
      currentUrl: window.location.href,
    });
    await sleep(700);
  }

  async function enterDouyinVideoPublishFromHome() {
    await gotoUrl("https://creator.douyin.com/creator-micro/home");
    await sleep(1600);
    await clickFirst(
      [
        'div.bg-tCBPTN:has-text("发布视频")',
        'div[class*="bg-"]:has-text("发布视频")',
        'div[class*="content"]:has-text("发布视频")',
        'div:has-text("发布视频")',
        'text=发布视频',
      ],
      12000,
      document,
      douyinSlowClickOptions(),
    );
    await sleep(2200);
  }

  async function openDouyinVideoUpload() {
    const readyInput = queryFirst(
      [
        'input[type="file"][accept*="video/mp4"]',
        'input[type="file"][accept*="video/*"]',
        'input[type="file"][accept*="video"]',
        'input[accept*="video/mp4"]',
        'input[accept*="video/*"]',
        'input[accept*="video"]',
        'input[type="file"]',
      ],
      document,
      false,
    );
    if (readyInput instanceof HTMLInputElement) {
      return;
    }

    await clickFirst(
      [
        'button.container-drag-btn-k6XmB4:has-text("上传视频")',
        'button:has-text("上传视频")',
      ],
      10000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    await waitForVisible(
      [
        'input[type="file"][accept*="video/mp4"]',
        'input[type="file"][accept*="video/*"]',
        'input[type="file"][accept*="video"]',
        'input[accept*="video/mp4"]',
        'input[accept*="video/*"]',
        'input[accept*="video"]',
        'input[type="file"]',
      ],
      10000,
      document,
      false,
    ).catch(() => null);
    await sleep(700);
  }

  function buildDouyinTopicCandidateSelectors(tag) {
    const safeTag = escapeHasText(tag);
    return [
      `.mention-suggest-mount-dom .tag-dVUDkJ:has-text("${safeTag}")`,
      `.mention-suggest-mount-dom [class*="tag-hash-view-name"]:has-text("${safeTag}")`,
      `.mention-suggest-mount-dom [class*="tag-hash"]:has-text("${safeTag}")`,
      `.mention-suggest-mount-dom [role="option"]:has-text("${safeTag}")`,
      `div[class*="tag"]:has-text("${safeTag}")`,
      `span[class*="tag"]:has-text("${safeTag}")`,
      `div:has-text("${safeTag}")`,
      `span:has-text("${safeTag}")`,
    ];
  }

  async function clickDouyinTopicCandidate(tag) {
    return clickFirst(buildDouyinTopicCandidateSelectors(tag), 5000, document, douyinSlowActionClickOptions())
      .then(() => true)
      .catch(() => false);
  }

  async function fillDouyinImageDescriptionAndTopics(job) {
    const editorSelectors = [
      'div.zone-container.editor-kit-container[contenteditable="true"][data-placeholder="添加作品描述..."]',
      'div.zone-container[contenteditable="true"][data-placeholder="添加作品描述..."]',
      'div[contenteditable="true"][data-placeholder="添加作品描述..."]',
      'div[contenteditable="true"][data-placeholder*="作品描述"]',
      'div[contenteditable="true"][data-placeholder*="描述"]',
      'div.zone-container[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    const editor = await waitForVisible(editorSelectors, 30000, document, true);
    if (!(editor instanceof HTMLElement)) {
      throw new Error("未找到抖音文案输入框");
    }

    await humanClickElement(editor, douyinSlowActionClickOptions());
    await sleep(randomBetween(220, 420));
    clearEditable(editor);
    await sleep(randomBetween(220, 420));

    const body = String(job?.draftBody || "").trim();
    const tags = normalizeTags(job?.draftTags);

    if (body) {
      await typeEditableTextHuman(editor, body, 75, 125);
    }

    for (const [index, tag] of tags.entries()) {
      await humanClickElement(editor, douyinSlowActionClickOptions()).catch(() => null);
      placeCaretAtEnd(editor);
      await sleep(randomBetween(180, 320));

      await sleep(randomBetween(320, 560));
      await appendText(
        editorSelectors,
        `${body || index > 0 ? " " : ""}#${tag}`,
        8000,
        document,
        { preferHumanType: true, perCharMin: 110, perCharMax: 185 },
      );
      await sleep(randomBetween(620, 980));

      const topicButton = await clickFirst(
        [
          'div.toolbar-button-spPS4r:has-text("#添加话题")',
          '[class*="toolbar-button"]:has-text("#添加话题")',
          'div:has-text("#添加话题")',
          'text=#添加话题',
        ],
        5000,
        document,
        douyinSlowActionClickOptions(),
      ).catch(() => null);

      const applied = await clickDouyinTopicCandidate(tag);
      if (!applied && topicButton) {
        debugLog("douyin-image", "topic-candidate-not-applied", { tag });
      }

      await sleep(randomBetween(480, 840));
      await humanClickElement(editor, douyinSlowActionClickOptions()).catch(() => null);
      placeCaretAtEnd(editor);
      await sleep(randomBetween(180, 320));
    }
  }

  async function fillDouyinVideoDescriptionAndTopics(job) {
    const editorSelectors = [
      'div.zone-container.editor-kit-container[contenteditable="true"][data-placeholder="添加作品简介"]',
      'div.zone-container[contenteditable="true"][data-placeholder="添加作品简介"]',
      'div[contenteditable="true"][data-placeholder="添加作品简介"]',
      'div[contenteditable="true"][data-placeholder*="作品简介"]',
      'div[contenteditable="true"][data-placeholder*="简介"]',
      'div.zone-container[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];
    const editor = await waitForVisible(editorSelectors, 30000, document, true);
    if (!(editor instanceof HTMLElement)) {
      throw new Error("未找到抖音简介输入框");
    }

    await humanClickElement(editor, douyinSlowActionClickOptions());
    await sleep(randomBetween(220, 420));
    clearEditable(editor);
    await sleep(randomBetween(220, 420));

    const body = String(job?.draftBody || "").trim();
    const tags = normalizeTags(job?.draftTags);

    if (body) {
      await typeEditableTextHuman(editor, body, 75, 125);
    }

    for (const [index, tag] of tags.entries()) {
      await humanClickElement(editor, douyinSlowActionClickOptions()).catch(() => null);
      placeCaretAtEnd(editor);
      await sleep(randomBetween(180, 320));

      await sleep(randomBetween(320, 560));
      await appendText(
        editorSelectors,
        `${body || index > 0 ? " " : ""}#${tag}`,
        8000,
        document,
        { preferHumanType: true, perCharMin: 110, perCharMax: 185 },
      );
      await sleep(randomBetween(620, 980));

      const topicButton = await clickFirst(
        [
          'div.toolbar-button-spPS4r:has-text("#添加话题")',
          '[class*="toolbar-button"]:has-text("#添加话题")',
          'div:has-text("#添加话题")',
          'text=#添加话题',
        ],
        5000,
        document,
        douyinSlowActionClickOptions(),
      ).catch(() => null);

      const applied = await clickDouyinTopicCandidate(tag);
      if (!applied && topicButton) {
        debugLog("douyin-video", "topic-candidate-not-applied", { tag });
      }

      await sleep(randomBetween(480, 840));
      await humanClickElement(editor, douyinSlowActionClickOptions()).catch(() => null);
      placeCaretAtEnd(editor);
      await sleep(randomBetween(180, 320));
    }
  }

  async function selectDouyinNoDeclaration() {
    await clickFirst(
      [
        'div.selectBox-buZRzi',
        '[class*="selectBox"]:has-text("请选择自主声明")',
        '[class*="selectText"]:has-text("请选择自主声明")',
        'text=请选择自主声明',
      ],
      8000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    await sleep(300);

    await clickFirst(
      [
        'label.semi-radio:has-text("无需添加自主声明")',
        'label:has-text("无需添加自主声明")',
        '[class*="semi-radio"]:has-text("无需添加自主声明")',
        'text=无需添加自主声明',
      ],
      6000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    await sleep(520);

    const confirmSelectors = [
      'button:has-text("确定")',
      '[role="button"]:has-text("确定")',
      'text=确定',
    ];
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
      const node = queryFirst(confirmSelectors, document, true);
      if (
        node instanceof HTMLElement &&
        !node.hasAttribute("disabled") &&
        node.getAttribute("aria-disabled") !== "true" &&
        (!(node instanceof HTMLButtonElement) || !node.disabled)
      ) {
        await humanClickElement(node, douyinSlowActionClickOptions()).catch(() => null);
        await sleep(680);
        return;
      }
      await sleep(300);
    }
  }

  async function ensureDouyinVideoPublishReady() {
    await sleep(1200);
    await clickFirst(
      [
        'button:has-text("发布视频")',
        '[role="tab"]:has-text("发布视频")',
        'div:has-text("发布视频")',
        'text=发布视频',
        'button:has-text("上传视频")',
        'text=上传视频',
      ],
      5000,
      document,
      douyinSlowActionClickOptions(),
    ).catch(() => null);
    await sleep(1200);
  }

  async function openWechatMpRecentEntry(recentEntryText, publishButtonText, readySelectors, publishTimeoutMs) {
    const publishButtonSelectors = [
      `button[type="button"].weui-desktop-btn.weui-desktop-btn_primary:has-text("${publishButtonText}")`,
      `button.weui-desktop-btn.weui-desktop-btn_primary:has-text("${publishButtonText}")`,
      `button:has-text("${publishButtonText}")`,
      `div:has-text("${publishButtonText}")`,
      `text=${publishButtonText}`,
    ];
    const readyPage = queryFirst(readySelectors, document, true);
    if (readyPage) {
      await sleep(900);
      return;
    }

    const visiblePublishButton = queryFirst(publishButtonSelectors, document, true);
    if (visiblePublishButton) {
      await humanClickElement(visiblePublishButton, {
        beforeMoveMin: 280,
        beforeMoveMax: 560,
        movePauseMin: 180,
        movePauseMax: 360,
        holdPauseMin: 150,
        holdPauseMax: 280,
        afterClickMin: 460,
        afterClickMax: 820,
      });
      await sleep(1800);
      return;
    }

    await clickFirst(
      [
        `button:has-text("${recentEntryText}")`,
        `a:has-text("${recentEntryText}")`,
        `[role="button"]:has-text("${recentEntryText}")`,
        `div:has-text("${recentEntryText}")`,
        `span:has-text("${recentEntryText}")`,
        `text=${recentEntryText}`,
      ],
      9000,
      document,
      {
        beforeMoveMin: 280,
        beforeMoveMax: 560,
        movePauseMin: 180,
        movePauseMax: 360,
        holdPauseMin: 150,
        holdPauseMax: 280,
        afterClickMin: 460,
        afterClickMax: 820,
      },
    );
    await sleep(1600);

    const readyAfterRecentClick = queryFirst(readySelectors, document, true);
    if (readyAfterRecentClick) {
      await sleep(900);
      return;
    }

    await clickFirst(
      publishButtonSelectors,
      publishTimeoutMs,
      document,
      {
        beforeMoveMin: 280,
        beforeMoveMax: 560,
        movePauseMin: 180,
        movePauseMax: 360,
        holdPauseMin: 150,
        holdPauseMax: 280,
        afterClickMin: 460,
        afterClickMax: 820,
      },
    );
    await sleep(1800);
  }

  async function ensureWechatMpPublishReady(isVideo) {
    await sleep(1600);
    if (!isVideo) {
      await openWechatMpRecentEntry(
        "最近图文",
        "发表图文",
        [
          'input.weui-desktop-form__input[placeholder="填写标题, 22个字符内"]',
          'input[placeholder="填写标题, 22个字符内"]',
          'input[placeholder="填写标题，22个字符内"]',
          'textarea[placeholder="填写标题，22个字符内"]',
          'input[placeholder*="填写标题"]',
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'div.post-desc-box div.input-editor[contenteditable]',
          'div.input-editor[contenteditable][data-placeholder="添加描述"]',
        ],
        9000,
      );
      return;
    }

    await openWechatMpRecentEntry(
      "最近视频",
      "发表视频",
      [
        'div.post-desc-box div.input-editor[contenteditable]',
        'div.input-editor[contenteditable][data-placeholder="添加描述"]',
        '[contenteditable][data-placeholder="添加描述"]',
      ],
      7000,
    );
  }

  function sanitizeTopicTag(tag) {
    return String(tag || "")
      .replace(/^#+/, "")
      .trim()
      .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, "");
  }

  function buildTagText(tags) {
    return (tags || [])
      .map((tag) => sanitizeTopicTag(tag))
      .filter(Boolean)
      .map((tag) => `#${tag}`)
      .join(" ");
  }

  function buildPublishPageBodyWithTags(job) {
    const parts = [job?.draftBody, buildTagText(job?.draftTags)]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    return parts.join("\n").trim();
  }

  async function publishXiaohongshu(job) {
    const isVideo = Boolean(job.draftVideoUrl);
    const bodyWithTags = buildPublishPageBodyWithTags(job);
    await gotoUrl("https://creator.xiaohongshu.com/");
    await ensureXiaohongshuPublishReady(isVideo);
    await uploadFiles(
      [
        'input[type="file"][accept*="image"]',
        'input[type="file"][accept*="video"]',
        'input[type="file"]',
      ],
      isVideo ? [job.draftVideoUrl] : job.draftImages,
      isVideo ? "video" : "image",
    );
    await sleep(2000);
    await fillFirst(
      ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', 'input[type="text"]'],
      job.draftTitle,
      30000,
      document,
      { preferHumanType: true, perCharMin: 110, perCharMax: 190 },
    );
    await fillFirst(
      ['div.tiptap.ProseMirror', 'div[role="textbox"]', 'div[contenteditable="true"]'],
      bodyWithTags,
      30000,
      document,
      { preferHumanType: true, perCharMin: 110, perCharMax: 180 },
    );
    await clickFirst(
      [
        "button.ce-btn.bg-red",
        'button.bg-red:has-text("发布")',
        'button.ce-btn:has-text("发布")',
        'button:has-text("发布")',
        'div[role="button"]:has-text("发布")',
        'text=发布',
      ],
      30000,
      document,
      {
        beforeMoveMin: 320,
        beforeMoveMax: 620,
        movePauseMin: 200,
        movePauseMax: 380,
        holdPauseMin: 170,
        holdPauseMax: 320,
        afterClickMin: 520,
        afterClickMax: 960,
      },
    );
    await waitForHints(
      ["发布成功", "笔记发布成功", "审核中", "发布中"],
      ["发布失败", "请完善", "请先上传", "请填写标题"],
      "未识别到小红书发布成功状态，请确认页面是否仍停留在发布页",
    );
  }

  async function finalizeDouyinImagePublish(job) {
    await sleep(3000);
    await fillFirst(
      ['input[placeholder="添加作品标题"]', 'input[placeholder*="作品标题"]', 'textarea[placeholder*="标题"]'],
      job.draftTitle,
      30000,
      document,
      { preferHumanType: true, perCharMin: 115, perCharMax: 190 },
    ).catch(() => null);
    await fillDouyinImageDescriptionAndTopics(job);
    await selectDouyinNoDeclaration();
    await clickFirst(
      [
        'button.button-dhlUZE.primary-cECiOJ.fixed-J9O8Yw',
        'button:has-text("发布")',
        '[role="button"]:has-text("发布")',
        'text=发布',
      ],
      30000,
      document,
      douyinSlowPublishClickOptions(),
    );
    await waitForHints(
      ["发布成功", "作品发布成功", "审核中", "内容管理", "发布完成"],
      ["发布失败", "上传失败", "请完善", "请填写"],
      "未识别到抖音图文发布成功状态，请确认页面是否仍停留在发布页",
    );
  }

  async function finalizeDouyinVideoPublish(job) {
    await sleep(3000);
    await fillFirst(
      [
        'input[placeholder="填写作品标题，为作品获得更多流量"]',
        'input[placeholder*="填写作品标题"]',
        'input[placeholder*="作品标题"]',
        'input[placeholder*="添加标题"]',
        'textarea[placeholder*="标题"]',
      ],
      job.draftTitle,
      30000,
      document,
      { preferHumanType: true, perCharMin: 115, perCharMax: 190 },
    ).catch(() => null);
    await fillDouyinVideoDescriptionAndTopics(job);
    await selectDouyinNoDeclaration();
    await clickFirst(
      [
        'button.button-dhlUZE.primary-cECiOJ.fixed-J9O8Yw',
        'button:has-text("发布")',
        '[role="button"]:has-text("发布")',
        'text=发布',
      ],
      30000,
      document,
      douyinSlowPublishClickOptions(),
    );
    await waitForHints(
      ["发布成功", "作品发布成功", "审核中", "内容管理", "发布完成"],
      ["发布失败", "上传失败", "请完善", "请填写"],
      "未识别到抖音视频发布成功状态，请确认页面是否仍停留在发布页",
    );
  }

  async function publishDouyinImage(job) {
    debugLog("douyin-image", "publish-start", {
      currentUrl: window.location.href,
      imageCount: Array.isArray(job?.draftImages) ? job.draftImages.length : 0,
      hasTitle: Boolean(String(job?.draftTitle || "").trim()),
      tagCount: Array.isArray(job?.draftTags) ? job.draftTags.length : 0,
    });
    await enterDouyinImagePublishFromHome();
    await ensureDouyinImagePublishReady().catch(() => null);
    await openDouyinImageUpload();
    await uploadFiles(
      ['input[type="file"][accept*="image"]', 'input[type="file"]'],
      job.draftImages,
      "image",
    );
    debugLog("douyin-image", "upload-files-dispatched", {
      currentUrl: window.location.href,
      imageCount: Array.isArray(job?.draftImages) ? job.draftImages.length : 0,
    });
    await finalizeDouyinImagePublish(job);
  }

  async function publishDouyinVideo(job) {
    await enterDouyinVideoPublishFromHome();
    await ensureDouyinVideoPublishReady().catch(() => null);
    await openDouyinVideoUpload();
    await uploadFiles(
      ['input[type="file"][accept*="video"]', 'input[type="file"]'],
      [job.draftVideoUrl],
      "video",
    );
    await finalizeDouyinVideoPublish(job);
  }

  async function publishDouyin(job) {
    if (job.draftVideoUrl) {
      await publishDouyinVideo(job);
      return;
    }

    await publishDouyinImage(job);
  }

  async function publishWechatMp(job) {
    const isVideo = Boolean(job.draftVideoUrl);
    const bodyWithTags = buildPublishPageBodyWithTags(job);
    await gotoUrl("https://channels.weixin.qq.com/platform");
    await ensureWechatMpPublishReady(isVideo);

    if (!isVideo) {
      await fillFirst(
        [
          'input.weui-desktop-form__input[placeholder="填写标题, 22个字符内"]',
          'input[placeholder="填写标题, 22个字符内"]',
          'input[placeholder="填写标题，22个字符内"]',
          'textarea[placeholder="填写标题，22个字符内"]',
          'input[placeholder*="填写标题"]',
          'input[placeholder*="标题"]',
          'textarea[placeholder*="标题"]',
          'input[type="text"]',
        ],
        job.draftTitle,
        30000,
        document,
        { preferHumanType: true, perCharMin: 115, perCharMax: 185 },
      ).catch(() => null);
    }

    await fillFirst(
      [
        'div.post-desc-box div.input-editor[contenteditable]',
        'div.input-editor[contenteditable][data-placeholder="添加描述"]',
        '[contenteditable][data-placeholder="添加描述"]',
        'div[contenteditable="true"]',
        'textarea[placeholder*="描述"]',
        'textarea[placeholder*="内容"]',
      ],
      bodyWithTags,
      30000,
      document,
      { preferHumanType: true, perCharMin: 105, perCharMax: 170 },
    );
    await sleep(700);

    await clickFirst(
      isVideo
        ? [
            '.upload-content',
            '.upload-content .center',
            '.upload-content .upload-tip',
            'button:has-text("上传视频")',
            '[role="button"]:has-text("上传视频")',
            'div:has-text("上传视频")',
            'text=上传视频',
          ]
        : [
            '.upload-content',
            '.upload-content .center',
            '.upload-content .upload-tip',
            'button:has-text("上传图片")',
            '[role="button"]:has-text("上传图片")',
            'div:has-text("上传图片")',
            'text=上传图片',
            'div:has-text("发布图片动态")',
            'text=发布图片动态',
          ],
      9000,
      document,
      {
        beforeMoveMin: 260,
        beforeMoveMax: 520,
        movePauseMin: 160,
        movePauseMax: 300,
        holdPauseMin: 140,
        holdPauseMax: 240,
        afterClickMin: 380,
        afterClickMax: 720,
      },
    ).catch(() => null);
    await sleep(700);

    await uploadFiles(
      ['input[type="file"][accept*="image"]', 'input[type="file"][accept*="video"]', 'input[type="file"]'],
      isVideo ? [job.draftVideoUrl] : job.draftImages,
      isVideo ? "video" : "image",
    );
    await sleep(2200);
    await clickFirst(
      ['button:has-text("发表")', '[role="button"]:has-text("发表")', 'button:has-text("发布")', 'text=发表'],
      30000,
      document,
      {
        beforeMoveMin: 280,
        beforeMoveMax: 560,
        movePauseMin: 170,
        movePauseMax: 320,
        holdPauseMin: 150,
        holdPauseMax: 260,
        afterClickMin: 420,
        afterClickMax: 760,
      },
    );
    await waitForHints(
      ["发表成功", "发布成功", "审核中", "内容管理"],
      ["发布失败", "上传失败", "请完善", "请填写"],
      "未识别到视频号发布成功状态，请确认页面是否仍停留在发布页",
    );
  }

  async function publishKuaishou(job) {
    const isVideo = Boolean(job.draftVideoUrl);
    if (!window.location.hostname.includes("cp.kuaishou.com")) {
      await gotoUrl("https://cp.kuaishou.com/profile");
    }
    if (isKuaishouProfilePage()) {
      await ensureKuaishouPublishReady(isVideo);
    } else if (!isKuaishouEditorPage(isVideo)) {
      await gotoUrl("https://cp.kuaishou.com/profile");
      await ensureKuaishouPublishReady(isVideo);
    }
    assertKuaishouLoginStillValid();
    await uploadFiles(
      isVideo
        ? ['input[type="file"][accept*="video"]', 'input[type="file"]']
        : [
            'input[type="file"][accept*="image/png"]',
            'input[type="file"][accept*="image/jpeg"]',
            'input[type="file"][accept*="image/webp"]',
            'input[type="file"][accept*="image/*"]',
            'input[accept*="image/png"]',
            'input[accept*="image/jpeg"]',
            'input[accept*="image/webp"]',
            'input[accept*="image/*"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"]',
          ],
      isVideo ? [job.draftVideoUrl] : job.draftImages,
      isVideo ? "video" : "image",
    );
    assertKuaishouLoginStillValid();
    await sleep(3200);
    await fillKuaishouDescription(job);
    await clickFirst(
      [
        'div._button_3a3lq_1._button-primary_3a3lq_60',
        'button:has-text("发布")',
        'div[role="button"]:has-text("发布")',
        'div:has-text("发布")',
        'text=发布',
      ],
      10000,
      document,
      {
        beforeMoveMin: 180,
        beforeMoveMax: 340,
        movePauseMin: 120,
        movePauseMax: 240,
        holdPauseMin: 130,
        holdPauseMax: 220,
        afterClickMin: 320,
        afterClickMax: 620,
      },
    );
    await waitForHints(
      ["发布成功", "作品发布成功", "发布完成", "审核中", "已发布"],
      ["发布失败", "上传失败", "请完善", "请填写内容"],
      "未识别到快手发布成功状态，请确认页面是否仍停留在发布页",
    );
  }

  async function executePublishSession(session, sendStatus) {
    const job = session?.job;
    if (!job?.platform) {
      throw new Error("扩展未收到有效发布任务");
    }

    debugLog("session", "execute-start", {
      platform: job.platform,
      currentUrl: window.location.href,
      hasVideo: Boolean(job.draftVideoUrl),
      sessionToken: String(session?.sessionToken || "").slice(0, 12),
    });

    await sendStatus({
      status: "running",
      sourceUrl: window.location.href,
    });

    switch (job.platform) {
      case "xiaohongshu":
        await publishXiaohongshu(job);
        break;
      case "douyin":
        await publishDouyin(job);
        break;
      case "wechat_mp":
        await publishWechatMp(job);
        break;
      case "kuaishou":
        await publishKuaishou(job);
        break;
      default:
        throw new Error("当前平台暂不支持扩展本地发布");
    }

    await sendStatus({
      status: "success",
      draftUrl: window.location.href,
      sourceUrl: window.location.href,
    });
  }

  globalThis.AISuperWebPublishAutomation = {
    executePublishSession,
  };
})();
