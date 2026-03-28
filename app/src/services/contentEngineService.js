// Content Engine Service — all Supabase CRUD for themes, messages, scripts, feedback
//
// SETUP: Update the import path below to match your project's supabase client location
import { supabase } from "../lib/supabase";

// ─── Themes ───

export async function fetchThemes({ mode, creator, phase } = {}) {
  try {
    let q = supabase.from("content_themes").select("*, content_messages(count)").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (mode) q = q.eq("mode", mode);
    if (creator && creator !== "all") q = q.eq("creator", creator);
    if (phase !== undefined && phase !== null) q = q.eq("phase", phase);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createTheme(theme) {
  try {
    const { data, error } = await supabase.from("content_themes").insert(theme).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateTheme(id, fields) {
  try {
    const { data, error } = await supabase.from("content_themes").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function deleteTheme(id) {
  try {
    const { error } = await supabase.from("content_themes").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Messages ───

export async function fetchMessages(themeId) {
  try {
    let q = supabase.from("content_messages").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (themeId) q = q.eq("theme_id", themeId);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createMessage(msg) {
  try {
    const { data, error } = await supabase.from("content_messages").insert(msg).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateMessage(id, fields) {
  try {
    const { data, error } = await supabase.from("content_messages").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function deleteMessage(id) {
  try {
    const { error } = await supabase.from("content_messages").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Scripts ───

export async function fetchScripts(messageId) {
  try {
    const { data, error } = await supabase.from("content_scripts").select("*").eq("message_id", messageId).order("version", { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createScript(script) {
  try {
    const { data, error } = await supabase.from("content_scripts").insert(script).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateScriptStatus(id, status) {
  try {
    const { data, error } = await supabase.from("content_scripts").update({ status }).eq("id", id).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ─── Feedback ───

export async function fetchFeedback(scriptId) {
  try {
    const { data, error } = await supabase.from("content_feedback").select("*").eq("script_id", scriptId).order("created_at", { ascending: false });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createFeedback(fb) {
  try {
    const { data, error } = await supabase.from("content_feedback").insert(fb).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ─── Bulk ───

export async function massImportThemes(rows) {
  try {
    const { data, error } = await supabase.from("content_themes").insert(rows).select();
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function massImportMessages(rows) {
  try {
    const { data, error } = await supabase.from("content_messages").insert(rows).select();
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}
