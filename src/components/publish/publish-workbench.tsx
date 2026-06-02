"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileImage, FileUp, LoaderCircle, RefreshCcw, Save, Trash2 } from "lucide-react";
import { auditPlatformAccountSession } from "@/lib/publish/account-session-validator";
import { getPlatformPublishProgressWindow } from "@/lib/publish/electron-login-client";
import { getPlatformPublisher } from "@/lib/publish/platform-publishers";
import { detectDesktopBridge, hasElectronDesktopBridge, type DesktopBridgeAvailability } from "@/lib/publish/local-bridge-client";
import { publishPlatformDescriptors } from "@/lib/publish/platforms";
import { countToutiaoTitleLength, TOUTIAO_TITLE_MAX_LENGTH } from "@/lib/publish/toutiao-title";
import type { AccountPublishingDraft, PlatformAccountRecord, PublishProgressSnapshot, PublishWorkbenchData, PublishingDraft, PublishingJobRecord } from "@/lib/types";

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
  return publishPlatformDescriptors.find((item) => item.key === platform)?.label ?? platform;
}

function accountOptions(accounts: PlatformAccountRecord[], platform: string) {
  return accounts.filter((item) => item.platform === platform && item.loginStatus === "authenticated");
}

function platformAutomationLabel(platform: string) {
  const status = publishPlatformDescriptors.find((item) => item.key === platform)?.automationStatus;
  if (status === "ready") return "已自动化";
  if (status === "manual_only") return "手动发布";
  return "计划接入";
}

function groupAccountDraftsByPlatform(data: PublishWorkbenchData | null) {
  const groups = new Map<string, NonNullable<PublishWorkbenchData["accountDrafts"]>>();
  for (const draft of data?.accountDrafts ?? []) {
    const current = groups.get(draft.platform) ?? [];
    current.push(draft);
    groups.set(draft.platform, current);
  }
  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
}

const providerLabels: Record<string, string> = {
  doubao: "豆包",
  yuanbao: "元宝",
  tongyi: "通义千问",
  deepseek: "DeepSeek",
};

function buildWorkbenchPreflight(data: PublishWorkbenchData | null, bridgeAvailability: DesktopBridgeAvailability) {
  const issues: string[] = [];
  const hints: string[] = [];
  const isBridgeReady = bridgeAvailability.mode === "electron_bridge" || bridgeAvailability.mode === "local_bridge";

  if (!isBridgeReady) {
    issues.push("当前未连接 GEO 桌面版，暂时无法复核发布账号的真实登录态，也不能真正执行平台自动发布。");
  }

  if (!data) {
    return { issues, hints };
  }

  const imageCount = data.image?.images?.length ?? (data.image?.url ? 1 : 0);
  if (imageCount === 0) {
    hints.push("当前任务没有图片也可以发布，系统会按纯文章模式执行对应平台发布。");
  }

  for (const draft of data.drafts) {
    const platformAccounts = data.accounts.filter((item) => item.platform === draft.platform);
    const authenticatedAccounts = accountOptions(data.accounts, draft.platform);
    if (authenticatedAccounts.length === 0) {
      const invalidAccounts = platformAccounts.filter(
        (item) => (item.loginStatus === "failed" || item.status === "invalid") && item.lastError?.trim(),
      );
      if (platformAccounts.length === 0) {
        issues.push(`${platformLabel(draft.platform)} 还没有任何账号记录，请先到账号中心完成登录。`);
      } else if (!isBridgeReady) {
        issues.push(`${platformLabel(draft.platform)} 当前未连接桌面桥，暂时无法确认哪些账号还能发布。`);
      } else if (invalidAccounts.length > 0) {
        issues.push(`${platformLabel(draft.platform)} 账号记录存在，但真实登录态已失效，请到账号中心重新登录后再发布。`);
      } else {
        issues.push(`${platformLabel(draft.platform)} 当前没有可用的已登录账号，任务会在创建阶段直接失败。`);
      }
      continue;
    }

    if (authenticatedAccounts.length > 1 && (!draft.accountIds || draft.accountIds.length === 0)) {
      issues.push(`${platformLabel(draft.platform)} 当前存在多个已登录账号，但草稿还没有至少勾选一个要发布的账号。`);
      continue;
    }

    if (authenticatedAccounts.length === 1 && (!draft.accountIds || draft.accountIds.length === 0)) {
      hints.push(`${platformLabel(draft.platform)} 当前只有 1 个已登录账号，系统会在创建任务时自动补绑该账号。`);
    }
  }

  return { issues, hints };
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
    return "平台已经接收提交，但内容仍在审核中或暂未出现在作品列表里；这表示脚本已跑到提交后阶段，不等于自动发布失败。";
  }

  if (job.status === "verification_failed") {
    return "发布动作大概率已经提交到平台，但系统在限定时间内没有在作品列表或详情页核验到目标内容，所以不能自动判定成功。";
  }

  if (job.status === "verifying") {
    return "发布提交已经完成，系统正在自动进入今日头条作品列表或详情页做二次核验。";
  }

  if (job.status === "submitted") {
    return "平台已接收提交，但系统尚未拿到足够的核验证据，因此还不能标记为已发布。";
  }

  if (job.failureStage === "account_binding") {
    return accountBindingDiagnosis(job, accounts);
  }

  if (job.failureStage === "missing_electron_bridge") {
    return "当前环境缺少可用桌面桥，可能是浏览器页面未连接到 GEO 桌面版，或桌面程序尚未启动；自动发布不会执行。";
  }

  if (job.failureStage === "prepare_images") {
    return "发布图片在应用侧准备失败，自动化还没有进入平台标题或正文填写阶段。通常是远程图片地址不可下载、已过期，或图片数据无法转换为可上传文件。";
  }

  if (job.failureStage === "platform_session_missing" || job.failureStage === "platform_login_required" || job.failureStage === "login_required") {
    return "账号记录还在，但当前 Electron 分区里的真实今日头条登录会话不可用。自动发布在脚本启动前就会中断，请先重新登录。";
  }

  if (job.failureStage === "fill_title") {
    return "脚本没有成功写入标题。通常是标题输入区域结构发生变化。";
  }

  if (job.failureStage === "fill_body") {
    return "脚本已经进入正文阶段，但没有把内容稳定写入头条编辑器。更可能是正文编辑器结构变化，或写入后的内容校验未通过。";
  }

  if (job.failureStage === "fill_tags") {
    return "正文阶段已完成，但填写标签时失败。通常是标签输入区域结构变化，或当前页面没有可写入的标签控件。";
  }

  if (job.failureStage === "preview_publish") {
    return "脚本已经完成标题和正文填写，但没有成功打开头条的预览确认层。当前策略不会降级去猜其他发布按钮；如果这里失败，就会直接中断并标记失败。";
  }

  if (job.failureStage === "confirm_publish") {
    return "脚本已经进入头条预览层，但没有成功点击底部“确认发布”。更可能是预览弹层结构或确认按钮位置发生了变化。";
  }

  if (job.failureStage === "load_publish_page") {
    return "平台创作页没有成功打开，自动化在进入发布页前就中断了。";
  }

  if (job.failureStage === "submit") {
    return "脚本已执行到发布提交阶段，但没有识别到明确的提交反馈；更可能是按钮结构、弹窗确认或提交提示文案发生了变化。";
  }

  if (job.failureStage === "open_manage_page") {
    return "自动化已经完成发布提交，但没有成功进入今日头条作品管理页，因此无法继续核验。";
  }

  if (job.failureStage === "find_published_item") {
    return "已经进入作品列表，但没有在限定时间内匹配到刚发布的内容，因此暂时不能自动确认成功。";
  }

  if (job.failureStage === "open_published_item") {
    return "作品列表里疑似已经出现目标内容，但自动化没有成功打开详情页完成二次确认。";
  }

  if (job.failureStage === "verify_published_item") {
    return "自动化已经进入作品详情核验阶段，但没有拿到足够证据确认该内容就是本次发布结果。";
  }

  if (job.status === "failed") {
    return "自动发布已中断，可结合失败阶段和执行日志继续定位具体卡点。";
  }

  return null;
}

