async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "zhihu" });
  if (!automation) {
    return { status: "failed", failureStage: "init", errorMessage: "automation helper not loaded", executionLog: [], verificationEvidence: "failed_at_init", draftUrl: window.location.href };
  }

  const { log, setStage, sleep, normalize, pageText, queryAll, waitFor, setInputValue, extractEditableText, getClickableNode, simulateClick, fail, complete } = automation;
  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://zhuanlan.zhihu.com/write");
  const title = normalize(payload.draftTitle || "");
  const body = String(payload.draftBody || "").replace(/\r\n/g, "\n").trim();

  async function ensurePage() {
    setStage("load_publish_page", "进入知乎写作页");
    if (!window.location.href.includes("zhihu.com")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    await waitFor(['textarea[placeholder*="标题"]', '[contenteditable="true"]', '[role="textbox"]'], 60000, true);
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
    await fillBody();
    return await submit();
  } catch (error) {
    return fail(error, "知乎自动发布失败");
  }
}
