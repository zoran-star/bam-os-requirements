// Content Engine Service — all Supabase CRUD for themes, creatives, scripts, feedback
// Auto-syncs to Notion on every write operation
//
// SETUP: Update the import path below to match your project's supabase client location
import { supabase } from "../lib/supabase";

// ─── Notion Sync (fire-and-forget) ───
const SYNC_API = "/api/sync-notion";

function syncNotion(action, type, data, parentThemeName) {
  fetch(SYNC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, type, data, parentThemeName }),
  }).catch(err => console.warn("Notion sync failed (non-blocking):", err.message));
}

// ─── Themes ───

export async function fetchThemes({ mode, creator, phase } = {}) {
  try {
    let q = supabase.from("content_themes").select("*, content_creatives(count)").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
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
    if (data) syncNotion("upsert", "theme", data);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateTheme(id, fields) {
  try {
    const { data, error } = await supabase.from("content_themes").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw error;
    if (data) syncNotion("upsert", "theme", data);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function deleteTheme(id) {
  try {
    const { error } = await supabase.from("content_themes").delete().eq("id", id);
    if (error) throw error;
    syncNotion("delete", "theme", { id });
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Creatives ───

export async function fetchCreatives(themeId) {
  try {
    let q = supabase.from("content_creatives").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false });
    if (themeId) q = q.eq("theme_id", themeId);
    const { data, error } = await q;
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createCreative(creative, parentThemeName) {
  try {
    const { data, error } = await supabase.from("content_creatives").insert(creative).select().single();
    if (error) throw error;
    if (data) syncNotion("upsert", "creative", data, parentThemeName);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateCreative(id, fields, parentThemeName) {
  try {
    const { data, error } = await supabase.from("content_creatives").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) throw error;
    if (data) syncNotion("upsert", "creative", data, parentThemeName);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function deleteCreative(id) {
  try {
    const { error } = await supabase.from("content_creatives").delete().eq("id", id);
    if (error) throw error;
    syncNotion("delete", "creative", { id });
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Scripts ───

export async function fetchScripts(creativeId) {
  try {
    const { data, error } = await supabase.from("content_scripts").select("*").eq("creative_id", creativeId).order("version", { ascending: false });
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

export async function massImportCreatives(rows) {
  try {
    const { data, error } = await supabase.from("content_creatives").insert(rows).select();
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}
