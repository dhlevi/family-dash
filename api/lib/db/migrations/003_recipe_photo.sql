-- Recipe images become photo library entries.
--
-- The original `image_path` column predated the Pictures page and was never
-- written to, so nothing is lost by replacing it. Pointing at `photo` instead
-- of holding a path means a recipe picture is an ordinary library photo: it
-- can be uploaded once and reused, it gets the same thumbnail treatment, and
-- deleting it from the library clears the reference rather than leaving the
-- recipe showing a broken image.
ALTER TABLE recipe DROP COLUMN IF EXISTS image_path;

ALTER TABLE recipe
  ADD COLUMN photo_id uuid REFERENCES photo(id) ON DELETE SET NULL;
