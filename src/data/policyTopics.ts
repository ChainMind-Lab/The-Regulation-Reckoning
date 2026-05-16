export type PolicyTopic = {
  id: string;
  icon: string;
  title: string;
  summary: string;
  tag: string;
};

const policyTopics: PolicyTopic[] = [
  {
    id: 'network-health',
    icon: '⬡',
    title: 'Stellar Network Health',
    summary: 'Surface Horizon performance, protocol activity, and the network indicators that matter for Stellar builders navigating regulatory change.',
    tag: 'On-chain metrics',
  },
  {
    id: 'policy-signals',
    icon: '⚖️',
    title: 'Policy Signal Mapping',
    summary: 'Connect regulatory developments to Stellar ecosystem risks, compliance signals, and cross-border design decisions in real time.',
    tag: 'Regulatory analysis',
  },
  {
    id: 'resilience',
    icon: '🛡️',
    title: 'Ecosystem Resilience',
    summary: 'Analyze which Stellar-native projects are positioned to survive regulatory pressure and shifting network conditions.',
    tag: 'Resilience modeling',
  },
  {
    id: 'rwa',
    icon: '🏦',
    title: 'Real-World Asset Tokenization',
    summary: 'Track the $2B+ RWA ecosystem on Stellar — compliance frameworks, tokenization patterns, and institutional adoption signals.',
    tag: 'RWA · DeFi',
  },
  {
    id: 'soroban',
    icon: '🔧',
    title: 'Soroban Smart Contracts',
    summary: 'Explore how Soroban-based contracts interact with compliance requirements, escrow patterns, and cross-border payment rails.',
    tag: 'Soroban · Rust',
  },
  {
    id: 'payments',
    icon: '💸',
    title: 'Cross-Border Payments',
    summary: 'Map how Stellar\'s $5.5B payment volume intersects with stablecoin regulation, CBDC frameworks, and humanitarian finance.',
    tag: 'Payments · USDC',
  },
];

export default policyTopics;
