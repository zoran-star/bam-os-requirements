import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Resolves the current staff member from the logged-in session by email.
// Returns the staff row ({ id, name, role, email, user_id }) or null.
export function useStaffMe(session) {
  const [me, setMe] = useState(null);

  useEffect(() => {
    const email = session?.user?.email;
    if (!email) {
      setMe(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("staff")
      .select("id,name,role,email,user_id")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setMe(data || null);
        // Backfill user_id on the staff row the first time we see this user.
        if (data && !data.user_id && session.user.id) {
          supabase.from("staff").update({ user_id: session.user.id }).eq("id", data.id);
        }
      });
    return () => { cancelled = true; };
  }, [session?.user?.email, session?.user?.id]);

  return me;
}
