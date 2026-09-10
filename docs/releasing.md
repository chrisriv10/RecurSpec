# Releasing RecurSpec

Do not automate publishing. Work through this list in order.

1. Confirm a clean tree (`git status` shows only intended files).
2. Confirm `version` in `package.json` (and that `recurspec --version`,
   the terminal header, README examples, and CHANGELOG agree).
3. `pnpm install --frozen-lockfile`.
4. `pnpm typecheck`.
5. `pnpm lint`.
6. `pnpm test` (full suite, must be green).
7. `pnpm build`.
8. `pnpm demo` (showcase must fail exactly as designed).
9. `pnpm test:real-world` (all present tools must match expectations).
10. `pnpm ci:showcase` (expected-failure verification).
11. `pnpm smoke` (packed-install test from the real tarball).
12. `npm pack --dry-run` (inspect every shipped file).
13. Dependency audit (`pnpm audit --prod` must be clean; review dev-only
    findings and record the decision).
14. Verify README (install steps, example output, version strings).
15. Verify CHANGELOG (release section dated and accurate).
16. Verify release notes (`docs/releases/vX.Y.Z.md`).
17. Push the final release commit.
18. Verify GitHub CI is green on Linux, macOS, and Windows.
19. Create the `vX.Y.Z` tag.
20. `pnpm publish` (requires npm auth; maintainers only).
21. Create the GitHub release, reusing the changelog text.
22. Verify a fresh `pnpm add -D recurspec` install works.
