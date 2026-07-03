import { withSentryApiRoute } from "../_sentry.js";
// Messaging spine (2/5): import an academy's FULL GoHighLevel conversation history
// into the provider-agnostic own-store (sms_threads + sms_messages, provider='ghl')
// BEFORE it cuts over to Twilio, so no past conversations are lost.
//
//   POST /api/messaging/import-ghl-history { client_id, max_pages? }   (STAFF only)
//     → pages GHL /conversations/search, pulls each thread's messages, upserts into
//       sms_threads / sms_messages. Idempotent (re-run anytime to catch up): existing
//       ghl_message_ids are skipped, threads upsert on (client_id, contact_phone).
//
// Read-only against GHL. Writes only to our own store. Dormant w.r.t. live messaging.

import { pickGhlToken, ghl } from "../ghl/_core.js";

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function requireStaff(req) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  // The migration watcher (cron) triggers the catch-up import at cutover time.
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return "migration-watch";
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
  if (!r.ok) return null;
  const user = await r.json();
  if (!user?.id) return null;
  let staff = await sb(`staff?user_id=eq.${user.id}&select=role&limit=1`);
  if ((!staff || !staff[0]) && user.email) staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=role&limit=1`);
  return Array.isArray(staff) && staff[0] ? (user.email || "staff") : null;
}

// Best-effort channel tag from GHL message type (number or string).
function channelOf(m) {
  const t = String(m.type ?? m.messageType ?? "").toLowerCase();
  if (t.includes("sms") || t === "1") return "sms";
  if (t.includes("email") || t === "3") return "email";
  if (t.includes("call")) return "call";
  return "other";
}
const norm = (v) => (v == null ? "" : String(v));

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const staff = await requireStaff(req);
  if (!staff) return res.status(401).json({ error: "staff only" });

  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (!b.client_id) return res.status(400).json({ error: "client_id required" });
  // Chunked: each call processes at most a few pages AND stops at a wall-clock budget
  // (well under the function timeout), returning a cursor the client re-submits. This
  // turns one long request that times out (-> HTML error -> "not valid JSON") into many
  // short ones the UI can show live progress for.
  const maxPages = Math.min(Number(b.max_pages) || 20, 50);
  const DEADLINE = Date.now() + 12000; // 12s budget; client loops until done

  const rows = await sb(`clients?id=eq.${encodeURIComponent(b.client_id)}&select=id,business_name,ghl_access_token,ghl_refresh_token,ghl_token_expires_at,ghl_location_id&limit=1`);
  const client = rows && rows[0];
  if (!client) return res.status(404).json({ error: "academy not found" });

  const creds = await pickGhlToken(client);
  if (!creds || !creds.token) return res.status(400).json({ error: "no GHL token/location for this academy" });
  const { token, locationId } = creds;
  if (!locationId) return res.status(400).json({ error: "no GHL location_id" });

  let convScanned = 0, threadsUpserted = 0, msgInserted = 0, msgSkipped = 0, pages = 0;
  // Resume from the cursor the previous chunk returned (null on the first call).
  let startAfterDate = b.start_after_date || null, startAfter = b.start_after || null;
  let done = false;
  const seenConvIds = new Set();

  try {
    while (pages < maxPages) {
      pages++;
      const params = new URLSearchParams({ locationId, limit: "100" });
      if (startAfterDate) params.set("startAfterDate", String(startAfterDate));
      if (startAfter) params.set("startAfter", String(startAfter));
      const data = await ghl("GET", `/conversations/search?${params}`, { token });
      const convos = data.conversations || data.data || [];
      if (!convos.length) { done = true; break; }

      for (const convo of convos) {
        if (!convo || seenConvIds.has(convo.id)) continue;
        seenConvIds.add(convo.id);
        convScanned++;

        const phone = norm(convo.phone || convo.contactPhone).trim();
        const contactId = norm(convo.contactId || convo.contact_id);
        const contactPhone = phone || (contactId ? `ghl:${contactId}` : `ghl-conv:${convo.id}`);
        const contactName = norm(convo.fullName || convo.contactName || convo.name).trim() || null;

        // Upsert the thread (unique on client_id, contact_phone).
        const threadRows = await sb(`sms_threads?on_conflict=client_id,contact_phone`, {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify([{
            client_id: client.id, contact_phone: contactPhone, ghl_contact_id: contactId || null,
            contact_name: contactName,
          }]),
        });
        const thread = Array.isArray(threadRows) ? threadRows[0] : null;
        if (!thread) continue;
        threadsUpserted++;

        // Pull this conversation's messages.
        let messages = [];
        try {
          const md = await ghl("GET", `/conversations/${encodeURIComponent(convo.id)}/messages?limit=100`, { token });
          messages = md.messages?.messages || md.messages || md.data || [];
        } catch (_) { messages = []; }
        if (!messages.length) continue;

        // Skip messages already imported (idempotent).
        const ids = messages.map((m) => m.id).filter(Boolean);
        let existing = new Set();
        if (ids.length) {
          const inList = ids.map((x) => `"${x}"`).join(",");
          const ex = await sb(`sms_messages?client_id=eq.${client.id}&ghl_message_id=in.(${encodeURIComponent(inList)})&select=ghl_message_id`);
          existing = new Set((ex || []).map((r) => r.ghl_message_id));
        }
        const fresh = messages.filter((m) => m.id && !existing.has(m.id));
        msgSkipped += messages.length - fresh.length;
        if (!fresh.length) continue;

        const payload = fresh.map((m) => ({
          thread_id: thread.id, client_id: client.id, provider: "ghl",
          direction: (m.direction === "outbound" ? "outbound" : "inbound"),
          channel: channelOf(m),
          body: m.body || m.message || "",
          status: m.status || null,
          ghl_message_id: m.id,
          ghl_conversation_id: convo.id,
          occurred_at: m.dateAdded || m.createdAt || m.timestamp || new Date().toISOString(),
          raw: m,
        }));
        await sb(`sms_messages`, {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(payload),
        });
        msgInserted += payload.length;

        // Stamp the thread's last_message_* from the newest message in this convo
        // (use the full set so re-runs still reflect the true latest).
        let latest = null;
        for (const m of messages) {
          const t = m.dateAdded || m.createdAt || m.timestamp;
          if (t && (!latest || new Date(t) > new Date(latest.t))) {
            latest = { t, body: m.body || m.message || "", dir: m.direction === "outbound" ? "outbound" : "inbound" };
          }
        }
        if (latest) {
          await sb(`sms_threads?id=eq.${thread.id}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              last_message_at: latest.t,
              last_preview: (latest.body || "").slice(0, 160),
              last_direction: latest.dir,
              updated_at: new Date().toISOString(),
            }),
          }).catch(() => {});
        }
      }

      // advance the cursor; stop if GHL didn't give us a full page
      const last = convos[convos.length - 1];
      startAfterDate = last?.lastMessageDate || last?.dateUpdated || last?.dateAdded || null;
      startAfter = last?.id || null;
      if (convos.length < 100 || !startAfterDate) { done = true; break; }
      if (Date.now() > DEADLINE) break; // budget hit -> return cursor so the client resumes
    }
  } catch (e) {
    return res.status(e.status || 502).json({
      error: `import failed: ${e.message}`,
      progress: { pages, convScanned, threadsUpserted, msgInserted, msgSkipped },
    });
  }

  return res.status(200).json({
    ok: true, done, client_id: client.id, business_name: client.business_name,
    cursor: done ? null : { start_after_date: startAfterDate, start_after: startAfter },
    pages, conversations_scanned: convScanned, threads_upserted: threadsUpserted,
    messages_imported: msgInserted, messages_skipped: msgSkipped,
  });
}

export default withSentryApiRoute(handler);
