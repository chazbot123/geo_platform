import fs from "node:fs";
import path from "node:path";

const CDP_URL = "http://127.0.0.1:9223/json";
const imagePaths = [
  "D:/geo/public/generated-images/6f9a2ee6-a828-4276-8c62-374b407dd065/cover.png",
];
const title = "AI营销获客实战";
const body =
  "企业做AI搜索优化，核心不是堆关键词，而是把真实产品能力、客户场景和可信案例讲清楚。先整理用户会问的问题，再生成可验证的图文内容，最后按平台规范发布，才能让品牌在AI问答和搜索结果里持续被看见。#AI营销 #GEO优化 #企业增长";

for (const imagePath of imagePaths) {
  if (!fs.existsSync(imagePath)) throw new Error(`Missing image: ${imagePath}`);
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const messageId = ++id;
        pending.set(messageId, resolve);
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const targets = await (await fetch(CDP_URL)).json();
  const target = targets.find((item) => item.type === "page" && item.url.includes("channels.weixin.qq.com"));
  if (!target) throw new Error("No logged videohao Edge target found.");

  const cdp = await connect(target);
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Page.navigate", { url: "https://channels.weixin.qq.com/platform/post/finderNewLifeCreate" });
  await new Promise((resolve) => setTimeout(resolve, 9000));

  const inputEval = await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('wujie-app')?.shadowRoot?.querySelector('input[type=file]')",
    objectGroup: "geo-videohao",
  });
  const objectId = inputEval.result?.result?.objectId;
  if (!objectId) throw new Error("Videohao file input not found.");
  await cdp.send("DOM.setFileInputFiles", { objectId, files: imagePaths.map((item) => path.resolve(item)) });
  await new Promise((resolve) => setTimeout(resolve, 15000));

  const fillExpression = `(() => {
    const root = document.querySelector('wujie-app')?.shadowRoot;
    if (!root) return { ok: false, stage: 'shadow_root_missing' };
    const fire = (el) => {
      for (const type of ['input', 'change', 'compositionend', 'blur']) {
        el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
      }
    };
    const titleInput = Array.from(root.querySelectorAll('input')).find((node) =>
      String(node.placeholder || '').includes('标题')
    );
    if (!titleInput) return { ok: false, stage: 'title_input_missing' };
    titleInput.focus();
    titleInput.value = ${JSON.stringify(title)};
    fire(titleInput);

    const candidates = Array.from(
      root.querySelectorAll('textarea,[contenteditable=true],[role=textbox],.input-editor,.rich-editor')
    ).map((node) => ({ node, placeholder: node.getAttribute('placeholder') || '', rect: node.getBoundingClientRect(), text: String(node.innerText || node.value || node.textContent || '') }));
    const desc = (
      candidates.find((item) => item.placeholder.includes('描述')) ||
      candidates.find((item) => item.text.includes('#话题')) ||
      candidates.find((item) => item.rect.width > 100 && item.rect.height > 40) ||
      {}
    ).node;
    if (desc) {
      desc.focus();
      if (desc.tagName === 'TEXTAREA' || desc.tagName === 'INPUT') {
        desc.value = ${JSON.stringify(body)};
        fire(desc);
      } else {
        desc.innerText = ${JSON.stringify(body)};
        desc.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: ${JSON.stringify(body)} }));
        desc.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        desc.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      }
    }
    const button = Array.from(root.querySelectorAll('button')).find((node) => String(node.innerText || '').trim() === '发表');
    return {
      ok: true,
      titleValue: titleInput.value,
      descFound: Boolean(desc),
      descTag: desc?.tagName || '',
      descText: String(desc?.innerText || desc?.value || '').slice(0, 160),
      publishDisabled: Boolean(button?.disabled || String(button?.className || '').includes('disabled')),
      imageVisible: Array.from(root.querySelectorAll('img')).some((img) => String(img.src || '').startsWith('blob:') && img.getBoundingClientRect().width > 20),
    };
  })()`;

  const fillResult = await cdp.send("Runtime.evaluate", {
    expression: fillExpression,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = fillResult.result?.result?.value;
  console.log(JSON.stringify({ stage: "filled", value }, null, 2));
  if (!value?.ok || value.publishDisabled || !value.imageVisible) {
    throw new Error(`Videohao fill verification failed: ${JSON.stringify(value)}`);
  }

  const submitExpression = `(() => {
    const root = document.querySelector('wujie-app')?.shadowRoot;
    const button = Array.from(root?.querySelectorAll('button') || []).find((node) => String(node.innerText || '').trim() === '发表');
    if (!button) return { ok: false, stage: 'submit_button_missing' };
    button.click();
    return { ok: true, url: location.href };
  })()`;
  const submitResult = await cdp.send("Runtime.evaluate", {
    expression: submitExpression,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify({ stage: "submit_clicked", value: submitResult.result?.result?.value }, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 10000));

  const verifyExpression = `(() => {
    const root = document.querySelector('wujie-app')?.shadowRoot;
    const text = String(root?.innerText || document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    return { url: location.href, textSample: text.slice(0, 800), hasSuccess: /发表成功|发布成功|审核|已发表|提交成功/.test(text), hasBlocking: /验证码|不能为空|失败|违规|错误/.test(text) };
  })()`;
  const verifyResult = await cdp.send("Runtime.evaluate", {
    expression: verifyExpression,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify({ stage: "verified", value: verifyResult.result?.result?.value }, null, 2));
  cdp.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
