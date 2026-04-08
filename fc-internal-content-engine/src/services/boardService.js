// Board Service — CRUD for chessboard canvas items
import { supabase } from "../lib/supabase";

export async function fetchBoardItems() {
  try {
    const { data, error } = await supabase
      .from("board_items")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function createBoardItem(item) {
  try {
    const { data, error } = await supabase
      .from("board_items")
      .insert(item)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function updateBoardItem(id, fields) {
  try {
    const { data, error } = await supabase
      .from("board_items")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function deleteBoardItem(id) {
  try {
    const { error } = await supabase.from("board_items").delete().eq("id", id);
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

export async function bulkUpdatePositions(items) {
  // items = [{ id, x, y }, ...]
  try {
    const promises = items.map(({ id, x, y }) =>
      supabase.from("board_items").update({ x, y, updated_at: new Date().toISOString() }).eq("id", id)
    );
    await Promise.all(promises);
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

// Fetch board columns (stored as a single config row)
export async function fetchBoardConfig() {
  try {
    const { data, error } = await supabase
      .from("board_config")
      .select("*")
      .single();
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
    return { data: data || null, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function saveBoardConfig(config) {
  try {
    // Upsert the single config row
    const { data, error } = await supabase
      .from("board_config")
      .upsert({ id: "default", ...config, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}
