// Reference meaning of an income schedule (`phaseOut.points` in schema.ts).
// The tax engine should use this function rather than reimplement it.

export type SchedulePoint = { income: number; value: number };

/**
 * The schedule's value at a given income.
 *
 * step:   a point's value applies to income ABOVE its `income`. The first
 *         point has income 0 and also covers an income of exactly 0.
 * linear: straight lines between points. Flat before the first point and
 *         after the last.
 */
export function scheduleValue(
  points: SchedulePoint[],
  interpolation: "linear" | "step",
  income: number,
): number {
  if (interpolation === "step") {
    let value = points[0].value;
    for (const p of points) if (income > p.income) value = p.value;
    return value;
  }
  if (income <= points[0].income) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (income <= b.income) {
      return a.value + ((b.value - a.value) * (income - a.income)) / (b.income - a.income);
    }
  }
  return points[points.length - 1].value;
}
