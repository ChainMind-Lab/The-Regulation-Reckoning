export type PolicyTopic = {
  id: string;
  title: string;
  summary: string;
  focus: string;
};

const policyTopics: PolicyTopic[] = [
  {
    id: 'stellar-network-health',
    title: 'Stellar Network Health',
    summary:
      'Surface Horizon performance, protocol activity, and the network indicators that matter for Stellar builders.',
    focus: 'On-chain metrics, Horizon, performance',
  },
  {
    id: 'policy-signal-mapping',
    title: 'Policy Signal Mapping',
    summary:
      'Connect regulatory developments to Stellar ecosystem risks, compliance signals, and cross-border design decisions.',
    focus: 'Regulatory analysis, risk modeling, jurisdiction mapping',
  },
  {
    id: 'ecosystem-resilience',
    title: 'Ecosystem Resilience',
    summary:
      'Analyze which Stellar-native projects are positioned to survive regulatory pressure and shifting network conditions.',
    focus: 'Resilience modeling, governance, sustainability',
  },
];

export default policyTopics;
