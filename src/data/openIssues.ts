export type OpenIssue = {
  id: string;
  title: string;
  repo: string;
  repoUrl: string;
  points: number;
  tags: string[];
};

const openIssues: OpenIssue[] = [
  {
    id: '1',
    title: 'Add Horizon API integration for live regulatory signal feed',
    repo: 'The-Regulation-Reckoning',
    repoUrl: 'https://github.com/The-Regulation-Reckoning',
    points: 200,
    tags: ['engineering', 'good-first'],
  },
  {
    id: '2',
    title: 'Build policy jurisdiction mapping component with Stellar network data',
    repo: 'The-Regulation-Reckoning',
    repoUrl: 'https://github.com/The-Regulation-Reckoning',
    points: 300,
    tags: ['engineering'],
  },
  {
    id: '3',
    title: 'Write research chapter: Stellar protocol upgrades and regulatory impact',
    repo: 'The-Regulation-Reckoning',
    repoUrl: 'https://github.com/The-Regulation-Reckoning',
    points: 150,
    tags: ['research', 'good-first'],
  },
  {
    id: '4',
    title: 'Implement on-chain transaction analytics dashboard',
    repo: 'The-Regulation-Reckoning',
    repoUrl: 'https://github.com/The-Regulation-Reckoning',
    points: 400,
    tags: ['engineering'],
  },
  {
    id: '5',
    title: 'Add contributor leaderboard with Drips Wave points tracking',
    repo: 'The-Regulation-Reckoning',
    repoUrl: 'https://github.com/The-Regulation-Reckoning',
    points: 250,
    tags: ['engineering', 'good-first'],
  },
  {
    id: '6',
    title: 'Document Stellar Soroban smart contract compliance patterns',
    repo: 'The-Regulation-Reckoning',
    repoUrl: 'https://github.com/The-Regulation-Reckoning',
    points: 100,
    tags: ['research', 'good-first'],
  },
];

export default openIssues;
