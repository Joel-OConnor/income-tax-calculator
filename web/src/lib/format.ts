const currency = (digits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const whole = currency(0);
const cents = currency(2);

/** $12,345 */
export const usd = (n: number) => whole.format(Math.round(n) === 0 ? 0 : n);

/** $12,345.67 */
export const usd2 = (n: number) => cents.format(n);

/** +$1,200 or -$1,200 */
export const signedUsd = (n: number) => (Math.round(n) > 0 ? "+" : "") + usd(n);

/** 0.2245 as 22.5% */
export const pct = (rate: number, digits = 1) => `${(rate * 100).toFixed(digits)}%`;

/** A statutory rate with no padding: 0.22 as 22%, 0.05525 as 5.525%. */
export const rate = (r: number) => `${parseFloat((r * 100).toFixed(3))}%`;

/** Axis ticks: $0, $50K, $1.2M */
export function compactUsd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${+(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1_000)}K`;
  return usd(n);
}

/** "3 minutes ago", for a time in the past. */
export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
  ];
  let label = "";
  for (const [size, name] of units) {
    if (seconds >= size) {
      const count = Math.round(seconds / size);
      label = `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return label || "1 minute ago";
}
