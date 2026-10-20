# vendor/

Ready-to-run builds of the two projects Agent Control Room runs, so the room works right after cloning, with only
Node.js installed. Both are **unmodified**: built from the official repositories, at the versions below, with their
own build scripts.

| Project | Version | Commit | Author | License |
|---|---|---|---|---|
| Habblaud | [v1.0.3](https://github.com/marmottajr/habblaud/tree/faa1a012b5fbf632c66dc6801c5383e53a542406) | `faa1a012b5fb` | Márcio Junior | MIT |
| Agent Flow | [v0.9.2](https://github.com/patoles/agent-flow/tree/1d821aff72547f07b2836f62c28ef4bcfee9eef2) | `1d821aff7254` | Simon Patole | Apache-2.0 |

Each folder keeps the project's `LICENSE` and a `THIRD_PARTY_NOTICES.md` with the licenses of the packages bundled
into its build. "Agent Flow" is a trademark of Simon Patole (see `agent-flow/TRADEMARK.md`); it is used here only to
name the software as distributed by its author.

To rebuild this folder from upstream (needs git, npm and network):

```bash
node scripts/vendor.mjs
```

To move to a newer version, change `ref` in `scripts/vendor.mjs`, run it, test, and commit the result.
