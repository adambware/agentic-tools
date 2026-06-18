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
2. **Remap `area` globs** from the pack's `REPO_MAP.yml`. The base globs
   (`["**/auth/**", "**/*Controller*"]`, …) are generic placeholders — replace them
   with the project's real paths so the engine's git-change detection (`change_flag`)
   and the reviewer scope point at the right code.
3. **Extend** with project-specific surfaces the base taxonomy can't know about. Keep
   the base ids (`ASVS-*`) and add new ids for extensions.

## Extension example (BearHost)

BearHost adds vectors beyond the base because its control plane holds keys to *other
people's* sites:

| id        | vector                                                       | weight   |
|-----------|--------------------------------------------------------------|----------|
| BH-SEC-01 | Stored WP credentials / app-passwords for connected sites    | critical |
| BH-SEC-02 | Control-plane → WP command channel auth / replay             | critical |
| BH-SEC-03 | SSRF via "monitor this URL" fetchers                         | high     |
| BH-SEC-04 | Indirect prompt injection through Content Gate               | high     |
| BH-SEC-05 | Multi-tenant isolation / IDOR on site-scoped resources       | critical |
| BH-SEC-06 | Webhook/callback authenticity from sites                     | medium   |
| BH-SEC-07 | Content Gate output handling / data exfil via review queue   | medium   |

These live in the pack's `vectors.yml` alongside the cloned `ASVS-*` base. Note some
extensions specialize a base vector (BH-SEC-05 is a project-specific IDOR built on
`ASVS-AC-03`; BH-SEC-03 specializes `ASVS-SSRF-10`).

## Keeping `area` mapped

`area` globs drift as code moves. **registry_gardening** (the weekly maintenance task)
flags stale area mappings and orphaned entries — keep them honest there. Always source
globs from the pack's `REPO_MAP.yml` so there's one map to maintain.

## Rule

This base library is **versioned once in the engine**. Improvements to the base
(new vectors, better defaults) ship here and packs re-clone or cherry-pick; pack-specific
surfaces never flow back up into the base.
