import { withSentryApiRoute } from "../_sentry.js";
// A2P 10DLC registration for one academy (ISV model): register THEIR business
// under their subaccount so their number can text US recipients.
//
//   POST /api/twilio/register-a2p
//   body: {
//     client_id,                     required - must have a config row (subaccount)
//     legal_name, ein,               required - EXACTLY as registered with the IRS
//     address: { street, city, region, postal_code },   required (US)
//     website,                       required (their site; carriers check it)
//     rep: { first_name, last_name, email, phone, title },   required
//     business_type: "Limited Liability Corporation" | "Corporation" | ...,
//     vertical: "EDUCATION" (default),
//   }
//
// Chain (each stage stores its SID and is skipped on re-run - resumable):
//   ① Secondary Customer Profile (+ business EndUser, rep EndUser,
//     address SupportingDocument, primary-profile link) → evaluate → submit
//   ② A2P TrustProduct (+ us_a2p_messaging_profile EndUser, links) → submit
//   ③ Brand registration (their profile + trust product)
//   ④ Messaging Service (webhooks → the portal spine)
//   ⑤ Usa2p campaign (LOW_VOLUME use case, academy templates)
//     → fills a2p_campaign_sid; the migration watcher polls it to VERIFIED
//     and attaches the number to the Messaging Service at cutover.
//
// GATES: the BAM master's PRIMARY business profile must be APPROVED (TrustHub).
// Until then stage ① fails cleanly and the chain resumes later from zero cost.
//
// All calls run AS THE SUBACCOUNT (Twilio scopes A2P objects per account).
// Auth: Bearer CRON_SECRET or BAM staff JWT.

import { sb } from "./_voice.js";
import { decryptSecret } from "../messaging/_crypto.js";

const PROD = "https://portal.byanymeansbusiness.com";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Twilio-published static policy SIDs (same for every account).
const POLICY_SECONDARY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
// VERIFY ON FIRST LIVE RUN: the A2P TrustProduct policy sid. Env-overridable.
const POLICY_A2P = process.env.TWILIO_A2P_POLICY_SID || "RNb0d4771c2c98518d916a3d4cd70a8f8b";

const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

