import { useEffect, useState } from 'react';
import { ArrowDownLeft } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money, type CustomerBalance } from '../model';

export default function CustomerBalanceChart({
  data,
  total,
}: {
  data: CustomerBalance[];
  total: number;
}) {
  const [compact, setCompact] = useState(
    () => window.matchMedia('(max-width: 600px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const change = () => setCompact(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return (
    <section className="card chart-card">
      <div className="section-title">
        <div>
          <h2>Outstanding by Customer</h2>
          <p>A clearer picture of where your receivables stand.</p>
        </div>
        <span className="chart-unit">
          <span />
          Outstanding balance (MYR)
        </span>
      </div>
      <div className="chart-subheader">
        <span className="chart-total">
          {money(total)}
          <small>Total outstanding</small>
        </span>
        <span className="chart-note">
          <ArrowDownLeft size={15} />
          Includes all customers, including do-not-contact
        </span>
      </div>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={compact ? 'vertical' : 'horizontal'}
            margin={{
              top: compact ? 12 : 28,
              right: compact ? 78 : 18,
              left: compact ? 0 : 12,
              bottom: 8,
            }}
            accessibilityLayer
          >
            <CartesianGrid
              strokeDasharray="3 5"
              vertical={compact}
              horizontal={!compact}
              stroke="#e9edf4"
            />
            <XAxis
              dataKey={compact ? undefined : 'name'}
              type={compact ? 'number' : 'category'}
              tickFormatter={compact ? (v) => `${v / 1000}k` : undefined}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: compact ? 9 : 11, fill: '#7d899e' }}
              interval={compact ? 'preserveStartEnd' : 0}
              height={38}
            />
            <YAxis
              dataKey={compact ? 'name' : undefined}
              type={compact ? 'category' : 'number'}
              axisLine={false}
              tickLine={false}
              tickFormatter={compact ? undefined : (v) => `${v / 1000}k`}
              tick={{ fontSize: compact ? 9 : 11, fill: '#8a96a9' }}
              width={compact ? 113 : 40}
            />
            <Tooltip
              cursor={{ fill: '#f5f8ff' }}
              formatter={(v) => [money(Number(v)), 'Outstanding']}
              contentStyle={{
                border: '1px solid #e3e8f1',
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="balance"
              isAnimationActive={false}
              fill="#4c83f4"
              radius={compact ? [0, 4, 4, 0] : [5, 5, 0, 0]}
              maxBarSize={compact ? 20 : 64}
              label={{
                position: compact ? 'right' : 'top',
                formatter: (v: unknown) =>
                  `MYR\u00a0${Number(v).toLocaleString('en-MY')}`,
                fill: '#61718b',
                fontSize: compact ? 9 : 11,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" aria-label="Outstanding balances by customer">
        {data.map((c) => (
          <li key={c.name}>
            {c.name}: {money(c.balance)}
          </li>
        ))}
      </ul>
    </section>
  );
}
