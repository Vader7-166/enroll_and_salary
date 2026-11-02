import Decimal from "decimal.js";
import { INSURANCE_KINDS, type InsuranceKind } from "../insurance-engine";

// Pure month-over-month rules for insurance increase/decrease/adjustment lists (FR-8.3.1, BR-51).

export type Amounts = Record<InsuranceKind, { employee: string; employer: string }>;
export interface MonthState {
  month: string;
  /** Employee's unit at the month's last covered day belongs to the list's site. */
  present: boolean;
  eligible: Record<InsuranceKind, boolean>;
  reasonCode: string;
  base: Record<InsuranceKind, string> | null;
  contribution: Amounts | null;
  hireDate: string;
  terminationDate: string | null;
  maternity: boolean;
  sources: Record<string, unknown>;
}
export type ChangeKind = "INCREASE" | "DECREASE" | "ADJUST";
export interface ChangeEvent {
  type: ChangeKind; reason: string; effectiveDate: string;
  old: { eligible: Record<InsuranceKind, boolean>; base: Record<InsuranceKind, string> | null };
  new: { eligible: Record<InsuranceKind, boolean>; base: Record<InsuranceKind, string> | null };
}

export function monthBounds(month: string) {
  const [year, value] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(year, value - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10) };
}
export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

const on = (state: MonthState) => state.present && state.eligible.BHXH;
const sameKinds = (left: MonthState, right: MonthState) => INSURANCE_KINDS.every(kind => left.eligible[kind] === right.eligible[kind]);

/**
 * The single change a month introduces against the previous month. A termination is reported in its own month
 * (effective on the termination date) and never again afterwards.
 */
export function detectChange(prev: MonthState, cur: MonthState): ChangeEvent | null {
  const { from, to } = monthBounds(cur.month);
  const snapshot = (state: MonthState) => ({ eligible: { ...state.eligible }, base: state.base ? { ...state.base } : null });
  const event = (type: ChangeKind, reason: string, effectiveDate: string): ChangeEvent => ({ type, reason, effectiveDate, old: snapshot(prev), new: snapshot(cur) });
  const termination = cur.terminationDate;
  if (termination && termination < from) return null;
  if (termination && termination <= to) return on(prev) || on(cur) ? event("DECREASE", "TERMINATION", termination) : null;
  if (!on(prev) && on(cur)) {
    const hired = cur.hireDate >= from && cur.hireDate <= to;
    const reason = hired ? "NEW_HIRE" : !prev.present ? "TRANSFER_IN" : ["UNPAID_LEAVE_14_DAYS", "MATERNITY"].includes(prev.reasonCode) ? "RETURN_TO_WORK" : "ELIGIBLE_CONTRACT";
    return event("INCREASE", reason, hired ? cur.hireDate : from);
  }
  if (on(prev) && !on(cur)) return event("DECREASE", !cur.present ? "TRANSFER_OUT" : cur.maternity ? "MATERNITY" : cur.reasonCode, from);
  if (on(prev) && on(cur)) {
    if (!sameKinds(prev, cur)) return event("ADJUST", "PARTICIPATION_CHANGE", from);
    if (prev.base && cur.base && !new Decimal(prev.base.BHXH).eq(cur.base.BHXH)) return event("ADJUST", "SALARY_CHANGE", from);
  }
  return null;
}

/** What one month owes when its declared state differs from the correct one: + arrears, − refund (per kind). */
export function arrearsFor(declared: MonthState | null, correct: MonthState) {
  const amounts = (state: MonthState | null) => state && on(state) && state.contribution ? state.contribution : null;
  const owed = amounts(correct), paid = amounts(declared);
  const perKind = {} as Amounts;
  let total = new Decimal(0);
  for (const kind of INSURANCE_KINDS) {
    const employee = new Decimal(owed?.[kind].employee ?? 0).minus(paid?.[kind].employee ?? 0);
    const employer = new Decimal(owed?.[kind].employer ?? 0).minus(paid?.[kind].employer ?? 0);
    perKind[kind] = { employee: employee.toString(), employer: employer.toString() };
    total = total.plus(employee).plus(employer);
  }
  if (total.isZero()) return null;
  return { month: correct.month, direction: total.gt(0) ? "ARREARS" as const : "REFUND" as const, perKind, total: total.toString() };
}
