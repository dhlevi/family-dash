-- Repeating events on the local calendar.
--
-- Tasks have had recurrence since the beginning; events have not, which left
-- the one thing you would most want to repeat. swimming on Tuesdays, rent on
-- the first, as the one thing you had to type in again every week. Tasks are
-- not a workaround for it either: they never appear on the calendar.
--
-- Occurrences are NOT materialised. A subscribed feed is expanded into
-- concrete rows at sync time because the upstream is the authority and the
-- rows are a cache; a local series is the authority, so storing one row and
-- expanding it on read means there is no horizon to keep topped up, no
-- background job, and an edit takes effect everywhere at once instead of
-- leaving stale copies beyond whatever window was last filled.
--
-- `rrule` is left exactly as it was. It holds the RRULE text of feed events
-- for reference and is not interpreted here; `recurrence` is the short,
-- touchscreen-sized vocabulary the task list already uses.
ALTER TABLE event ADD COLUMN recurrence text;

-- When the series stops. NULL repeats indefinitely, which is what a bin
-- collection or a weekly club does.
ALTER TABLE event ADD COLUMN recurrence_until timestamptz;

-- Occurrences that have been deleted individually.
-- Holding the exceptions on the series keeps the whole thing in one row, so
-- deleting the series cannot leave orphaned exception rows behind.
ALTER TABLE event ADD COLUMN excluded_at timestamptz[] NOT NULL DEFAULT '{}';

-- The range query has to consider every open series regardless of when it
-- started, so it cannot rely on the starts_at index alone. Partial, because
-- all but a handful of rows are one-offs.
CREATE INDEX event_recurring_idx ON event (starts_at) WHERE recurrence IS NOT NULL;
