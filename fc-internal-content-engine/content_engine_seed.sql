-- Content Engine Seed Data — Informed by BAM OS Identity/Onboarding Section
-- Run AFTER content_engine_schema.sql

-- ═══════════════════════════════════════════════════════════════
-- THEME 1: Effortless Setup
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'Effortless Setup', 'How easy it is to get started. Logo, name, contact info — done in minutes. No tech headaches.', 'paid', 'Coleman', 0, 1);

INSERT INTO content_messages (theme_id, title, hook, cta, tone, video_style, phase, mode, creator, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'Setup in 5 Minutes', 'Most gym software takes weeks to set up. We did it in 5 minutes.', 'Try the setup yourself — link in bio', 'Conversational', 'talking_head', 0, 'paid', 'Coleman', 1),
('a1000000-0000-0000-0000-000000000001', 'No IT Department Needed', 'You shouldn''t need a computer science degree to run a basketball academy.', 'See how simple it really is', 'Motivational', 'selfie', 0, 'organic', 'Coleman', 2),
('a1000000-0000-0000-0000-000000000001', 'Your Logo, Your Brand, Day One', 'Upload your logo and your entire system matches your brand. Invoices, scheduling app, emails — all you.', 'Start your free trial', 'Authoritative', 'screen_record', 1, 'paid', 'Coleman', 3);

-- ═══════════════════════════════════════════════════════════════
-- THEME 2: One Place for Everything
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'One Place for Everything', 'Stop juggling spreadsheets, DMs, emails, and payment apps. All your business info lives in one command center.', 'paid', 'Coleman', 0, 2);

INSERT INTO content_messages (theme_id, title, hook, cta, tone, video_style, phase, mode, creator, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'The Scattered Coach', 'Your schedule''s in Google Cal. Payments in Venmo. Contacts in your phone. Marketing... nowhere. Sound familiar?', 'There''s a better way — link in bio', 'Storytelling', 'talking_head', 0, 'paid', 'Coleman', 1),
('a1000000-0000-0000-0000-000000000002', 'Everything Under One Roof', 'What if your business name, logo, contacts, schedule, payments, and marketing all lived in one place?', 'See it in action', 'Educational', 'screen_record', 1, 'paid', 'Coleman', 2),
('a1000000-0000-0000-0000-000000000002', 'Stop Copy-Pasting Your Own Info', 'How many times have you typed your own business address this week? Your phone number? Your email?', 'Automate the basics — try free', 'Conversational', 'selfie', 0, 'organic', 'Coleman', 3);

-- ═══════════════════════════════════════════════════════════════
-- THEME 3: AI That Actually Knows You
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'AI That Actually Knows You', 'The AI learns your business from day one — your name, your style, your services, your members. It writes like you, talks like you.', 'paid', 'Coleman', 0, 3);

INSERT INTO content_messages (theme_id, title, hook, cta, tone, video_style, phase, mode, creator, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'It Knows Your Business Description', 'You tell the AI about your academy once. After that, every email, every text, every post — it sounds like YOU wrote it.', 'Meet Sage — your AI assistant', 'Conversational', 'talking_head', 0, 'paid', 'Coleman', 1),
('a1000000-0000-0000-0000-000000000003', 'Not Generic AI', 'ChatGPT doesn''t know your gym name. Doesn''t know your clients. Doesn''t know your voice. Sage does.', 'See the difference', 'Controversial', 'talking_head', 0, 'paid', 'Zoran', 2),
('a1000000-0000-0000-0000-000000000003', 'Your AI Gets Smarter Over Time', 'The more you use FullControl, the more Sage learns. Your tone. Your schedule patterns. What your clients respond to.', 'Start training your AI today', 'Educational', 'pro_camera', 1, 'paid', 'Coleman', 3),
('a1000000-0000-0000-0000-000000000003', 'AI Writes Your Bio', 'We asked Sage to write our academy description. It nailed it in 10 seconds. Here''s what it came up with.', 'Try it with your business', 'Conversational', 'selfie', 0, 'organic', 'Coleman', 4);

-- ═══════════════════════════════════════════════════════════════
-- THEME 4: Payments That Just Work
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('a1000000-0000-0000-0000-000000000004', 'Payments That Just Work', 'Stripe-powered payments. No chasing Venmo. No awkward DMs. Auto-billing, subscriptions, refunds — handled.', 'paid', 'Coleman', 1, 4);

