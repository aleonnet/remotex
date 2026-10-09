# Releasing alumia

How a version leaves this repository, `aleonnet/alumia-app` (private, where the work is), for
the public one, `aleonnet/alumia`, which is the fork of the original project
([andrewtheguy/remotex](https://github.com/andrewtheguy/remotex)) under the product's name:
one commit a version on top of its `main`, the release with the Mac app's disk image, the
native packages built there, and the page at <https://aleonnet.github.io/alumia/>.
Every step is a command, with what its output says when it went well.
`tools/publish-public.sh` is the only thing that writes to the public repository, with a key
of its own; what it refuses is listed at the end, with why. The `gh` commands name the
repository with `-R`: on a clone with the remote `upstream` (the original project), `gh` would
otherwise act on that one.

## Once

What makes the two repositories what they are, each step read before the next. The order
matters: the private repository changes its name before anything more is pushed to it, and
the public one has its key and its rules before its first version.

1. Rename the private repository and point the clone at the new name:

   ```sh
   gh repo rename alumia-app -R aleonnet/alumia --yes
   git remote set-url origin git@github.com:aleonnet/alumia-app.git
   git remote add public https://github.com/aleonnet/alumia.git
   git remote set-url --push public DISABLED-publish-by-script
   ```

   `git remote -v` then shows `public` with `DISABLED-publish-by-script (push)`: a `git push
   public` fails by construction, and `tools/publish-public.sh` pushes from its own clone in
   `tmp/publish/public`.
2. Give the fork of the original project the product's name, with issues on and the rest off.
   The public repository is that fork, and stays one: GitHub marks as a fork only what was
   made by forking, so it is renamed, never made anew.

   ```sh
   gh repo rename alumia -R aleonnet/remotex --yes
   gh api -X PATCH repos/aleonnet/alumia -F has_issues=true -F has_wiki=false \
     -F has_projects=false -F has_pull_requests=false \
     -f description="Your computers, from any browser. An app on the Mac, a page everywhere else." \
     -f homepage=https://aleonnet.github.io/alumia/ \
     --jq '{fork, parent: .parent.full_name, has_issues, has_wiki, has_projects, has_pull_requests}'
   gh repo edit aleonnet/alumia --enable-secret-scanning --enable-secret-scanning-push-protection
   ```

   The second answers `"fork":true`, `"parent":"andrewtheguy/remotex"`, `"has_issues":true`
   and `false` for the other three: the issues are where a reader writes, and nothing else is
   open. `gh api repos/aleonnet/alumia --jq .security_and_analysis` then says `enabled` for
   `secret_scanning` and for `secret_scanning_push_protection`. Its `main` is the original's
   history as this repository had it when it left, with the first nine commits of this
   project on it, and every version goes on top of it. It has two older branches besides,
   `juncao-original-0.0.325` and `modo-espelhado-rapido`, both already in that `main`: they
   stay as they are, and the rules of step 4 let nobody move them.
3. Make the publication key, a deploy key of the public repository with write access, kept on
   the Mac that publishes and used by nothing but the script:

   ```sh
   ssh-keygen -q -t ed25519 -N '' -C 'alumia publication' -f ~/.ssh/alumia-publish
   gh repo deploy-key add ~/.ssh/alumia-publish.pub -R aleonnet/alumia --allow-write \
     --title "publication (tools/publish-public.sh)"
   ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none -i ~/.ssh/alumia-publish -T git@github.com
   ```

   The last says `Hi aleonnet/alumia! You've successfully authenticated, but GitHub does not
   provide shell access.` and exits 1: the key is that repository's and no account's. It is
   the ssh command the script's clone pushes with. A key is one repository's: GitHub answers
   `key is already in use` to one registered on another repository, and went on answering so
   after that repository was deleted. A new key is made then.
4. Let nothing but that key write to the public repository: two rules, one for every branch
   and one for every tag, each refusing to create, move, delete and force, with the deploy
   key as the only one that passes:

   ```sh
   for target in branch tag; do
     printf '%s' "{\"name\":\"only the publication writes: every ${target}\",\"target\":\"${target}\",\"enforcement\":\"active\",\"bypass_actors\":[{\"actor_id\":null,\"actor_type\":\"DeployKey\",\"bypass_mode\":\"always\"}],\"conditions\":{\"ref_name\":{\"include\":[\"~ALL\"],\"exclude\":[]}},\"rules\":[{\"type\":\"creation\"},{\"type\":\"update\"},{\"type\":\"deletion\"},{\"type\":\"non_fast_forward\"}]}" \
       | gh api -X POST repos/aleonnet/alumia/rulesets --input -
   done
   gh api repos/aleonnet/alumia/rulesets --jq '.[] | [.name, .target, .enforcement] | @tsv'
   ```

   The last lists both as `active`. Nobody's account passes them, its owner's included, so a
   push by hand, an edit on GitHub's pages and the fork's own *Sync fork* are refused alike;
   the publication is the one way in.
5. Publish the first version (*Each version*, below). The page's workflow runs on that first
   push, finds GitHub Pages not turned on, says so and ends well with nothing published:
   `gh run list -R aleonnet/alumia --workflow pages.yml --limit 1` shows the run. If it shows
   none, GitHub is holding the fork's workflows, as it does on a fork that had workflow files
   when it was made (the fork had run none before its first version, though pushes to it
   touched what they watch): its owner lets them run on the repository's Actions page, once.
6. Prove the rules refuse what is not the key, with the owner's own token:

   ```sh
   gh api -X POST repos/aleonnet/alumia/git/refs -f ref=refs/heads/proof \
     -f sha="$(gh api repos/aleonnet/alumia/commits/main --jq .sha)"
   ```

   It has to fail, naming the rule. If it answers with the new reference instead, the rules
   are not in force: stop, and take the reference away before anything else.
7. Turn GitHub Pages on, built by the workflow, and run the workflow by hand this once:

   ```sh
   gh api -X POST repos/aleonnet/alumia/pages -f build_type=workflow
   gh workflow run pages.yml -R aleonnet/alumia
   gh api repos/aleonnet/alumia/pages --jq .html_url
   ```

   The last says `https://aleonnet.github.io/alumia/`; the page answers there once the run
   is done (`gh run list -R aleonnet/alumia --workflow pages.yml --limit 1`).
8. The container image's package is created by the release workflow's first run (step 8 of
   *Each version*). Whether anybody can pull it is asked with no credential:

   ```sh
   token="$(curl -s "https://ghcr.io/token?scope=repository:aleonnet/alumia:pull" \
     | uv run --no-project python -c 'import json, sys; print(json.load(sys.stdin).get("token", ""))')"
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $token" \
     -H 'Accept: application/vnd.oci.image.index.v1+json' https://ghcr.io/v2/aleonnet/alumia/manifests/latest
   ```

   `200` is a public image. `403` is one GitHub created private: make it public once, on its
   page (`https://github.com/users/aleonnet/packages/container/alumia/settings`), and ask again.

## Each version

1. The changelog has the version's section, in both languages: `## <version> - <date>` in
   `CHANGELOG.md` and `CHANGELOG.pt-BR.md`, with an empty `## Unreleased` above it, the date
   being the day the version will be tagged; `Cargo.toml` says the version.
   `uv run --no-project python tools/check-docs.py` says `all documents agree`.
2. Build the Mac app's disk image from the version's last commit, on the Mac with the
   identity:

   ```sh
   bash packaging/build-mac-app.sh
   ALUMIA_SIGN_IDENTITY="Developer ID Application: …" ALUMIA_NOTARY_PROFILE=<profile> \
     bash packaging/build-mac-dmg.sh
   ```

   It ends with `dist/mac/Alumia-<version>.dmg (…), …source=Notarized Developer ID`.
3. Rehearse the publication, with nothing reaching GitHub: `bash tools/rehearse-publish.sh
   <version>` publishes `HEAD` to two stand-in repositories under `tmp/rehearsal/` and ends
   with `rehearse: 15 of 15 steps as expected`.
4. Rehearse the packages. Push the branch the version is made on, and dispatch the release
   workflow on it here, where it builds, installs and tests everything and publishes nothing:

   ```sh
   git push origin <branch>
   gh workflow run release.yml -R aleonnet/alumia-app --ref <branch>
   gh run watch <run> -R aleonnet/alumia-app
   gh run view <run> -R aleonnet/alumia-app --json conclusion,jobs \
     --jq '.conclusion, (.jobs[] | [.name, .conclusion] | @tsv)'
   ```

   `gh workflow run` prints the address of the run it started, which ends in the run's
   number: that is `<run>`, and not the newest run of a list, which may be an older one for a
   moment. The last says `success`, then each job: `prepare`, the frontend, the four builds,
   `release` and the two images `success`, `docker-manifest` `skipped`. What does not build is found here, before the version's commit
   is public: the packages of a version are that commit's, and are not built from another.
5. The gates of the plan that made the version pass, and the work is merged into `main`
   (`/roadworthy:close`, then the merge, never squashed).
6. Tag `main` and push both, on the day the changelog gives: `git tag -a v<version> -m "alumia
   <version>"`, `git push origin main v<version>`.
7. Publish: `bash tools/publish-public.sh <version>`. It asks for the owner's key once, to
   read this repository's `main` and the tag as GitHub has them; the push to the public
   repository goes with the publication key. It says, in order, `the public repository is the
   photograph of <previous>` (or `has no version yet`), how many paths left and in how many
   documents links became text, `the scan found nothing that may not be public`, `the
   exported tree passes its own checks`, `pushing main and v<version>`, `published
   <version>: https://github.com/aleonnet/alumia/releases/tag/v<version>`, and `next: dispatch
   the release workflow there for the packages`, which is step 8. The release holds
   the disk image, and its notes are the changelog's section, its links made addresses at the
   version's tag, with the image's SHA-256. Then `bash tools/publish-public.sh --check` says
   `the public repository is the photograph of <version>`. The workflow `public-check.yml`
   runs the same check here when a tag is pushed, which is before the tag's version is
   published: it then holds the public repository to the version it has, and `gh workflow run
   public-check.yml -R aleonnet/alumia-app` runs it again after the publication.
8. Build the packages, in the public repository, on the version's commit:

   ```sh
   gh workflow run release.yml -R aleonnet/alumia
   gh run watch <run> -R aleonnet/alumia
   gh release view v<version> -R aleonnet/alumia --json assets --jq '.assets[].name'
   ```

   The last lists `Alumia-<version>.dmg` and the packages the rehearsal of step 4 listed in
   its step *The packages the release gets*: two `.deb`, two `.rpm`, one `.pkg` and one
   `.msi`. The images are `ghcr.io/aleonnet/alumia:v<version>` and `:latest`.
9. The page, if `site/` changed in the version, is republished by `pages.yml` on the push;
   `gh run list -R aleonnet/alumia --workflow pages.yml --limit 1` shows the run.

## What the script refuses, and why

Each refusal is one line beginning with `publish:`. All but one come before anything is
written to the public repository; the one that comes after is *the release … could not be
created*, when `main` and the tag are pushed already, and the same command then creates the
release alone.

- *'<version>' is not a version of the form 0.1.3*, *publish takes the version alone*,
  *unknown argument*: the command is the version, `--check`, or `--export` with its own.
- *this is not a clone of aleonnet/alumia-app*: the version comes from the private repository
  and from nowhere else.
- *commit or stash the tracked changes first*: the tag is what is published, and a dirty tree
  is a sign something is not in it.
- *there is no publication key at …*: the push to the public repository goes with that key
  and with nothing else this machine has (*Once*, step 3).
- *the tag v<version> is not in this repository*, *is not annotated*, *is not pushed to
  aleonnet/alumia-app*, *in aleonnet/alumia-app is not the one here*, *is not on the main of
  aleonnet/alumia-app*, *aleonnet/alumia-app could not be read*: nothing is published that is
  not tagged and pushed here first, and the private repository is asked, not remembered.
- *there is no dist/mac/Alumia-<version>.dmg*, *Gatekeeper does not take … as notarized*: the
  release carries the image, and only one this Mac's Gatekeeper accepts.
- *Cargo.toml says X, not Y*, *CHANGELOG.md at v<version> has no section*, *CHANGELOG.md dates
  <version> …, and the tag … was made on …*: the version has to be the tree's, have its notes,
  and be dated the day it was tagged, in both languages.
- *aleonnet/alumia has no main*, *the public repository's main is neither a version's commit
  nor one of this repository's history*, *is not the photograph of <previous>*: the public
  repository is the fork, whose `main` is either the history this repository left with or a
  version on top of it. Anything else was written by somebody by hand; and what a version's
  commit holds is compared with the export of the version it names, by that version's rules,
  before anything is added.
- *the version <version> is already published*, *the public repository is at <previous>, and
  <version> is not a newer version*: a version is published once, on top of the ones before
  it and never under one. A run that pushed the photograph and then failed to create the
  release is picked up again by the same command: the script sees the version on the public
  `main` with no release, and creates the release alone.
- *aleonnet/alumia could not be cloned*, *the public repository names <previous>, and this
  repository has no tag v<previous>*: the public repository has to be read, and the version it
  holds exported from here, before anything is compared.
- *tools/public-paths.txt is not in the exported tree*, *names a path that is not relative and
  plain*, *tools/public-allowed.txt is not in the exported tree*, *allows … and does not say
  why*: the two lists are read from the version being exported, and each exception gives its
  reason.
- *--export writes under tmp/ alone*: the export directory is emptied first, so only one under
  `tmp/` may be named.
- *tmp/publish/public is a clone of <url>, not of aleonnet/alumia*: the clone the script
  pushes from points elsewhere.
- *a secret-looking string*, *a private key*, *a password hash*, *a network address*, *a
  Tailscale name* in `<file>:<line>`: the scan (`tools/publish-public.sh`, `scan_tree`), with
  `tools/public-allowed.txt` as the only exceptions, each with its reason. A network address
  is a public one: the private ranges, the shared range Tailscale uses, loopback and the
  documentation ranges name nobody, and the tree has them as the examples of its tests and
  of `alumia.example.toml`.
- *the exported tree fails: <command>*, *a broken link in the export*, *a check left a file
  of its own in the exported tree*: the public copy runs the repository's own checks that
  compile nothing, and lychee, without the mockups, and what is published is what was
  exported and nothing a check wrote beside it.
- *the push to aleonnet/alumia failed*: `main` and the tag go together or not at all, so
  nothing was written or released, and the same command starts over from the public
  repository as it is.
- *the release v<version> could not be created on aleonnet/alumia; main and the tag are
  pushed*: the one refusal after writing, taken up by the same command.
- *nothing to commit*: the tree is already what the public repository holds.
