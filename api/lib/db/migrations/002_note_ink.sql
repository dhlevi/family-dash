-- ---------------------------------------------------------------------------
-- Handwritten sticky notes
--
-- A note is either typed or drawn. Drawn notes store their strokes as jsonb
-- in the coordinate space they were captured in, alongside that space's
-- dimensions:
--
--   strokes = [{ "colour": "#1a1f2b", "width": 3, "points": [{"x":12,"y":40,"p":0.5}, ...] }]
--
-- Storing capture-space pixels plus `ink_width`/`ink_height` rather than
-- normalised 0..1 coordinates means an SVG viewBox reproduces the writing at
-- any size without distorting it — normalising each axis independently would
-- stretch handwriting whenever a note is rendered at a different aspect
-- ratio (a corkboard note versus a dashboard widget, say).
--
-- `p` is stylus pressure, 0..1. It is captured and kept even though notes
-- currently render at a constant width, so switching to variable-width
-- strokes later does not need everyone to redraw their notes.
-- ---------------------------------------------------------------------------

ALTER TABLE note
  ADD COLUMN kind        text NOT NULL DEFAULT 'text',
  ADD COLUMN strokes     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN ink_width   integer,
  ADD COLUMN ink_height  integer;

ALTER TABLE note
  ADD CONSTRAINT note_kind_known CHECK (kind IN ('text', 'ink'));

-- A drawn note without its capture dimensions cannot be rendered at all.
ALTER TABLE note
  ADD CONSTRAINT note_ink_has_dimensions
  CHECK (kind <> 'ink' OR (ink_width IS NOT NULL AND ink_width > 0
                           AND ink_height IS NOT NULL AND ink_height > 0));

-- The corkboard and the dashboard widget both read pinned notes first.
CREATE INDEX note_board_order_idx ON note (z_index, created_at);
