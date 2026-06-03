/**
 * WeChat official account material/draft/publish service.
 *
 * This module contains ONLY the HTTP contract layer.
 * - No credentials are stored or logged here.
 * - All calls require the caller to supply a valid access_token.
 * - Tokens are passed in-memory and never written to disk or logged.
 *
 * Eligibility prerequisites (enforced at the platform layer, not here):
 *   - Verified service account (订阅号 or 服务号, 认证后) with material + draft + publish scope.
 *   - access_token obtained via the caller's auth flow (credential-holder responsibility).
 *
 * WeChat API reference:
 *   Material upload:  POST https://api.weixin.qq.com/cgi-bin/material/add_material
 *   Add draft:        POST https://api.weixin.qq.com/cgi-bin/draft/add
 *   Submit publish:   POST https://api.weixin.qq.com/cgi-bin/freepublish/submit
 *   Poll status:      POST https://api.weixin.qq.com/cgi-bin/freepublish/get
 */

export class WeChatMissingTokenError extends Error {
  constructor() {
    super("WECHAT_MISSING_ACCESS_TOKEN");
    this.name = "WeChatMissingTokenError";
  }
}

export class WeChatMaterialError extends Error {
  code: number;
  constructor(code: number, detail: string) {
    super(`WECHAT_MATERIAL_ERROR:${code}:${detail}`);
    this.name = "WeChatMaterialError";
    this.code = code;
  }
}

export class WeChatDraftError extends Error {
  code: number;
  constructor(code: number, detail: string) {
    super(`WECHAT_DRAFT_ERROR:${code}:${detail}`);
    this.name = "WeChatDraftError";
    this.code = code;
  }
}

export class WeChatPublishSubmitError extends Error {
  code: number;
  constructor(code: number, detail: string) {
    super(`WECHAT_PUBLISH_SUBMIT_ERROR:${code}:${detail}`);
    this.name = "WeChatPublishSubmitError";
    this.code = code;
  }
}

export class WeChatPublishPollError extends Error {
  code: number;
  constructor(code: number, detail: string) {
    super(`WECHAT_PUBLISH_POLL_ERROR:${code}:${detail}`);
    this.name = "WeChatPublishPollError";
    this.code = code;
  }
}

export interface WeChatArticleInput {
  title: string;
  /** Full HTML/text body; WeChat renders it in the reader view. */
  content: string;
  /** Author display name (optional). */
  author?: string;
  /** media_id of the uploaded cover image. Required for most service accounts. */
  thumbMediaId: string;
  /** Whether to show the cover image in the article body. */
  showCoverPic?: 0 | 1;
  contentSourceUrl?: string;
  digest?: string;
  needOpenComment?: 0 | 1;
  onlyFansCanComment?: 0 | 1;
}

export type WeChatPublishStatus = "publishing" | "success" | "failed";

export interface WeChatPublishPollResult {
  publishId: string;
  status: WeChatPublishStatus;
  /** Populated when status is "success". */
  publishUrl?: string;
  /** Populated when status is "failed". */
  failReason?: string;
  /** Raw errcode from WeChat if status is "failed" or an API error occurred. */
  errcode?: number;
}

interface WeChatApiErrorBody {
  errcode?: number;
  errmsg?: string;
}


/**
 * Uploads a permanent image material and returns its media_id.
 * imageBuffer should be the raw bytes of a JPEG/PNG file.
 * fileName must end with the correct extension (.jpg, .png).
 *
 * Caller MUST supply a valid access_token. No token is stored here.
 */
