import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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
        // Backfill user_id on first login
        if (data && !data.user_id && session.user.id) {
          supabase.from("staff").update({ user_id: session.user.id }).eq("id", data.id);
        }
      });
    return () => { cancelled = true; };
  }, [session?.user?.email, session?.user?.id]);

  return me;
}
