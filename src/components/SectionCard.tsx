export type PolicyTopic = {
  id: string;
  title: string;
  summary: string;
  focus: string;
};

type Props = {
  topic: PolicyTopic;
};

export default function SectionCard({ topic }: Props) {
  return (
    <article className="card">
      <h3>{topic.title}</h3>
      <p>{topic.summary}</p>
      <p className="focus">Focus: {topic.focus}</p>
    </article>
  );
}
