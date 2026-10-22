# Screenshots in pull requests

Pictures for a pull request never go into the PR's branch. Committing them and removing
them before merge meant two extra pushes, and each push ran CI again.

Instead, push them to the **`pr-screenshots`** branch and link them from the PR. That
branch holds only pictures and is never merged. CI only runs for `main` and for pull
requests, so a push to it runs nothing, nothing lands in `main`, and the links keep
working after the PR is merged.

## Recipe

```bash
git clone --branch pr-screenshots --single-branch --depth 1 \
  https://github.com/nissy34/cloud-slicer shots
mkdir -p shots/<folder>            # one folder per PR, e.g. pr151 or the branch's last part
cp *.png shots/<folder>/
cd shots && git add -A && git commit -m "Screenshots for <folder>" && git push origin pr-screenshots
```

If the push is refused because someone else pushed first, run `git pull --rebase` and push
again (different folders never clash).

Link each picture in the PR description or a comment:

```markdown
![Send dialog on a phone](https://raw.githubusercontent.com/nissy34/cloud-slicer/pr-screenshots/pr151/send-dialog-phone.png)
```

To replace a picture, push a new file with the same name; the link stays the same (GitHub
may show the old one for a few minutes).

## Uploading from your own computer

With GitHub's `gh` 2.99 or newer you can also attach pictures straight to a PR, the same as
drag-and-drop on the web page: `gh pr edit 151 --attach shot.png`. Claude's cloud threads
can't use this (their GitHub access only passes text), so they use the branch above.