export async function uploadImageMaterial(
  accessToken: string,
  imageBuffer: ArrayBuffer,
  fileName: string,
): Promise<string> {
  if (!accessToken) throw new WeChatMissingTokenError();

  const form = new FormData();
  const blob = new Blob([imageBuffer], { type: fileName.endsWith(".png") ? "image/png" : "image/jpeg" });
  form.append("media", blob, fileName);

  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=image`;
  const response = await fetch(url, { method: "POST", body: form });

  if (!response.ok) {
    throw new WeChatMaterialError(response.status, `HTTP_${response.status}`);
  }

  const data = (await response.json()) as { media_id?: string; errcode?: number; errmsg?: string };
  if (data.errcode && data.errcode !== 0) {
    throw new WeChatMaterialError(data.errcode, data.errmsg ?? "unknown");
  }
  if (!data.media_id) {
    throw new WeChatMaterialError(-1, "missing_media_id");
  }
  return data.media_id;
}

/**
 * Adds one article as a draft and returns its media_id.
 *
 * Caller MUST supply a valid access_token. No token is stored here.
 */
export async function addDraft(
  accessToken: string,
  article: WeChatArticleInput,
): Promise<string> {
  if (!accessToken) throw new WeChatMissingTokenError();
  if (!article.title?.trim()) throw new WeChatDraftError(-1, "missing_title");
  if (!article.content?.trim()) throw new WeChatDraftError(-1, "missing_content");
  if (!article.thumbMediaId?.trim()) throw new WeChatDraftError(-1, "missing_thumb_media_id");

  const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`;
  const payload = {
    articles: [
      {
        title: article.title.trim(),
        content: article.content.trim(),
        author: article.author?.trim() ?? "",
        thumb_media_id: article.thumbMediaId,
        show_cover_pic: article.showCoverPic ?? 1,
        content_source_url: article.contentSourceUrl ?? "",
        digest: article.digest ?? "",
        need_open_comment: article.needOpenComment ?? 0,
        only_fans_can_comment: article.onlyFansCanComment ?? 0,
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new WeChatDraftError(response.status, `HTTP_${response.status}`);
  }

  const data = (await response.json()) as { media_id?: string; errcode?: number; errmsg?: string };
  if (data.errcode && data.errcode !== 0) {
    throw new WeChatDraftError(data.errcode, data.errmsg ?? "unknown");
  }
  if (!data.media_id) {
    throw new WeChatDraftError(-1, "missing_media_id");
  }
  return data.media_id;
}

/**
 * Submits a draft for publish and returns the publish_id for polling.
 *
 * Caller MUST supply a valid access_token. No token is stored here.
 */
export async function submitPublish(
  accessToken: string,
  mediaId: string,
): Promise<string> {
  if (!accessToken) throw new WeChatMissingTokenError();

  const url = `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });

  if (!response.ok) {
    throw new WeChatPublishSubmitError(response.status, `HTTP_${response.status}`);
  }

  const data = (await response.json()) as { publish_id?: string; errcode?: number; errmsg?: string };
  if (data.errcode && data.errcode !== 0) {
    throw new WeChatPublishSubmitError(data.errcode, data.errmsg ?? "unknown");
  }
  if (!data.publish_id) {
    throw new WeChatPublishSubmitError(-1, "missing_publish_id");
  }
  return data.publish_id;
}

/**
 * Polls publish status for a given publish_id.
 *
 * Caller MUST supply a valid access_token. No token is stored here.
 */
export async function pollPublishStatus(
  accessToken: string,
  publishId: string,
): Promise<WeChatPublishPollResult> {
  if (!accessToken) throw new WeChatMissingTokenError();

  const url = `https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publish_id: publishId }),
  });

  if (!response.ok) {
    throw new WeChatPublishPollError(response.status, `HTTP_${response.status}`);
  }

  const data = (await response.json()) as {
    publish_id?: string;
    publish_status?: number;
    article_id?: string;
    fail_idx?: number[];
    errcode?: number;
    errmsg?: string;
  };

  if (data.errcode && data.errcode !== 0) {
    throw new WeChatPublishPollError(data.errcode, data.errmsg ?? "unknown");
  }

  // WeChat publish_status: 0=publishing, 1=success, 2=failed (primary article), 3=failed (other)
  const status = data.publish_status === 1 ? "success" : data.publish_status === 0 ? "publishing" : "failed";
  return {
    publishId,
    status,
    publishUrl: status === "success" && data.article_id
      ? `https://mp.weixin.qq.com/s/${data.article_id}`
      : undefined,
    failReason: status === "failed" ? `publish_status_code:${String(data.publish_status)}` : undefined,
    errcode: data.errcode,
  };
}
