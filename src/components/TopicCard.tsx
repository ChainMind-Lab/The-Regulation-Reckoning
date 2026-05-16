import type { PolicyTopic } from '../data/policyTopics';

export default function TopicCard({ topic }: { topic: PolicyTopic }) {
  return (
    <article className="topic-card">
      <div className="topic-icon">{topic.icon}</div>
      <h3>{topic.title}</h3>
      <p>{topic.summary}</p>
      <span className="topic-tag">{topic.tag}</span>
    </article>
  );
}
