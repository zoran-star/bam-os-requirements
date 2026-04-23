import { useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { T } from "../tokens/tokens";
import TrainingHome from "./views/TrainingHome";
import QuickFireMode from "./views/QuickFireMode";
import ReviewFeed from "./views/ReviewFeed";
import CalibrationMode from "./views/CalibrationMode";
import AddScenario from "./views/AddScenario";
import AdminHub from "./views/AdminHub";
import TeamDashboard from "./views/TeamDashboard";
import ScenarioFeedbackView from "./views/ScenarioFeedbackView";

export default function TrainingApp() {
  const [session, setSession] = useState(undefined);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const tk = T.dark;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) fetchRole(s.user.id);
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) fetchRole(s.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function fetchRole(userId) {
    const { data } = await supabase
      .from("sm_user_roles")
      .select("role, display_name")
      .eq("user_id", userId)
      .single();
    setUserRole(data);
    setLoading(false);
  }

  if (loading || session === undefined) {
    return (
      <div style={{ background: tk.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: tk.textSub, fontSize: 14, fontFamily: "Inter, sans-serif" }}>Loading...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  if (!userRole) {
    return (
      <div style={{ background: tk.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
        <div style={{ color: tk.text, fontSize: 18, fontFamily: "Inter, sans-serif", fontWeight: 600 }}>No Training Access</div>
        <div style={{ color: tk.textSub, fontSize: 14, fontFamily: "Inter, sans-serif" }}>You haven't been assigned a training role yet.</div>
        <div
          onClick={() => window.location.href = "/"}
          style={{ marginTop: 12, padding: "8px 20px", background: "transparent", border: `1px solid ${tk.accent}`, color: tk.accent, borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "Inter, sans-serif" }}
        >
          Back to Portal
        </div>
      </div>
    );
  }

  return (
    <>
    <style>{`html,body{margin:0;padding:0;background:${tk.bg};}`}</style>
    <Routes>
      <Route path="/" element={<TrainingHome tk={tk} session={session} userRole={userRole} navigate={navigate} />} />
      <Route path="/session/quick-fire" element={<QuickFireMode tk={tk} session={session} userRole={userRole} navigate={navigate} />} />
      <Route path="/admin" element={<AdminHub role={userRole?.role} navigate={navigate} />} />
      <Route path="/team" element={<TeamDashboard role={userRole?.role} userId={session.user.id} navigate={navigate} />} />
      <Route path="/review" element={<ReviewFeed role={userRole?.role} userId={session.user.id} />} />
      <Route path="/calibrate" element={<CalibrationMode role={userRole?.role} userId={session.user.id} />} />
      <Route path="/add-scenario" element={<AddScenario role={userRole?.role} userId={session.user.id} />} />
      <Route path="/scenario-feedback" element={<ScenarioFeedbackView role={userRole?.role} navigate={navigate} />} />
      {/* Phase 5: Progress */}
      {/* <Route path="/units" element={<UnitMap />} /> */}
      {/* <Route path="/progress" element={<ProgressView />} /> */}
    </Routes>
    </>
  );
}
