# Squirrel (freelance-guard)

## Source of truth

`docs/thesis-context.md` says what is true about this project now: what is built, tested, sandboxed or still open. It is read by the Claude project for the user's thesis.

- If it disagrees with another file, it wins. Fix the other file.
- A change that affects status, a decision, or what is sandbox and what is real updates that file **in the same PR**: new date and commit at the top, and each claim marked as assumption, planned, built, tested or verified. Say what was not verified.
- The detail files are `README.md`, `docs/business-model.md`, `docs/contract-v2-design.md` and `docs/mainnet.md`. Keep them from drifting: when a PR changes what one of them says, change it too.
- After it changes, tell the user to upload it again to the thesis project on claude.ai.
