// Stripe Service — always tries live API, returns empty data on error
import { supabase } from "../lib/supabase";

// /api/stripe/overview is now staff-gated — send the logged-in staff token.
async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const tok = data?.session?.access_token;
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

export async function fetchFinancialSummary() {
  try {
    const res = await fetch("/api/stripe/overview?section=summary", { headers: await authHeaders() });
    const json = await res.json();
    if (!res.ok) return { data: {}, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}

export async function fetchCustomers() {
  try {
    const res = await fetch("/api/stripe/overview?section=customers", { headers: await authHeaders() });
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchInvoices() {
  try {
    const res = await fetch("/api/stripe/overview?section=invoices", { headers: await authHeaders() });
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchAlerts() {
  try {
    const res = await fetch("/api/stripe/overview?section=alerts", { headers: await authHeaders() });
    const json = await res.json();
    if (!res.ok) return { data: {}, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}

export async function fetchMetrics() {
  try {
    const res = await fetch("/api/stripe/overview?section=metrics", { headers: await authHeaders() });
    const json = await res.json();
    if (!res.ok) return { data: {}, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}
