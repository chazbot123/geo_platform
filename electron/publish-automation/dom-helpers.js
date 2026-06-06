(function () {
  function createAutomationContext(input, options) {
    const logs = [];
    let currentStage = "init";
    const platform = String(options?.platform || input?.platform || "publish");
    const prefix = `[geo-${platform}]`;
    window.__geoPublishAutomationLogs = logs;

    const log = (message) => {
      const normalizedMessage = String(message || "").trim();
      if (!normalizedMessage) return;
      logs.push(normalizedMessage);
      window.__geoPublishAutomationLogs = logs;
      console.log(`${prefix} ${normalizedMessage}`);
    };

    const setStage = (stage, message) => {
      currentStage = String(stage || "unknown_stage");
      log(`${currentStage}: ${message || ""}`);
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const ownerWindow = (node) => node?.ownerDocument?.defaultView || window;
    const isHtmlElement = (node) => {
      const view = ownerWindow(node);
      return Boolean(node && view?.HTMLElement && node instanceof view.HTMLElement);
    };
    const isInput = (node) => {
      const view = ownerWindow(node);
      return Boolean(node && view?.HTMLInputElement && node instanceof view.HTMLInputElement);
    };
    const isTextArea = (node) => {
      const view = ownerWindow(node);
      return Boolean(node && view?.HTMLTextAreaElement && node instanceof view.HTMLTextAreaElement);
    };

    const visible = (node) => {
      if (!isHtmlElement(node)) return false;
      const style = ownerWindow(node).getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };

    const text = (node) => normalize(node?.innerText || node?.textContent || "");
    const pageText = () => normalize(document.body?.innerText || document.body?.textContent || "");

    const parseHasTextSelector = (selector) => {
      const single = selector.match(/^(.*):has-text\("(.+)"\)$/);
      if (single) return { baseSelector: single[1]?.trim() || "*", texts: [normalize(single[2])] };
      const multi = selector.match(/^(.*):has-text-any\("(.+)"\)$/);
      if (multi) return { baseSelector: multi[1]?.trim() || "*", texts: multi[2].split("|").map((item) => normalize(item)) };
      return null;
    };

    const findByText = (words, root = document, baseSelector = "*") => {
      const needles = Array.isArray(words) ? words : [words];
      const normalizedNeedles = needles.map((item) => normalize(item)).filter(Boolean);
      return (
        Array.from(root.querySelectorAll(baseSelector)).find((node) => {
          if (!visible(node)) return false;
          const nodeText = text(node);
          return normalizedNeedles.some((needle) => nodeText.includes(needle));
        }) || null
      );
    };

    const queryAll = (selectors, visibleOnly = true, root = document) => {
      const results = [];
      for (const selector of selectors) {
        try {
          if (selector.startsWith("text=")) {
            const needle = normalize(selector.slice(5));
            results.push(
              ...Array.from(root.querySelectorAll("*")).filter((node) => {
                const matched = normalize(node.textContent || "").includes(needle);
                return matched && (!visibleOnly || visible(node));
              }),
            );
            continue;
          }
          const textSelector = parseHasTextSelector(selector);
          if (textSelector) {
            results.push(
              ...Array.from(root.querySelectorAll(textSelector.baseSelector || "*")).filter((node) => {
                const nodeText = normalize(node.textContent || "");
                return textSelector.texts.some((item) => nodeText.includes(item)) && (!visibleOnly || visible(node));
              }),
            );
            continue;
          }
          results.push(...Array.from(root.querySelectorAll(selector)).filter((node) => (visibleOnly ? visible(node) : true)));
        } catch (_) {
          // Ignore invalid selectors from platform-specific fallbacks.
        }
      }
      return Array.from(new Set(results));
    };

    const query = (selectors, visibleOnly = true, root = document) => queryAll(selectors, visibleOnly, root)[0] || null;

    const waitFor = async (selectors, waitMs = 30000, visibleOnly = true) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < waitMs) {
        const node = query(selectors, visibleOnly);
        if (node) return node;
        await sleep(500);
      }
      throw new Error(`[${currentStage}] target element not found: ${selectors[0] || "unknown"}`);
    };

    const dispatchInputEvents = (node) => {
      const view = ownerWindow(node);
      node.dispatchEvent(new view.Event("input", { bubbles: true }));
      node.dispatchEvent(new view.Event("change", { bubbles: true }));
      node.dispatchEvent(new view.Event("blur", { bubbles: true }));
      if (typeof view.InputEvent === "function") {
        node.dispatchEvent(new view.InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: "" }));
      }
    };

    const setInputValue = (node, value) => {
      if (isInput(node) || isTextArea(node)) {
        const view = ownerWindow(node);
        const proto = isTextArea(node) ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(node, value);
        dispatchInputEvents(node);
        return;
      }
      if (isHtmlElement(node)) {
        node.focus();
        if (node.isContentEditable) {
          node.ownerDocument.execCommand("selectAll", false);
          node.ownerDocument.execCommand("delete", false);
          node.ownerDocument.execCommand("insertText", false, value);
          if (!normalize(node.textContent).includes(normalize(value).slice(0, 8))) {
            node.textContent = value;
          }
          dispatchInputEvents(node);
          return;
        }
        node.textContent = value;
        dispatchInputEvents(node);
      }
    };

    const extractEditableText = (node) => {
      if (isInput(node) || isTextArea(node)) return node.value || "";
      return node?.innerText || node?.textContent || "";
    };

    const closestText = (node) => {
      if (!node?.parentElement && typeof node?.getAttribute !== "function") return "";
      let current = node;
      const chunks = [];
      for (let depth = 0; current && depth < 4; depth += 1) {
        chunks.push(current.getAttribute?.("data-placeholder") || "");
        chunks.push(current.getAttribute?.("aria-label") || "");
        chunks.push(current.textContent || "");
        current = current.parentElement;
      }
      return normalize(chunks.join(" "));
    };

    const containsAnyNeedle = (haystack, needles) => {
      const target = normalize(haystack);
      return needles.some((needle) => target.includes(normalize(needle)));
    };

    const getClickableNode = (node) => {
      if (!node) return null;
      const view = ownerWindow(node);
      if (node instanceof view.HTMLAnchorElement || node instanceof view.HTMLButtonElement) return node;
      return node.closest?.('a, button, [role="button"], [tabindex="0"]') || node;
    };

    const simulateClick = (element) => {
      if (!element) return;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.click();
      try {
        const view = ownerWindow(element);
        element.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, cancelable: true, view }));
        element.dispatchEvent(new view.MouseEvent("mouseup", { bubbles: true, cancelable: true, view }));
        element.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true, view }));
      } catch (_) {
        // ignore
      }
    };

    const focusEditableNode = (node) => {
      if (!(isHtmlElement(node) || isTextArea(node))) return;
      node.focus();
      if (!isHtmlElement(node) || !node.isContentEditable) return;
      const view = ownerWindow(node);
      const selection = view.getSelection();
      const range = node.ownerDocument.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    const clearEditableNode = (node) => {
      if (isTextArea(node)) { setInputValue(node, ""); return; }
      if (!isHtmlElement(node)) return;
      focusEditableNode(node);
      if (node.isContentEditable) {
        node.ownerDocument.execCommand("selectAll", false);
        node.ownerDocument.execCommand("delete", false);
        if (normalize(node.innerText || node.textContent || "")) {
          node.innerHTML = "";
          node.textContent = "";
        }
        dispatchInputEvents(node);
      }
    };

    const escapeHtml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const formatParagraph = (value) => `<p>${escapeHtml(value)}</p>`;

    const getParagraphs = (body) =>
      String(body || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);

    const insertParagraphBlock = (node, paragraphHtml, paragraphText) => {
      if (isTextArea(node)) {
        const currentValue = node.value || "";
        setInputValue(node, `${currentValue}${currentValue ? "\n" : ""}${paragraphText}`);
        return true;
      }
      if (!isHtmlElement(node) || !node.isContentEditable) return false;
      focusEditableNode(node);
      const view = ownerWindow(node);
      const doc = node.ownerDocument;
      node.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, cancelable: true, view }));
      node.dispatchEvent(new view.MouseEvent("mouseup", { bubbles: true, cancelable: true, view }));
      node.dispatchEvent(new view.MouseEvent("click", { bubbles: true, cancelable: true, view }));
      const clipboardData = new view.DataTransfer();
      clipboardData.setData("text/html", paragraphHtml);
      clipboardData.setData("text/plain", paragraphText);
      const pasteEvent = new view.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
      const handled = node.dispatchEvent(pasteEvent);
      if (!handled || doc.queryCommandSupported("insertHTML")) {
        doc.execCommand("insertHTML", false, paragraphHtml);
      }
      if (!normalize(node.innerText || node.textContent || "").includes(normalize(paragraphText).slice(0, Math.min(12, paragraphText.length)))) {
        const block = doc.createElement("p");
        block.textContent = paragraphText;
        node.appendChild(block);
      }
      dispatchInputEvents(node);
      return true;
    };

    const setHtmlValue = (node, html, fallbackText) => {
      if (isInput(node) || isTextArea(node)) { setInputValue(node, fallbackText); return; }
      if (!isHtmlElement(node)) return;
      node.focus();
      if (node.isContentEditable) {
        const view = ownerWindow(node);
        const doc = node.ownerDocument;
        doc.execCommand("selectAll", false);
        doc.execCommand("delete", false);
        dispatchInputEvents(node);
        const clipboardData = new view.DataTransfer();
        clipboardData.setData("text/html", html);
        clipboardData.setData("text/plain", fallbackText);
        const pasteEvent = new view.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData });
        const handled = node.dispatchEvent(pasteEvent);
        if (!handled || doc.queryCommandSupported("insertHTML")) {
          doc.execCommand("insertHTML", false, html);
        }
        dispatchInputEvents(node);
        return;
      }
      node.textContent = fallbackText;
      dispatchInputEvents(node);
    };

    const dataUrlToFile = (dataUrl, filename, mimeType) => {
      const arr = String(dataUrl || "").split(",");
      if (arr.length < 2) throw new Error("图片 dataUrl 无效，无法转换为 File");
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      return new File([u8arr], filename, { type: mimeType });
    };

    const findFileInputForEditor = (editorNode) => {
      const ancestors = [];
      let cursor = isHtmlElement(editorNode) ? editorNode : null;
      for (let depth = 0; cursor && depth < 7; depth += 1) {
        ancestors.unshift(cursor);
        cursor = cursor.parentElement;
      }
      const searchRoots = ancestors.length > 0 ? ancestors : [document];
      for (const root of searchRoots) {
        const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
        const matched = inputs.find((input) => {
          const accept = (input.getAttribute("accept") || "").toLowerCase();
          return !accept || accept.includes("image") || accept.includes("*");
        });
        if (matched instanceof HTMLInputElement) return matched;
      }
      const fallback = Array.from(document.querySelectorAll('input[type="file"]')).find((input) => {
        const accept = (input.getAttribute("accept") || "").toLowerCase();
        return accept.includes("image");
      });
      return fallback instanceof HTMLInputElement ? fallback : null;
    };

    const findDocumentFileInput = (acceptNeedles = ["image", "*"]) => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      return inputs.find((input) => {
        const accept = String(input.getAttribute("accept") || "").toLowerCase();
        if (!accept) return true;
        return acceptNeedles.some((needle) => {
          const normalizedNeedle = String(needle).toLowerCase();
          if (normalizedNeedle === "*") {
            return accept === "*" || accept === "*/*";
          }
          return accept.includes(normalizedNeedle);
        });
      }) || null;
    };

    const countRemoteImages = (root = document) =>
      Array.from(root.querySelectorAll("img")).filter((img) => {
        const src = String(img.getAttribute("src") || img.src || "");
        return src && !src.startsWith("data:") && !src.startsWith("blob:");
      }).length;

    const waitForDocumentRemoteImages = async (prevCount, expectedIncrease = 1, waitMs = 45000) => {
      const startedAt = Date.now();
      while (Date.now() - startedAt < waitMs) {
        const currentCount = countRemoteImages(document);
        if (currentCount >= prevCount + expectedIncrease) {
          return true;
        }
        await sleep(800);
      }
      return false;
    };

    const assignFilesToInput = (input, files) => {
      try {
        Object.defineProperty(input, "files", { value: files, configurable: true });
      } catch (_) {
        try { input.files = files; } catch (__) { return false; }
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };

    const uploadImagesViaDocumentInput = async (images, options = {}) => {
      const input = findDocumentFileInput(options.acceptNeedles || ["image", "*"]);
      if (!(input instanceof HTMLInputElement)) return { ok: false, reason: "no_file_input" };
      const selectedImages = (Array.isArray(images) ? images : []).filter((image) => image?.dataUrl).slice(0, options.limit || 9);
      if (!selectedImages.length) return { ok: false, reason: "no_images" };
      const dt = new DataTransfer();
      selectedImages.forEach((image, index) => {
        dt.items.add(dataUrlToFile(image.dataUrl, image.name || `publish-${index + 1}.png`, image.mimeType || "image/png"));
      });
      const prevCount = countRemoteImages(document);
      if (!assignFilesToInput(input, dt.files)) return { ok: false, reason: "files_assign_failed" };
      log(`document_file_input_change_dispatched: ${dt.files.length}`);
      const verified = await waitForDocumentRemoteImages(prevCount, options.expectedIncrease || 1, options.waitMs || 45000);
      return verified ? { ok: true } : { ok: false, reason: "remote_image_not_detected" };
    };

    const waitForRealImage = (editorNode, prevCount, waitMs = 30000) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const finalize = (ok, payload) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          clearTimeout(timer);
          if (ok) resolve(payload);
          else reject(new Error(payload || "image_upload_timeout"));
        };
        const check = () => {
          const imgs = editorNode.querySelectorAll("img");
          if (imgs.length <= prevCount) return;
          const newest = imgs[imgs.length - 1];
          if (!(newest instanceof HTMLImageElement)) return;
          const src = newest.src || "";
          if (!src || src.startsWith("blob:") || src.startsWith("data:")) return;
          if (newest.naturalWidth === 0) return;
          finalize(true, src);
        };
        const observer = new MutationObserver(check);
        observer.observe(editorNode, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
        const timer = setTimeout(() => finalize(false, "image_upload_timeout"), waitMs);
        check();
      });

    const uploadViaFileInput = async (editorNode, image, index) => {
      const input = findFileInputForEditor(editorNode);
      if (!(input instanceof HTMLInputElement)) return { ok: false, reason: "no_file_input" };
      if (!image?.dataUrl) return { ok: false, reason: "no_data_url" };
      log(`upload_image_${index + 1}_file_input_found`);
      const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
      const dt = new DataTransfer();
      dt.items.add(file);
      const prevCount = editorNode.querySelectorAll("img").length;
      try {
        Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      } catch (_) {
        try { input.files = dt.files; } catch (__) { return { ok: false, reason: "files_assign_failed" }; }
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
      log(`upload_image_${index + 1}_change_dispatched`);
      try {
        const src = await waitForRealImage(editorNode, prevCount, 30000);
        log(`upload_image_${index + 1}_cdn_url_received: ${String(src).slice(0, 120)}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
      }
    };

    const uploadViaDrop = async (editorNode, image, index) => {
      if (!image?.dataUrl) return { ok: false, reason: "no_data_url" };
      const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
      const dt = new DataTransfer();
      dt.items.add(file);
      const rect = editorNode.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + Math.min(rect.height / 2, 120);
      const prevCount = editorNode.querySelectorAll("img").length;
      const dispatch = (type) => {
        editorNode.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }));
      };
      dispatch("dragenter");
      dispatch("dragover");
      dispatch("drop");
      log(`upload_image_${index + 1}_drop_dispatched`);
      try {
        const src = await waitForRealImage(editorNode, prevCount, 30000);
        log(`upload_image_${index + 1}_cdn_url_received: ${String(src).slice(0, 120)}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
      }
    };

    const uploadViaPaste = async (editorNode, image, index) => {
      if (!image?.dataUrl) return { ok: false, reason: "no_data_url" };
      focusEditableNode(editorNode);
      const file = dataUrlToFile(image.dataUrl, image.name || `image-${index + 1}.png`, image.mimeType || "image/png");
      const dt = new DataTransfer();
      dt.items.add(file);
      const prevCount = editorNode.querySelectorAll("img").length;
      const evt = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      editorNode.dispatchEvent(evt);
      dispatchInputEvents(editorNode);
      log(`upload_image_${index + 1}_paste_dispatched`);
      try {
        const src = await waitForRealImage(editorNode, prevCount, 25000);
        log(`upload_image_${index + 1}_cdn_url_received: ${String(src).slice(0, 120)}`);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : "wait_failed" };
      }
    };

    const insertImageWithFallback = async (editorNode, image, index) => {
      log(`upload_image_${index + 1}_strategy_A_try`);
      const a = await uploadViaFileInput(editorNode, image, index);
      if (a.ok) { log(`upload_image_${index + 1}_done: strategy_A`); return true; }
      log(`upload_image_${index + 1}_strategy_A_failed: ${a.reason}`);

      log(`upload_image_${index + 1}_strategy_B_try`);
      const b = await uploadViaDrop(editorNode, image, index);
      if (b.ok) { log(`upload_image_${index + 1}_done: strategy_B`); return true; }
      log(`upload_image_${index + 1}_strategy_B_failed: ${b.reason}`);

      log(`upload_image_${index + 1}_strategy_C_try`);
      const c = await uploadViaPaste(editorNode, image, index);
      if (c.ok) { log(`upload_image_${index + 1}_done: strategy_C`); return true; }
      log(`upload_image_${index + 1}_strategy_C_failed: ${c.reason}`);
      return false;
    };

    // Evenly distribute imageCount images across paragraphCount paragraphs.
    const computeImagePositions = (paragraphCount, imageCount) => {
      const positions = new Map();
      if (imageCount <= 0 || paragraphCount <= 0) return positions;
      for (let k = 1; k <= imageCount; k += 1) {
        const idx = Math.max(1, Math.min(paragraphCount, Math.round((paragraphCount * k) / (imageCount + 1))));
        const list = positions.get(idx) ?? [];
        list.push(k - 1);
        positions.set(idx, list);
      }
      return positions;
    };

    const complete = (result = {}) => ({
      ...result,
      status: result.status || "submitted",
      failureStage: result.failureStage,
      errorMessage: result.errorMessage,
      executionLog: Array.isArray(result.executionLog) ? result.executionLog : logs,
      verificationEvidence: result.verificationEvidence,
    });

    const fail = (error, fallbackMessage) => {
      const message = error instanceof Error ? error.message : fallbackMessage || "automation failed";
      log(`error: ${message}`);
      return complete({
        status: "failed",
        failureStage: currentStage,
        errorMessage: message,
        verificationEvidence: `failed_at_${currentStage}`,
        draftUrl: window.location.href,
      });
    };

    return {
      logs,
      get currentStage() { return currentStage; },
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
      dispatchInputEvents,
      setInputValue,
      setHtmlValue,
      extractEditableText,
      closestText,
      containsAnyNeedle,
      getClickableNode,
      simulateClick,
      focusEditableNode,
      clearEditableNode,
      escapeHtml,
      formatParagraph,
      getParagraphs,
      insertParagraphBlock,
      dataUrlToFile,
      findFileInputForEditor,
      findDocumentFileInput,
      countRemoteImages,
      waitForDocumentRemoteImages,
      assignFilesToInput,
      uploadImagesViaDocumentInput,
      waitForRealImage,
      uploadViaFileInput,
      uploadViaDrop,
      uploadViaPaste,
      insertImageWithFallback,
      computeImagePositions,
      complete,
      fail,
    };
  }

  window.geoPublishAutomation = { createAutomationContext };
})();
