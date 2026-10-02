# Base Taxonomy

The **base taxonomy** is a library of canonical security vectors, versioned **once**
in the engine. Today it contains `owasp-asvs.yml` — ~12 high-value OWASP ASVS-derived
vectors (authentication, session management, access control / IDOR, input validation /
injection, secrets storage, dependency / SCA, rate-limiting, cryptography, error handling
& logging, SSRF, file/resource handling, security configuration).

Each entry is a [registry entry](../schemas/registry-entry.yml) with `kind: vector`,
`owner: security`, and an `asvs_ref` so findings can cite the ASVS chapter
(e.g. `"ASVS 4.0.3 V2.1"`).

## How a pack uses it

A pack does **not** edit this file. Onboarding clones and extends it:

1. **Clone** the base into the pack:
   `cp taxonomy/owasp-asvs.yml <repo>/.nightshift/registries/vectors.yml`
2. **Remap `area` globs** from the area→path map built at onboard. The base globs
   (`["**/auth/**", "**/*Controller*"]`, …) are generic placeholders — replace them
   with the project's real paths so the engine's git-change detection (`change_flag`)
   and the reviewer scope point at the right code.
3. **Extend** with project-specific surfaces the base taxonomy can't know about. Keep
   the base ids (`ASVS-*`) and add new ids for extensions.

## Extension example (NovuDesk)

NovuDesk adds vectors beyond the base because its control plane stores OAuth tokens for
and dispatches commands to a worker on behalf of *other* workspaces:

| id        | vector                                                            | weight   |
|-----------|-------------------------------------------------------------------|----------|
| ND-SEC-01 | Stored customer OAuth tokens for workspace integrations           | critical |
| ND-SEC-02 | Control-plane → nova-worker command channel auth / replay         | critical |
| ND-SEC-03 | SSRF via "monitor this webhook URL" fetchers                      | high     |
| ND-SEC-04 | Indirect prompt injection through Triage Gate                     | high     |
| ND-SEC-05 | Multi-tenant isolation / IDOR on ticket-scoped resources          | critical |
| ND-SEC-06 | Webhook / callback authenticity from integrations                 | medium   |
| ND-SEC-07 | Triage Gate output encoding / XSS in review queue UI              | medium   |

These live in the pack's `vectors.yml` alongside the cloned `ASVS-*` base. Note some
extensions specialize a base vector (ND-SEC-05 is a project-specific IDOR built on
`ASVS-AC-03`; ND-SEC-03 specializes `ASVS-SSRF-10`).

## Keeping `area` mapped

`area` globs drift as code moves. The **`/nightshift:garden`** skill (the weekly
maintenance task) flags stale area mappings and orphaned entries — keep them honest there.
Always source globs from the area→path map built at onboard so there's one map to maintain.

## Rule

This base library is **versioned once in the engine**. Improvements to the base
(new vectors, better defaults) ship here and packs re-clone or cherry-pick; pack-specific
surfaces never flow back up into the base.
