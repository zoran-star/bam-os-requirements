import { supabase } from "../../lib/supabase";

// ─── Sessions ───

export async function getOrCreateTodaySession(userId) {
  const today = new Date().toISOString().split("T")[0];

  // Try to get existing session
  const { data: existing } = await supabase
    .from("sm_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  if (existing) return existing;

  // Create new session
  const { data, error } = await supabase
    .from("sm_sessions")
    .insert({ user_id: userId, date: today })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSession(sessionId, updates) {
  const { data, error } = await supabase
    .from("sm_sessions")
    .update(updates)
    .eq("id", sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Daily Queue ───

export async function getDailyQueue(userId, sessionId) {
  const { data, error } = await supabase
    .from("sm_daily_queue")
    .select(`
      *,
      scenario:sm_scenarios(*)
    `)
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("queue_order", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function markQueueItemComplete(queueItemId) {
  const { error } = await supabase
    .from("sm_daily_queue")
    .update({ is_completed: true })
    .eq("id", queueItemId);
  if (error) throw error;
}

// ─── Scenarios ───

export async function getScenariosByUnit(unitId, type = null) {
  let query = supabase
    .from("sm_scenarios")
    .select("*")
    .eq("unit_id", unitId)
    .eq("is_active", true);

  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function getAllActiveScenarios(type = null) {
  let query = supabase
    .from("sm_scenarios")
    .select("*, unit:sm_units(title, slug)")
    .eq("is_active", true);

  if (type) query = query.eq("type", type);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// ─── Responses ───

export async function saveResponse(response) {
  const { data, error } = await supabase
    .from("sm_responses")
    .insert(response)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRecentResponses(userId, limit = 5) {
  const { data, error } = await supabase
    .from("sm_responses")
    .select(`
      *,
      scenario:sm_scenarios(title, type, tags)
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ─── Progress ───

export async function getUserProgress(userId) {
  const { data, error } = await supabase
    .from("sm_progress")
    .select(`
      *,
      unit:sm_units(*)
    `)
    .eq("user_id", userId)
    .order("unit(order_index)", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getOrCreateProgress(userId, unitId) {
  const { data: existing } = await supabase
    .from("sm_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("unit_id", unitId)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from("sm_progress")
    .insert({ user_id: userId, unit_id: unitId, status: "in_progress" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Units ───

export async function getUnits() {
  const { data, error } = await supabase
    .from("sm_units")
    .select("*")
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  if (error) throw error;
  return data || [];
}

// ─── Streak ───

export async function getStreak(userId) {
  const { data, error } = await supabase
    .from("sm_sessions")
    .select("date, is_complete")
    .eq("user_id", userId)
    .eq("is_complete", true)
    .order("date", { ascending: false })
    .limit(60);

  if (error) return 0;
  if (!data || data.length === 0) return 0;

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < data.length; i++) {
    const sessionDate = new Date(data[i].date);
    sessionDate.setHours(0, 0, 0, 0);

    const expected = new Date(today);
    expected.setDate(expected.getDate() - i);

    if (sessionDate.getTime() === expected.getTime()) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

// ─── AI Evaluation ───

export async function evaluateResponse(scenarioId, responseText, conversationHistory = null) {
  const res = await fetch("/api/training", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "evaluate", scenarioId, responseText, conversationHistory }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Evaluation failed" }));
    throw new Error(err.error || "Evaluation failed");
  }

  return res.json();
}

// ─── Queue Generation ───

export async function generateDailyQueue(userId) {
  const res = await fetch("/api/training", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "generate-queue", userId }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Queue generation failed" }));
    throw new Error(err.error || "Queue generation failed");
  }

  return res.json();
}
