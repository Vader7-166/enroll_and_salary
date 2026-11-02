import { ConflictException } from "@nestjs/common";
export interface HolidayCalendar { dates: string[]; status: "SIMULATION" | "BUSINESS_CONFIRMED"; reference: string }
 export function holidayCalendar(value: unknown): HolidayCalendar {
  const item = value as unknown as HolidayCalendar;
  if (!item || !Array.isArray(item.dates) || !["SIMULATION", "BUSINESS_CONFIRMED"].includes(item.status) || typeof item.reference !== "string" || !item.reference.trim() || item.dates.some(day => typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) || new Set(item.dates).size !== item.dates.length) throw new ConflictException("Lịch lễ không hợp lệ; cần danh sách dates YYYY-MM-DD, status và reference.");
  return item;
}
