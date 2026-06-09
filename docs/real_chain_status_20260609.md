# GEO Real Chain Status - 2026-06-09

## Current State

- Desktop package and local Electron bridge can start successfully.
- Text generation is configured for GPT provider with `gpt5.5`.
- Image generation is configured for GPT provider with `gpt-image-2`.
- The runtime image API key can query `/v1/models`, and `gpt-image-2` appears in the returned model list.

## Blocking Issue

Real image generation is not currently available through the configured gateway.

The direct `/v1/images/generations` probe returns HTTP 503 with:

```text
model_not_found
group sora has no available channel for model gpt-image-2
```

This means the model is visible to the key, but the gateway distributor has no usable image-generation channel for the key's group.

## Impact

- Existing generated image records for the current real-chain task are `prompt-url` fallback assets.
- Those fallback assets are not valid proof of real image generation.
- Real publishing should remain blocked until non-fallback image assets are generated and verified.

## Required Next Action

Enable a working `gpt-image-2` image-generation channel for the configured key/group in the gateway, or provide another real image model/key/base URL that can successfully return image data from `/v1/images/generations`.

After that, rerun:

```bash
npm run check
npm test
npm run build:web
npm run scan:mojibake
```

Then regenerate images, verify the image record has a non-`prompt-url` provider, and only then continue to real account publishing.
