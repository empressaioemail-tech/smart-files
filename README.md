# smart-files

Independent Smart Files module. Own repo, own database, own serving process.

SmartSite is a consumer. This is not cortex-api. This is not the Texas property-spine store.

Do not put a cortex-prod or atoms `DATABASE_URL` in this repo or its deploy env. Files credentials must not reach the atoms database. Atoms / L26 credentials must not reach the files database.

Application surfaces mount this module. They do not merge it into the public spine. Later mounts (city, title, builder, agent, RWA operators) attach the same way. We are not RWA creators. RWA operators bring their own asset representation and mount onto provenance, this file room, and the map.

G-58 / OPS-17. Isolation WDLL lives in doc_repo at `_inbox/2026-08-15_a_wdll_smart_files_isolation.md`.
