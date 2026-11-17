<img src="assets/icon.svg" width="48" height="48" alt="">

# VibeStyle

A minimal Firefox-first website customizer, with a Chrome build. Connect an AI provider, select a model, and describe how you want a website to look or behave. One combined CSS/JavaScript customization is saved per exact hostname and reapplied on future visits.

## Install in Firefox

Requires Firefox 142 or newer. No Node.js or Mozilla developer account is needed to install a release.

1. Download **[vibestyle-0.1.1.xpi](https://github.com/joan-code6/vibestyle-extension/releases/download/v0.1.1/vibestyle-0.1.1.xpi)** from the [latest release](https://github.com/joan-code6/vibestyle-extension/releases/latest). Choose the `.xpi` installer, not the source ZIP.
2. In Firefox, open `about:addons` (or press **Ctrl+Shift+A**).
3. Click the **gear menu** → **Install Add-on From File…**, select the downloaded `.xpi`, and accept Firefox's installation prompt.
4. Click the extensions puzzle icon in the toolbar, then **VibeStyle**, to open its sidebar. Choose your AI provider, enter your provider API key, and select a model.

The release installer is signed by Mozilla and stays installed across browser and computer restarts. It is self-distributed through GitHub rather than a public Mozilla store listing. Future updates currently require installing a newer signed `.xpi` from Releases.

If you previously loaded VibeStyle through `about:debugging`, that was a temporary development installation. Close and reopen Firefox to clear that temporary installation, then install the signed release above. You may need to set up your provider and site changes again if Firefox removed the temporary add-on's data.

## Build locally

Requires Node.js 22.12+ (or Node.js 24+) for development, Firefox 142+, or Chrome 138+.

```sh
npm ci
npm run build
```

**Firefox — permanent installation:** Install a Mozilla-signed `.xpi` through `about:addons` → gear menu → **Install Add-on From File…**, then accept Firefox’s installation prompt. It stays installed when Firefox restarts. Click VibeStyle in the toolbar to open its sidebar.

To create your own installer, use the release steps below. An unsigned ZIP or renamed `.xpi` cannot be installed permanently in standard Firefox.

**Firefox — development only:** Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `dist/firefox/manifest.json`. Firefox removes this temporary installation when it closes.

**Chrome:** Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/chrome`. Pin VibeStyle and click its toolbar button. For JavaScript changes, open VibeStyle’s extension **Details** and enable **Allow User Scripts**; CSS works without that toggle.

Builds are in `dist/firefox` and `dist/chrome`. Content-addressed ZIP packages are written to `artifacts/vibestyle-<version>-<browser>-<hash>.zip`; the build prints their exact paths. Rebuilding a matching package reuses it.

## Sign a permanent Firefox installer

Signing is only needed when publishing a new build. Users installing the signed release above do not need signing credentials.

For signing without API credentials, run `npm run prepare:firefox`, then use the [Mozilla Developer Hub](https://addons.mozilla.org/developers/addon/submit/). Choose **On your own**, upload the Firefox ZIP and the corresponding source ZIP printed by the command, and complete submission. For an existing add-on, upload a new version from its management page instead of creating a duplicate add-on. After approval, download the signed `.xpi` and attach it to a GitHub release without modifying its contents.

For automated signing:

Get a Mozilla Add-ons account and generate your [API credentials](https://addons.mozilla.org/developers/addon/api/key/). Set `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret) in your local environment; keep them out of source files and chat messages.

```sh
npm ci
npm run prepare:firefox
# With both signing environment variables set:
npm run release:firefox
```

`prepare:firefox` builds and lints the extension and creates a source archive for Mozilla review without submitting anything. `release:firefox` repeats those checks, submits the extension and source to Mozilla using the **unlisted** channel, and downloads the signed installer into `artifacts/signed/`. It does not create a public store listing. Mozilla may require review before returning a signed file. See [Mozilla’s signing reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign).

Install the returned `.xpi` through `about:addons` as described above. Keep the existing `vibestyle@extension.local` add-on ID when releasing updates, and increase `package.json`’s version before submitting a new version to Mozilla. Temporary development installations may lose their settings when removed; you may need to configure the signed installation again.

Source rebuild for reviewers: Node.js 22.12+ or 24+, `npm ci`, then `npm run build:firefox`. Output is `dist/firefox`. The source archive includes the lockfile, source, assets, tests, and build scripts; it excludes local credentials, dependencies, and browser profiles.

## Use

Requests include an initial visible-page screenshot. CSS changes are previewed, screenshotted, and reviewed by the AI up to three times before saving. Keep the website active during the checks and choose an image-capable model. Screenshots include visible page content, including forms; the DOM snapshot filtering does not redact images. JavaScript changes retain the explicit installation step and currently skip the automatic visual review loop.

