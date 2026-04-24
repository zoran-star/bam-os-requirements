// Feedback Service — submit feedback from portal, query status
import { supabase } from "../lib/supabase";

export async function submitFeedback({ body, source = "text", page = "", author = "Mike" }) {
  try {
    // Save to Supabase
    const { data: row, error: dbError } = await supabase
      .from("portal_feedback")
      .insert({ body, source, page, author })
      .select()
      .single();
    if (dbError) throw dbError;

    // Post to Slack via API route
    try {
      await fetch("/api/slack/channels?action=feedback-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, body, source, page, author }),
      });
    } catch (slackErr) {
      console.warn("Slack notification failed:", slackErr);
    }

    return { data: row, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchFeedbackItems({ status } = {}) {
  try {
    let q = supabase.from("portal_feedback").select("*").order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}
