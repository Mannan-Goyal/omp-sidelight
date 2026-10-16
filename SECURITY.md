# Security policy

## Supported versions

Only the latest release on npm (`omp-sidelight`) gets fixes.

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on this repository ([direct link](https://github.com/Mannan-Goyal/omp-sidelight/security/advisories/new)). Don't open a public issue.

Include what you found, how to reproduce it, and which versions of Sidelight and omp you used. You'll get a reply within a week.

## What Sidelight touches

- It runs inside omp with the same permissions as omp itself.
- It reads and writes only the current session's folder (documents, versions, threads) and one small state file in omp's agent directory (`explain-reader/tour.json`).
- It makes no network calls of its own. Side questions go through omp's side-turn API to the model you already use.
