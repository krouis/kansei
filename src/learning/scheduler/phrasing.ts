/**
 * Turning numbers into sentences a learner can read.
 *
 * Deliberately vague ("about three weeks"). The underlying interval is a model
 * estimate with fuzz applied; printing "20.7 days" would dress a guess up as a
 * measurement. For the same reason nothing here ever produces a percentage:
 * Kansei does not show mastery as a number.
 */

/** Plain-language duration for an interval in fractional days. */
export function humaniseDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return 'right away';
  const minutes = days * 24 * 60;
  if (minutes < 90) {
    const m = Math.max(1, Math.round(minutes));
    return `about ${m} minute${m === 1 ? '' : 's'}`;
  }
  if (days < 1.5) {
    const h = Math.round(days * 24);
    return `about ${h} hours`;
  }
  if (days < 14) {
    const d = Math.round(days);
    return `about ${d} day${d === 1 ? '' : 's'}`;
  }
  if (days < 60) {
    const w = Math.round(days / 7);
    return `about ${w} week${w === 1 ? '' : 's'}`;
  }
  const months = Math.round(days / 30);
  return `about ${months} month${months === 1 ? '' : 's'}`;
}

/** "3 different days" / "1 different day" without the usual pluralisation bugs. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
