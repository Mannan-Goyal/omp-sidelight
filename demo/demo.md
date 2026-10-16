# How `git rebase` rewrites history

`git rebase main` takes the commits on your branch and replays them, one by one, on top of `main`. The result looks as if you had started your work from the latest `main`.

## What actually happens

Git never edits a commit. A commit's ID is a hash of its content, its parent and its metadata, so changing the parent produces a new commit. Rebasing therefore creates **new commits** with the same changes and new IDs, then moves your branch label to the last one.

```text
before:   main  A ── B ── C
                     \
          feature     D ── E

after:    main  A ── B ── C
                           \
          feature           D' ── E'
```

`D'` and `E'` contain the same changes as `D` and `E`, but they are different commits. The old ones still exist until garbage collection removes them, which is why `git reflog` can undo a bad rebase.

## Rebase or merge?

| | Rebase | Merge |
|---|---|---|
| History | Linear, as if work was done in sequence | Keeps the real branching shape |
| Commit IDs | Rewritten | Unchanged |
| Safe on shared branches | No: others still have the old commits | Yes |
| Conflicts | Resolved once per replayed commit | Resolved once, in the merge commit |

## The one rule

Never rebase commits that someone else has already pulled. Their copies still point at the old commits, and the next pull will mix both versions of the same work.

## Undoing a rebase

1. Run `git reflog` and find the entry from just before the rebase started.
2. Run `git reset --hard <that entry>`.

Your branch is back exactly where it was, because the old commits were never deleted.
