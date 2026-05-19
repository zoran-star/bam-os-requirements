// Thin wrapper around /api/messages so views don't repeat fetch boilerplate.
import { supabase } from "../lib/supabase";

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const tok = session?.access_token;
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

async function req(url, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export const listConversations = () =>
  req(`/api/messages?action=list-conversations`).then(r => r.conversations || []);

export const listMessages = (conversationId, { before, limit = 50 } = {}) => {
  const qs = new URLSearchParams({ conversation_id: conversationId, limit: String(limit) });
  if (before) qs.set("before", before);
  return req(`/api/messages?${qs.toString()}`).then(r => r.messages || []);
};

export const sendMessage = ({ conversation_id, body, files = [] }) =>
  req(`/api/messages?action=send`, {
    method: "POST",
    body: JSON.stringify({ conversation_id, body, files }),
  }).then(r => r.message);

export const editMessage = (message_id, body) =>
  req(`/api/messages?action=edit`, {
    method: "POST",
    body: JSON.stringify({ message_id, body }),
  }).then(r => r.message);

export const deleteMessage = (message_id) =>
  req(`/api/messages?action=delete`, {
    method: "POST",
    body: JSON.stringify({ message_id }),
  });

export const markRead = (conversation_id, last_read_at) =>
  req(`/api/messages?action=mark-read`, {
    method: "POST",
    body: JSON.stringify({ conversation_id, last_read_at }),
  });

// Upload a single file directly to the message-attachments bucket.
// Returns { url, name, size, mime } — pass into sendMessage({ files: [...] }).
export async function uploadAttachment(file, conversationId) {
  if (!conversationId) throw new Error("conversationId required for upload path");
  // Path: {conversation_id}/{uuid}-{filename}
  const safeName = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniq = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${conversationId}/${uniq}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from("message-attachments")
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { data: urlData } = supabase.storage.from("message-attachments").getPublicUrl(path);
  return { url: urlData.publicUrl, name: file.name, size: file.size, mime: file.type };
}
