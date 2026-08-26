<p align="center">
  <img src="./assets/dsh-open-eyes.png" width="240" alt="dsh-open-eyes">
</p>

<h1 align="center">dsh-open-eyes</h1>

<p align="center"><strong>Let the multimodal model you choose become DeepSeek's eyes.</strong></p>

<p align="center">English · <a href="./README.zh-CN.md">中文</a></p>

`dsh-open-eyes` adds configurable vision to DeepSeek Harness. Attach a screenshot, photo, chart, or interface to a conversation, and the main model can delegate the visual work to a multimodal model of your choice. The analysis returns as text in the same conversation, so the main model itself does not need native image support.

Open Eyes supports OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages endpoints. It is provider-neutral: you choose the API endpoint, model, and credentials.

> **Unofficial community plugin:** `dsh-open-eyes` is an independent community project. It is not affiliated with, endorsed by, or maintained by DeepSeek.

## Install

Requirements: DeepSeek Harness `0.1.1-rc.2` and Node.js `>=22.19.0`.

```sh
dsh plugin --profile web add dsh-open-eyes@0.1.1-rc.2
```

Restart DSH Web after installation, then reload the page. DSH profiles are independent, so install the plugin separately in every profile where you want to use it.

## Find Open Eyes in Settings

Open **Settings → Plugins → Plugin configuration** and expand **Open Eyes**. The card is named **Open Eyes** in English and **开放视觉** in Chinese, following the DSH interface language.

<p align="center">
  <img src="./assets/screenshots/open-eyes-settings.png" width="860" alt="Open Eyes card in Settings, Plugins, Plugin configuration">
</p>

## Configure your vision model

Open Eyes lets you create multiple vision schemes and switch the active default at any time. Each scheme has an optional display name, API endpoint, model, and API Key. The editor accepts either a service base URL or the complete endpoint for the selected protocol.

Three protocols are available:

- `openai-responses`
- `openai-chat-completions`
- `anthropic-messages`

You can enter a model manually or use **Fetch models** to read the service's model list. Because a model catalog does not reliably declare image capability, confirm that the model you select is multimodal. **Validate connection** sends one tiny test image through the real configured model, while **Save and validate** checks a new or edited scheme immediately.

<p align="center">
  <img src="./assets/screenshots/provider-configuration.png" width="600" alt="Open Eyes vision provider scheme editor">
</p>

The compact scheme list shows only the display name and model. Use the radio button on the left to select the default scheme. Editing opens directly below the matching scheme, and the same button collapses it again. Validation results appear without expanding or reshaping the scheme row.

API Keys are written only through DSH Credentials. They are never stored in plugin Settings or `cordis.patch.yml`. Leave the API Key blank while editing to keep the existing key. Deleting a scheme does not automatically delete its saved credential.

## Choose when Open Eyes is active

The **Enable** switch applies to new conversations:

- A conversation created while Open Eyes is enabled bridges every Web image through the configured vision workflow.
- A conversation created while it is disabled leaves image handling entirely to DSH.
- Existing conversations keep the state they had when they were created, even if the switch changes later.

Changing the default vision scheme does not require a new conversation. The next visual analysis in the same conversation uses the newly selected scheme.

## Personalize the visual analysis

The conversation model creates a task-specific `vision_analyze` prompt from your question—for example, to transcribe an error, inspect a layout, read a chart, or compare two screenshots. The optional **Preference** panel gives you another layer of control:

- **Visual analysis:** Default, Efficiency first, or In-depth analysis.
- **Focus areas:** Text and OCR, Tables and charts, Interface and layout, Objects and scenes, and Anomalies and details.
- **Custom supplement:** up to 50 words or text units of your own guidance.

<p align="center">
  <img src="./assets/screenshots/visual-preferences.png" width="660" alt="Open Eyes visual analysis preferences">
</p>

Preferences are applied internally after the visible Tool Call and immediately before the request is sent to the vision model. This is why the extra preference text does not appear in the Tool Call arguments. It does not modify the main model's system prompt, conversation history, tool declaration, or Harness loop. Leaving every option at **Default** adds nothing and preserves the original task prompt exactly.

Preference changes apply to the next visual analysis, including inside an existing conversation.

## Use it

Paste, drop, or select an image in DSH Web, ask the question you actually want answered, and send it normally. Open Eyes keeps the user's text in the same conversation, provides a session-bound attachment to the vision tool, and returns the visual model's analysis for the main model to use.

In the example below, the non-multimodal main model **GLM-5.3 (High effort)** receives an image question, calls `vision_analyze`, delegates the image to **GPT-5.6-Luna**, and uses the returned visual evidence in its answer.

