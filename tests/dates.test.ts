import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonthsClamped, ruleDate, scheduleDate, todayIn, toWeekday } from "../lib/dates.ts";

test("green = 21 days after last contact", () => {
  assert.equal(ruleDate("green", "2026-11-02"), "2026-11-23");
});
test("yellow = 2 calendar months, clamped", () => {
  assert.equal(ruleDate("yellow", "2026-11-02"), "2027-01-02");
  assert.equal(addMonthsClamped("2026-12-31", 2), "2027-02-28");
  assert.equal(addMonthsClamped("2027-12-31", 2), "2028-02-29");
});
test("red = no follow-up", () => {
  assert.equal(ruleDate("red", "2026-11-02"), null);
});
test("weekend reminders move to Monday", () => {
  assert.equal(toWeekday("2026-11-07"), "2026-11-09");
  assert.equal(toWeekday("2026-11-09"), "2026-11-09");
});
test("on-time reminder uses rule date", () => {
  const load = new Map();
  assert.equal(scheduleDate("2026-11-23", "2026-11-02", null, load), "2026-11-23");
});
test("overdue reminders spread max 3 per weekday from tomorrow", () => {
  const load = new Map<string, number>();
  const got = Array.from({ length: 7 }, () => scheduleDate("2026-06-01", "2026-11-06", null, load));
  // 2026-11-06 is a Friday → tomorrow is Saturday → first slot Monday 11-09
  assert.deepEqual(got, ["2026-11-09", "2026-11-09", "2026-11-09", "2026-11-10", "2026-11-10", "2026-11-10", "2026-11-11"]);
});
test("overdue contact already slotted in the future keeps its date", () => {
  assert.equal(scheduleDate("2026-06-01", "2026-11-02", "2026-11-05", new Map()), "2026-11-05");
});
test("todayIn respects time zone", () => {
  const now = new Date("2026-11-03T03:00:00Z"); // 9pm Nov 2 in Chicago
  assert.equal(todayIn("America/Chicago", now), "2026-11-02");
  assert.equal(todayIn("UTC", now), "2026-11-03");
});
