ALTER TABLE resources ADD COLUMN IF NOT EXISTS search_outline TEXT GENERATED ALWAYS AS (
  CASE WHEN parsed IS NULL THEN NULL
  ELSE COALESCE(parsed::jsonb->>'summary', jsonb_path_query_array(parsed::jsonb, '$.nodes[*].title')::text)
  END
) STORED;
