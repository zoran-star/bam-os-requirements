-- Content Engine Seed Data — from FullControl Content & Ad Planner
-- Run AFTER content_engine_schema.sql
-- 12 themes (messaging angles) + 5 creatives (ad concepts)

-- ═══════════════════════════════════════════════════════════════
-- THEMES (12 messaging angle pillars)
-- ═══════════════════════════════════════════════════════════════

-- AI Advantage (6 themes)
INSERT INTO content_themes (id, title, description, category, mode, creator, phase, sort_order) VALUES
('t0000000-0001-0000-0000-000000000001', 'AI won''t replace owners — but AI users will outperform those who don''t', 'Fear-of-missing-out angle. Positions FC as inevitable evolution, not optional upgrade. Speaks to competitive anxiety every owner feels.', 'AI Advantage', 'paid', 'Coleman', 0, 1),
('t0000000-0002-0000-0000-000000000002', 'Running an academy means doing 8 jobs at once', 'Pain validation. Name all 8 roles (marketer, accountant, scheduler, coach, content creator, customer service, sales, strategist). Then reveal the solution.', 'AI Advantage', 'paid', 'Coleman', 0, 2),
('t0000000-0003-0000-0000-000000000003', 'AI can now handle a huge portion of those jobs', 'Relief angle. Follow the ''8 jobs'' pain with the release: most of those jobs can now run on autopilot. Transition from overwhelm to possibility.', 'AI Advantage', 'paid', 'Coleman', 0, 3),
('t0000000-0004-0000-0000-000000000004', 'Academies using AI will outperform those that don''t', 'Competitive gap angle. Not about working harder — about working smarter. The gap is widening. Which side are you on?', 'AI Advantage', 'paid', 'Coleman', 0, 4),
('t0000000-0005-0000-0000-000000000005', 'AI isn''t replacing coaches — it''s giving them leverage', 'Objection-handling angle. Addresses the ''AI is taking jobs'' fear head-on. AI handles the backend so coaches can focus on what they do best: coaching.', 'AI Advantage', 'paid', 'Coleman', 0, 5),
('t0000000-0006-0000-0000-000000000006', 'Stuff you used to pay thousands for is now ___', 'Value reframe. Compare cost of hiring a marketing agency, scheduler, bookkeeper vs. one platform. Fill in the blank with FC''s price point.', 'AI Advantage', 'paid', 'Coleman', 0, 6);

-- Command Center (4 themes)
INSERT INTO content_themes (id, title, description, category, mode, creator, phase, sort_order) VALUES
('t0000000-0007-0000-0000-000000000007', 'Imagine a digital operator running your backend', 'Vision-casting. Paint the picture of waking up to leads already booked, payments collected, follow-ups sent. What would you do with that time?', 'Command Center', 'paid', 'Coleman', 0, 7),
('t0000000-0008-0000-0000-000000000008', 'One place to see everything in your business', 'Simplification angle. No more switching between 6 tabs and 4 apps. One dashboard. One source of truth. Everything from leads to revenue.', 'Command Center', 'paid', 'Coleman', 0, 8),
('t0000000-0009-0000-0000-000000000009', 'The AI command center for sports academies', 'Category-defining statement. Not a tool, not a CRM — a command center. Positions FC as a new category entirely.', 'Command Center', 'paid', 'Coleman', 0, 9),
('t0000000-0010-0000-0000-000000000010', 'What if your entire academy ran from one dashboard?', 'Curiosity hook. Question format draws people in. Great for scroll-stopping openers. Follow with a prototype walkthrough.', 'Command Center', 'paid', 'Coleman', 0, 10);

-- Strategic Intel (2 themes)
INSERT INTO content_themes (id, title, description, category, mode, creator, phase, sort_order) VALUES
('t0000000-0011-0000-0000-000000000011', 'Most owners are flying blind — FC turns data into direction', 'Strategic intel angle. You don''t know your real churn rate, your cost per lead, or which location is underperforming. FC does.', 'Strategic Intel', 'paid', 'Coleman', 0, 11),
('t0000000-0012-0000-0000-000000000012', 'Value content → how to run your academy → FC as strategy agent', 'Content funnel angle. Lead with free value (how to run your academy), build trust, then reveal FC as the tool that does it all for you.', 'Strategic Intel', 'paid', 'Coleman', 0, 12);

-- ═══════════════════════════════════════════════════════════════
-- CREATIVES (5 ad concepts, placed under best-fit themes)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO content_creatives (theme_id, title, notes, mode, creator, phase, sort_order, psych_lever, video_style) VALUES
-- AD-01 → under "Imagine a digital operator" (Command Center)
('t0000000-0007-0000-0000-000000000007', 'This is insane — watch how I run my entire business (DITL)', 'Day-in-the-life format. Coleman walks through his morning: opens FC, sees leads booked overnight, payments collected, content scheduled. Authentic ''this is real'' energy.', 'paid', 'Coleman', 0, 1, 'Social Proof', 'talking_head'),

-- AD-02 → under "Running an academy means 8 jobs" (AI Advantage)
('t0000000-0002-0000-0000-000000000002', 'You probably just missed ANOTHER ___ — specific pain points', 'Series format. Each ad names a specific pain: missed DM, forgotten follow-up, double-booked session, lost lead. Then: ''FC catches what you miss.'' Scalable — can produce many versions.', 'paid', 'Coleman', 0, 1, 'Pain Point', 'talking_head'),

-- AD-03 → under "AI can now handle those jobs" (AI Advantage)
('t0000000-0003-0000-0000-000000000003', 'AI literally turns annoying tasks into a game', 'Reframe angle. The boring stuff (invoicing, scheduling, follow-ups) becomes satisfying when it runs itself. Show the gamification of automation.', 'paid', 'Coleman', 0, 1, 'Humor', 'screen_record'),

-- AD-04 → under "Stuff you used to pay thousands for" (AI Advantage)
('t0000000-0006-0000-0000-000000000006', 'Old school way vs FullControl way — price calculator format', 'Side-by-side comparison. Left: manual process (hours, cost, stress). Right: FC way (automated, instant, peaceful). End with price comparison.', 'paid', 'Coleman', 0, 1, 'Value', 'quick_graphics'),

-- AD-05 → under "AI isn''t replacing coaches — leverage" (AI Advantage)
('t0000000-0005-0000-0000-000000000005', 'I''ve fully automated my business... only the parts I don''t enjoy', 'Nuanced angle. Not ''replace everything'' — just the parts that drain you. You still coach, still connect. FC handles the rest.', 'paid', 'Coleman', 0, 1, 'Objection Handler', 'talking_head');
