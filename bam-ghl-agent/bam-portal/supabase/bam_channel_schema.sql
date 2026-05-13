-- BAM Channel Dashboard — schema
-- Tracks the basketball acquisition channel test (May 2026 → 6-week window)
-- Two tables: bam_channel_snapshots (daily rows) + bam_channel_settings (single config row)
-- Run in Supabase SQL Editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Settings (singleton row, id = 1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bam_channel_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Test window
  campaign_start_date DATE NOT NULL DEFAULT '2026-05-08',
  test_window_days INTEGER NOT NULL DEFAULT 42,

  -- Headline metric thresholds ($ new MRR per $1 ad spend, 60d rolling)
  target_mrr_per_ad_dollar NUMERIC NOT NULL DEFAULT 3.0,
  acceptable_mrr_per_ad_dollar NUMERIC NOT NULL DEFAULT 1.5,

  -- Funnel targets (target / acceptable boundaries)
  target_cpl NUMERIC DEFAULT 15,
  acceptable_cpl NUMERIC DEFAULT 30,
  target_lead_to_book NUMERIC DEFAULT 0.40,
  acceptable_lead_to_book NUMERIC DEFAULT 0.25,
  target_cost_per_book NUMERIC DEFAULT 50,
  acceptable_cost_per_book NUMERIC DEFAULT 100,
  target_show_rate NUMERIC DEFAULT 0.65,
  acceptable_show_rate NUMERIC DEFAULT 0.50,
  target_close_rate NUMERIC DEFAULT 0.60,
  acceptable_close_rate NUMERIC DEFAULT 0.40,

  -- Mix target
  target_full_partner_mix NUMERIC DEFAULT 0.60,

  -- Kill-basketball thresholds (all 6 must hold for sustained_days)
  kill_full_partner_clients INTEGER DEFAULT 12,
  kill_core_clients INTEGER DEFAULT 30,
  kill_total_mrr NUMERIC DEFAULT 45000,
  kill_full_partner_mrr NUMERIC DEFAULT 20000,
  kill_ad_spend_threshold NUMERIC DEFAULT 5000,
  kill_sustained_days INTEGER DEFAULT 60,

  -- Scenario assumptions (Bear / Base / Bull) — used by trajectory chart
  scenarios JSONB DEFAULT '{
    "bear": { "ratio": 1.5, "monthly_ad_spend": 2000, "label": "$1.50:1 @ $2K/mo" },
    "base": { "ratio": 3.0, "monthly_ad_spend": 5000, "label": "$3:1 @ $5K/mo" },
    "bull": { "ratio": 5.0, "monthly_ad_spend": 15000, "label": "$5:1 @ $15K/mo" }
  }'::jsonb,

  -- Existing book + partner growth-share ramp (used in projections)
  existing_book_mrr NUMERIC DEFAULT 28000,
  partner_growth_share_month_6 NUMERIC DEFAULT 300,
  partner_growth_share_month_12 NUMERIC DEFAULT 600,

  -- Stripe SKU classification (price IDs or product name patterns)
  sku_full_pattern TEXT DEFAULT 'SS Full',
  sku_partner_pattern TEXT DEFAULT 'SS Partner',
  sku_core_pattern TEXT DEFAULT 'SS Core',

  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO bam_channel_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Snapshots (one row per day, denormalized)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bam_channel_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,

  -- Funnel (60d rolling) — Meta + GHL, hand-entered until ingestion job lands
  ad_spend_60d NUMERIC DEFAULT 0,
  leads_60d INTEGER DEFAULT 0,
  booked_calls_60d INTEGER DEFAULT 0,
  showed_up_60d INTEGER DEFAULT 0,
  closed_60d INTEGER DEFAULT 0,
  new_mrr_60d NUMERIC DEFAULT 0,

  -- New-close mix (60d) — from Stripe SKU classification
  new_closes_full_partner_60d INTEGER DEFAULT 0,
  new_closes_core_60d INTEGER DEFAULT 0,

  -- Kill-basketball progress — current active counts/MRR from Stripe
  active_full_partner INTEGER DEFAULT 0,
  active_core INTEGER DEFAULT 0,
  total_business_mrr NUMERIC DEFAULT 0,
  full_partner_mrr NUMERIC DEFAULT 0,

  -- "Channel proven at $5K/mo" tracker — days at >= threshold ad spend
  consecutive_days_above_spend_threshold INTEGER DEFAULT 0,

  -- "Sustained $3:1 for 60d" tracker — resets to 0 on any day below target
  daily_ratio NUMERIC GENERATED ALWAYS AS (
    CASE WHEN ad_spend_60d > 0 THEN new_mrr_60d / ad_spend_60d ELSE 0 END
  ) STORED,
  consecutive_days_above_3to1 INTEGER DEFAULT 0,

  -- Provenance
  source_meta JSONB DEFAULT '{}'::jsonb,  -- which fields came from which source/ingest
  ingested_by TEXT DEFAULT 'manual',      -- 'manual' | 'stripe-auto' | 'meta-auto' | 'ghl-auto'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bam_channel_snapshots_date_idx
  ON bam_channel_snapshots (snapshot_date DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_bam_channel_snapshots_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bam_channel_snapshots_updated_at ON bam_channel_snapshots;
CREATE TRIGGER bam_channel_snapshots_updated_at
  BEFORE UPDATE ON bam_channel_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_bam_channel_snapshots_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — locked to email allowlist (Cole / Mike / Zoran) only
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bam_channel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bam_channel_snapshots ENABLE ROW LEVEL SECURITY;

-- Helper: is the calling user in the channel allowlist?
CREATE OR REPLACE FUNCTION is_channel_viewer()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'email' IN (
    'zoran@byanymeansbball.com',
    'mike@byanymeansbball.com',
    'coleman@byanymeansbball.com'
  );
$$;

DROP POLICY IF EXISTS "channel viewers read settings" ON bam_channel_settings;
CREATE POLICY "channel viewers read settings" ON bam_channel_settings
  FOR SELECT USING (is_channel_viewer());

DROP POLICY IF EXISTS "channel viewers write settings" ON bam_channel_settings;
CREATE POLICY "channel viewers write settings" ON bam_channel_settings
  FOR UPDATE USING (is_channel_viewer()) WITH CHECK (is_channel_viewer());

DROP POLICY IF EXISTS "channel viewers read snapshots" ON bam_channel_snapshots;
CREATE POLICY "channel viewers read snapshots" ON bam_channel_snapshots
  FOR SELECT USING (is_channel_viewer());

DROP POLICY IF EXISTS "channel viewers insert snapshots" ON bam_channel_snapshots;
CREATE POLICY "channel viewers insert snapshots" ON bam_channel_snapshots
  FOR INSERT WITH CHECK (is_channel_viewer());

DROP POLICY IF EXISTS "channel viewers update snapshots" ON bam_channel_snapshots;
CREATE POLICY "channel viewers update snapshots" ON bam_channel_snapshots
  FOR UPDATE USING (is_channel_viewer()) WITH CHECK (is_channel_viewer());
