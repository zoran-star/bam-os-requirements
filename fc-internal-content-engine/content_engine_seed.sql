-- Content Engine Seed Data — from FullControl Content & Ad Planner
-- Run AFTER content_engine_schema.sql

-- ═══════════════════════════════════════════════════════════════
-- THEME 1: AI Advantage
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('t1000000-0000-0000-0000-000000000001', 'AI Advantage', 'FOMO and competitive urgency angles — AI is the new unfair advantage for academy owners. Positions FC as inevitable evolution.', 'paid', 'Coleman', 0, 1);

INSERT INTO content_creatives (theme_id, title, notes, mode, creator, phase, sort_order, psych_lever, persona) VALUES
('t1000000-0000-0000-0000-000000000001', 'AI won''t replace owners — but AI users will outperform those who don''t', 'Fear-of-missing-out angle. Positions FC as inevitable evolution, not optional upgrade. Speaks to competitive anxiety every owner feels.', 'paid', 'Coleman', 0, 1, 'FOMO', ''),
('t1000000-0000-0000-0000-000000000001', 'Running an academy means doing 8 jobs at once', 'Pain validation. Name all 8 roles (marketer, accountant, scheduler, coach, content creator, customer service, sales, strategist). Then reveal the solution.', 'paid', 'Coleman', 0, 2, 'Pain Point', ''),
('t1000000-0000-0000-0000-000000000001', 'AI can now handle a huge portion of those jobs', 'Relief angle. Follow the ''8 jobs'' pain with the release: most of those jobs can now run on autopilot. Transition from overwhelm to possibility.', 'paid', 'Coleman', 0, 3, 'Solution', ''),
('t1000000-0000-0000-0000-000000000001', 'Academies using AI will outperform those that don''t', 'Competitive gap angle. Not about working harder — about working smarter. The gap is widening. Which side are you on?', 'paid', 'Coleman', 0, 4, 'Urgency', ''),
('t1000000-0000-0000-0000-000000000001', 'AI isn''t replacing coaches — it''s giving them leverage', 'Objection-handling angle. Addresses the ''AI is taking jobs'' fear head-on. AI handles the backend so coaches can focus on what they do best: coaching.', 'paid', 'Coleman', 0, 5, 'Objection Handler', ''),
('t1000000-0000-0000-0000-000000000001', 'Stuff you used to pay thousands for is now ___', 'Value reframe. Compare cost of hiring a marketing agency, scheduler, bookkeeper vs. one platform. Fill in the blank with FC''s price point.', 'paid', 'Coleman', 0, 6, 'Value', '');

-- ═══════════════════════════════════════════════════════════════
-- THEME 2: Command Center
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('t1000000-0000-0000-0000-000000000002', 'Command Center', 'Category-defining messaging — FC isn''t a tool, it''s a command center. One dashboard, one source of truth. Vision-casting and simplification.', 'paid', 'Coleman', 0, 2);

INSERT INTO content_creatives (theme_id, title, notes, mode, creator, phase, sort_order, psych_lever, persona) VALUES
('t1000000-0000-0000-0000-000000000002', 'Imagine a digital operator running your backend', 'Vision-casting. Paint the picture of waking up to leads already booked, payments collected, follow-ups sent. What would you do with that time?', 'paid', 'Coleman', 0, 1, 'Aspiration', ''),
('t1000000-0000-0000-0000-000000000002', 'One place to see everything in your business', 'Simplification angle. No more switching between 6 tabs and 4 apps. One dashboard. One source of truth. Everything from leads to revenue.', 'paid', 'Coleman', 0, 2, 'Simplicity', ''),
('t1000000-0000-0000-0000-000000000002', 'The AI command center for sports academies', 'Category-defining statement. Not a tool, not a CRM — a command center. Positions FC as a new category entirely.', 'paid', 'Coleman', 0, 3, 'Authority', ''),
('t1000000-0000-0000-0000-000000000002', 'What if your entire academy ran from one dashboard?', 'Curiosity hook. Question format draws people in. Great for scroll-stopping openers. Follow with a prototype walkthrough.', 'paid', 'Coleman', 0, 4, 'Curiosity', '');

-- ═══════════════════════════════════════════════════════════════
-- THEME 3: Strategic Intel
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('t1000000-0000-0000-0000-000000000003', 'Strategic Intel', 'Data-driven direction — most owners are flying blind. FC turns raw data into strategic recommendations.', 'paid', 'Coleman', 0, 3);

INSERT INTO content_creatives (theme_id, title, notes, mode, creator, phase, sort_order, psych_lever, persona) VALUES
('t1000000-0000-0000-0000-000000000003', 'Most owners are flying blind — FC turns data into direction', 'Strategic intel angle. You don''t know your real churn rate, your cost per lead, or which location is underperforming. FC does.', 'paid', 'Coleman', 0, 1, 'Pain Point', ''),
('t1000000-0000-0000-0000-000000000003', 'Value content → how to run your academy → FC as strategy agent', 'Content funnel angle. Lead with free value (how to run your academy), build trust, then reveal FC as the tool that does it all for you.', 'paid', 'Coleman', 0, 2, 'Authority', '');

