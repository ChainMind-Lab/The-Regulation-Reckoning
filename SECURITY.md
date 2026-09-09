# Security

The Regulation Reckoning is a Stellar Testnet application. The full threat model,
secrets handling, and hardening details live in
[`docs/SECURITY.md`](./docs/SECURITY.md).

## Reporting a vulnerability

Open a private issue in this repository with the `security` label and describe the
behavior you observed. Do **not** include secret values (admin secret, tokens, keys)
in the report. If the issue involves a deployed Testnet contract, note that the
contract is a test artifact and can be redeployed.

## Quick rules

- Never commit secrets, `.env` files, or the SQLite database.
- Keep dependencies updated; CI fails on `npm audit` high/critical findings.
- The backend never returns the admin secret — if an endpoint does, that is a bug:
  report it.