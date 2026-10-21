CREATE UNIQUE INDEX "attendance_period_lock_event_one_lock_per_period"
ON "attendance_period_lock_event" ("period_id")
WHERE "action" = 'LOCK';
