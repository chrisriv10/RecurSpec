# npm real-world notes

Tested against npm 11.17.0. Assertions use stable substrings only.

## Cases

- `npm-missing-script` (NO_RECOVERY_ADVICE): `npm run missing` prints
  "To see a list of scripts, run:" followed by `npm run`. That command only
  lists scripts; it cannot fix anything, so refusing to treat it as recovery
  is correct (true negative). This case also guards a past false positive:
  the log-path line ("...can be found in: ...") once produced a phantom
  `can` command; bare English words after run/try are now rejected.

## Safety

`npm_config_cache` and `npm_config_update_notifier` are redirected into the
workspace so npm writes no logs or cache entries outside it. No packages are
installed and no registry is contacted.
