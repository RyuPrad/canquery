-- SQLite schema version 2; open a read-only connection. Timestamps/days are UTC.
-- Views include all 30 dates ending today, including the partial current day.
SELECT * FROM history_status;
SELECT * FROM daily_capacity ORDER BY day, device;
SELECT * FROM daily_components ORDER BY day, component;
-- reserved means outcome unknown; never retry that day, even after interruption.
SELECT * FROM component_sizes ORDER BY day;
SELECT * FROM retention_days ORDER BY day;
SELECT * FROM job_minima ORDER BY minimum_available_bytes, first_observed_at;
SELECT * FROM activity_minima ORDER BY day, minimum_available_bytes;
-- Activity reported during the same observation interval, NOT proven overlap.
SELECT * FROM activity_minima WHERE instr(activity, '+') > 0
ORDER BY day, minimum_available_bytes;
