export type WaveInfo = {
  number: number;
  status: 'upcoming' | 'live' | 'ended';
  budget: string;
  startDate: string;
  endDate: string;
  totalRepos: number;
  totalIssues: number;
};

const waveInfo: WaveInfo = {
  number: 5,
  status: 'upcoming',
  budget: '$75,000',
  startDate: 'May 2026',
  endDate: 'TBA',
  totalRepos: 540,
  totalIssues: 74283,
};

export default waveInfo;
