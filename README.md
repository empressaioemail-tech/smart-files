# smart-files

Empressa product: Smart Files. Own repo, own database, own serving process.

SmartSite is a consumer. This is not cortex-api. This is not the Texas property-spine store. This is not Hauska substrate.

Do not put a cortex-prod or atoms `DATABASE_URL` in this repo or its deploy env. Files credentials must not reach the atoms database. Atoms / L26 credentials must not reach the files database.

Other products and actors mount this product. They do not merge it into the public spine. Later mounts (city, title, builder, agent, RWA operators) attach the same way. We are not RWA creators. RWA operators bring their own asset representation and mount onto provenance, this file room, and the map.

Infra: Neon `smart-files` / `snowy-bread-83475727`. GCP `smart-files-505619`. Cloud Run service name will be `smart-files`, not `cortex-api`.

`GET /healthz` is the process liveness probe. Do not put the files DSN in this repo. Secret Manager is the home once the service is billed and serving.

Store: `sql/001_foundation.sql` on Neon `snowy-bread-83475727`. Identity is `src/identity.mjs` (last-segment-is-slug). Default `access_policy` is `tenant-private`. Apply and seed read `%USERPROFILE%\\.empressa\\smart-files.database_url` and refuse a cortex-prod host.

G-58 / OPS-17. Isolation WDLL lives in doc_repo at `_inbox/2026-08-15_a_wdll_smart_files_isolation.md`.
