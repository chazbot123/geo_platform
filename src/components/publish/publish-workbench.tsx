"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileUp, LoaderCircle, RefreshCcw, Save, Trash2 } from "lucide-react";
import { getPlatformPublisher } from "@/lib/publish/platform-publishers";
import { publishPlatformDescriptors } from "@/lib/publish/platforms";
import type { PlatformAccountRecord, PublishWorkbenchData, PublishingDraft, PublishingJobRecord } from "@/lib/types";

interface TaskOption {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

function formatTags(tags: string[]) {
  return tags.join(" ");
}

function parseTags(text: string) {
  return Array.from(
    new Set(
      text
        .split(/[\s,，]+/)
        .map((item) => item.trim().replace(/^#+/, ""))
        .filter(Boolean),
    ),
  );
}

function platformLabel(platform: string) {
  if (platform === "blog") {
    return "历史遗留记录";
  }
  return publishPlatformDescriptors.find((item) => item.key === platform)?.label ?? platform;
}

function accountOptions(accounts: PlatformAccountRecord[], platform: string) {
  return accounts.filter((item) => item.platform === platform && item.loginStatus === "authenticated");
}

function accountBindingDiagnosis(job: PublishingJobRecord, accounts: PlatformAccountRecord[]) {
  const matchedAccounts = accountOptions(accounts, job.platform);
  if (matchedAccounts.length === 0) {
    return "当前平台还没有已登录账号，请先到账号中心完成登录，再返回工作台创建发布任务。";
  }
  if (matchedAccounts.length === 1) {
    return "当前平台只有 1 个已登录账号，这次失败是因为当时草稿还没绑定到它。重新打开工作台后系统会自动补绑，也可以手动确认后再创建任务。";
  }
  return "当前平台存在多个已登录账号，系统不会自动猜测要用哪一个。请先在对应平台草稿里明确选择账号后再发布。";
}

function jobStatusLabel(status: PublishingJobRecord["status"]) {
  const map: Record<PublishingJobRecord["status"], string> = {
    drafted: "草稿",
    queued: "排队中",
    running: "执行中",
    submitted: "平台已接收提交",
    verifying: "列表核验中",
    pending_review: "平台处理中，待人工确认",
    verification_failed: "已提交但未核验到内容",
    manual_pending: "待人工处理",
    published: "已发布",
    failed: "失败",
  };
  return map[status] ?? status;
}

function jobDiagnosis(job: PublishingJobRecord, accounts: PlatformAccountRecord[]) {
  if (job.status === "published") {
    if (job.verificationEvidence === "manual_publish_url") {
      return "这条记录是人工补录成功，不代表系统自动核验通过。";
    }
    if (job.verificationEvidence) {
      return "平台列表已找到新内容，系统已自动确认发布成功。";
    }
    return "任务已标记成功。";
  }

  if (job.status === "pending_review") {
    return "平台很可能已接受提交，但内容仍在审核中，系统暂时无法自动确认成功。";
  }

  if (job.status === "verification_failed") {
    return "发布动作大概率已提交到平台，但系统在作品列表里没有找到新内容，所以不能判定成功。";
  }

  if (job.failureStage === "account_binding") {
    return accountBindingDiagnosis(job, accounts);
  }

  if (job.failureStage === "missing_electron_bridge" || job.failureStage === "missing_extension_bridge") {
    return "当前环境缺少浏览器扩展桥，社媒自动发布不会执行。请先加载 `scripts/browser-extension/platform-login-helper` 扩展。";
  }

  if (job.failureStage === "extension_publish_session") {
    return "发布任务没有成功换取到扩展发布会话，通常是账号登录态不完整或当前任务绑定的账号不可用。";
  }

  if (job.failureStage === "extension_publish_failed") {
    return "浏览器扩展已经启动，但平台自动发布过程中失败了，可结合执行日志继续定位。";
  }

  if (job.failureStage === "prepare_images") {
    return "发布图片在应用侧准备失败，自动化还没有进入平台标题或正文填写阶段。通常是远程图片地址不可下载、已过期，或图片数据无法转换为可上传文件。";
  }

  if (job.failureStage === "platform_session_missing" || job.failureStage === "platform_login_required" || job.failureStage === "login_required") {
    return "账号记录还在，但当前 Electron 分区里的平台登录会话不可用。自动发布不会继续执行，请先重新登录该平台账号。";
  }

  if (job.failureStage === "post_upload_transition") {
    return "图片已送入平台，但上传后的过渡步骤没有完成，页面可能还停在裁剪、确认或继续编辑阶段。";
  }

  if (job.failureStage === "image_mode_not_entered") {
    return "页面还停留在小红书的发布入口区，尚未真正进入“上传图文”编辑模式，因此后续标题和正文都不会出现。";
  }

  if (job.failureStage === "image_mode_switch_failed") {
    return "脚本尝试切到小红书图文模式但没有成功，可能是页面入口结构变化，或点击入口后没有真正进入图文编辑器。";
  }

  if (job.failureStage === "image_editor_not_ready") {
    return "已经进入图文相关页面，但图文编辑器仍未渲染完成，标题和正文输入区域暂时不可用。";
  }

  if (job.failureStage === "editor_not_ready") {
    return "图片上传后页面没有进入真正可编辑的图文发布态，因此脚本没有继续填写标题和正文。";
  }

  if (job.failureStage === "title_input_missing") {
    return "页面已进入小红书发布页，但没有识别到标题输入区域，通常是新版页面结构或编辑器节点发生了变化。";
  }

  if (job.failureStage === "body_input_missing") {
    return "标题阶段可能已通过，但没有识别到正文输入区域，通常是正文编辑器节点或提示文案发生了变化。";
  }

  if (job.failureStage === "load_publish_page") {
    return "平台创作页没有成功打开，自动化在进入发布页前就中断了。";
  }

  if (job.failureStage === "open_manage_page") {
    return "发布页动作可能已经提交，但脚本没有成功进入作品管理页做二次核验。";
  }

  if (job.failureStage === "verify_item_missing") {
    return "脚本已进入作品管理页，但没有在列表中匹配到刚发布的内容。";
  }

  if (job.failureStage === "submit_ack_missing") {
    return "脚本点了发布，但没有识别到平台的提交反馈，可能是页面提示文案或结构变了。";
  }

  if (job.status === "failed") {
    return "自动发布已中断，可结合失败阶段和执行日志继续定位具体卡点。";
  }

  return null;
}

export function PublishWorkbench({
  tasks,
  initialTaskId,
  initialData,
}: {
  tasks: TaskOption[];
  initialTaskId?: string;
  initialData?: PublishWorkbenchData | null;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState(initialTaskId ?? tasks[0]?.id ?? "");
  const [data, setData] = useState<PublishWorkbenchData | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>(initialData?.drafts.map((item) => item.id) ?? []);
  const [draftEdits, setDraftEdits] = useState<Record<string, { title: string; body: string; tagsText: string; accountId?: string }>>(
    Object.fromEntries(
      (initialData?.drafts ?? []).map((draft) => [
        draft.id,
        { title: draft.title, body: draft.body, tagsText: formatTags(draft.tags), accountId: draft.accountId },
      ]),
    ),
  );
  const [jobLinks, setJobLinks] = useState<Record<string, string>>({});

  async function loadWorkbench(taskId: string) {
    if (!taskId) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/publish/workbench/${taskId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "加载发布工作台失败");
      setData(payload);
      setSelectedDraftIds(payload.drafts.map((item: PublishingDraft) => item.id));
      setDraftEdits(
        Object.fromEntries(
          payload.drafts.map((draft: PublishingDraft) => [
            draft.id,
            { title: draft.title, body: draft.body, tagsText: formatTags(draft.tags), accountId: draft.accountId },
          ]),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载发布工作台失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!data && selectedTaskId) {
      void loadWorkbench(selectedTaskId);
    }
  }, [data, selectedTaskId]);

  const currentTask = useMemo(() => tasks.find((item) => item.id === selectedTaskId), [tasks, selectedTaskId]);

  async function saveDraft(draftId: string) {
    const draft = draftEdits[draftId];
    if (!draft) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/publish/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          body: draft.body,
          tags: parseTags(draft.tagsText),
          accountId: draft.accountId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "保存草稿失败");
      await loadWorkbench(selectedTaskId);
      setMessage("草稿已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存草稿失败");
    } finally {
      setLoading(false);
    }
  }

  async function createJobs() {
    if (!selectedTaskId || selectedDraftIds.length === 0) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/publish/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedTaskId,
          items: selectedDraftIds.map((draftId) => ({
            draftId,
            accountId: draftEdits[draftId]?.accountId,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "创建发布任务失败");
      const createdJobs = payload.jobs as PublishingJobRecord[];
      await executeSocialJobs(createdJobs);
      await loadWorkbench(selectedTaskId);
      setMessage("发布任务已创建。社媒任务会优先通过浏览器扩展执行真发布，并且只有在平台列表核验通过后才会记为成功。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建发布任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function clearPublishData() {
    if (!selectedTaskId) return;
    const confirmed = window.confirm("这会清空当前任务在发布工作台中的发布结果、发布记录和平台草稿。确定继续吗？");
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/publish/workbench/${selectedTaskId}`, {
        method: "DELETE",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "清空发布数据失败");
      }
      setJobLinks({});
      await loadWorkbench(selectedTaskId);
      setMessage("当前任务的发布数据已清空，平台草稿已重置。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清空发布数据失败");
    } finally {
      setLoading(false);
    }
  }

  async function updateJob(jobId: string, status: "published" | "failed") {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/publish/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          publishUrl: jobLinks[jobId],
          notes: status === "published" ? "已人工补录平台发布链接并确认为成功。" : "已人工标记为失败。",
          errorMessage: status === "failed" ? "用户在工作台中手动标记失败。" : undefined,
          failureStage: status === "failed" ? "manual_override" : undefined,
          externalStatus: status === "published" ? "manual_confirmed" : undefined,
          verificationEvidence: status === "published" ? "manual_publish_url" : undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "更新发布任务失败");
      await loadWorkbench(selectedTaskId);
      setMessage(status === "published" ? "发布结果已回录。" : "发布任务已标记失败。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新发布任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function patchJob(jobId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/publish/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "更新发布任务失败");
    }
    return payload.job as PublishingJobRecord;
  }

  async function patchAccountState(accountId: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/publish/accounts/${accountId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "更新账号状态失败");
    }
    return payload.account as PlatformAccountRecord;
  }

  async function executeSocialJob(job: PublishingJobRecord) {
    if (!data) {
      throw new Error("发布工作台数据未加载完成");
    }

    if (!job.accountId) {
      return;
    }

    const account = data.accounts.find((item) => item.id === job.accountId);
    if (!account) {
      throw new Error("未找到已绑定的平台账号");
    }

    const publisher = getPlatformPublisher(job.platform);
    if (!publisher) {
      return;
    }

    const draft = data.drafts.find((item) => item.platform === job.platform) ?? {
      id: `${job.taskId}-${job.platform}`,
      taskId: job.taskId,
      platform: job.platform,
      title: job.draftTitle,
      body: job.draftBody,
      tags: job.draftTags,
      imageUrls: job.draftImages,
      publishEntryUrl: job.publishEntryUrl,
      updatedAt: new Date().toISOString(),
    };

    await patchJob(job.id, {
      status: "running",
      notes: "扩展发布已启动，正在执行平台自动化脚本。",
      executionLog: ["启动浏览器扩展发布会话"],
    });

    const result = await publisher.publish({
      account,
      draft,
      job,
      timeoutMs: 180000,
    });

    if (result.status === "published") {
      await patchJob(job.id, {
        status: "published",
        publishUrl: result.publishUrl,
        draftUrl: result.draftUrl,
        verificationUrl: result.verificationUrl,
        externalStatus: result.externalStatus,
        executionLog: result.executionLog,
        verificationEvidence: result.verificationEvidence,
        verificationAttempts: result.verificationAttempts,
        platformItemId: result.platformItemId,
        notes: "平台自动发布成功，且已在列表中完成二次核验。",
      });
      return;
    }

    if (
      job.accountId &&
      (result.failureStage === "platform_session_missing" ||
        result.failureStage === "platform_login_required" ||
        result.failureStage === "login_required")
    ) {
      await patchAccountState(job.accountId, {
        loginStatus: "failed",
        status: "invalid",
        lastError: result.errorMessage ?? "平台登录会话已失效，请重新登录。",
      });
    }

    if (result.status === "submitted" || result.status === "verifying" || result.status === "pending_review" || result.status === "verification_failed") {
      await patchJob(job.id, {
        status: result.status,
        publishUrl: result.publishUrl,
        draftUrl: result.draftUrl,
        verificationUrl: result.verificationUrl,
        externalStatus: result.externalStatus,
        executionLog: result.executionLog,
        verificationEvidence: result.verificationEvidence,
        verificationAttempts: result.verificationAttempts,
        platformItemId: result.platformItemId,
        failureStage: result.failureStage,
        errorMessage: result.errorMessage,
        notes:
          result.status === "pending_review"
            ? "平台已接受提交，但列表未完成强证据核验，暂不标记为成功。"
            : result.status === "verification_failed"
              ? "已提交发布，但列表核验未找到新内容，不能标记为成功。"
              : "平台发布已提交，正在等待核验结果。",
      });
      return;
    }

    await patchJob(job.id, {
      status: "failed",
      publishUrl: result.publishUrl,
      draftUrl: result.draftUrl,
      verificationUrl: result.verificationUrl,
      externalStatus: result.externalStatus,
      executionLog: result.executionLog,
      verificationEvidence: result.verificationEvidence,
      verificationAttempts: result.verificationAttempts,
      platformItemId: result.platformItemId,
      failureStage: result.failureStage,
      errorMessage: result.errorMessage ?? "平台自动发布失败",
      notes: "自动发布失败，可检查日志后重试或人工补录。",
    });
  }

  async function executeSocialJobs(jobs: PublishingJobRecord[]) {
    const runnableJobs = jobs.filter((job) => job.status !== "failed");
    for (const job of runnableJobs) {
      await executeSocialJob(job);
    }
  }

  async function retryJob(job: PublishingJobRecord) {
    setLoading(true);
    setMessage("");
    try {
      await executeSocialJob(job);
      await loadWorkbench(selectedTaskId);
      setMessage(`${platformLabel(job.platform)} 已重新执行自动发布。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重试发布失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="label-base">任务选择</p>
          <select
            className="input-base mt-4"
            value={selectedTaskId}
            onChange={(event) => {
              setSelectedTaskId(event.target.value);
              setData(null);
            }}
          >
            <option value="">请选择任务</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          {currentTask ? (
            <div className="mt-4 text-sm text-slate-300">
              <p>状态：{currentTask.status}</p>
              <p>更新时间：{new Date(currentTask.updatedAt).toLocaleString()}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-300">请选择一个已生成内容或图片的任务进入工作台。</p>
          )}
        </div>

        <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
          <p className="label-base">发布动作</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            勾选平台草稿后即可创建发布任务。小红书和抖音当前优先通过浏览器扩展执行真实图文发布，且平台草稿必须先绑定已认证账号。
          </p>
          <p className="mt-2 text-xs leading-6 text-slate-400">
            账号中心里的“已登录”只表示这个平台账号可用，不等于当前草稿已经绑定它；当某个平台只有 1 个已登录账号时，系统会自动补绑，否则仍需你手动选择。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="rounded-2xl bg-accent px-5 py-4 text-sm font-semibold text-slate-950" disabled={loading || !selectedTaskId} onClick={createJobs}>
              {loading ? <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" /> : <FileUp className="mr-2 inline h-4 w-4" />}
              创建发布任务
            </button>
            <button className="rounded-2xl border border-rose-400/20 px-5 py-4 text-sm font-semibold text-rose-200" disabled={loading || !selectedTaskId} onClick={clearPublishData}>
              <Trash2 className="mr-2 inline h-4 w-4" />
              一键清空当前任务发布数据
            </button>
          </div>
          {message ? <p className="mt-4 text-sm text-slate-300">{message}</p> : null}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
            <p className="label-base">平台草稿</p>
            <div className="mt-4 grid gap-4">
              {(data?.drafts ?? []).map((draft) => {
                const edit = draftEdits[draft.id] ?? { title: draft.title, body: draft.body, tagsText: formatTags(draft.tags), accountId: draft.accountId };
                const authenticatedAccounts = accountOptions(data?.accounts ?? [], draft.platform);
                const selectedAccount = authenticatedAccounts.find((account) => account.id === edit.accountId);
                return (
                  <div key={draft.id} className="rounded-[24px] border border-white/10 bg-slate-950/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-3 text-sm text-white">
                        <input
                          type="checkbox"
                          checked={selectedDraftIds.includes(draft.id)}
                          onChange={(event) =>
                            setSelectedDraftIds((current) =>
                              event.target.checked ? [...current, draft.id] : current.filter((item) => item !== draft.id),
                            )
                          }
                        />
                        {platformLabel(draft.platform)}
                      </label>
                      {draft.publishEntryUrl ? (
                        <a className="text-xs text-accent underline" href={draft.publishEntryUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-1 inline h-3.5 w-3.5" />
                          打开平台入口
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-3">
                      <input
                        className="input-base"
                        value={edit.title}
                        onChange={(event) =>
                          setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, title: event.target.value } }))
                        }
                        placeholder="标题"
                      />
                      <textarea
                        className="input-base min-h-32"
                        value={edit.body}
                        onChange={(event) =>
                          setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, body: event.target.value } }))
                        }
                        placeholder="正文"
                      />
                      <input
                        className="input-base"
                        value={edit.tagsText}
                        onChange={(event) =>
                          setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, tagsText: event.target.value } }))
                        }
                        placeholder="#标签1 #标签2"
                      />
                      <select
                        className="input-base"
                        value={edit.accountId ?? ""}
                        onChange={(event) =>
                          setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, accountId: event.target.value || undefined } }))
                        }
                      >
                        <option value="">请选择平台账号</option>
                        {accountOptions(data?.accounts ?? [], draft.platform).map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.displayName ?? account.accountName}
                          </option>
                        ))}
                      </select>
                      {authenticatedAccounts.length === 0 ? (
                        <p className="text-xs leading-5 text-amber-200">当前平台还没有已登录账号，请先到账号中心完成登录。</p>
                      ) : null}
                      {authenticatedAccounts.length === 1 && selectedAccount ? (
                        <p className="text-xs leading-5 text-emerald-200">
                          已自动绑定唯一已登录账号：{selectedAccount.displayName ?? selectedAccount.accountName}
                        </p>
                      ) : null}
                      {authenticatedAccounts.length > 1 && !edit.accountId ? (
                        <p className="text-xs leading-5 text-amber-200">当前平台有多个已登录账号，请先明确选择一个再保存草稿。</p>
                      ) : null}
                      <button className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white" onClick={() => saveDraft(draft.id)} disabled={loading}>
                        <Save className="mr-2 inline h-4 w-4" />
                        保存草稿
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
            <p className="label-base">任务素材</p>
            {data ? (
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>产品：{data.product.productName}</p>
                <p>摘要：{data.content?.summary ?? "暂无主稿摘要"}</p>
                <p>封面：{data.image?.url ? <a className="text-accent underline" href={data.image.url} target="_blank" rel="noreferrer">{data.image.url}</a> : "暂无图片"}</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-300">选择任务后即可查看当前交付素材。</p>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
            <p className="label-base">发布记录</p>
            <div className="mt-4 grid gap-4">
              {(data?.jobs ?? []).length ? (
                data?.jobs.map((job) => (
                  <div key={job.id} className="rounded-[24px] border border-white/10 bg-slate-950/20 p-4 text-sm text-slate-300">
                    <p className="font-semibold text-white">{platformLabel(job.platform)}</p>
                    <p className="mt-1">状态：{jobStatusLabel(job.status)}</p>
                    <p className="mt-1">账号：{job.accountName ?? "--"}</p>
                    {job.draftUrl ? (
                      <p className="mt-1">
                        结果：
                        <a className="text-accent underline" href={job.draftUrl} target="_blank" rel="noreferrer">
                          {job.draftUrl}
                        </a>
                      </p>
                    ) : null}
                    {job.verificationUrl ? (
                      <p className="mt-1">
                        核验页：
                        <a className="text-accent underline" href={job.verificationUrl} target="_blank" rel="noreferrer">
                          {job.verificationUrl}
                        </a>
                      </p>
                    ) : null}
                    {job.publishEntryUrl ? (
                      <p className="mt-1">
                        入口：
                        <a className="text-accent underline" href={job.publishEntryUrl} target="_blank" rel="noreferrer">
                          {job.publishEntryUrl}
                        </a>
                      </p>
                    ) : null}
                    {job.verificationEvidence ? <p className="mt-1 text-xs text-slate-400">核验证据：{job.verificationEvidence}</p> : null}
                    {job.externalStatus ? <p className="mt-1 text-xs text-slate-400">来源：{job.externalStatus}</p> : null}
                    {job.failureStage ? <p className="mt-1 text-xs text-amber-300">失败阶段：{job.failureStage}</p> : null}
                    {jobDiagnosis(job, data?.accounts ?? []) ? <p className="mt-2 text-xs leading-5 text-amber-200">{jobDiagnosis(job, data?.accounts ?? [])}</p> : null}
                    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">{job.notes ?? job.errorMessage ?? "--"}</p>
                    {job.executionLog?.length ? (
                      <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/30 p-3 text-[11px] leading-5 text-slate-400">
                        {job.executionLog.join("\n")}
                      </pre>
                    ) : null}
                    <div className="mt-3 grid gap-3">
                      <button className="rounded-2xl border border-white/10 px-4 py-3 text-xs text-white" onClick={() => retryJob(job)} disabled={loading || !job.accountId}>
                        <RefreshCcw className="mr-1 inline h-3.5 w-3.5" />
                        重试自动发布
                      </button>
                      <input
                        className="input-base"
                        value={jobLinks[job.id] ?? ""}
                        onChange={(event) => setJobLinks((current) => ({ ...current, [job.id]: event.target.value }))}
                        placeholder="发布完成后回录外部链接"
                      />
                      <div className="flex gap-3">
                        <button className="rounded-2xl border border-emerald-400/20 px-4 py-3 text-xs text-emerald-200" onClick={() => updateJob(job.id, "published")} disabled={loading}>
                          手动补录成功
                        </button>
                        <button className="rounded-2xl border border-rose-400/20 px-4 py-3 text-xs text-rose-200" onClick={() => updateJob(job.id, "failed")} disabled={loading}>
                          人工标记失败
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-300">当前还没有发布记录。</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
