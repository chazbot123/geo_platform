/**
 * Offline verification script for endpoint candidate generation and provider routing.
 * Run with: npx tsx scripts/verify-model-endpoints.ts
 * No live API calls are made.
 */

import {
  getOpenAICompatibleProviderProfile,
  normalizeOpenAICompatibleProviderName,
  resolveArkEndpoint,
  resolveConfiguredOpenAICompatibleEndpoint,
  resolveSkyEndpoint,
  resolveOpenAICompatibleEndpoint,
  isNewApiAutoProvider,
  isVolcengineArkProvider,
} from "../src/lib/integrations/openai-compatible.js";

// ---- helpers ----

function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`  FAIL  ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS  ${label}`);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

// ---- 1. Provider name normalization ----

section("Provider name normalization");
assert(normalizeOpenAICompatibleProviderName("sky") === "newapi-auto", "sky -> newapi-auto");
assert(normalizeOpenAICompatibleProviderName("Sky") === "newapi-auto", "Sky (caps) -> newapi-auto");
assert(normalizeOpenAICompatibleProviderName("ark") === "volcengine-ark", "ark -> volcengine-ark");
assert(normalizeOpenAICompatibleProviderName("doubao") === "volcengine-ark", "doubao -> volcengine-ark");
assert(normalizeOpenAICompatibleProviderName("doubao-ark") === "volcengine-ark", "doubao-ark -> volcengine-ark");
assert(normalizeOpenAICompatibleProviderName("volcengine") === "volcengine-ark", "volcengine -> volcengine-ark");
assert(normalizeOpenAICompatibleProviderName("deepseek") === "deepseek", "deepseek unchanged");
assert(normalizeOpenAICompatibleProviderName("openai") === "openai", "openai unchanged");

// ---- 2. Provider profile lookup ----

section("Provider profile endpointMode");
assert(getOpenAICompatibleProviderProfile("newapi-auto").endpointMode === "newapi-probe", "newapi-auto -> newapi-probe");
assert(getOpenAICompatibleProviderProfile("volcengine-ark").endpointMode === "ark-chat", "volcengine-ark -> ark-chat");
assert(getOpenAICompatibleProviderProfile("doubao").endpointMode === "ark-chat", "doubao -> ark-chat via normalize");
assert(getOpenAICompatibleProviderProfile("deepseek").endpointMode === "openai-v1", "deepseek -> openai-v1");
assert(getOpenAICompatibleProviderProfile("openai").endpointMode === "openai-v1", "openai -> openai-v1");
assert(getOpenAICompatibleProviderProfile("some-custom").endpointMode === "generic-chat", "custom -> generic-chat");

// ---- 3. isNewApiAutoProvider / isVolcengineArkProvider ----

section("Provider predicate helpers");
assert(isNewApiAutoProvider("newapi-auto"), "newapi-auto is newapi");
assert(isNewApiAutoProvider("sky"), "sky is newapi via normalize");
assert(!isNewApiAutoProvider("doubao"), "doubao is NOT newapi");
assert(isVolcengineArkProvider("doubao"), "doubao is ark");
assert(isVolcengineArkProvider("volcengine-ark"), "volcengine-ark is ark");
assert(!isVolcengineArkProvider("deepseek"), "deepseek is NOT ark");

// ---- 4. resolveArkEndpoint ----

section("resolveArkEndpoint");
assert(
  resolveArkEndpoint("https://ark.cn-beijing.volces.com") === "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "root domain -> /api/v3/chat/completions",
);
assert(
  resolveArkEndpoint("https://ark.cn-beijing.volces.com/api/v3") === "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "/api/v3 -> /api/v3/chat/completions",
);
assert(
  resolveArkEndpoint("https://ark.cn-beijing.volces.com/api/v3/chat/completions") ===
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "full path returned unchanged",
);
assert(
  resolveArkEndpoint("https://ark.cn-beijing.volces.com/v1") === "https://ark.cn-beijing.volces.com/v1/chat/completions",
  "/v1 -> /v1/chat/completions",
);

// ---- 5. resolveSkyEndpoint (OpenAI / DeepSeek path) ----

section("resolveSkyEndpoint");
assert(
  resolveSkyEndpoint("https://api.deepseek.com") === "https://api.deepseek.com/v1/chat/completions",
  "deepseek root -> /v1/chat/completions",
);
assert(
  resolveSkyEndpoint("https://api.openai.com/v1") === "https://api.openai.com/v1/chat/completions",
  "/v1 -> /v1/chat/completions",
);

// ---- 6. resolveOpenAICompatibleEndpoint (generic) ----

section("resolveOpenAICompatibleEndpoint");
assert(
  resolveOpenAICompatibleEndpoint("https://my-api.example.com") === "https://my-api.example.com/chat/completions",
  "root -> /chat/completions",
);
assert(
  resolveOpenAICompatibleEndpoint("https://my-api.example.com/v2") === "https://my-api.example.com/v2/chat/completions",
  "/v2 -> /v2/chat/completions",
);

// ---- 7. resolveConfiguredOpenAICompatibleEndpoint dispatches correctly ----

section("resolveConfiguredOpenAICompatibleEndpoint dispatch");
assert(
  resolveConfiguredOpenAICompatibleEndpoint("volcengine-ark", "https://ark.cn-beijing.volces.com") ===
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "ark provider -> ark endpoint",
);
assert(
  resolveConfiguredOpenAICompatibleEndpoint("doubao", "https://ark.cn-beijing.volces.com/api/v3") ===
    "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  "doubao alias -> ark endpoint",
);
assert(
  resolveConfiguredOpenAICompatibleEndpoint("deepseek", "https://api.deepseek.com") ===
    "https://api.deepseek.com/v1/chat/completions",
  "deepseek -> openai-v1 endpoint",
);
assert(
  resolveConfiguredOpenAICompatibleEndpoint("newapi-auto", "https://my-newapi.example.com/v1/chat/completions").includes(
    "my-newapi.example.com",
  ),
  "newapi-auto stores sanitized base (no appended path)",
);

// ---- done ----

console.log("\nVerification complete.");
