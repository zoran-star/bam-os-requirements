// Google Sheets Service — calls /api/sheets/* when connected, returns empty on failure

const CONNECTED = import.meta.env.VITE_SHEETS_CONNECTED === "true";

export async function fetchOnboardingClients() {
  if (!CONNECTED) {
    return { data: [], error: null };
  }
  try {
    const res = await fetch("/api/sheets/onboarding?tab=CLIENT%20TRACKER");
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function toggleOnboardingCheck(row, checkIndex, value) {
  if (!CONNECTED) {
    return { data: { row, checkIndex, value }, error: null };
  }
  try {
    const res = await fetch("/api/sheets/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row, checkIndex, value }),
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchSystemsImplementation() {
  if (!CONNECTED) {
    return { data: null, error: "Mock data not available for this tab" };
  }
  try {
    const res = await fetch("/api/sheets/onboarding?tab=SYSTEMS%20IMPLEMENTATION");
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchSystemTemplates() {
  if (!CONNECTED) {
    return { data: null, error: "Mock data not available for this tab" };
  }
  try {
    const res = await fetch("/api/sheets/onboarding?tab=SYSTEM%20TEMPLATES%20BUILD%20TRACKER");
    const json = await res.json();
    if (!res.ok) return { data: null, error: json.error };
    return { data: json.data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}