async function twx(auth, method, url, form) {
  let body;
  if (form) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else p.append(k, v);
    }
    body = p.toString();
  }
  const r = await fetch(url, {
    method,
    headers: { Authorization: auth, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${r.status} ${url.replace(/https:\/\/|\.twilio\.com.*?\/v1|\.json.*/g, "")}: ${j.message || j.code || "error"}`);
  return j;
}

async function isStaff(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  let staff = await sb(`staff?user_id=eq.${user.id}&select=id&limit=1`).catch(() => null);
  if ((!staff || !staff[0]) && user.email) {
    staff = await sb(`staff?email=eq.${encodeURIComponent(user.email)}&select=id&limit=1`).catch(() => null);
  }
  return Array.isArray(staff) && !!staff[0];
}

async function save(clientId, patch) {
  await sb(`client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await isStaff(req))) return res.status(401).json({ error: "unauthorized" });

  const b = (req.body && typeof req.body === "object") ? req.body : {};
  const clientId = String(b.client_id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: "client_id must be a uuid" });
  const need = (v, name) => { if (!v || !String(v).trim()) throw Object.assign(new Error(`${name} required`), { status: 400 }); return String(v).trim(); };

  try {
    const legalName = need(b.legal_name, "legal_name");
    const ein = need(b.ein, "ein").replace(/\D/g, "");
    if (ein.length !== 9) return res.status(400).json({ error: "ein must be 9 digits (XX-XXXXXXX)" });
    const addr = b.address || {};
    const street = need(addr.street, "address.street"), city = need(addr.city, "address.city");
    const region = need(addr.region, "address.region"), postal = need(addr.postal_code, "address.postal_code");
    const website = need(b.website, "website");
    const rep = b.rep || {};
    const repFirst = need(rep.first_name, "rep.first_name"), repLast = need(rep.last_name, "rep.last_name");
    const repEmail = need(rep.email, "rep.email"), repPhone = need(rep.phone, "rep.phone");
    const repTitle = String(rep.title || "Owner").trim();
    const bizType = String(b.business_type || "Limited Liability Corporation").trim();
    const vertical = String(b.vertical || "EDUCATION").trim();

    const rows = await sb(
      `client_twilio_config?client_id=eq.${encodeURIComponent(clientId)}` +
      `&select=account_sid,auth_token_enc,from_number,a2p_profile_sid,a2p_trust_product_sid,a2p_brand_sid,messaging_service_sid,a2p_campaign_sid&limit=1`
    );
    const cfg = rows && rows[0];
    if (!cfg || !cfg.account_sid) return res.status(404).json({ error: "no twilio config/subaccount for this client - run provision or start-migration first" });
    if (cfg.a2p_campaign_sid) return res.status(200).json({ ok: true, already_registered: true, campaign_sid: cfg.a2p_campaign_sid });

    const clients = await sb(`clients?id=eq.${encodeURIComponent(clientId)}&select=business_name&limit=1`);
    const bizName = (clients && clients[0] && clients[0].business_name) || legalName;

    const token = cfg.auth_token_enc ? decryptSecret(cfg.auth_token_enc) : null;
    if (!token) return res.status(500).json({ error: "subaccount creds missing/undecryptable" });
    const auth = basic(cfg.account_sid, token);
    const TH = "https://trusthub.twilio.com/v1";
    const MSG = "https://messaging.twilio.com/v1";
    const done = [];

    // ── ① Secondary Customer Profile ──
    let profileSid = cfg.a2p_profile_sid;
    if (!profileSid) {
      const prof = await twx(auth, "POST", `${TH}/CustomerProfiles`, {
        FriendlyName: `a2p: ${bizName}`.slice(0, 64),
        Email: "zoran@byanymeansbusiness.com",
        PolicySid: POLICY_SECONDARY,
      });
      profileSid = prof.sid;

      const bizEU = await twx(auth, "POST", `${TH}/EndUsers`, {
        Type: "customer_profile_business_information",
        FriendlyName: `${bizName} business info`.slice(0, 64),
        Attributes: JSON.stringify({
          business_name: legalName,
          business_type: bizType,
          business_industry: vertical,
          business_registration_identifier: "EIN",
          business_registration_number: ein,
          business_identity: "direct_customer",
          business_regions_of_operation: "USA_AND_CANADA",
          website_url: website,
        }),
      });
      await twx(auth, "POST", `${TH}/CustomerProfiles/${profileSid}/EntityAssignments`, { ObjectSid: bizEU.sid });

      const repEU = await twx(auth, "POST", `${TH}/EndUsers`, {
        Type: "authorized_representative_1",
        FriendlyName: `${bizName} rep`.slice(0, 64),
        Attributes: JSON.stringify({
          first_name: repFirst, last_name: repLast, email: repEmail,
          phone_number: repPhone, business_title: repTitle, job_position: "CEO",
        }),
      });
      await twx(auth, "POST", `${TH}/CustomerProfiles/${profileSid}/EntityAssignments`, { ObjectSid: repEU.sid });

      const address = await twx(auth, "POST", `https://api.twilio.com/2010-04-01/Accounts/${cfg.account_sid}/Addresses.json`, {
        FriendlyName: `${bizName} HQ`.slice(0, 64), CustomerName: legalName,
        Street: street, City: city, Region: region, PostalCode: postal, IsoCountry: "US",
      });
      const doc = await twx(auth, "POST", `${TH}/SupportingDocuments`, {
        Type: "customer_profile_address",
        FriendlyName: `${bizName} address`.slice(0, 64),
        Attributes: JSON.stringify({ address_sids: address.sid }),
      });
      await twx(auth, "POST", `${TH}/CustomerProfiles/${profileSid}/EntityAssignments`, { ObjectSid: doc.sid });

      // Link BAM's approved PRIMARY profile (must exist on the master).
      const primary = process.env.TWILIO_PRIMARY_PROFILE_SID;
      if (!primary) throw new Error("TWILIO_PRIMARY_PROFILE_SID not configured (set it once the TrustHub primary profile is approved)");
      await twx(auth, "POST", `${TH}/CustomerProfiles/${profileSid}/EntityAssignments`, { ObjectSid: primary });

      const ev = await twx(auth, "POST", `${TH}/CustomerProfiles/${profileSid}/Evaluations`, { PolicySid: POLICY_SECONDARY });
      if (ev.status !== "compliant") throw new Error(`profile evaluation noncompliant: ${JSON.stringify(ev.results || {}).slice(0, 400)}`);
      await twx(auth, "POST", `${TH}/CustomerProfiles/${profileSid}`, { Status: "pending-review" });
      await save(clientId, { a2p_profile_sid: profileSid });
      done.push("secondary profile submitted");
    }

    // ── ② A2P TrustProduct ──
    let trustSid = cfg.a2p_trust_product_sid;
    if (!trustSid) {
      const tp = await twx(auth, "POST", `${TH}/TrustProducts`, {
        FriendlyName: `a2p trust: ${bizName}`.slice(0, 64),
        Email: "zoran@byanymeansbusiness.com",
        PolicySid: POLICY_A2P,
      });
      trustSid = tp.sid;
      const a2pEU = await twx(auth, "POST", `${TH}/EndUsers`, {
        Type: "us_a2p_messaging_profile_information",
        FriendlyName: `${bizName} a2p info`.slice(0, 64),
        Attributes: JSON.stringify({ company_type: "private" }),
      });
      await twx(auth, "POST", `${TH}/TrustProducts/${trustSid}/EntityAssignments`, { ObjectSid: a2pEU.sid });
      await twx(auth, "POST", `${TH}/TrustProducts/${trustSid}/EntityAssignments`, { ObjectSid: profileSid });
      const ev = await twx(auth, "POST", `${TH}/TrustProducts/${trustSid}/Evaluations`, { PolicySid: POLICY_A2P });
      if (ev.status !== "compliant") throw new Error(`trust product evaluation noncompliant: ${JSON.stringify(ev.results || {}).slice(0, 400)}`);
      await twx(auth, "POST", `${TH}/TrustProducts/${trustSid}`, { Status: "pending-review" });
      await save(clientId, { a2p_trust_product_sid: trustSid });
      done.push("a2p trust product submitted");
    }

    // ── ③ Brand ──
    let brandSid = cfg.a2p_brand_sid;
    if (!brandSid) {
      const brand = await twx(auth, "POST", `${MSG}/a2p/BrandRegistrations`, {
        CustomerProfileBundleSid: profileSid,
        A2PProfileBundleSid: trustSid,
      });
      brandSid = brand.sid;
      await save(clientId, { a2p_brand_sid: brandSid });
      done.push(`brand registered (${brand.status || "pending"})`);
    }

    // ── ④ Messaging Service ──
    let msSid = cfg.messaging_service_sid;
    if (!msSid) {
      const ms = await twx(auth, "POST", `${MSG}/Services`, {
        FriendlyName: `${bizName} messaging`.slice(0, 64),
        InboundRequestUrl: `${PROD}/api/twilio/inbound-webhook`,
        InboundMethod: "POST",
        UsecaseCategory: "undeclared",
      });
      msSid = ms.sid;
      await save(clientId, { messaging_service_sid: msSid });
      done.push("messaging service created");
    }

    // ── ⑤ Campaign ──
    const campaign = await twx(auth, "POST", `${MSG}/Services/${msSid}/Compliance/Usa2p`, {
      BrandRegistrationSid: brandSid,
      Description: `${bizName} is a youth basketball training academy. This number sends parents/guardians training schedules, booking confirmations, missed-call follow-ups, and replies to their inquiries.`,
      MessageFlow: `Parents opt in by submitting the academy's contact/booking form online or by texting/calling the academy's business number first. Opt-in is confirmed verbally or on the website form (${website}). Reply STOP to unsubscribe at any time.`,
      MessageSamples: [
        `Hey! This is ${bizName}. Your session is confirmed for Tuesday 6pm. Reply here with any questions.`,
        `Sorry we missed your call! This is ${bizName}. Text us back here and we'll help you out.`,
      ],
      UsAppToPersonUsecase: "LOW_VOLUME",
      HasEmbeddedLinks: "true",
      HasEmbeddedPhone: "false",
    });
    await save(clientId, { a2p_campaign_sid: campaign.sid, a2p_status: String(campaign.campaign_status || "in_progress").toLowerCase(), a2p_submitted_at: new Date().toISOString() });
    done.push(`campaign submitted (${campaign.campaign_status || "IN_PROGRESS"})`);

    return res.status(200).json({
      ok: true, client: bizName, done,
      sids: { profile: profileSid, trust_product: trustSid, brand: brandSid, messaging_service: msSid, campaign: campaign.sid },
      next: "the migration watcher polls the campaign to VERIFIED and attaches the number at cutover",
    });
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message });
  }
}

export default withSentryApiRoute(handler);