function buildBodyPreview(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无正文预览";
  }
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
}

function taskStatusTone(status?: string) {
  if (!status) {
    return "bg-white/5 text-muted";
  }
  if (status.includes("failed")) {
    return "bg-danger/15 text-danger";
  }
  if (status.includes("generated") || status.includes("completed") || status.includes("published")) {
    return "bg-emerald-500/15 text-emerald-300";
  }
  return "bg-warning/15 text-warning";
}

function resolveTaskPreviewImages(data: PublishWorkbenchData | null, draft?: PublishingDraft) {
  if (draft?.imageUrls?.length) {
    return draft.imageUrls;
  }
  if (data?.image?.images?.length) {
    return data.image.images.map((item) => item.publicUrl ?? item.url);
  }
  if (data?.image?.url) {
    return [data.image.url];
  }
  return [];
}

function accountDraftToPublishingDraft(draft: AccountPublishingDraft): PublishingDraft {
  return {
    id: draft.id,
    taskId: draft.taskId,
    platform: draft.platform,
    title: draft.title,
    body: draft.body,
    tags: draft.tags,
    coverImageUrl: draft.coverImageUrl,
    imageUrls: draft.imageUrls,
    localImagePaths: draft.localImagePaths,
    publishMode: draft.publishMode,
    publishEntryUrl: draft.publishEntryUrl,
    accountId: draft.accountId,
    accountIds: [draft.accountId],
    updatedAt: draft.updatedAt,
  };
}

