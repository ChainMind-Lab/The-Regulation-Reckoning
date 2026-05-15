# Architecture Overview

The Regulation Reckoning is structured as a Web3 Stella project with separate concerns for content, Stellar network integration, analytics, and front-end delivery.

## Layers

- `src/` — React application, UI components, and Stellar Horizon helpers.
- `src/lib/stellar.ts` — network integration helpers for Horizon and Stellar signal fetching.
- `content/` — policy chapters, narrative briefs, and research notes.
- `analysis/` — analytics tooling for on-chain metrics, compliance signals, and data modeling.
- `docs/` — contributor documentation that explains Web3 workflows, architecture, and review expectations.

## Goals

- Make it easy to contribute to a Stellar-focused Web3 project.
- Keep on-chain analysis, narrative content, and implementation separated.
- Support reusable signal models tied to Stellar network behavior.
- Enable contributors to move from issue to merge with clear guidance.

## Contribution-ready design

- Issue templates support research, feature work, and web3 data improvements.
- Clear labels help contributors choose between policy, data, and frontend work.
- The architecture emphasizes Horizon connectivity, network signal tracking, and publishable research output.
