# Clash Merge

Local subscription workbench. Each plan combines one default subscription with multiple independent exits and their domain suffix rules. The service listens only on `127.0.0.1`.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:18790/`. `npm run dev` builds the React/shadcn UI and starts the Node service with file watching. Keep it running while using subscriptions. After editing frontend source, run `npm run build` and reload the page. `npm start` builds the UI and runs the service without file watching. `npm test` runs backend regression and integration tests.

## Plans

- Create, rename and delete plans. Each plan has an independent subscription URL: `/subscriptions/<plan-id>/clash.yaml`.
- `/clash.yaml` remains an alias for the saved default plan, preserving existing Clash imports.
- Choose a Clash remote profile or enter an HTTP/HTTPS subscription URL and User-Agent. A custom URL never reuses another URL's cache.
- Add SSH, SOCKS5 or HTTP exits. Each exit has a stable ID, editable name, enable switch and domain suffix list. SOCKS5 and HTTP exits support optional authentication.
- Exit order determines domain rule priority. Exact duplicate domains across enabled exits are rejected; overlapping suffixes follow the configured order.
- Relay, proxy-server and loopback bypass rules precede exit domain rules. Remaining traffic uses the original subscription's rules. Its DNS, TUN, groups and network settings are preserved.
- Disconnected exits do not automatically fall back to the default subscription. Their matching routes continue targeting that exit.
- Save workspace changes, then update the corresponding subscription in Clash Verge. Runtime start/stop operations are separate from saving configuration.
- Generation preview and YAML download reflect saved configuration.

## SSH Guardians

Each SSH exit owns an independent two-hop tunnel: relay SSH → local forward → remote SSH → local SOCKS5 listener. Configure relay address and SSH port, relay user, destination user, remote forwarded port, private key path, local forward port and local SOCKS port. The same local private key is used for both hops, matching the original client script.

Start, stop and reconnect individual guardians from the exit inspector. Guardians retry disconnected tunnels after 10 seconds and show recent diagnostic events. Readiness indicates a listening SOCKS port; it is not an end-to-end application connectivity check.

Only processes launched by this service are stopped. Existing external tunnels are detected and left untouched. Stop a managed exit before changing its tunnel, disabling it or deleting it. Enabled SSH exits must use distinct local ports across all plans. Known-host verification stays strict; configure SSH trust separately before starting. Private keys are never uploaded or copied.

Guardians do not auto-start after service restart. Other exits and subscription generation continue independently. The original `company-socks-client.sh` can still be used as an external provider; it must not run alongside a managed exit using the same ports.

## Migration And Storage

New installations start with one empty default plan. Configure a subscription URL or select your own local profile, then add exits as needed. No personal server, domain or credential is bundled. SSH defaults use a placeholder host and must be configured before use.

Existing flat settings migrate to an `office` plan named `办公方案`, containing one SSH exit named `内网出口`. The subscription, domains, enabled state and tunnel parameters are retained. Before writing version 2, the original settings file is backed up to `data/settings.json.v1-backup`. Existing Clash profile files are never modified.

Settings live in `data/settings.json` with owner-only permissions. The UI uses revision checks to prevent one browser tab from silently overwriting another tab's saved changes. Unavailable upstream fetches fall back to the same source's cache; switching sources invalidates old merged output.

`data/`, local environment files, private keys, logs, design screenshots, dependencies and generated builds are excluded from Git. Do not force-add them. Local settings and migration backups may contain subscription tokens and proxy passwords. Build the distributable UI from `web/` with `npm run build`.

## Endpoints

- `GET /api/settings`, `PUT /api/settings`: versioned plan configuration.
- `GET /api/profiles`, `GET /api/defaults`: available source profiles and defaults.
- `GET /api/plans/<id>/health`: plan source and refresh status.
- `POST /api/plans/<id>/refresh`: immediate upstream refresh.
- `GET /api/plans/<id>/preview`: saved generated configuration without fetching upstream.
- `GET /api/plans/<id>/exits`: guardian and external exit status.
- `POST /api/plans/<id>/exits/<exit-id>/start`, `/stop`, `/restart`: independent SSH guardian operations.
- `GET /subscriptions/<id>/clash.yaml`: refresh and return a plan subscription.
- `GET /clash.yaml`, `GET /health`, `POST /refresh`: default-plan compatibility endpoints.

## Environment

`CLASH_MERGE_PORT` defaults to `18790`. `CLASH_MERGE_REFRESH_MINUTES` defaults to `60` (minimum 5). `CLASH_VERGE_DIR` overrides the Clash Verge data directory. A direct subscription URL can be used without local Clash profiles.

## Structure

`web/` contains React and shadcn/ui components; Vite builds them into `public/app/`. `src/plans.js` validates and migrates persisted settings. `src/runtime.js` owns per-plan subscription services and per-exit guardians. `src/app.js` exposes the workbench and API. `src/merge.js`, `src/profiles.js`, `src/service.js` and `src/tunnel.js` implement merging, source loading, refresh/fallback and SSH process management. Legacy flat merge and handler helpers remain for backward-compatible module tests.
# Agent 接口

本机 agent 可先读取 `GET http://127.0.0.1:18790/api/skill`（Markdown 操作流程），再读取 `GET /api/docs`（JSON 接口与配置说明）。端口跟随 `CLASH_MERGE_PORT`。

配置修改使用完整文档 `PUT /api/settings`，应携带读取时的 `ETag` 作为 `If-Match`，避免覆盖其他修改。文档说明多方案、出口、域名优先级、守护操作及客户端更新订阅的流程，不包含实际配置或凭据。

服务绑定 `127.0.0.1`，请求还必须来自实际回环地址并通过 Host 检查；写操作检查 Origin。所有接口均限定本机，转发请求头不能绕过来源检查。
