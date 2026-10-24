import { ChartNoAxesColumnIncreasing } from 'lucide-react';

export default function RankingExplanation({
  explanation,
}: {
  explanation?: string | null;
}) {
  if (!explanation) return null;
  return (
    <section
      className="ranking-explanation"
      aria-label="Why this invoice needs attention"
    >
      <div className="ranking-explanation-header">
        <span className="ranking-explanation-icon">
          <ChartNoAxesColumnIncreasing size={18} aria-hidden="true" />
        </span>
        <h3>Why this invoice needs attention</h3>
      </div>
      <p>{explanation}</p>
      <span className="ranking-explanation-source">Template-generated</span>
    </section>
  );
}
