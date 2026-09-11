-- What has already been sent.
--
-- The dashboard is a display: it knows a chore is overdue and a bin goes out
-- tonight, and it tells nobody. Notifications close that loop, and the whole
-- difficulty is in this table rather than in the sending.
--
-- The key is what makes that work. It carries the *moment* the reminder is
-- for, not just the thing it is about:
--
--   task-due:<task id>:<due at>          rescheduling a task re-arms it
--   event-soon:<series id>:<occurrence>  a weekly event notifies every week
--   system-fault:<check name>            one row per probe, updated in place
--
-- Rows are also written for reminders that were deliberately *not* sent.
CREATE TABLE notification (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  dedupe_key  text NOT NULL UNIQUE,
  topic       text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  -- When the reminder was for, after any shift out of quiet hours.
  fire_at     timestamptz NOT NULL,
  -- Null when it was suppressed rather than delivered.
  sent_at     timestamptz,
  -- 'stale' when the moment had passed, null when it was actually sent.
  suppressed  text,
  -- For system faults: the error text that was reported, so an unchanged
  -- fault stays quiet and a *different* one is announced.
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The sweep asks "have I already dealt with these keys?" on every run.
CREATE INDEX notification_created_idx ON notification (created_at DESC);
