-- Landing pages V2 cleanup (Zoran, 2026-07-08): the two legacy GHL-form entry
-- points for BAM GTA were never connected (enabled=false, no pipeline/stage)
-- and the V2 landing pages route through website forms + booking calendars
-- only. Delete them so the entry-point list reflects the real front doors.
delete from public.entry_points
where client_id = '39875f07-0a4b-4429-a201-2249bc1f24df'
  and type = 'ghl-form'
  and key in ('GLI35e0zHS4cFrft92le', '00MuBSi1GxsRcSqklOkF');
