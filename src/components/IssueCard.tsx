import type { OpenIssue } from '../data/openIssues';

const TAG_CLASS: Record<string, string> = {
  'good-first': 'good-first',
  research: 'research',
  engineering: 'engineering',
};

export default function IssueCard({ issue }: { issue: OpenIssue }) {
  return (
    <article className="issue-card">
      <div className="issue-card-top">
        <h3>{issue.title}</h3>
        <span className="issue-points">{issue.points} pts</span>
      </div>
      <p className="issue-repo">
        <a href={issue.repoUrl} target="_blank" rel="noreferrer">
          {issue.repo}
        </a>
      </p>
      <div className="issue-tags">
        {issue.tags.map((t) => (
          <span key={t} className={`issue-tag ${TAG_CLASS[t] ?? ''}`}>
            {t.replace('-', ' ')}
          </span>
        ))}
      </div>
    </article>
  );
}
