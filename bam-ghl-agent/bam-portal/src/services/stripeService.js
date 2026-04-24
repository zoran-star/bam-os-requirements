// Stripe Service — always tries live API, returns empty data on error

export async function fetchFinancialSummary() {
  try {
    const res = await fetch("/api/stripe/overview?section=summary");
    const json = await res.json();
    if (!res.ok) return { data: {}, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}

export async function fetchCustomers() {
  try {
    const res = await fetch("/api/stripe/overview?section=customers");
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchInvoices() {
  try {
    const res = await fetch("/api/stripe/overview?section=invoices");
    const json = await res.json();
    if (!res.ok) return { data: [], error: json.error };
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export async function fetchAlerts() {
  try {
    const res = await fetch("/api/stripe/overview?section=alerts");
    const json = await res.json();
    if (!res.ok) return { data: {}, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}

export async function fetchMetrics() {
  try {
    const res = await fetch("/api/stripe/overview?section=metrics");
    const json = await res.json();
    if (!res.ok) return { data: {}, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
  }
}
