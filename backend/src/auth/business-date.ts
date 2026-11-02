const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Returns the current business day represented as a UTC midnight Date for DATE columns. */
export function businessDate(now = new Date()): Date {
  const parts = businessDateFormatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('Unable to determine the business date.');
  }
  return new Date(Date.UTC(year, month - 1, day));
}
