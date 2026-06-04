async (input) => {
  const automation = window.geoPublishAutomation?.createAutomationContext?.(input, { platform: "videohao" });
  if (!automation) {
    return { status: "failed", failureStage: "init", errorMessage: "automation helper not loaded", executionLog: [], verificationEvidence: "failed_at_init", draftUrl: window.location.href };
  }

  const { log, setStage, sleep, normalize, pageText, queryAll, waitFor, setInputValue, extractEditableText, getClickableNode, simulateClick, fail, complete } = automation;
  const payload = input?.payload ?? {};
  const publishUrl = String(input?.publishUrl || "https://channels.weixin.qq.com/platform/post/create");
  const title = normalize(payload.draftTitle || "");
  const body = normalize(payload.draftBody || "");
  const tags = Array.isArray(payload.draftTags) ? payload.draftTags.map(normalize).filter(Boolean).slice(0, 5) : [];
  const textBody = normalize([title, body, tags.map((tag) => `#${tag.replace(/^#+/, "")}`).join(" ")].filter(Boolean).join("\n\n"));

  async function ensurePage() {
    setStage("load_publish_page", "进入视频号助手发布页");
    if (!window.location.href.includes("channels.weixin.qq.com")) {
      window.location.href = publishUrl;
      await sleep(3000);
    }
    await waitFor(['textarea', '[contenteditable="true"]', '[role="textbox"]', 'input[type="file"]'], 60000, false);
  }

  async function fillBody() {
    setStage("fill_body", "填写视频号文案");
    const editor = await waitFor(['textarea[placeholder*="描述"]', 'textarea[placeholder*="文案"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'], 30000, true);
    setInputValue(editor, textBody.slice(0, 1200));
    await sleep(800);
    const written = normalize(extractEditableText(editor));
    if (!written.includes(title.slice(0, Math.min(8, title.length))) && !written.includes(body.slice(0, 10))) {
      throw new Error("视频号文案写入后未通过校验");
    }
  }

  async function submit() {
    setStage("submit", "提交视频号发布");
    const pgBefore = pageText();
    if (["上传视频", "添加视频", "选择视频"].some((hint) => pgBefore.includes(hint)) && !Array.isArray(payload.preparedImages)) {
      return complete({ status: "verification_failed", failureStage: "submit", errorMessage: "视频号发布页要求视频或图片素材，当前稿件没有可用视频素材。", publishUrl: window.location.href, verificationEvidence: "videohao_media_required" });
    }
    const button = queryAll(['button:has-text("发表")', 'button:has-text("发布")', '[role="button"]:has-text("发表")', '[role="button"]:has-text("发布")', 'text=发表'], true)
      .map((node) => getClickableNode(node))
      .find(Boolean);
    if (!button) throw new Error("未找到视频号发布按钮");
    simulateClick(button);
    log("submit_clicked: videohao");
    await sleep(6000);
    const pg = pageText();
    if (["发表成功", "发布成功", "审核"].some((hint) => pg.includes(hint))) {
      return complete({ status: pg.includes("审核") ? "pending_review" : "published", publishUrl: window.location.href, verificationEvidence: "videohao_submit_success_text" });
    }
    if (["上传视频", "添加视频", "验证码", "审核", "不能为空"].some((hint) => pg.includes(hint))) {
      return complete({ status: "verification_failed", failureStage: "submit", errorMessage: "视频号提交后出现素材、验证、审核或必填项阻断。", publishUrl: window.location.href, verificationEvidence: "videohao_platform_blocking_text" });
    }
    return complete({ status: "submitted", publishUrl: window.location.href, verificationEvidence: "videohao_submit_clicked" });
  }

  try {
    await ensurePage();
    await fillBody();
    return await submit();
  } catch (error) {
    return fail(error, "视频号自动发布失败");
  }
}
