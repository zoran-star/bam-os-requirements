// Vercel Serverless Function — Stripe webhook (Connect events)
//
// Listens for first-payment events on connected academy accounts and
// links the resulting Stripe customer/subscription to the matching
// member row (created earlier by api/members/intake.js when the GHL
// form was submitted). Matches by parent_email.
//
// Events handled:
//   - customer.subscription.created   (the first sub creation = first payment)
//
// Future: invoice.payment_succeeded (for catch-up / repeated reconcile),
//         customer.subscription.deleted (auto-cancel), etc.
//
// Connect: the event payload has `account` set to the connected account
// id when it originated there. We use the platform key + Stripe-Account
// header to fetch the customer (needed for email since sub object alone
// doesn't include it).

import crypto from "node:crypto";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STRIPE_API = "https://api.stripe.com/v1";

// Stripe signature verification requires the raw request body. Disable
// Vercel's default JSON body parser for this route.
export const config = { api: { bodyParser: false } };

function nowIso() { return new Date().toISOString(); }

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Verify the Stripe-Signature header per
// https://stripe.com/docs/webhooks/signatures
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map(p => {
      const idx = p.indexOf("=");
      return [p.slice(0, idx), p.slice(idx + 1)];
    })
  );
  if (!parts.t || !parts.v1) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(parts.v1, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch (_) { return false; }
}

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function stripeFetch(path, stripeAccount) {
  const stripeSecret = process.env.STRIPE_CONNECT_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const headers = { Authorization: `Bearer ${stripeSecret}` };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  const res = await fetch(`${STRIPE_API}${path}`, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Stripe ${res.status}: ${txt}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await readRawBody(req);
  const sig     = req.headers["stripe-signature"];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  if (!verifyStripeSignature(rawBody, sig, secret)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  let event;
  try { event = JSON.parse(rawBody); }
  catch (_) { return res.status(400).json({ error: "invalid JSON" }); }

  const connectedAccount = event.account || null;

  if (event.type === "customer.subscription.created") {
    try {
      const sub = event.data && event.data.object;
      if (!sub) return res.status(200).json({ skipped: "no sub object" });
      const customerId = sub.customer;
      // Sub object doesn't carry the customer email — fetch the customer.
      const customer = await stripeFetch(`/customers/${customerId}`, connectedAccount);
      const email = ((customer && customer.email) || "").toLowerCase().trim();
      if (!email) return res.status(200).json({ skipped: "no customer email" });

      // Match the oldest pending member with this parent email + no sub yet.
      // Siblings (one parent → many athletes) are handled by FIFO matching:
      // the first sub created links to the first pending row, second to the
      // second, etc.
      const candidates = await sb(
        `members?status=eq.payment_method_required` +
        `&parent_email=eq.${encodeURIComponent(email)}` +
        `&stripe_subscription_id=is.null` +
        `&select=id,client_id,athlete_name,parent_email` +
        `&order=created_at.asc&limit=1`
      );
      const target = Array.isArray(candidates) && candidates[0];

      if (!target) {
        // No pending row to link — log it as an orphan for visibility.
        try {
          await sb(`member_audit_log`, {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{
              client_id:         null,
              member_id:         null,
              action_type:       "stripe-intake-orphan",
              args:              { event_id: event.id, customer_email: email, sub_id: sub.id, connected_account: connectedAccount },
              performed_by_name: "Stripe webhook",
            }]),
          });
        } catch (_) {}
        return res.status(200).json({ skipped: "no pending member for email", email });
      }

      await sb(`members?id=eq.${target.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status:                 "live",
          stripe_customer_id:     customerId,
          stripe_subscription_id: sub.id,
          updated_at:             nowIso(),
        }),
      });

      try {
        await sb(`member_audit_log`, {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{
            client_id:         target.client_id,
            member_id:         target.id,
            action_type:       "intake-stripe-link",
            args:              { event_id: event.id, sub_id: sub.id, customer_id: customerId },
            performed_by_name: "Stripe webhook",
            stripe_response:   { id: sub.id, status: sub.status },
            db_changes:        { members: { status: "payment_method_required → live", linked: true } },
          }]),
        });
      } catch (_) {}

      return res.status(200).json({ ok: true, linked_member_id: target.id });
    } catch (e) {
      // Return 200 so Stripe doesn't retry endlessly. Log for inspection.
      console.error("stripe webhook subscription.created error:", e.message);
      return res.status(200).json({ error: e.message });
    }
  }

  // Other event types accepted-but-ignored.
  return res.status(200).json({ skipped: event.type });
}
