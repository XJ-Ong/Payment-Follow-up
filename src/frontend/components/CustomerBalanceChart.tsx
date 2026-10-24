import { money, type CustomerBalance } from '../model';

export default function CustomerBalanceChart({
  data,
  total,
}: {
  data: CustomerBalance[];
  total: number;
}) {
  const maximum = Math.max(0, ...data.map((customer) => customer.balance));
  return (
    <section
      className="card chart-card balance-chart"
      aria-labelledby="balance-chart-title"
    >
      <div className="section-title">
        <div>
          <h2 id="balance-chart-title">Outstanding by Customer</h2>
        </div>
        <span className="chart-unit">
          <span />
          Outstanding balance (MYR)
        </span>
      </div>
      <div className="chart-subheader">
        <span className="chart-total">
          {money(total)}
          <small>Total</small>
        </span>
        <span className="chart-note">
          Includes do-not-contact customers
        </span>
      </div>
      {data.length === 0 ? (
        <p className="balance-empty">No customer balances to display.</p>
      ) : (
        <ul className="balance-rows" aria-label="Outstanding balances by customer">
          {data.map((customer, index) => (
            <li className="balance-row" key={`${customer.name}-${index}`}>
              <div className="balance-label">
                <span>{customer.name}</span>
                <strong>{money(customer.balance)}</strong>
              </div>
              <div className="balance-track" aria-hidden="true">
                <div
                  className="balance-fill"
                  style={{
                    width: `${maximum > 0 ? (Math.max(0, customer.balance) / maximum) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
