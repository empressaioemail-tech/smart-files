# smart-files

Empressa product: Smart Files. Own repo, own database, own serving process.

SmartSite is a consumer. This is not cortex-api. This is not the Texas property-spine store. This is not Hauska substrate.

Do not put a cortex-prod or atoms `DATABASE_URL` in this repo or its deploy env. Files credentials must not reach the atoms database. Atoms / L26 credentials must not reach the files database.

Other products and actors mount this product. They do not merge it into the public spine. Later mounts (city, title, builder, agent, RWA operators) attach the same way. We are not RWA creators. RWA operators bring their own asset representation and mount onto provenance, this file room, and the map.

Infra: Neon `smart-files` / `snowy-bread-83475727`. GCP `smart-files-505619`. Cloud Run service `smart-files` in us-east1. Live probe is `GET /` (GFE intercepts exact `/healthz` on `*.run.app`).

HTTP: `GET /api/smart-files/folders`, `.../folders/:folderId/files`, `.../files/:entityId`, `.../files/:entityId/placements`, `.../blobs/:contentCid`. Writes: `POST /api/smart-files/folders`, `POST .../folders/:folderId/files`, `POST .../folders/:folderId/share`, `GET .../share/:token`. Writes, personas, and share resolution are unchanged: anonymous callers are 401, bearer is the single `SMART_FILES_SERVICE_TOKEN` from Secret Manager. **Reads are gated separately (G-106, defect #3 closed).** A read refuses with 403 -- anonymous or a token scoped to a different tenant alike -- unless the bearer token resolves to a `SMART_FILES_SERVICE_TOKENS` identity holding a grant for the resource's actual `(scopeType, scopeId)`. `SMART_FILES_SERVICE_TOKEN` is deliberately NOT auto-granted read access to every scope; an environment that hasn't configured `SMART_FILES_SERVICE_TOKENS` reads nothing, by design, rather than keeping the old defect as a silent default. See `src/identity.mjs` (`parseServiceIdentities`, `identityAllowsAnyScope`) and `scripts/read_scope_probe.mjs`. `DATABASE_URL` is Secret Manager only. Do not put either token env var in this repo.

QA UI: https://smart-files-app.vercel.app (Vercel project `smart-files-app`, not property-explorer, not cmdcenter). BFF at `/api/files` holds URL + service token only. Personas are QA actors (Joe/Acme, Jane/Acme, Nick/Empressa), not G-11.

Store: `sql/001_foundation.sql` on Neon `snowy-bread-83475727`. Identity is `src/identity.mjs` (last-segment-is-slug). Default `access_policy` is `tenant-private`. Apply and seed read `%USERPROFILE%\\.empressa\\smart-files.database_url` and refuse a cortex-prod host.

Scopes: `jurisdiction`, `tenant`, `site`, `instrument`. All four are readable, behind the caller-scope gate above; write accepts `tenant` and `instrument` only (`WRITABLE_SCOPE_TYPES`). Each scope brings its own scopeId rule to `SCOPE_ID_VALIDATORS` in `src/identity.mjs`, which is the extension point rather than the scope list. `tenant` scopeId is any non-empty string and is not to be tightened; `jurisdiction` is numeric FIPS; `instrument` is `sec_` or `iss_` plus a 26-character Crockford base32 ULID naming a security-master node. `jurisdiction_fips` is denormalised only for `scopeType = jurisdiction`. Tenant writes carry a QA persona; instrument writes name `scopeType` and `scopeId` in the body and are recorded against the `instrument/service` actor.

Round trip: `SMART_FILES_BASE_URL=... SMART_FILES_SERVICE_TOKEN=... node scripts/scope_roundtrip_probe.mjs` exercises the real HTTP routes for the instrument scope and for every live tenant slug, and exits non-zero on any failure. It authenticates as a single blanket-grant identity (`SMART_FILES_SERVICE_TOKENS` "*"/"*"), which is a legitimate disposable CI/backend identity, not evidence that reads are unscoped. `scripts/read_scope_probe.mjs` is the read-scope-specific probe: it proves anonymous and wrong-tenant-token reads of a folder, file, blob, and placement all refuse with 403 while a matching-tenant token succeeds. CI runs both against a throwaway Postgres on every pull request.

G-58 / OPS-17. Isolation WDLL lives in doc_repo at `_inbox/2026-08-15_a_wdll_smart_files_isolation.md`.
