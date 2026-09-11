-- Generated map artwork for the screensaver.
--
-- The alternative to the photo slideshow: a stylised street map of a randomly
-- chosen city, rendered here and cached, so an install with no pictures, or
-- one whose owner would rather not put family photographs on a kitchen wall, 
-- still has something worth looking at when it goes idle.
--
-- This is a cache table in the same sense as `news_article` and
-- `weather_cache`: every row can be deleted and regenerated from the city list
-- and a tile server. What makes it worth storing rather than drawing on demand
-- is that drawing one costs a few megabytes of vector tiles and a second or two
-- of CPU, and the screensaver is the part of the display that has to keep
-- working when the network does not.
--
-- Two files are kept per artwork. The SVG is the master, resolution
-- independent, and the thing to hand someone who wants to print one. The raster
-- is what the screensaver actually loads, because decoding a WebP is the
-- cheapest possible thing to ask of a Raspberry Pi driving a wall panel, and it
-- keeps the idle screen's cost identical to showing a photograph.
CREATE TABLE city_art (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which entry in the curated list this came from. Not a foreign key: the
  -- list is code, not data, and an artwork should survive a city being
  -- renamed or dropped from it.
  city_key     text NOT NULL,
  city_name    text NOT NULL,
  region       text NOT NULL,
  country      text NOT NULL DEFAULT '',
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  theme        text NOT NULL,
  -- Paths are relative to the city-art directory on the media volume, in the
  -- same way `photo.rel_path` is relative to the library.
  svg_path     text NOT NULL UNIQUE,
  raster_path  text,
  width        integer NOT NULL,
  height       integer NOT NULL,
  -- Roughly how much was drawn. A hamlet with three lanes in OpenStreetMap
  -- produces a near-empty picture, and this is what lets the generator notice
  -- that and choose somewhere else rather than putting it on the wall.
  feature_count integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER city_art_touch BEFORE UPDATE ON city_art
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- The screensaver asks for the newest few; the generator asks what it has
-- already drawn so it can prefer somewhere it has not been lately.
CREATE INDEX city_art_created_idx ON city_art (created_at DESC);
CREATE INDEX city_art_city_idx ON city_art (city_key, created_at DESC);