1. Choose **OpenRouter** or **Hack Club**, enter your own API key, and continue.
2. Search/select a model from the provider’s current catalog, then **Save & start**.
3. Open a normal website, describe a change in the sidebar, and send it. Allow access to that site when your browser asks.
4. CSS changes apply and save immediately. Generated JavaScript appears behind **Install site script**; installation saves it and reloads the site’s open tabs. The script is viewable before installation.
5. Use the site switch to disable/enable all of its changes, or **Delete** to remove them. Further chat requests update the combined customization.

Scope is an exact hostname: `www.example.com` and `example.com` are separate sites; paths, ports, and HTTP/HTTPS share the hostname’s customization. Subdomains are separate. Changing or deleting active JavaScript reloads that site’s tabs to fully remove listeners and DOM changes. An uninstalled pending script does not replace the current customization.

Hack Club requires an eligible account and [prohibits coding agents](https://docs.ai.hackclub.com/guide/rules.html); this use may be rejected by its service. The integration uses its documented endpoint without evading restrictions. OpenRouter charges against your own account. Codex/ChatGPT subscription login is not included in this version.

## Data and execution

- API keys, selected model, conversation, pending scripts, and saved customizations live in `storage.local`, not browser sync. No extension backend or analytics.
- Only submitting a prompt sends page context, the request, and the existing site customization to the chosen provider. Setup fetches the model catalog. Saved code runs locally without model requests on later visits.
- The snapshot is bounded and contains selectors, short text samples, and selected computed styles. Forms, inputs, editable content, scripts, iframes, and explicitly private elements are excluded. URL queries/fragments are omitted. Page text/title/path may still contain private information; review the page before submitting a request.
- CSS is parsed before saving; imports and external resource URLs are rejected. JavaScript syntax is checked and runs through `userScripts` in a separate user-script world, with network connections blocked by that world’s CSP. Scripts share the page DOM and are **not a complete security sandbox**; install only changes you trust.
- A packaged content-script bridge checks whether the current site still has the exact installed script enabled. Its DOM messages contain only a request ID, code fingerprint, and enabled result; they never expose keys or settings. This also suppresses stale registrations after deletion. The DOM bridge is not a security boundary against a hostile website, which already controls its own page.
- Provider requests omit browser cookies and reject redirects. Provider error bodies and credentials are never echoed into the conversation. Changing provider replaces the stored key.

## Development and checks

```sh
npm run typecheck
npm test
npm run build
npm run lint:firefox
npm run test:e2e
npm run test:firefox
```

`test:e2e` uses a real Chromium extension, a local fixture page with strict CSP, and fixture provider responses. It checks setup, CSS, privacy filtering, browser-restart persistence, explicit script installation, JavaScript cleanup, site controls, narrow/dark layouts, and provider error recovery. It uses an installed Playwright Chromium or `CHROMIUM_EXECUTABLE`; otherwise install one with `npx playwright install chromium`.

`test:firefox` installs a temporary build into an isolated headless Firefox profile using Selenium. It checks the actual Firefox APIs for CSS/JavaScript installation, persistence on reload, toggling, and deletion. Firefox must be installed (or set `FIREFOX_EXECUTABLE`); Selenium Manager obtains geckodriver if needed. Both test fixtures pregrant access only to localhost and use fake API keys. **No paid/live inference requests are made by the tests.** Test screenshots and profiles are under ignored `test-results/`.

Mozilla’s linter reports two `innerHTML` warnings inside the bundled, unmodified React DOM implementation. Application code renders model/user text as text and does not use `innerHTML` or `dangerouslySetInnerHTML`. There are no manifest errors; store approval/signing remains a separate release step. `npm audit --omit=dev` checks shipped dependencies; upstream development-tool advisories may still appear in a full audit.

`npm run dev` opens the UI development entry; website access requires loading the packaged extension. The ordinary webpage explains installation rather than simulating browser capabilities.

## Limits

Browser settings pages, extension stores, local files, PDF viewers, and other protected pages cannot be customized. The first version operates on the top document, not cross-origin frames or closed shadow roots. Site redesigns can invalidate generated selectors; send a new request to regenerate the customization. There is no element picker, undo, manual editor, sync, or individual-change manager.

Source layout: `src/sidebar/` (React UI), `src/background.ts` (trusted messages and persistence), `src/engine.ts` (registration/injection), `src/inspector.ts` (page snapshot), `src/providers.ts` (provider adapters), `src/shared/` (types/validation), and `scripts/build.mjs` (browser manifests and packages).
