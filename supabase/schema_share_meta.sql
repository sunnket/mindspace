-- ===========================================================================
-- Share METADATA — a cheap read for link previews.
--
-- `get_shared_board` (schema_shares.sql) returns the entire board snapshot, and
-- that is correct for the viewer, which needs every object. It is the wrong
-- tool for a link preview: rendering the <title> and the Open Graph card for
-- /s/[token] needs the board's NAME and nothing else, and a board with pasted
-- images carries those images inline as data-URLs — so answering "what is this
-- board called?" could mean shipping tens of megabytes of JSON to a crawler,
-- on every crawl, for a string.
--
-- This returns only what a preview can display. Same token gate, same
-- SECURITY DEFINER pattern, same revoked check as the full read.
--
-- SAFE TO SKIP: the app degrades to a generic (still branded) preview if this
-- function is absent, so deploying it is an improvement, not a prerequisite.
-- ===========================================================================

create or replace function public.get_shared_board_meta(share_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select case
           when revoked then null
           else jsonb_build_object(
             'title', coalesce(nullif(title, ''), 'Untitled board'),
             -- Read the count out of the stored snapshot rather than joining
             -- anything: `data->'objects'` is already there, and jsonb_array_length
             -- does not deserialise the array's contents to count it.
             'objectCount', coalesce(jsonb_array_length(data -> 'objects'), 0),
             'updatedAt', updated_at
           )
         end
  from public.shares
  where token = share_token
  limit 1;
$$;

grant execute on function public.get_shared_board_meta(text) to anon, authenticated;