INSERT INTO content_messages (theme_id, title, hook, cta, tone, video_style, phase, mode, creator, sort_order) VALUES
('a1000000-0000-0000-0000-000000000004', 'Stop Chasing Payments', 'If you''ve ever sent a "hey just checking on that payment" text... this is for you.', 'Never chase a payment again', 'Conversational', 'talking_head', 0, 'paid', 'Coleman', 1),
('a1000000-0000-0000-0000-000000000004', 'Venmo Is Not a Business Tool', 'Real talk: if you''re running an academy and still getting paid through Venmo, you''re leaving money on the table.', 'Upgrade your payment system', 'Controversial', 'selfie', 0, 'organic', 'Coleman', 2),
('a1000000-0000-0000-0000-000000000004', 'Auto-Billing Changed My Life', 'I used to spend 3 hours a week chasing payments. Now? Zero. Stripe handles it. FullControl tracks it.', 'See how it works', 'Storytelling', 'testimonial', 1, 'paid', 'Coleman', 3);

-- ═══════════════════════════════════════════════════════════════
-- THEME 5: Your Brand, Everywhere
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('a1000000-0000-0000-0000-000000000005', 'Your Brand, Everywhere', 'Your logo, colors, and name show up on everything — the member app, invoices, emails, marketing. Professional from day one.', 'organic', 'Coleman', 1, 5);

INSERT INTO content_messages (theme_id, title, hook, cta, tone, video_style, phase, mode, creator, sort_order) VALUES
('a1000000-0000-0000-0000-000000000005', 'Look Like a Big Brand', 'Your parents receive an invoice with YOUR logo. Your athletes open an app with YOUR name. That''s the standard now.', 'Make it yours — start free', 'Motivational', 'talking_head', 1, 'paid', 'Coleman', 1),
('a1000000-0000-0000-0000-000000000005', 'White-Label Everything', 'Most academy software looks generic. FullControl looks like YOUR software. Your brand, your colors, everywhere.', 'See it branded to you', 'Authoritative', 'screen_record', 1, 'paid', 'Zoran', 2),
('a1000000-0000-0000-0000-000000000005', 'First Impressions Matter', 'When a parent gets a text from your academy, does it look professional? Or does it look like a random number?', 'Fix your first impression', 'Urgent', 'selfie', 0, 'organic', 'Coleman', 3);

-- ═══════════════════════════════════════════════════════════════
-- THEME 6: Built for Basketball
-- ═══════════════════════════════════════════════════════════════
INSERT INTO content_themes (id, title, description, mode, creator, phase, sort_order) VALUES
('a1000000-0000-0000-0000-000000000006', 'Built for Basketball', 'Not generic gym software. Not CrossFit tools. Built specifically for basketball academies, trainers, and youth programs.', 'organic', 'Coleman', 0, 6);

INSERT INTO content_messages (theme_id, title, hook, cta, tone, video_style, phase, mode, creator, sort_order) VALUES
('a1000000-0000-0000-0000-000000000006', 'We''re Coaches Too', 'We didn''t build this in Silicon Valley. We built it in the gym. Because we run one.', 'Built by coaches, for coaches', 'Storytelling', 'talking_head', 0, 'paid', 'Coleman', 1),
('a1000000-0000-0000-0000-000000000006', 'Mindbody Doesn''t Get Basketball', 'Mindbody was built for yoga studios. We were built for the hardwood. There''s a difference.', 'See the difference', 'Controversial', 'talking_head', 0, 'paid', 'Zoran', 2),
('a1000000-0000-0000-0000-000000000006', 'AAU, Private Training, Academy — All In', 'Whether you run AAU, private 1-on-1s, group skills sessions, or a full academy — this was built for your exact setup.', 'Tell us your setup, we''ll show you yours', 'Educational', 'pro_camera', 1, 'paid', 'Coleman', 3),
('a1000000-0000-0000-0000-000000000006', '500K Coaches Can''t Be Wrong', 'We built BAM Basketball to 500K followers. Now we''re building the tools we wish we had from day one.', 'Join the movement', 'Motivational', 'selfie', 0, 'organic', 'Coleman', 4);
