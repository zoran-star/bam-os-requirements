import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Dev-only role override personas. Activated by localStorage key "dev_role".
// Set via the dev role switcher in the bottom-left of the screen.
const DEV_PERSONAS = {
  zoran:    { id: "55e35cac-4472-4788-ab2a-4f30c7183904", name: "Zoran (admin)",            role: "admin",             email: "zoran@byanymeansbball.com" },
  mike:     { id: "dev-mike",                              name: "Mike (admin)",             role: "admin",             email: "mike@byanymeansbball.com" },
  manager:  { id: "4fe042f4-d890-45c3-a55f-8d18423373dd", name: "Rosano (systems_manager)", role: "systems_manager",   email: "rarandila@gmail.com" },
  executor: { id: "6e876f7f-6e17-443d-a032-5f28fa0c908b", name: "Chris (systems_executor)", role: "systems_executor",  email: "mcdelostrinos@gmail.com" },
  jenny:    { id: "98694d3f-ad3c-4607-85a3-f3900789970a", name: "Jenny (systems_executor)", role: "systems_executor",  email: "jennybabeco@gmail.com" },
  mkt_mgr:  { id: "dev-mkt-mgr",                           name: "Marketing Manager (dev)",  role: "marketing_manager", email: "marketing@bam.dev" },
  mkt_exec: { id: "dev-mkt-exec",                          name: "Marketing Executor (dev)", role: "marketing_executor", email: "marketing-exec@bam.dev" },
};

export function useStaffMe(session) {
  const [me, setMe] = useState(null);
  const [override, setOverride] = useState(() => localStorage.getItem("dev_role"));

  // Listen for dev_role changes (set by role switcher)
  useEffect(() => {
    const handler = () => setOverride(localStorage.getItem("dev_role"));
    window.addEventListener("dev-role-change", handler);
    return () => window.removeEventListener("dev-role-change", handler);
  }, []);

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
        if (data && !data.user_id && session.user.id) {
          supabase.from("staff").update({ user_id: session.user.id }).eq("id", data.id);
        }
      });
    return () => { cancelled = true; };
  }, [session?.user?.email, session?.user?.id]);

  if (override && DEV_PERSONAS[override]) return DEV_PERSONAS[override];
  return me;
}

export const DEV_ROLE_PERSONAS = DEV_PERSONAS;
