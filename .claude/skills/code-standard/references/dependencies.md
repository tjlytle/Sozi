# Dependencies (standard 4)

Adding an npm package requires all of the following. `npm run check:deps` checks the
mechanical ones against the base branch, and CI runs it on every PR.

- It is named in the issue's Implementation Plan. The architect adds dependencies, not
  the builder; a package the plan does not name sends the PR back.
- Licence MIT, BSD, ISC, Apache 2 or MPL 2 (OFL for a font).
- For a runtime package, a release within the last year. A dev tool is exempt.
- Its minified size stated in the PR body, in the Dependencies section.
- Pinned to an exact version, with the lockfile committed.
- Nothing loaded from a CDN at run time: a `src/` file that loads a script or
  stylesheet from a URL fails the check.
- No framework in the deck; surfaces may use Preact (2.6).
- If about a hundred lines of our own code would do, write them.

Expected additions over the presenter backlog: preact, marked, DOMPurify, a QR encoder,
possibly dockview-core.
