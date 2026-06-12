# [OPEN] license-activation-failed

## 用户现象
- 已填写授权码，但页面仍显示未激活/不可用。

## 预期结果
- 输入有效授权码后，设备授权状态应更新为已激活，并允许继续使用受授权保护的功能。

## 当前环境
- Windows
- 项目目录：`E:\GEO-2026年6月10日\geo_platform`

## 初始假设
- 假设 1：前端提交了授权码，但激活接口返回失败或返回体字段不符合页面预期。
- 假设 2：激活接口成功写入了授权信息，但读取授权状态的接口/页面缓存没有刷新。
- 假设 3：授权码被后台判定为无效、已绑定其他设备或设备指纹不匹配。
- 假设 4：授权成功后本地持久化失败，导致刷新页面后仍显示未激活。
- 假设 5：前端实际发送的授权码与页面显示的不一致，或提交时被裁剪/格式化错误。

## 调试计划
- 先查看授权页面与接口链路。
- 只加埋点，不改业务逻辑。
- 复现一次授权流程，收集请求、返回值和本地落盘证据。
- 基于证据再决定修复。

## 证据与结论
- 运行日志显示前端已成功发起 `/api/license/activate`，并进入本地 Next 路由。
- 本地 `/api/license/activate` 和 `/api/license/status` 均在转发上游时抛出 `fetch failed`。
- 直接访问 `http://127.0.0.1:8080/api/licenses/...` 失败，证明本机没有可用的本地授权服务。
- 直接访问 `https://geoadmin.jizhidaoai.com/health` 与 `https://geoadmin.jizhidaoai.com/api/licenses/status?deviceFingerprint=test` 均返回 `200`，证明正式授权服务可达。

## 假设验证
- 假设 1：部分成立。前端请求成功发出，但失败点不在返回格式，而在服务端上游不可达。
- 假设 2：否。激活根本未成功，不是状态刷新问题。
- 假设 3：否。尚未到达授权码校验阶段。
- 假设 4：否。尚未进入本地持久化阶段。
- 假设 5：否。日志中的授权码尾段与页面输入一致。

## 已实施修复
- 修改 `src/lib/license/server-endpoints.ts`
- 当未配置 `GEO_LICENSE_ACTIVATION_ENDPOINT` / `GEO_LICENSE_STATUS_ENDPOINT`，且也未显式配置本地 admin host/base url 时，默认回退到 `https://geoadmin.jizhidaoai.com/api/licenses/...`
- 仍保留通过环境变量覆盖到本地服务的能力
