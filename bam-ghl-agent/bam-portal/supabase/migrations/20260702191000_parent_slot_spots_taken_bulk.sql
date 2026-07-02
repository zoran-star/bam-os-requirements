-- Parent shared slot capacity bulk read.
--
-- This is the ONLY sanctioned way to get occupancy for many slots; do not
-- hand-count reservations/trials in app code.

CREATE OR REPLACE FUNCTION public.slot_spots_taken_bulk(
    p_tenant_id uuid,
    p_slot_ids uuid[]
)
RETURNS TABLE (slot_id uuid, spots_taken integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        s.id AS slot_id,
        public.slot_spots_taken(p_tenant_id, s.id) AS spots_taken
    FROM (
        SELECT DISTINCT ids.id
        FROM unnest(COALESCE(p_slot_ids, ARRAY[]::uuid[])) AS ids(id)
    ) AS input_ids
    JOIN public.schedule_slots s
      ON s.id = input_ids.id
     AND s.tenant_id = p_tenant_id;
$$;

REVOKE ALL ON FUNCTION public.slot_spots_taken_bulk(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slot_spots_taken_bulk(uuid, uuid[]) TO service_role;
