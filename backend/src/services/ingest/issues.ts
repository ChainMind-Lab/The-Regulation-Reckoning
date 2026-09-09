/**
 * Issues ingestion pipeline.
 *
 * When `GITHUB_REPO` (and optionally `GITHUB_TOKEN`) are configured, live issues
 * are fetched from the GitHub API with pagination. Otherwise a bundled seed
 * dataset (`backend/data/seed-issues.json`) is used. Both paths validate and
 * persist into the `issues` table with an explicit `source` column
 * (`github` / `seed`) so provenance is always visible.
 *
 * GitHub unauthenticated rate limit is 60 req/hr; set GITHUB_TOKEN for CI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../../db';
import { logger } from '../../logger';
import { metrics } from '../../metrics';
import { config } from '../../config';
import { recordIngestRun } from './policies';

export interface IssueRecord {
  id: string;
  repo: string;
  title: string;
  points: number;
  tags: string[];
  state: 'open' | 'closed';
}

export function validateIssue(r: IssueRecord): string[] {
  const errors: string[] = [];
  if (!r.id) errors.push('issue id missing');
  if (!r.title || r.title.length < 5) errors.push(`title too short for ${r.id}`);
  if (!r.repo) errors.push(`repo missing for ${r.id}`);
  if (!Number.isInteger(r.points) || r.points < 0) errors.push(`points invalid for ${r.id}`);
  if (!Array.isArray(r.tags)) errors.push(`tags invalid for ${r.id}`);
  if (!['open', 'closed'].includes(r.state)) errors.push(`state invalid for ${r.id}`);
  return errors;
}

export function loadSeedIssues(): IssueRecord[] {
  const file = join(__dirname, '..', '..', '..', 'data', 'seed-issues.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { issues: IssueRecord[] };
  return parsed.issues;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: { name: string }[];
  html_url: string;
  body: string | null;
}

/** Fetch open issues from the GitHub API (paginated). */
export async function fetchGithubIssues(repo: string, token: string): Promise<IssueRecord[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const issues: GitHubIssue[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`GitHub repo not found: ${repo}`);
      }
      if (res.status === 403) {
        throw new Error(
          `GitHub API rate limited (${res.headers.get('x-ratelimit-remaining')} remaining)`,
        );
      }
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    }
    const batch = (await res.json()) as GitHubIssue[];
    issues.push(...batch);
    if (batch.length < 100) break;
  }

  return issues
    .filter((i) => !i.title.startsWith('[')) // skip issue-template drafts
    .map((i) => ({
      id: String(i.number),
      repo,
      title: i.title,
      points: pointsFromLabels(i.labels),
      tags: i.labels.map((l) => l.name).slice(0, 5),
      state: i.state,
    }));
}

/** Deterministic point estimate from GitHub labels (documented heuristic). */
export function pointsFromLabels(labels: { name: string }[]): number {
  const names = labels.map((l) => l.name.toLowerCase());
  if (names.some((n) => n.includes('points-500'))) return 500;
  if (names.some((n) => n.includes('points-300') || n.includes('large'))) return 300;
  if (names.some((n) => n.includes('points-200') || n.includes('medium'))) return 200;
  if (names.some((n) => n.includes('good first'))) return 100;
  return 100;
}

export function persistIssues(issues: IssueRecord[], source: 'github' | 'seed'): number {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO issues (id, repo, title, points, tags, state, source, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repo = excluded.repo,
      title = excluded.title,
      points = excluded.points,
      tags = excluded.tags,
      state = excluded.state,
      source = excluded.source,
      ingested_at = excluded.ingested_at
  `);
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const i of issues) {
      const errors = validateIssue(i);
      if (errors.length > 0) {
        throw new Error(`Invalid issue ${i.id}: ${errors.join(', ')}`);
      }
      upsert.run(i.id, i.repo, i.title, i.points, JSON.stringify(i.tags), i.state, source, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  metrics.inc('ingest_records_total', { pipeline: 'issues' }, issues.length);
  return issues.length;
}

export async function ingestIssues(): Promise<{ records: number; source: 'github' | 'seed' }> {
  try {
    if (config.githubRepo) {
      const issues = await fetchGithubIssues(config.githubRepo, config.githubToken);
      const count = persistIssues(issues, 'github');
      recordIngestRun('issues', 'success', count);
      logger.info('ingest.issues: github', { records: count, repo: config.githubRepo });
      return { records: count, source: 'github' };
    }
  } catch (err) {
    logger.warn('ingest.issues: github fetch failed, falling back to seed', {
      err: String(err),
    });
  }
  const seed = loadSeedIssues();
  const count = persistIssues(seed, 'seed');
  recordIngestRun('issues', 'success', count);
  logger.info('ingest.issues: seed fallback', { records: count });
  return { records: count, source: 'seed' };
}
