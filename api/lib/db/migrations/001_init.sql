-- ---------------------------------------------------------------------------
-- family-dash initial schema
--
-- Single shared household: there is no member/owner column anywhere, by
-- design. Task assignment is free text.
--
-- Data falls into two categories:
--   * authored locally and authoritative here (tasks, notes, recipes,
--     meal plans, drawings, local events)
--   * fetched from elsewhere and cached (ICS/Google events, news articles,
--     weather, the photo index)
-- The cached tables are refreshed by the background tasks so the UI only
-- ever reads Postgres, which is what keeps the wall display working when the
-- network or a third-party credential goes away.
-- ---------------------------------------------------------------------------

-- Keep `updated_at` honest without every repository having to remember.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- --- settings --------------------------------------------------------------
-- Everything the Settings page writes. One row per key, value is jsonb so a
-- setting can be a scalar, a list of dashboard widgets or a nested object
-- without a migration each time.
CREATE TABLE setting (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER setting_touch BEFORE UPDATE ON setting
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- --- calendar --------------------------------------------------------------
-- One row per configured source. `config` holds the provider-specific bits:
-- the feed URL for ics, the OAuth refresh token and calendar id for google,
-- nothing for local.
CREATE TABLE calendar_source (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL CHECK (type IN ('local', 'ics', 'google')),
  name          text NOT NULL,
  colour        text NOT NULL DEFAULT '#4f8ef7',
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  read_only     boolean NOT NULL DEFAULT false,
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER calendar_source_touch BEFORE UPDATE ON calendar_source
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Local events and the cache of fetched ones share this table so the
-- calendar view is a single query over a single index.
CREATE TABLE event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES calendar_source (id) ON DELETE CASCADE,
  external_uid  text,
  title         text NOT NULL,
  description   text,
  location      text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  rrule         text,
  colour        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_ends_after_start CHECK (ends_at >= starts_at)
);

CREATE TRIGGER event_touch BEFORE UPDATE ON event
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- The upsert key for feed syncs. Partial, because local events have no
-- external uid and several of them may legitimately be NULL.
CREATE UNIQUE INDEX event_source_external_uid_idx
  ON event (source_id, external_uid)
  WHERE external_uid IS NOT NULL;

-- Drives every calendar and dashboard query: "events overlapping this range".
CREATE INDEX event_range_idx ON event (starts_at, ends_at);
CREATE INDEX event_source_idx ON event (source_id);


-- --- tasks and chores ------------------------------------------------------
CREATE TABLE task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  notes         text,
  -- Free text: the household is shared, so this is "Sam" or "whoever's up",
  -- not a foreign key.
  assignee      text,
  category      text,
  priority      smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  due_at        timestamptz,
  completed_at  timestamptz,
  -- NULL for one-offs; 'daily' | 'weekly' | 'monthly' | an RRULE string
  recurrence    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER task_touch BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- The dashboard's "due today and overdue, not done" widget.
CREATE INDEX task_open_due_idx ON task (due_at) WHERE completed_at IS NULL;
CREATE INDEX task_assignee_idx ON task (assignee) WHERE completed_at IS NULL;


-- --- sticky notes ----------------------------------------------------------
-- x/y are fractions of the board (0..1) rather than pixels, so a note stays
-- where it was put when the screen is rotated between portrait and landscape.
CREATE TABLE note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body        text NOT NULL DEFAULT '',
  colour      text NOT NULL DEFAULT '#ffe066',
  x           double precision NOT NULL DEFAULT 0.1 CHECK (x BETWEEN 0 AND 1),
  y           double precision NOT NULL DEFAULT 0.1 CHECK (y BETWEEN 0 AND 1),
  z_index     integer NOT NULL DEFAULT 0,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER note_touch BEFORE UPDATE ON note
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX note_pinned_idx ON note (pinned) WHERE pinned;


-- --- recipes and meal planning --------------------------------------------
-- ingredients: [{ "quantity": "2", "unit": "cup", "item": "flour" }, ...]
-- steps:       ["Preheat the oven", ...]
CREATE TABLE recipe (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  servings      smallint CHECK (servings > 0),
  prep_minutes  smallint CHECK (prep_minutes >= 0),
  cook_minutes  smallint CHECK (cook_minutes >= 0),
  ingredients   jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags          text[] NOT NULL DEFAULT '{}',
  image_path    text,
  source_url    text,
  favourite     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER recipe_touch BEFORE UPDATE ON recipe
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX recipe_tags_idx ON recipe USING gin (tags);
CREATE INDEX recipe_title_idx ON recipe (lower(title));

CREATE TABLE meal_plan (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date    date NOT NULL,
  slot         text NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  -- Either a recipe from the library or a scribbled "leftovers", never neither.
  recipe_id    uuid REFERENCES recipe (id) ON DELETE SET NULL,
  custom_text  text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_plan_has_content CHECK (recipe_id IS NOT NULL OR custom_text IS NOT NULL),
  CONSTRAINT meal_plan_unique_slot UNIQUE (plan_date, slot)
);

CREATE TRIGGER meal_plan_touch BEFORE UPDATE ON meal_plan
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX meal_plan_date_idx ON meal_plan (plan_date);

CREATE TABLE shopping_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  quantity    text,
  category    text,
  checked     boolean NOT NULL DEFAULT false,
  origin      text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'meal_plan')),
  recipe_id   uuid REFERENCES recipe (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER shopping_item_touch BEFORE UPDATE ON shopping_item
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX shopping_item_open_idx ON shopping_item (checked, created_at);


-- --- photos ----------------------------------------------------------------
-- An index of the mounted media volume, not the images themselves. The
-- scanner keeps it in step with the filesystem; album is the subfolder name.
CREATE TABLE photo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rel_path    text NOT NULL UNIQUE,
  album       text NOT NULL DEFAULT '',
  filename    text NOT NULL,
  mime_type   text,
  width       integer,
  height      integer,
  size_bytes  bigint,
  taken_at    timestamptz,
  thumb_path  text,
  favourite   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER photo_touch BEFORE UPDATE ON photo
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX photo_album_idx ON photo (album, taken_at DESC NULLS LAST);


-- --- freehand drawings -----------------------------------------------------
-- Strokes are kept as jsonb so a drawing stays editable (undo, re-open,
-- continue later); the PNG is only a thumbnail for the gallery.
CREATE TABLE drawing (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT 'Untitled',
  strokes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  background  text NOT NULL DEFAULT '#ffffff',
  width       integer NOT NULL DEFAULT 1024,
  height      integer NOT NULL DEFAULT 768,
  thumb_path  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER drawing_touch BEFORE UPDATE ON drawing
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX drawing_recent_idx ON drawing (updated_at DESC);


-- --- news ------------------------------------------------------------------
CREATE TABLE news_feed (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  url            text NOT NULL UNIQUE,
  category       text,
  enabled        boolean NOT NULL DEFAULT true,
  last_fetch_at  timestamptz,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER news_feed_touch BEFORE UPDATE ON news_feed
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE news_article (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id       uuid NOT NULL REFERENCES news_feed (id) ON DELETE CASCADE,
  guid          text NOT NULL,
  title         text NOT NULL,
  link          text,
  summary       text,
  author        text,
  image_url     text,
  published_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_article_unique_guid UNIQUE (feed_id, guid)
);

CREATE INDEX news_article_recent_idx ON news_article (published_at DESC NULLS LAST);


-- --- weather ---------------------------------------------------------------
-- One row per provider+location. The forecast payload is stored whole and
-- reshaped on read, so switching provider does not need a migration.
CREATE TABLE weather_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  location    jsonb NOT NULL,
  payload     jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weather_cache_unique_location UNIQUE (provider, location)
);


-- --- seed ------------------------------------------------------------------
-- A first boot should show a usable dashboard, not a wall of empty states.

-- The always-present, writable calendar. Events created in the UI land here.
INSERT INTO calendar_source (type, name, colour, read_only, config)
VALUES ('local', 'Family', '#4f8ef7', false, '{}'::jsonb);

-- Keyless news to start with; editable in Settings.
INSERT INTO news_feed (name, url, category) VALUES
  ('CBC — Top Stories',  'https://www.cbc.ca/webfeed/rss/rss-topstories',        'general'),
  ('CBC — British Columbia', 'https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia', 'local'),
  ('BBC — World',        'https://feeds.bbci.co.uk/news/world/rss.xml',          'world');

INSERT INTO setting (key, value) VALUES
  ('appearance.theme',            '"dark"'::jsonb),
  ('appearance.accent',           '"#4f8ef7"'::jsonb),
  ('appearance.clock24Hour',      'true'::jsonb),
  ('appearance.screensaverMinutes', '0'::jsonb),
  ('dashboard.widgets',           '["calendar","tasks","weather","meal","notes","news","photos"]'::jsonb),
  ('weather.units',               '"metric"'::jsonb),
  ('news.maxArticles',            '30'::jsonb),
  ('news.retentionDays',          '7'::jsonb),
  ('photos.slideshowSeconds',     '20'::jsonb),
  ('calendar.defaultView',        '"month"'::jsonb),
  ('calendar.weekStartsOn',       '0'::jsonb),
  ('tasks.showCompleted',         'false'::jsonb);
