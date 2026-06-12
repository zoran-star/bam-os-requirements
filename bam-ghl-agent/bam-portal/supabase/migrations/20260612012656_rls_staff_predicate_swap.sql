-- Swap "any authenticated user" policies for is_staff() on staff-only tables.
-- Prep for parent accounts sharing this auth realm (fc-mobile parent app).
-- Verified 2026-06-11 against prod: all staff rows have user_id linked; the
-- invite-staff flow links user_id at creation (api/clients.js); client portal
-- and API paths are unaffected (service-role bypasses RLS; the client portal's
-- defensive staff lookup returns empty instead of erroring).

DROP POLICY "Staff can read all staff" ON public.staff;
CREATE POLICY "Staff can read all staff" ON public.staff
  FOR SELECT USING (is_staff());
DROP POLICY "staff_read" ON public.website_leads;
CREATE POLICY "staff_read" ON public.website_leads
  FOR SELECT USING (is_staff());
DROP POLICY "Allow all for authenticated" ON public.portal_feedback;
CREATE POLICY "Staff full access" ON public.portal_feedback
  FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
DROP POLICY "Scenarios readable by authenticated" ON public.sm_scenarios;
CREATE POLICY "Scenarios readable by staff" ON public.sm_scenarios
  FOR SELECT USING (is_staff());
DROP POLICY "Units readable by authenticated" ON public.sm_units;
CREATE POLICY "Units readable by staff" ON public.sm_units
  FOR SELECT USING (is_staff());
DROP POLICY "Roles readable" ON public.sm_user_roles;
CREATE POLICY "Roles readable by staff" ON public.sm_user_roles
  FOR SELECT USING (is_staff());
DROP POLICY "Authenticated read guide cards" ON public.guide_cards;
CREATE POLICY "Staff read guide cards" ON public.guide_cards
  FOR SELECT USING (is_staff());