function draftTitleMeta(platform: string, title: string) {
  if (platform !== "toutiao") {
    return null;
  }
  const length = countToutiaoTitleLength(title);
  return {
    length,
    exceeded: length > TOUTIAO_TITLE_MAX_LENGTH,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createClientSessionToken() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `publish-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stageLabel(stage?: string) {
  const map: Record<string, string> = {
    init: "准备启动",
    validate_session: "会话校验",
    prepare_images: "图片准备",
    open_publish_page: "打开发布页",
    inject_automation: "注入自动化",
    manage_page_ready: "管理页已就绪",
    open_manage_candidate: "尝试打开管理页",
    fill_title: "填写标题",
    fill_body: "填写正文",
    fill_tags: "填写标签",
    preview_publish: "打开预览发布",
    confirm_publish: "确认正式发布",
    submit: "提交发布",
    open_manage_page: "打开管理页",
    find_published_item: "查找发布结果",
    open_published_item: "打开发布详情",
    verify_published_item: "核验发布结果",
    verification_failed: "核验失败",
    published: "发布成功",
    error: "执行异常",
  };
  if (!stage) {
    return "未知阶段";
  }
  return map[stage] ?? stage.replace(/_/g, " ");
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
  const [selectedAccountDraftIds, setSelectedAccountDraftIds] = useState<string[]>(initialData?.accountDrafts?.map((item) => item.id) ?? []);
  const [draftEdits, setDraftEdits] = useState<Record<string, { title: string; body: string; tagsText: string; accountIds: string[] }>>(
    Object.fromEntries(
      (initialData?.drafts ?? []).map((draft) => [
        draft.id,
        { title: draft.title, body: draft.body, tagsText: formatTags(draft.tags), accountIds: draft.accountIds ?? (draft.accountId ? [draft.accountId] : []) },
      ]),
    ),
  );
  const [jobLinks, setJobLinks] = useState<Record<string, string>>({});
  const [liveProgress, setLiveProgress] = useState<Record<string, PublishProgressSnapshot>>({});
  const [bridgeAvailability, setBridgeAvailability] = useState<DesktopBridgeAvailability>(() => ({
    mode: hasElectronDesktopBridge() ? "electron_bridge" : "bridge_unreachable",
    label: hasElectronDesktopBridge() ? "已连接 Electron 注入桥" : "未检测到可用桌面桥",
  }));
  const [auditedTaskIds, setAuditedTaskIds] = useState<string[]>([]);
  const isBridgeReady = bridgeAvailability.mode === "electron_bridge" || bridgeAvailability.mode === "local_bridge";

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
      setSelectedAccountDraftIds((payload.accountDrafts ?? []).map((item: AccountPublishingDraft) => item.id));
      setDraftEdits(
        Object.fromEntries(
          payload.drafts.map((draft: PublishingDraft) => [
            draft.id,
            { title: draft.title, body: draft.body, tagsText: formatTags(draft.tags), accountIds: draft.accountIds ?? (draft.accountId ? [draft.accountId] : []) },
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

  useEffect(() => {
    let alive = true;
    void detectDesktopBridge().then((result) => {
      if (alive) {
        setBridgeAvailability(result);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTaskId || !data || !isBridgeReady || auditedTaskIds.includes(selectedTaskId)) {
      return;
    }

    const accountsToAudit = data.accounts.filter((item) => item.platform === "toutiao" && item.loginStatus === "authenticated");
    if (accountsToAudit.length === 0) {
      setAuditedTaskIds((current) => [...current, selectedTaskId]);
      return;
    }

    let cancelled = false;
    void (async () => {
      let changed = false;
      let downgradedCount = 0;
      for (const account of accountsToAudit) {
        const audit = await auditPlatformAccountSession(account);
        if (!audit.canAutoValidate) {
          continue;
        }
        const nextLoginStatus = audit.nextLoginStatus ?? account.loginStatus;
        const nextStatus = audit.nextStatus ?? account.status;
        const nextError = audit.lastError;
        if (
          nextLoginStatus !== account.loginStatus ||
          nextStatus !== account.status ||
          (nextError ?? "") !== (account.lastError ?? "")
        ) {
          await patchAccountState(account.id, {
            loginStatus: nextLoginStatus,
            status: nextStatus,
            lastError: nextError,
          });
          changed = true;
          if (audit.validationStatus !== "authenticated") {
            downgradedCount += 1;
          }
        }
      }
      if (cancelled) {
        return;
      }
      setAuditedTaskIds((current) => [...current, selectedTaskId]);
      if (changed) {
        await loadWorkbench(selectedTaskId);
        if (downgradedCount > 0) {
          setMessage(`系统已自动复核发布账号：${downgradedCount} 个账号因真实会话失效已被降级，请先到账号中心重新登录。`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedTaskId, data, isBridgeReady, auditedTaskIds]);

  const currentTask = useMemo(() => tasks.find((item) => item.id === selectedTaskId), [tasks, selectedTaskId]);
  const preflight = useMemo(() => buildWorkbenchPreflight(data, bridgeAvailability), [data, bridgeAvailability]);
  const primaryDraft = useMemo(() => data?.drafts[0], [data]);
  const primaryDraftEdit = primaryDraft ? draftEdits[primaryDraft.id] : undefined;
  const taskPreviewTitle = primaryDraftEdit?.title?.trim() || primaryDraft?.title?.trim() || data?.content?.title?.trim() || "暂无标题";
  const taskPreviewBody = primaryDraftEdit?.body?.trim() || primaryDraft?.body?.trim() || data?.content?.content?.trim() || "";
  const taskPreviewTags = primaryDraftEdit ? parseTags(primaryDraftEdit.tagsText) : primaryDraft?.tags ?? [];
  const taskPreviewImages = useMemo(() => resolveTaskPreviewImages(data, primaryDraft), [data, primaryDraft]);
  const accountDraftGroups = useMemo(() => groupAccountDraftsByPlatform(data), [data]);

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
          accountIds: draft.accountIds,
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
    if (!isBridgeReady) {
      setMessage(bridgeAvailability.reason ?? "当前未检测到可用桌面桥，请先启动 GEO 桌面版后再创建平台草稿发布任务。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/publish/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedTaskId,
          items: selectedDraftIds.flatMap((draftId) => {
            const accountIds = draftEdits[draftId]?.accountIds ?? [];
            if (accountIds.length > 0) {
              return accountIds.map(accountId => ({ draftId, accountId }));
            }
            return [{ draftId }];
          }),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "创建发布任务失败");
      const createdJobs = payload.jobs as PublishingJobRecord[];
      const jobsWithSession = await Promise.all(
        createdJobs.map(async (job) => {
          const sessionToken = createClientSessionToken();
          return patchJob(job.id, { sessionToken });
        }),
      );
      await loadWorkbench(selectedTaskId);
      await executeSocialJobs(jobsWithSession);
      await loadWorkbench(selectedTaskId);
      setMessage("发布任务已创建。当前会实时展示自动发布阶段和诊断日志。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建发布任务失败");
    } finally {
      setLoading(false);
    }
  }

  async function createAccountDraftJobs() {
    if (!selectedTaskId || selectedAccountDraftIds.length === 0) return;
    if (!isBridgeReady) {
      setMessage(bridgeAvailability.reason ?? "当前未检测到可用桌面桥，请先启动 GEO 桌面版后再按账号变体创建发布任务。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/publish/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selectedTaskId,
          items: selectedAccountDraftIds.map((accountPublishingDraftId) => ({ accountPublishingDraftId })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "创建账号级发布任务失败");
      const createdJobs = payload.jobs as PublishingJobRecord[];
      const jobsWithSession = await Promise.all(
        createdJobs.map(async (job) => {
          if (job.status !== "queued") return job;
          const sessionToken = createClientSessionToken();
          return patchJob(job.id, { sessionToken });
        }),
      );
      await loadWorkbench(selectedTaskId);
      await executeSocialJobs(jobsWithSession);
      await loadWorkbench(selectedTaskId);
      setMessage("账号级发布任务已创建。已接入自动化的平台会进入 Electron 执行流程。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建账号级发布任务失败");
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

  async function pollLiveProgress(jobId: string, sessionToken?: string) {
    if (!sessionToken) {
      return;
    }
    while (true) {
      const progress = await getPlatformPublishProgressWindow({ sessionToken });
      if (!progress) {
        break;
      }
      setLiveProgress((current) => ({ ...current, [jobId]: progress }));
      if (["published", "failed", "pending_review", "verification_failed", "submitted", "verifying"].includes(progress.status)) {
        if (progress.status !== "running") {
          break;
        }
      }
      await sleep(1200);
    }
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

    const accountDraft = job.accountPublishingDraftId
      ? data.accountDrafts?.find((item) => item.id === job.accountPublishingDraftId)
      : undefined;
    const draft = accountDraft
      ? accountDraftToPublishingDraft(accountDraft)
      : data.drafts.find((item) => item.platform === job.platform) ?? {
      id: `${job.taskId}-${job.platform}`,
      taskId: job.taskId,
      platform: job.platform,
      title: job.draftTitle,
      body: job.draftBody,
      tags: job.draftTags,
      coverImageUrl: job.draftImages[0],
      imageUrls: job.draftImages,
      localImagePaths: job.draftImagePaths,
      publishMode: job.publishMode ?? "text_only",
      publishEntryUrl: job.publishEntryUrl,
      updatedAt: new Date().toISOString(),
    };

    await patchJob(job.id, {
      status: "running",
      notes: `Electron 发布已启动，正在执行${platformLabel(job.platform)}自动化脚本。当前阶段和原始日志会实时更新。`,
      executionLog: [`启动 Electron ${platformLabel(job.platform)}发布会话`],
    });
    void pollLiveProgress(job.id, job.sessionToken);

    const result = await publisher.publish({
      account,
      draft,
      job,
      timeoutMs: 180000,
    });
    if (job.sessionToken) {
      const finalProgress = await getPlatformPublishProgressWindow({ sessionToken: job.sessionToken });
      if (finalProgress) {
        setLiveProgress((current) => ({ ...current, [job.id]: finalProgress }));
      }
    }

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
          notes: `平台自动发布成功，并已完成${platformLabel(job.platform)}发布回录。`,
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
          result.status === "verifying"
            ? `平台发布已提交，正在自动进入${platformLabel(job.platform)}列表或详情页核验结果。`
            : result.status === "pending_review"
              ? "平台已接受提交，但仍处于审核中或暂未形成可核验证据，暂不标记为成功。"
              : result.status === "verification_failed"
                ? `已提交发布，但自动核验没有在${platformLabel(job.platform)}列表或详情页找到新内容，不能标记为成功。`
                : "平台发布已提交，但系统尚未拿到足够证据确认已发布。",
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
    if (!isBridgeReady) {
      setMessage(bridgeAvailability.reason ?? "当前未检测到可用桌面桥，请先启动 GEO 桌面版后再重试自动发布。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await executeSocialJob(job);
      await loadWorkbench(selectedTaskId);
      setMessage(`${platformLabel(job.platform)} 已重新执行 Electron 自动发布。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重试发布失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8">
      <div className="grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
        <div className="section-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="page-section-title">任务选择</h2>
              <p className="page-section-desc">选择已生成内容的任务，系统会加载平台草稿、账号级发布稿和发布记录。</p>
            </div>
            {currentTask ? (
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${taskStatusTone(currentTask.status)}`}>{currentTask.status}</span>
            ) : null}
          </div>
          <select
            className="input-base mt-6 w-full"
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
            <div className="mt-5 grid gap-3 rounded-lg border border-stroke bg-surface/50 p-4">
              <div className="subtle-card">
                <p className="text-xs font-medium uppercase tracking-wider text-muted">任务标题</p>
                <p className="mt-2 text-sm font-medium leading-relaxed text-ink">{currentTask.title}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="subtle-card">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">当前状态</p>
                  <p className="mt-2 text-sm font-medium text-ink">{currentTask.status}</p>
                </div>
                <div className="subtle-card">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">更新时间</p>
                  <p className="mt-2 font-mono text-xs text-slate-300">{new Date(currentTask.updatedAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-accent/20 bg-accent/10 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-accent-soft">来源板块</p>
                  <p className="mt-2 text-sm font-semibold text-ink">{providerLabels[data?.task.searchProvider ?? ""] ?? data?.task.searchProvider ?? "未设置"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-accent-soft">板块决定目标发布平台组合。</p>
                </div>
                <div className={`rounded-lg border p-4 ${isBridgeReady ? "border-emerald-500/20 bg-emerald-500/10" : "border-warning/30 bg-warning/10"}`}>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">环境状态</p>
                  <p className={`mt-2 text-sm font-semibold ${isBridgeReady ? "text-emerald-300" : "text-warning"}`}>{bridgeAvailability.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">
                    {bridgeAvailability.mode === "electron_bridge"
                      ? "当前宿主已连接 Electron 注入桥，可直接执行平台自动发布。"
                      : bridgeAvailability.mode === "local_bridge"
                        ? "当前页面运行在浏览器中，但已连接本机 localhost 桌面桥。"
                        : "当前未连接 GEO 桌面版，只能查看草稿和发布记录。"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-dashed border-stroke p-5 text-center text-sm text-muted">
              请选择一个已生成内容或图片的任务进入工作台。
            </div>
          )}
        </div>

        <div className="section-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="page-section-title">发布动作</h2>
              <p className="page-section-desc max-w-2xl">
                平台草稿是当前主编辑与主发布入口；账号级发布稿保留为账号变体参考与独立任务入口。
              </p>
            </div>
            <div className="status-pill">
              图文直粘模式
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <div className={`rounded-lg border p-4 ${isBridgeReady ? "border-emerald-500/20 bg-emerald-500/10" : "border-warning/30 bg-warning/10"}`}>
              <p className="text-xs font-medium uppercase tracking-wider text-muted">环境状态</p>
              <p className={`mt-2 text-sm font-semibold ${isBridgeReady ? "text-emerald-300" : "text-warning"}`}>{bridgeAvailability.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                {bridgeAvailability.mode === "electron_bridge"
                  ? "当前宿主已连接 Electron 注入桥，可以直接执行平台自动发布。"
                  : bridgeAvailability.mode === "local_bridge"
                    ? "当前页面运行在浏览器中，但已连接本机 localhost 桌面桥；创建任务后会由后台运行的 GEO 桌面版执行自动发布。"
                    : "当前未检测到可用桌面桥，只能查看草稿和发布记录；请先启动 GEO 桌面版。"}
              </p>
            </div>
            <div className="rounded-lg border border-accent/20 bg-accent/10 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-accent-soft">本次发布策略</p>
              <p className="mt-2 text-sm font-semibold text-ink">系统将正文与配图均匀混排后直接粘贴到平台编辑器，自动提取封面。</p>
              <p className="mt-2 text-xs leading-relaxed text-accent-soft">
                图片和文本合并为 HTML 后，触发原生的剪贴板粘贴事件，能够更稳定地完成发布。
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-accent-muted/20 p-4 text-xs leading-relaxed text-accent-soft">
            账号中心里的“已登录”只表示可用，不等于当前草稿已经绑定；若平台只有 1 个已登录账号，系统会自动补绑。
          </div>
          {preflight.issues.length ? (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-4 text-xs leading-relaxed text-warning">
              {preflight.issues.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          ) : null}
          {preflight.hints.length ? (
            <div className="mt-4 rounded-lg border border-stroke bg-white/5 p-4 text-xs leading-relaxed text-muted">
              {preflight.hints.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-4">
            <button 
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3.5 text-sm font-bold text-surface shadow-glow transition-all hover:bg-accent-soft disabled:opacity-50 disabled:shadow-none" 
              disabled={loading || !selectedTaskId || !isBridgeReady} 
              onClick={createJobs}
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              创建平台草稿发布任务
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent-muted/30 px-5 py-3.5 text-sm font-bold text-accent-soft transition-all hover:bg-accent hover:text-surface disabled:opacity-50"
              disabled={loading || !selectedTaskId || !isBridgeReady || !selectedAccountDraftIds.length}
              onClick={createAccountDraftJobs}
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              按账号变体创建发布任务
            </button>
            <button 
              className="flex items-center justify-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-5 py-3.5 text-sm font-bold text-danger transition-all hover:bg-danger/20 disabled:opacity-50" 
              disabled={loading || !selectedTaskId} 
              onClick={clearPublishData}
            >
              <Trash2 className="h-4 w-4" />
              清空发布数据
            </button>
          </div>
          {message && (
            <div className="mt-6 rounded-lg border border-stroke-strong bg-white/5 p-4 text-sm text-ink">
              {message}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="section-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="page-section-title">账号级发布稿</h2>
                <p className="page-section-desc">
                  这里展示板块映射后的平台账号稿。每个账号对应一篇独立稿，当前作为账号变体参考区，也可单独创建账号级发布任务。
                </p>
              </div>
              <span className="status-pill text-accent-soft">
                {providerLabels[data?.task.searchProvider ?? ""] ?? data?.task.searchProvider ?? "未设置板块"}
              </span>
            </div>

            {accountDraftGroups.length ? (
              <div className="mt-6 grid gap-5">
                {accountDraftGroups.map(([platform, drafts]) => (
                  <div key={platform} className="rounded-lg border border-stroke bg-surface/50 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display text-base font-bold text-ink">{platformLabel(platform)}</h3>
                        <p className="mt-1 text-xs text-muted">{publishPlatformDescriptors.find((item) => item.key === platform)?.contentProfile}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                        platformAutomationLabel(platform) === "已自动化"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : platformAutomationLabel(platform) === "手动发布"
                            ? "bg-cyan-500/15 text-cyan-300"
                            : "bg-warning/15 text-warning"
                      }`}>
                        {platformAutomationLabel(platform)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4">
                      {drafts.map((draft) => (
                        <div key={draft.id} className="rounded-lg border border-stroke bg-panel/50 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <label className="flex cursor-pointer items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 cursor-pointer rounded border border-stroke bg-panel"
                                  checked={selectedAccountDraftIds.includes(draft.id)}
                                  onChange={(event) =>
                                    setSelectedAccountDraftIds((current) =>
                                      event.target.checked ? [...current, draft.id] : current.filter((item) => item !== draft.id),
                                    )
                                  }
                                />
                                <span>
                                  <span className="block text-xs font-medium uppercase tracking-wider text-muted">发布账号</span>
                                  <span className="mt-1 block text-sm font-semibold text-ink">{draft.accountName ?? draft.accountId}</span>
                                </span>
                              </label>
                            </div>
                            <div className="status-pill">
                              {draft.publishMode === "with_images" ? "图文稿" : "纯文本稿"}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3">
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wider text-muted">独立标题</p>
                              <p className="mt-1 text-sm font-semibold leading-relaxed text-ink">{draft.title}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wider text-muted">正文摘要</p>
                              <p className="mt-1 text-sm leading-6 text-slate-300">{buildBodyPreview(draft.body)}</p>
                            </div>
                            {draft.tags.length ? (
                              <div className="flex flex-wrap gap-2">
                                {draft.tags.map((tag) => (
                                  <span key={`${draft.id}-${tag}`} className="rounded-full bg-accent-muted/20 px-2.5 py-1 text-[11px] font-medium text-accent-soft">
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-lg border border-dashed border-stroke p-6 text-sm leading-relaxed text-muted">
                当前任务还没有可展示的账号级发布稿。请先在账号中心为该板块对应的平台创建账号记录，或完成内容生成后重新进入工作台。
              </div>
            )}
          </div>

          <div className="section-card">
            <div className="mb-5">
              <h2 className="page-section-title">平台草稿</h2>
              <p className="page-section-desc">这里按当前板块映射展示多平台草稿；每个平台一张草稿卡，可独立编辑内容并绑定一个或多个发布账号。</p>
            </div>
            <div className="grid gap-5">
              {(data?.drafts ?? []).map((draft) => {
                const edit = draftEdits[draft.id] ?? { title: draft.title, body: draft.body, tagsText: formatTags(draft.tags), accountIds: draft.accountIds ?? (draft.accountId ? [draft.accountId] : []) };
                const authenticatedAccounts = accountOptions(data?.accounts ?? [], draft.platform);
                const selectedAccounts = authenticatedAccounts.filter((account) => edit.accountIds.includes(account.id));
                const titleMeta = draftTitleMeta(draft.platform, edit.title);
                const invalidAccounts = (data?.accounts ?? []).filter(
                  (account) =>
                    account.platform === draft.platform &&
                    (account.loginStatus === "failed" || account.status === "invalid") &&
                    account.lastError?.trim(),
                );
                return (
                  <div key={draft.id} className="rounded-lg border border-stroke bg-surface/50 p-5 transition-colors hover:border-stroke-strong">
                    <div className="flex items-center justify-between gap-4 mb-6">
                      <label className="flex cursor-pointer items-center gap-3">
                        <div className="relative flex items-center">
                          <input
                            type="checkbox"
                            className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-stroke bg-panel transition-all checked:border-accent checked:bg-accent"
                            checked={selectedDraftIds.includes(draft.id)}
                            onChange={(event) =>
                              setSelectedDraftIds((current) =>
                                event.target.checked ? [...current, draft.id] : current.filter((item) => item !== draft.id),
                              )
                            }
                          />
                          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-surface opacity-0 transition-opacity peer-checked:opacity-100">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        </div>
                        <span className="font-display text-lg font-bold text-ink">{platformLabel(draft.platform)}</span>
                      </label>
                      {draft.publishEntryUrl && (
                        <a className="flex items-center gap-1.5 rounded-lg bg-accent-muted/30 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-surface" href={draft.publishEntryUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                          打开平台入口
                        </a>
                      )}
                    </div>
                    
                    <div className="grid gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted uppercase tracking-wider">标题</label>
                        <input
                          className="input-base w-full font-medium"
                          value={edit.title}
                          onChange={(event) =>
                            setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, title: event.target.value } }))
                          }
                          placeholder="输入极具吸引力的标题..."
                        />
                        {titleMeta ? (
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className={titleMeta.exceeded ? "text-warning" : "text-muted"}>
                              当前 {titleMeta.length}/{TOUTIAO_TITLE_MAX_LENGTH} 字
                            </span>
                            <span className={titleMeta.exceeded ? "text-warning" : "text-muted"}>
                              今日头条标题按 {TOUTIAO_TITLE_MAX_LENGTH} 字硬适配，保存时会自动裁切到上限内。
                            </span>
                          </div>
                        ) : null}
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted uppercase tracking-wider">正文内容</label>
                        <textarea
                          className="input-base w-full min-h-[160px] resize-y leading-relaxed"
                          value={edit.body}
                          onChange={(event) =>
                            setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, body: event.target.value } }))
                          }
                          placeholder="编写正文内容..."
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted uppercase tracking-wider">标签</label>
                        <input
                          className="input-base w-full font-mono text-sm text-accent-soft"
                          value={edit.tagsText}
                          onChange={(event) =>
                            setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, tagsText: event.target.value } }))
                          }
                          placeholder="#标签1 #标签2"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted uppercase tracking-wider">发布账号绑定</label>
                        <div className="grid gap-2 mt-2">
                          {accountOptions(data?.accounts ?? [], draft.platform).length > 0 ? (
                            accountOptions(data?.accounts ?? [], draft.platform).map((account) => (
                              <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-stroke bg-panel/30 px-4 py-3 transition-colors hover:border-stroke-strong">
                                <div className="relative flex items-center">
                                  <input
                                    type="checkbox"
                                    className="peer h-4 w-4 cursor-pointer appearance-none rounded border border-stroke bg-panel transition-all checked:border-accent checked:bg-accent"
                                    checked={edit.accountIds.includes(account.id)}
                                    onChange={(event) => {
                                      const checked = event.target.checked;
                                      setDraftEdits((current) => ({
                                        ...current,
                                        [draft.id]: {
                                          ...edit,
                                          accountIds: checked
                                            ? [...edit.accountIds, account.id]
                                            : edit.accountIds.filter((id) => id !== account.id),
                                        },
                                      }));
                                    }}
                                  />
                                  <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-surface opacity-0 transition-opacity peer-checked:opacity-100">
                                    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                </div>
                                <span className="text-sm font-medium text-ink">{account.displayName ?? account.accountName}</span>
                              </label>
                            ))
                          ) : (
                            <div className="rounded-[12px] border border-dashed border-stroke px-4 py-3 text-sm text-muted">
                              暂无可用账号
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="min-h-[24px]">
                        {authenticatedAccounts.length === 0 ? (
                          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                            <span className="h-1.5 w-1.5 rounded-full bg-warning"></span>
                            {invalidAccounts.length
                              ? "账号记录存在，但真实登录态已失效；请先到账号中心重新登录。"
                              : "当前平台还没有已登录账号，请先到账号中心完成登录。"}
                          </p>
                        ) : null}
                        {authenticatedAccounts.length === 1 && selectedAccounts.length === 1 ? (
                          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                            已自动绑定唯一账号：{selectedAccounts[0].displayName ?? selectedAccounts[0].accountName}
                          </p>
                        ) : null}
                        {authenticatedAccounts.length > 1 && edit.accountIds.length === 0 ? (
                          <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                            <span className="h-1.5 w-1.5 rounded-full bg-warning"></span>
                            有多个已登录账号，请至少勾选一个要发布的账号。
                          </p>
                        ) : null}
                        {invalidAccounts.length > 0 ? (
                          <p className="mt-2 rounded-xl border border-warning/20 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                            已记录账号里至少有 1 个真实会话已失效。即使它曾被强制标记为已登录，系统复核后也不会把它当成可发布账号。
                          </p>
                        ) : null}
                      </div>

                      <button 
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-stroke bg-white/5 px-4 py-3.5 text-sm font-bold text-ink transition-colors hover:bg-white/10 disabled:opacity-50" 
                        onClick={() => saveDraft(draft.id)} 
                        disabled={loading}
                      >
                        <Save className="h-4 w-4" />
                        保存草稿更改
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
            <div className="section-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                <h2 className="page-section-title">发布预览</h2>
                <p className="page-section-desc">这里展示本次会送入平台发布链路的内容摘要。图片与正文会按平台能力组装后提交。</p>
              </div>
              <div className="status-pill text-accent-soft">
                仅预览，不可编辑
              </div>
            </div>
            {data ? (
              <div className="mt-5 space-y-4 rounded-lg border border-stroke bg-surface/50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-panel/60 p-4">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted">关联产品</span>
                    <p className="mt-2 text-sm font-medium text-ink">{data.product.productName}</p>
                  </div>
                  <div className="rounded-lg border border-accent/20 bg-accent/10 p-4">
                    <span className="text-xs font-medium uppercase tracking-wider text-accent-soft">发布模式说明</span>
                    <p className="mt-2 text-sm font-semibold text-ink">图文直粘模式</p>
                    <p className="mt-1 text-xs leading-relaxed text-accent-soft">系统将正文与配图均匀排版，通过原生剪贴板事件直接粘贴至平台编辑器，平台会自动提取封面。</p>
                  </div>
                </div>
                <div className="rounded-lg bg-panel/60 p-4">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">发布标题</span>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-ink">{taskPreviewTitle}</p>
                </div>
                <div className="rounded-lg bg-panel/60 p-4">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">发布正文摘要</span>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{buildBodyPreview(taskPreviewBody)}</p>
                </div>
                <div className="rounded-lg bg-panel/60 p-4">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">发布标签</span>
                  {taskPreviewTags.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {taskPreviewTags.map((tag) => (
                        <span key={tag} className="rounded-full bg-accent-muted/20 px-3 py-1 text-xs font-medium text-accent-soft">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="mt-2 block text-sm text-muted">暂无标签</span>
                  )}
                </div>
                <div className="rounded-lg bg-panel/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-muted uppercase tracking-wider">图片预览</span>
                    <span className="text-[11px] text-accent-soft">图文混排发布</span>
                  </div>
                  {taskPreviewImages.length ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        {taskPreviewImages.slice(0, 4).map((imageUrl, index) => (
                          <a
                            key={`${imageUrl}-${index}`}
                            href={imageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-lg border border-stroke bg-panel/60"
                          >
                            <img src={imageUrl} alt={`${taskPreviewTitle} 配图 ${index + 1}`} className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                          </a>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center justify-between rounded-lg border border-stroke bg-panel/40 px-4 py-3 text-xs text-muted">
                        <span>当前任务已生成图片 {taskPreviewImages.length} 张</span>
                        <a
                          className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent-soft"
                          href={taskPreviewImages[0]}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          查看原图
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-stroke px-4 py-3 text-sm text-muted">
                      <FileImage className="h-4 w-4" />
                      当前任务暂无图片，将按纯文章模式发布。
                    </div>
                  )}
                </div>
                <div className="rounded-lg bg-panel/60 p-4">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">主稿摘要</span>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{data.content?.summary ?? "暂无主稿摘要"}</p>
                </div>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-stroke text-sm text-muted">
                选择任务后即可查看交付素材。
              </div>
            )}
          </div>

          <div className="section-card">
            <h2 className="page-section-title mb-5">发布记录</h2>
            <div className="grid gap-4">
              {(data?.jobs ?? []).length ? (
                data?.jobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-stroke bg-surface/70 p-5 transition-colors hover:border-stroke-strong">
                    {(() => {
                      const progress = liveProgress[job.id];
                      const recentLogLines = progress?.liveExecutionLog?.slice(-6) ?? [];
                      return (
                        <>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-display text-lg font-bold text-ink">{platformLabel(job.platform)}</h4>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                        job.status === "published" ? "bg-emerald-500/20 text-emerald-400" :
                        job.status === "failed" ? "bg-danger/20 text-danger" :
                        "bg-warning/20 text-warning"
                      }`}>
                        {jobStatusLabel(job.status)}
                      </span>
                    </div>

                    <div className="mb-4 rounded-lg border border-stroke bg-panel/40 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted">发布诊断</p>
                          <h5 className="text-sm font-semibold text-ink">
                            {progress ? `当前阶段：${stageLabel(progress.currentStage)}` : `当前阶段：${stageLabel(job.failureStage ?? job.status)}`}
                          </h5>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                          <p>状态：{progress?.status ? jobStatusLabel(progress.status as PublishingJobRecord["status"]) : jobStatusLabel(job.status)}</p>
                          <p>
                            最后更新：
                            {progress?.lastUpdatedAt
                              ? new Date(progress.lastUpdatedAt).toLocaleString()
                              : new Date(job.updatedAt).toLocaleString()}
                          </p>
                        </div>
                      </div>

                      {progress?.stageTimeline?.length ? (
                        <div className="mt-4 grid gap-2">
                          {progress.stageTimeline.slice(-5).map((entry, index) => (
                            <div key={`${job.id}-${entry.stage}-${entry.at}-${index}`} className="rounded-xl border border-white/5 bg-surface/60 px-3 py-2 text-xs text-slate-300">
                              <span className="font-medium text-ink">{entry.label}</span>
                              <span className="mx-2 text-muted">·</span>
                              <span>{entry.message}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {recentLogLines.length ? (
                        <div className="mt-4">
                          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">最近日志</p>
                          <pre className="max-h-28 overflow-y-auto rounded-lg border border-stroke bg-surface p-3 font-mono text-[10px] leading-relaxed text-muted/80 scrollbar-thin">
                            {recentLogLines.join("\n")}
                          </pre>
                        </div>
                      ) : null}

                      {!progress && job.status === "running" ? (
                        <p className="mt-4 rounded-xl border border-warning/20 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                          当前发布任务正在执行，系统正在等待 Electron 回传实时阶段日志。如果长时间停留，请检查桌面窗口或稍后重试。
                        </p>
                      ) : null}
                    </div>

                    <div className="rounded-lg border border-stroke bg-panel/40 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted uppercase tracking-wider">本次发布内容</p>
                          <h5 className="text-sm font-semibold leading-relaxed text-ink">{job.draftTitle}</h5>
                        </div>
                        <div className="status-pill text-accent-soft">
                          图文直粘模式
                        </div>
                      </div>
                      {job.publishedAt ? (
                        <p className="mt-2 text-xs text-slate-400">发布时间：{new Date(job.publishedAt).toLocaleString()}</p>
                      ) : null}
                      <p className="mt-3 text-sm leading-6 text-slate-300">{buildBodyPreview(job.draftBody)}</p>
                      {job.draftTags.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {job.draftTags.map((tag) => (
                            <span key={`${job.id}-${tag}`} className="rounded-full bg-accent-muted/20 px-2.5 py-1 text-[11px] font-medium text-accent-soft">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-stroke px-3 py-3 text-xs text-muted">
                        <FileImage className="h-4 w-4" />
                        系统将正文与配图组装为 HTML 统一粘贴。
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-stroke bg-panel/30 p-4 text-sm">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <p className="flex justify-between gap-3">
                          <span className="text-muted">发布账号</span>
                          <span className="font-medium text-ink">{job.accountName ?? "--"}</span>
                        </p>
                        <p className="flex justify-between gap-3">
                          <span className="text-muted">失败阶段</span>
                          <span className="font-medium text-ink">{job.failureStage ? stageLabel(job.failureStage) : "--"}</span>
                        </p>
                      </div>
                      {(job.publishUrl || job.draftUrl) ? (
                        <p className="mt-2 flex justify-between gap-3">
                          <span className="text-muted">发布结果</span>
                          <a className="text-accent hover:underline" href={job.publishUrl ?? job.draftUrl} target="_blank" rel="noreferrer">查看链接</a>
                        </p>
                      ) : null}
                      {job.verificationUrl ? (
                        <p className="mt-2 flex justify-between gap-3">
                          <span className="text-muted">核验页面</span>
                          <a className="text-accent hover:underline" href={job.verificationUrl} target="_blank" rel="noreferrer">查看链接</a>
                        </p>
                      ) : null}
                      {job.publishEntryUrl ? (
                        <p className="mt-2 flex justify-between gap-3">
                          <span className="text-muted">操作入口</span>
                          <a className="text-accent hover:underline" href={job.publishEntryUrl} target="_blank" rel="noreferrer">查看链接</a>
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-4 space-y-2 border-t border-stroke pt-4">
                      {typeof job.verificationAttempts === "number" ? (
                        <p className="text-xs text-slate-400"><span className="text-muted">核验轮次：</span>{job.verificationAttempts}</p>
                      ) : null}
                      {job.platformItemId ? (
                        <p className="text-xs text-slate-400"><span className="text-muted">平台内容 ID：</span>{job.platformItemId}</p>
                      ) : null}
                      {job.verificationEvidence ? (
                        <p className="text-xs text-emerald-400"><span className="text-muted">核验证据：</span>{job.verificationEvidence}</p>
                      ) : null}
                      {job.externalStatus ? (
                        <p className="text-xs text-slate-400"><span className="text-muted">外部来源：</span>{job.externalStatus}</p>
                      ) : null}
                      {jobDiagnosis(job, data?.accounts ?? []) ? (
                        <p className="rounded-lg bg-warning/10 p-3 text-xs leading-relaxed text-warning">
                          {jobDiagnosis(job, data?.accounts ?? [])}
                        </p>
                      ) : null}
                      <p className="rounded-lg bg-surface p-3 text-xs leading-relaxed text-muted">
                        {job.notes ?? job.errorMessage ?? "暂无附加信息"}
                      </p>
                    </div>

                    {job.executionLog?.length ? (
                      <div className="mt-4">
                        <p className="mb-2 text-xs font-medium text-muted uppercase tracking-wider">执行日志</p>
                        <pre className="max-h-32 overflow-y-auto rounded-lg border border-stroke bg-surface p-3 font-mono text-[10px] leading-relaxed text-muted/80 scrollbar-thin">
                          {job.executionLog.join("\n")}
                        </pre>
                      </div>
                    ) : null}

                    <div className="mt-5 grid gap-3">
                      <button
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-stroke bg-white/5 px-4 py-3 text-sm font-bold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
                        onClick={() => retryJob(job)}
                        disabled={loading || !job.accountId || !isBridgeReady}
                      >
                        <RefreshCcw className="h-4 w-4" />
                        重试自动发布
                      </button>

                      <div className="mt-2 space-y-3 border-t border-stroke pt-4">
                        <p className="text-xs font-medium text-muted uppercase tracking-wider">人工干预</p>
                        <input
                          className="input-base w-full text-sm"
                          value={jobLinks[job.id] ?? ""}
                          onChange={(event) => setJobLinks((current) => ({ ...current, [job.id]: event.target.value }))}
                          placeholder="如已手动发布，可在此粘贴链接..."
                        />
                        <div className="flex gap-3">
                          <button
                            className="flex-1 rounded-lg bg-emerald-500/20 px-4 py-2.5 text-xs font-bold text-emerald-400 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
                            onClick={() => updateJob(job.id, "published")}
                            disabled={loading}
                          >
                            手动补录成功
                          </button>
                          <button
                            className="flex-1 rounded-lg bg-danger/20 px-4 py-2.5 text-xs font-bold text-danger transition-colors hover:bg-danger/30 disabled:opacity-50"
                            onClick={() => updateJob(job.id, "failed")}
                            disabled={loading}
                          >
                            人工标记失败
                          </button>
                        </div>
                      </div>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                ))
              ) : (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-stroke text-sm text-muted">
                  当前任务还没有生成任何发布记录。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
