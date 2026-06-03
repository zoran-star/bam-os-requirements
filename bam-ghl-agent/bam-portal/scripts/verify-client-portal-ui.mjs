#!/usr/bin/env node
/**
 * Verify the client portal first-login onboarding tour will still work
 * after any change to public/client-portal.html.
 *
 * The tour spotlights 6 specific elements (steps 2-7). If a UI change
 * removes or renames any of those targets, the spotlight breaks silently
 * (the tooltip falls back to centered but the page-dim looks wrong and
 * the tour stops feeling guided).
 *
 * Run after every UI edit:
 *     node bam-portal/scripts/verify-client-portal-ui.mjs
 *
 * Exits 0 on success, 1 on failure.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORTAL_PATH = join(__dirname, '..', 'public', 'client-portal.html');

const html = readFileSync(PORTAL_PATH, 'utf8');

// Each spotlight step in the tour needs at least one matching element.
// Patterns intentionally permissive (whitespace, attr-order tolerant).
// The first-login tour now just points to the Action Items onboarding
// checklist (welcome modal → spotlight the list). Verify those targets exist.
const TOUR_TARGETS = [
  { step: 2, name: 'Action Items nav item',  css: ".nav-item[onclick*=\"action-items\"]", pattern: /onclick="switchView\('action-items'/ },
  { step: 2, name: 'Action Items list',      css: '#action-items-list',                   pattern: /id="action-items-list"/ },
];

// Other invariants worth catching cheaply.
const INVARIANTS = [
  { name: 'TOUR_STEPS config present',         pattern: /const TOUR_STEPS\s*=/ },
  { name: 'TOUR_DEMO_CONTAINERS config present', pattern: /const TOUR_DEMO_CONTAINERS\s*=/ },
  { name: 'startOnboardingTour function',      pattern: /function startOnboardingTour/ },
  { name: '?action=complete-onboarding call',  pattern: /action=complete-onboarding/ },
  { name: '"Take the tour" sidebar link',      pattern: /user-tour-link[\s\S]{0,200}startOnboardingTour/ },
  { name: 'boot fires tour when not done',     pattern: /clientRow\?\.onboarding_completed_at/ },
];

let allOk = true;

console.log('━━━ Client portal tour: spotlight targets ━━━');
for (const { step, name, css, pattern } of TOUR_TARGETS) {
  const found = pattern.test(html);
  const icon = found ? '✅' : '❌';
  console.log(`  Step ${step} (${name})  [${css}]  ${icon} ${found ? 'FOUND' : 'MISSING'}`);
  if (!found) allOk = false;
}

console.log('\n━━━ Client portal tour: invariants ━━━');
for (const { name, pattern } of INVARIANTS) {
  const found = pattern.test(html);
  const icon = found ? '✅' : '❌';
  console.log(`  ${name}  ${icon} ${found ? 'OK' : 'MISSING'}`);
  if (!found) allOk = false;
}

console.log('');
if (allOk) {
  console.log('✅ All checks passed. Onboarding tour is intact.');
  process.exit(0);
} else {
  console.error('❌ One or more checks failed.');
  console.error('   Fix: restore the missing selector in client-portal.html, OR');
  console.error('         update TOUR_STEPS / TOUR_DEMO_CONTAINERS to use the new selector.');
  process.exit(1);
}