<p align="center">
  <img src="./assets/screenshots/vision-delegation-example.png" width="560" alt="GLM-5.3 delegates an attached image to GPT-5.6-Luna through Open Eyes">
</p>

The same tool can analyze image files already available to an Agent:

```text
Call vision_analyze on screenshots/error.png. Transcribe the exact error code
and describe the actions visibly available in the interface.
```

Local PNG, JPEG, WebP, and GIF files are supported. Relative paths resolve from the current Agent session working directory. Remote image URLs are disabled by default and can be enabled through advanced configuration when needed.

## How it works

1. You attach an image and ask a normal question.
2. The conversation model turns that question into a focused visual task.
3. Open Eyes applies any saved preferences and sends the image to the selected multimodal provider.
4. The visual analysis returns as untrusted evidence for the conversation model to interpret and answer.

The default vision scheme and visual preferences are resolved for every analysis, so both can change live without rebuilding the conversation. The Enable state is deliberately fixed when a conversation is created so repeatedly toggling it cannot change that conversation's model-visible prompt or tool catalog.

## Advanced and headless configuration

The Settings card covers the fields most people need. Advanced request limits, retries, custom headers, authentication overrides, remote URLs, and filesystem policies remain available in `cordis.patch.yml` and are preserved when a scheme is edited in Settings.

<details>
<summary>Minimal advanced configuration example</summary>

```yaml
- id: vision-bridge
  config:
    enabled: true
    visualAnalysis: default
    focusAreas: []
    preference: ''
    providers:
      - id: my-vision
        protocol: openai-chat-completions
        baseUrl: https://api.example.com/v1
        model: your-vision-model
        credential: VISION_PROVIDER_API_KEY
        maxOutputTokens: 2048
        chatMaxTokensField: max_completion_tokens
    defaultProvider: my-vision
```

Store `VISION_PROVIDER_API_KEY` in the Credential source used by DSH. Keep only the reference name in configuration.

For a headless profile, replace `web` in the installation and inspection commands with the intended profile name. The `vision_analyze` tool and bundled `vision-bridge` Skill remain available without the Web Settings card.

</details>

## Privacy and safety

- Images processed through Open Eyes are sent to the third-party provider you configure. Review that provider's privacy, retention, and billing terms.
- Credentials are resolved through DSH Credential References for each request. API Key literals are not accepted in tool arguments or browser plugin requests.
- Local files stay inside the Agent workspace and explicitly allowed roots by default. Supported image bytes are validated before upload.
- Remote image URLs are disabled by default. When enabled, the configured provider fetches the URL; Open Eyes does not download it first.
- Visual model output is treated as untrusted evidence, not as instructions to execute.

## Reliability and compatibility

- Designed and tested for DeepSeek Harness `0.1.1-rc.2`.
- Compatible with `dsh-open-file@0.1.1-rc.2` in either installation order.
- Text-only submissions and disabled conversations stay on the original DSH submission path.
- Submission outcomes, cancellation, errors, and draft images are preserved through the Web wrapper.
- Model discovery, validation, and visual inference recover from bounded transient network, timeout, response-body, rate-limit, and gateway failures. The default is a five-minute deadline per attempt with up to two retries.

Authentication, request, protocol, and user-cancellation failures are not retried. In the rare case where a provider accepted a request just before the connection failed, a recovery retry may create duplicate provider usage or billing.

## Troubleshooting

- **Open Eyes is not visible:** confirm the package was installed in the same profile that is running, restart DSH Web, and reload the page.
- **A new conversation uses the wrong route:** check the Enable switch, then create another conversation; existing conversations keep their creation-time state.
- **Validation cannot connect:** verify the protocol, endpoint suffix, model name, API Key, DNS, port, TLS, account quota, and service status. The validation message distinguishes these categories where possible.
- **Model discovery returns no models:** continue with manual model entry and confirm the model supports images.
- **`VISION_NOT_CONFIGURED`:** add at least one scheme and select a valid default.

Inspect the active profile with:

```sh
dsh --profile web --dump-config
```

## Uninstall

```sh
dsh plugin --profile web remove dsh-open-eyes
```

Restart DSH Web and reload the page afterward. If you added `vision-bridge` or `vision-bridge-skill` rows manually, remove only those rows and preserve unrelated profile configuration.

## Development

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
npm pack --dry-run
pnpm run test:e2e
```

The test suite does not require a paid vision API. The packed-profile test installs, starts, and removes the real tarball in a temporary DSH profile and also exercises coexistence with `dsh-open-file` in both installation orders.

## License

Released under the [MIT License](./LICENSE). Security issues should be reported privately according to the [security policy](https://github.com/Hyp6666/dsh-open-eyes/blob/main/SECURITY.md).
