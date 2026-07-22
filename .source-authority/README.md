# TXT runtime source authority

`TXT_RUNTIME_SOURCE_BASELINE_001` is a sanitized source baseline rooted in a
new Git history. It captures the source state that can be safely published and
reproduced from the verified local TXT runtime evidence available on
2026-07-22.

It does **not** claim historical continuity from the legacy GitHub `main`
branch. The legacy branch remains an independent history until a later,
file-by-file reconciliation is completed.

The canonical manifest covers exactly 925 source files. Files under
`.source-authority/` are authority metadata and are deliberately excluded from
that source-file count and manifest.

Publication sanitization is part of the contract:

- 85 runtime-private, abandoned-component, or cross-project files are excluded;
- 29 source files contain recorded publication-safe transformations;
- no secret, credential, private key, runtime database, market-history dataset,
  log archive, build output, or dependency directory is included;
- the 11 active Healthwatch files remain byte-identical to tested source and the
  active runtime.

The authoritative statement is:

> This baseline matches the sanitized source snapshot. It does not claim a
> byte-for-byte match with the complete active runtime.