-- ═══════════════════════════════════════════════════════════════
-- THEME 4: Ad Concepts
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('t1000000-0000-0000-0000-000000000004', 'Ad Concepts', 'Specific ad concepts — each is a distinct creative angle designed for Andromeda''s diversification engine. Ready-to-produce ideas.', 'paid', 'Coleman', 0, 4);

INSERT INTO content_creatives (theme_id, title, notes, mode, creator, phase, sort_order, psych_lever, persona) VALUES
('t1000000-0000-0000-0000-000000000004', 'This is insane — watch how I run my entire business (DITL)', 'Day-in-the-life format. Coleman walks through his morning: opens FC, sees leads booked overnight, payments collected, content scheduled. Authentic ''this is real'' energy.', 'paid', 'Coleman', 0, 1, 'Social Proof', ''),
('t1000000-0000-0000-0000-000000000004', 'You probably just missed ANOTHER ___ — specific pain points', 'Series format. Each ad names a specific pain: missed DM, forgotten follow-up, double-booked session, lost lead. Then: ''FC catches what you miss.''', 'paid', 'Coleman', 0, 2, 'Pain Point', ''),
('t1000000-0000-0000-0000-000000000004', 'AI literally turns annoying tasks into a game', 'Reframe angle. The boring stuff (invoicing, scheduling, follow-ups) becomes satisfying when it runs itself. Show the gamification of automation.', 'paid', 'Coleman', 0, 3, 'Humor', ''),
('t1000000-0000-0000-0000-000000000004', 'Old school way vs FullControl way — price calculator format', 'Side-by-side comparison. Left: manual process (hours, cost, stress). Right: FC way (automated, instant, peaceful). End with price comparison.', 'paid', 'Coleman', 0, 4, 'Value', ''),
('t1000000-0000-0000-0000-000000000004', 'I''ve fully automated my business... only the parts I don''t enjoy', 'Nuanced angle. Not ''replace everything'' — just the parts that drain you. You still coach, still connect. FC handles the rest.', 'paid', 'Coleman', 0, 5, 'Objection Handler', '');

-- ═══════════════════════════════════════════════════════════════
-- THEME 5: Organic Strategy
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('t1000000-0000-0000-0000-000000000005', 'Organic Strategy', 'Pre-launch content cadence — 5 organic pieces per campaign before any ad spend. Build audience, test angles, prime Andromeda.', 'organic', 'Coleman', 0, 5);

INSERT INTO content_creatives (theme_id, title, notes, mode, creator, phase, sort_order, psych_lever, persona) VALUES
('t1000000-0000-0000-0000-000000000005', 'Build in Public — 3x/week FC IG + Cole BAM pages', 'Share the journey: product screenshots, team meetings, design decisions, wins, setbacks. Build audience investment before launch.', 'organic', 'Coleman', 0, 1, 'Curiosity', ''),
('t1000000-0000-0000-0000-000000000005', 'FullControl IG — Brand identity, curiosity, product teasers', 'Dedicated FC Instagram. Polished brand posts, feature reveals, ''coming soon'' teasers. 3x/week cadence. Build the brand before the product.', 'organic', 'Coleman', 0, 2, 'Curiosity', ''),
('t1000000-0000-0000-0000-000000000005', 'AI Education — Build urgency before solution drops', 'Content that teaches AI''s impact on sports businesses WITHOUT mentioning FC. Build the problem awareness. When FC launches, they''re primed.', 'organic', 'Coleman', 0, 3, 'Urgency', ''),
('t1000000-0000-0000-0000-000000000005', 'Founder Narrative — Cole: why I built this (4x/week)', 'Cole''s personal story. 500K+ followers. The credibility of someone who actually runs 5 locations saying ''I needed this to exist.''', 'organic', 'Coleman', 0, 4, 'Authority', ''),
('t1000000-0000-0000-0000-000000000005', 'Founder Talking Heads — Cole + Zoran', 'Both founders on camera. Product vision, behind-the-scenes decisions, disagreements even. Humanizes the brand. Two perspectives, one mission.', 'organic', 'Coleman', 0, 5, 'Social Proof', ''),
('t1000000-0000-0000-0000-000000000005', '''I can''t believe what we built'' teasers — no reveal yet', 'Hype without showing the product. Reactions, excited faces, vague screen glimpses. Build curiosity that demands to be satisfied.', 'organic', 'Coleman', 0, 6, 'Curiosity', ''),
('t1000000-0000-0000-0000-000000000005', 'First curiosity post — mission + founder energy, no product reveal', 'Day 1 post. No product. Just the mission: ''We''re building something that changes how sports academies operate.'' Pure founder energy.', 'organic', 'Coleman', 0, 7, 'Aspiration', ''),
('t1000000-0000-0000-0000-000000000005', 'BAM Business IG — AI for sports business, pain points (3x/week)', 'Business-focused account. Pain point content: missed DMs, churn problems, scheduling chaos. Position AI as the inevitable solution. 3x/week.', 'organic', 'Coleman', 0, 8, 'Pain Point', ''),
('t1000000-0000-0000-0000-000000000005', 'Pain Point Content — 8 jobs problem, missed DM problem', 'Specific pain content that names the exact problems. ''You''re doing 8 jobs and none of them well.'' ''You missed 3 DMs last week. Each one was $200/month.''', 'organic', 'Coleman', 0, 9, 'Pain Point', '');
