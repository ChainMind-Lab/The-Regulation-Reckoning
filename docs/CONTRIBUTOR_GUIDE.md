# Contributor Guide

This guide helps new contributors understand the workflow and how the project is structured for a Stellar-focused Web3 research platform.

## Start here

1. Read `README.md` and `CONTRIBUTING.md`.
2. Browse open issues and choose a labeled task.
3. If you do not see a good issue, open a proposal using the provided template.

## Workflows

### Research contributions

- Add or update narrative chapters under `content/chapters/`.
- Keep structure aligned with Stellar policy analysis and network signal storytelling.
- Cite Horizon data, regulatory sources, and policy frameworks.

### Engineering contributions

- Focus on `src/` for the website experience and Stellar Horizon integration.
- Keep UI components small, reusable, and accessible.
- Add review notes for behavior changes and data handling.

### Data contributions

- Add new on-chain metrics, policy signal definitions, or Stellar dataset ingestion in `analysis/`.
- Document new schema fields, data sources, and transformation assumptions.
- Ensure deterministic ETL logic for reproducibility and review.

## Quality expectations

- Use clear commit messages.
- Keep PRs scoped to a single objective.
- Explain the impact of the change in the PR description.
- Verify that Stellar integration code does not expose private keys or secrets.
