import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NavBar from '../components/NavBar';
import WaveBanner from '../components/WaveBanner';
import NetworkStatusCard from '../components/NetworkStatusCard';
import IssueCard from '../components/IssueCard';
import TopicCard from '../components/TopicCard';
import ContributorCTA from '../components/ContributorCTA';
import policyTopics from '../data/policyTopics';
import waveInfo from '../data/waveInfo';
import openIssues from '../data/openIssues';

// ── NavBar ────────────────────────────────────────────────────────
describe('NavBar', () => {
  it('renders brand and Wave 5 badge', () => {
    render(<NavBar />);
    expect(screen.getByText(/Regulation Reckoning/i)).toBeInTheDocument();
    expect(screen.getByText(/Wave 5/i)).toBeInTheDocument();
  });

  it('renders all nav links', () => {
    render(<NavBar />);
    ['Wave', 'Network', 'Issues', 'Topics', 'Contribute'].forEach((link) =>
      expect(screen.getByRole('link', { name: link })).toBeInTheDocument()
    );
  });
});

// ── WaveBanner ───────────────────────────────────────────────────
describe('WaveBanner', () => {
  it('displays wave number and budget', () => {
    render(<WaveBanner wave={waveInfo} />);
    expect(screen.getByText(`Wave ${waveInfo.number}`)).toBeInTheDocument();
    // budget appears in both the description and the stat tile
    expect(screen.getAllByText(waveInfo.budget).length).toBeGreaterThanOrEqual(1);
  });

  it('shows upcoming status', () => {
    render(<WaveBanner wave={waveInfo} />);
    expect(screen.getByText(/upcoming/i)).toBeInTheDocument();
  });
});

// ── NetworkStatusCard ────────────────────────────────────────────
describe('NetworkStatusCard', () => {
  it('shows loading state when status is null', () => {
    render(<NetworkStatusCard status={null} error={false} />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
  });

  it('shows error state', () => {
    render(<NetworkStatusCard status={null} error={true} />);
    expect(screen.getByText(/unable to reach/i)).toBeInTheDocument();
  });

  it('renders live network data', () => {
    const status = {
      network: 'Public Global Stellar Network ; September 2015',
      horizon: 'https://horizon.stellar.org',
      protocolVersion: '21',
      latestLedger: '50000000',
      closedAt: '2026-05-16T14:00:00Z',
    };
    render(<NetworkStatusCard status={status} error={false} />);
    expect(screen.getByText('v21')).toBeInTheDocument();
    expect(screen.getByText('#50000000')).toBeInTheDocument();
  });
});

// ── IssueCard ────────────────────────────────────────────────────
describe('IssueCard', () => {
  const issue = openIssues[0];

  it('renders title and points', () => {
    render(<IssueCard issue={issue} />);
    expect(screen.getByText(issue.title)).toBeInTheDocument();
    expect(screen.getByText(`${issue.points} pts`)).toBeInTheDocument();
  });

  it('renders repo link', () => {
    render(<IssueCard issue={issue} />);
    expect(screen.getByRole('link', { name: issue.repo })).toHaveAttribute(
      'href',
      issue.repoUrl
    );
  });
});

// ── TopicCard ────────────────────────────────────────────────────
describe('TopicCard', () => {
  const topic = policyTopics[0];

  it('renders title, summary and tag', () => {
    render(<TopicCard topic={topic} />);
    expect(screen.getByText(topic.title)).toBeInTheDocument();
    expect(screen.getByText(topic.summary)).toBeInTheDocument();
    expect(screen.getByText(topic.tag)).toBeInTheDocument();
  });
});

// ── ContributorCTA ───────────────────────────────────────────────
describe('ContributorCTA', () => {
  it('renders heading and action buttons', () => {
    render(<ContributorCTA />);
    expect(screen.getByRole('heading', { name: /contribute to wave 5/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse wave 5 issues/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /how it works/i })).toBeInTheDocument();
  });
});

// ── Data integrity ───────────────────────────────────────────────
describe('policyTopics data', () => {
  it('has 6 topics with required fields', () => {
    expect(policyTopics).toHaveLength(6);
    policyTopics.forEach((t) => {
      expect(t.id).toBeTruthy();
      expect(t.title).toBeTruthy();
      expect(t.summary).toBeTruthy();
      expect(t.tag).toBeTruthy();
    });
  });
});

describe('openIssues data', () => {
  it('has 6 issues with positive point values', () => {
    expect(openIssues).toHaveLength(6);
    openIssues.forEach((i) => {
      expect(i.points).toBeGreaterThan(0);
      expect(i.tags.length).toBeGreaterThan(0);
    });
  });
});

describe('waveInfo data', () => {
  it('has correct Wave 5 metadata', () => {
    expect(waveInfo.number).toBe(5);
    expect(waveInfo.budget).toBeTruthy();
    expect(['upcoming', 'live', 'ended']).toContain(waveInfo.status);
  });
});
