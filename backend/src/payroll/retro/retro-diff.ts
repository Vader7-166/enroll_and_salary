import Decimal from "decimal.js";

// Pure retro difference: replay of a locked period minus its original snapshot, per line key and per total.
export const TOTALS = ["gross", "insuranceEmployee", "unionFee", "insuranceEmployer", "tax", "deductions", "adjustments", "net"] as const;
export type Totals = Record<(typeof TOTALS)[number], string>;
export interface SnapshotEmployee { employeeId: string; status: string; totals: Totals; lines: Array<{ lineType: string; label: string; componentCode: string | null; amount: string }> }
const lineKey = (line: { lineType: string; componentCode: string | null; label: string }) => line.lineType + "|" + (line.componentCode ?? line.label);

/** Line and total differences, replay − original snapshot, per line key (FR-7.4.1, TC-P09). */
export function retroDiff(before: { totals: Totals; lines: SnapshotEmployee["lines"] }, after: { totals: Totals; lines: SnapshotEmployee["lines"] }) {
  const sums = (lines: SnapshotEmployee["lines"]) => lines.filter(line => line.lineType !== "NET").reduce((map, line) => map.set(lineKey(line), { line, amount: (map.get(lineKey(line))?.amount ?? new Decimal(0)).plus(line.amount) }), new Map<string, { line: SnapshotEmployee["lines"][number]; amount: Decimal }>());
  const left = sums(before.lines), right = sums(after.lines);
  const lines = [...new Set([...left.keys(), ...right.keys()])].map(item => {
    const a = left.get(item)?.amount ?? new Decimal(0), b = right.get(item)?.amount ?? new Decimal(0);
    const line = right.get(item)?.line ?? left.get(item)!.line;
    return { key: item, lineType: line.lineType, label: line.label, before: a.toString(), after: b.toString(), diff: b.minus(a).toString() };
  }).filter(line => !new Decimal(line.diff).isZero());
  const diff = Object.fromEntries(TOTALS.map(name => [name, new Decimal(after.totals[name] ?? 0).minus(before.totals[name] ?? 0).toString()])) as Totals;
  return { lines, diff };
}
