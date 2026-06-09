"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";
import {
  createFeedbackPayload,
  FEEDBACK_ISSUE_TYPES,
  submitFeedback,
  type FeedbackIssueType,
} from "@/lib/feedback/client";

export function FeedbackBox() {
  const [type, setType] = useState<FeedbackIssueType>(FEEDBACK_ISSUE_TYPES[0]);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function handleSubmit() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      setNotice({ tone: "error", text: "请填写具体问题后再提交。" });
      return;
    }

    setSubmitting(true);
    setNotice(null);

    try {
      await submitFeedback(createFeedbackPayload({ type, message: trimmedMessage, contact }));
      setMessage("");
      setContact("");
      setNotice({ tone: "success", text: "已提交，感谢反馈。" });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "提交失败，请稍后重试。",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-stroke bg-panel/70 p-5 shadow-panel">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-bold text-ink">意见反馈</h3>
        <p className="text-sm leading-6 text-muted">提交后会发送到服务端后台，便于统一查看和处理。</p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
        <label className="block">
          <span className="label-base">问题类型</span>
          <select className="input-base" value={type} onChange={(event) => setType(event.target.value as FeedbackIssueType)}>
            {FEEDBACK_ISSUE_TYPES.map((issueType) => (
              <option key={issueType} value={issueType}>
                {issueType}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label-base">联系方式（选填）</span>
          <input
            className="input-base"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="手机号、邮箱或微信"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="label-base">具体问题</span>
        <textarea
          className="input-base min-h-32 resize-y"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="请描述发生的问题、相关页面和复现方式。"
        />
      </label>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-surface transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleSubmit}
          disabled={submitting}
          type="button"
        >
          {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? "提交中..." : "提交反馈"}
        </button>
        {notice ? (
          <p className={`text-sm ${notice.tone === "success" ? "text-emerald-400" : "text-danger"}`}>{notice.text}</p>
        ) : null}
      </div>
    </section>
  );
}
