// Slack Service — calls /api/slack/* with per-user auth, returns empty data on error
import { supabase } from "../lib/supabase";

// Cache-bust param to avoid stale 304s from Vercel edge
const nocache = () => `_t=${Date.now()}`;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}`, "Cache-Control": "no-cache" };
  }
  return { "Cache-Control": "no-cache" };
}

export async function fetchChannels() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/slack/channels?${nocache()}`, { headers });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return { data: json.data || [], error: null };
  } catch (err) {
    console.warn("Slack channels fetch failed:", err.message);
    return { data: [], error: err.message };
  }
}

export async function fetchMessages(channelId) {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/slack/channels?channel=${encodeURIComponent(channelId)}&${nocache()}`, { headers });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return { data: json.data || [], error: null };
  } catch (err) {
    console.warn("Slack messages fetch failed:", err.message);
    return { data: [], error: err.message };
  }
}

export async function fetchMembers(channelId) {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/slack/channels?channel=${encodeURIComponent(channelId)}&mode=members&${nocache()}`, { headers });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return { data: json.data || [], error: null };
  } catch (err) {
    console.warn("Slack members fetch failed:", err.message);
    return { data: [], error: err.message };
  }
}

export async function sendMessage(channelId, text) {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/slack/channels", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channelId, text }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return { data: json.data, error: null };
  } catch (err) {
    console.warn("Slack send failed:", err.message);
    return { data: null, error: err.message };
  }
}

// Slack connection status + OAuth helpers
export async function fetchSlackStatus() {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/slack/channels?action=status", { headers });
    return await res.json();
  } catch {
    return { connected: false };
  }
}

export async function disconnectSlack() {
  const headers = await getAuthHeaders();
  const res = await fetch("/api/slack/channels?action=disconnect", {
    method: "POST",
    headers,
  });
  return await res.json();
}

export async function getSlackOAuthUrl() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return `/api/slack/channels?action=oauth-start&token=${session.access_token}`;
}
