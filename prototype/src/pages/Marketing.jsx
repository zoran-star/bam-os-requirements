// Marketing page: Sage conversational advisor (MKT-013). See sageReply() below.
import { useState, useRef, useEffect } from 'react';
import useBannerCanvas from '../hooks/useBannerCanvas';
import useTypewriter from '../hooks/useTypewriter';
import s from '../styles/Marketing.module.css';
import sh from '../styles/shared.module.css';

const SAGE_PROMPTS = [
  'Increase Saturday ad budget by $50...',
  'Create a new Instagram Reel ad for summer camp...',
  'Pause the Free Trial story ad - it has zero conversions...',
  'Show me cost per lead by channel this month...',
  'Generate a parent testimonial ad from Maria R...',
  'Set up a referral campaign with $25 credit reward...',
];

const QUICK_ACTIONS = [
  { label: 'Ask Sage', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M20 9h3"/><path d="M20 14h3"/><path d="M1 9h3"/><path d="M1 14h3"/></svg>, action: 'sage' },
  { label: 'Create a campaign', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>, action: 'createAd' },
  { label: 'Manage campaigns', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, action: 'manage' },
  { label: 'Create ad content', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>, action: 'content' },
];

const CHANNELS = [
  {
    name: 'Instagram', leads: 14, cpl: '$12.40', trend: '+22%', trendUp: true, cplTrend: '-6%', cplTrendGood: true, icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>, accent: '#E1306C',
    campaigns: [
      { name: 'Youth Basketball Reel - Saturday Energy', spend: '$89', impressions: '4,210', cpm: '$21.14', reach: '3,680', frequency: '1.1', clicks: 187, ctr: '4.2%', cpc: '$0.48', lpv: 142, lpvRate: '75.9%', formFills: 4, trialBookings: 2, cpl: '$14.83', convRate: '4.2%', demo: { age: '28-42', gender: '62% F', geo: 'Within 15mi', onTarget: true } },
      { name: 'Summer Skills Camp Promo', spend: '$134', impressions: '6,820', cpm: '$19.65', reach: '5,100', frequency: '1.3', clicks: 245, ctr: '3.6%', cpc: '$0.55', lpv: 189, lpvRate: '77.1%', formFills: 5, trialBookings: 3, cpl: '$16.75', convRate: '4.2%', demo: { age: '25-38', gender: '71% F', geo: 'Within 10mi', onTarget: true } },
    ],
  },
  {
    name: 'Facebook', leads: 8, cpl: '$18.60', trend: '+5%', trendUp: true, cplTrend: '+3%', cplTrendGood: false, icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>, accent: '#1877F2',
    campaigns: [
      { name: 'Parent Testimonial - Maria R.', spend: '$134', impressions: '5,430', cpm: '$24.68', reach: '4,200', frequency: '1.3', clicks: 206, ctr: '3.8%', cpc: '$0.65', lpv: 158, lpvRate: '76.7%', formFills: 3, trialBookings: 2, cpl: '$26.80', convRate: '3.2%', demo: { age: '30-45', gender: '58% F', geo: 'Within 20mi', onTarget: true } },
      { name: 'Back-to-School Registration', spend: '$67', impressions: '3,150', cpm: '$21.27', reach: '2,800', frequency: '1.1', clicks: 98, ctr: '3.1%', cpc: '$0.68', lpv: 74, lpvRate: '75.5%', formFills: 2, trialBookings: 1, cpl: '$22.33', convRate: '4.1%', demo: { age: '22-35', gender: '65% F', geo: 'Within 25mi', onTarget: false, flag: 'Geo reaching beyond 20mi target radius' } },
    ],
  },
  {
    name: 'Google', leads: 6, cpl: '$24.10', trend: '-8%', trendUp: false, cplTrend: '-12%', cplTrendGood: true, icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, accent: '#4285F4',
    campaigns: [
      { name: 'Search - Basketball Training Near Me', spend: '$145', impressions: '2,300', cpm: '$63.04', reach: '2,100', frequency: '1.1', clicks: 89, ctr: '3.9%', cpc: '$1.63', lpv: 67, lpvRate: '75.3%', formFills: 4, trialBookings: 2, cpl: '$24.17', convRate: '9.0%', demo: { age: '28-50', gender: '52% M', geo: 'Within 12mi', onTarget: true } },
    ],
  },
  {
    name: 'Referral', leads: 4, cpl: '$0', trend: '+50%', trendUp: true, cplTrend: '$0', cplTrendGood: true, icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, accent: '#3EAF5C',
    campaigns: [
      { name: 'Member Referral Links', spend: '$0', impressions: '-', cpm: '-', reach: '-', frequency: '-', clicks: 28, ctr: '-', cpc: '$0', lpv: 22, lpvRate: '78.6%', formFills: 2, trialBookings: 2, cpl: '$0', convRate: '18.2%', demo: { age: '30-42', gender: '55% F', geo: 'Within 8mi', onTarget: true } },
    ],
  },
];

const ADS_NEEDING_REFRESH = [
  { name: 'Summer Skills Camp Promo', days: 47, status: 'Stale', spend: '$312', conversions: 2, trend: 'declining' },
  { name: 'Free Trial - Instagram Story', days: 62, status: 'Stop-loss', spend: '$158', conversions: 0, trend: 'zero' },
];

const TOP_ADS = [
  { name: 'Youth Basketball Reel - Saturday Energy', spend: '$89', conversions: 6, ctr: '4.2%', days: 12, status: 'healthy' },
  { name: 'Parent Testimonial - Maria R.', spend: '$134', conversions: 5, ctr: '3.8%', days: 21, status: 'healthy' },
  { name: 'Back-to-School Registration', spend: '$67', conversions: 3, ctr: '3.1%', days: 8, status: 'new' },
];

const BUDGET = { monthly: 500, spent: 312, daysLeft: 15, pacing: 'on-pace' };

const CAMPAIGN_BUDGETS = [
  { name: 'Youth Basketball Reel - Saturday Energy', daily: '$8.50', monthly: '$255', status: 'Active' },
  { name: 'Parent Testimonial - Maria R.', daily: '$5.00', monthly: '$150', status: 'Active' },
  { name: 'Back-to-School Registration', daily: '$3.20', monthly: '$95', status: 'Active' },
  { name: 'Free Trial - Instagram Story', daily: '$0', monthly: '$0', status: 'Paused' },
];

const MORE_TOOLS = [
  { name: 'Meta Ads', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>, enabled: true, ref: 'MKT-001' },
  { name: 'Landing Pages', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>, enabled: false, ref: 'MKT-007' },
  { name: 'Email & SMS Campaigns', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>, enabled: false, ref: 'MKT-008' },
  { name: 'Referral Campaigns', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, enabled: false, ref: 'MKT-009' },
  { name: 'Content Calendar', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, enabled: false, ref: 'MKT-010' },
  { name: 'Google Business Profile', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>, enabled: false, ref: 'MKT-011' },
  { name: 'Testimonial Collection', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>, enabled: false, ref: 'MKT-012' },
];

const PERIODS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '4w', label: 'Last 4 weeks', days: 28 },
  { id: 'mtd', label: 'Month to date', days: 16 },
  { id: '3m', label: 'Last 3 months', days: 90 },
];

/* Metric education - MKT-003 */
const METRIC_EDUCATION = {
  cpl: { label: 'Cost Per Lead', explain: 'Total ad spend divided by number of leads (form fills + trial bookings). Lower is better - under $15 is strong for youth sports.' },
  ctr: { label: 'Click-Through Rate', explain: 'Percentage of people who saw your ad and clicked. Above 3% is solid for Meta ads in the youth sports space.' },
  cpm: { label: 'Cost Per 1,000 Impressions', explain: 'How much it costs to show your ad 1,000 times. Under $25 is healthy - higher CPM usually means more competitive audience targeting.' },
  convRate: { label: 'Conversion Rate', explain: 'Percentage of landing page visitors who took an action (form fill or trial booking). Above 5% is excellent.' },
  lpvRate: { label: 'Landing Page View Rate', explain: 'Percentage of clickers who actually loaded your landing page. Below 70% may indicate slow page load or mismatched ad-to-page experience.' },
  frequency: { label: 'Frequency', explain: 'Average number of times each person saw your ad. Above 2.0 means audience fatigue may be setting in - time to refresh creative.' },
};

/* ─── SAGE MARKETING ADVISOR - conversational knowledge engine (MKT-013) ─── */
const money = str => parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0;

const STARTERS = [
  "How's my marketing doing?",
  'Which channel is cheapest?',
  'Any ads I should pause?',
  "What's CPL?",
];

function sageGreeting() {
  return {
    role: 'sage',
    text: `Hey - I'm Sage, your marketing advisor. I can explain your numbers, tell you what's working, and take action for you.\n\nOne thing stands out right now: your Free Trial Instagram Story ad has spent $158 with 0 conversions in 62 days. I'd pause it and move that budget to your Saturday Reel.`,
    actions: [
      { label: 'Pause that ad', act: 'budget' },
      { label: "How's everything doing?", act: 'ask:how is my marketing doing' },
    ],
  };
}

/* Rule-based intent engine. Reads the live prototype data (CHANNELS, BUDGET,
   TOP_ADS, ADS_NEEDING_REFRESH, METRIC_EDUCATION) and returns { text, actions }.
   Actions carry an `act` key resolved by runSageAction in the component. */
function sageReply(raw) {
  const t = ` ${raw.toLowerCase()} `;
  const has = (...w) => w.some(x => t.includes(x));

  // Launch / create a campaign
  if (has('create', 'launch', 'new ad', 'new campaign', 'set up a', 'make an ad', 'start a campaign', 'build a campaign')) {
    return {
      text: `Let's launch a new campaign. For youth academies, Trial Bookings is the highest-ROI objective - short Reels with a clear "book a free trial" CTA convert best. I'll open the builder and walk you through objective, creative, copy, audience and budget.`,
      actions: [{ label: 'Open campaign builder', act: 'createAd' }],
    };
  }

  // Pause / underperformers / refresh
  if (has('pause', 'stop', 'kill', 'underperform', 'refresh', 'stale', 'wasting', 'not working', 'worst', 'bad ad', 'cut')) {
    return {
      text: `Two ads are dragging your spend:\n\n- Free Trial - Instagram Story: $158 spent, 0 conversions, 62 days. This one hit stop-loss - I'd kill it.\n- Summer Skills Camp Promo: $312 spent, only 2 conversions, 47 days and declining. Time to refresh the creative.\n\nEverything else is pulling its weight.`,
      actions: [
        { label: 'Adjust budgets', act: 'budget' },
        { label: 'See full dashboard', act: 'dashboard' },
      ],
    };
  }

  // Best / working well
  if (has('best', ' top ', 'working', 'winner', 'performing well', 'do more', 'scale up')) {
    return {
      text: `Your winners right now:\n\n- Youth Basketball Reel - Saturday Energy: 6 conversions, 4.2% CTR, only $89 spent. This is your best ad - it drives about 42% of all conversions.\n- Parent Testimonial - Maria R.: 5 conversions, 3.8% CTR. Testimonials convert about 2x better than training footage.\n\nI'd put more budget behind the Saturday Reel.`,
      actions: [
        { label: 'Shift budget to winners', act: 'budget' },
        { label: 'Make a similar ad', act: 'createAd' },
      ],
    };
  }

  // Budget / spend / pacing
  if (has('budget', 'spend', 'spent', 'pacing', 'pace', 'how much', 'money left', 'afford', 'raise')) {
    return {
      text: `You're on pace. Monthly budget is $${BUDGET.monthly}, you've spent $${BUDGET.spent} with ${BUDGET.daysLeft} days left - that's ${Math.round((BUDGET.spent / BUDGET.monthly) * 100)}% used, right where you should be. If you want to grow, the safest move is shifting spend from the stale Summer Camp ad into your Saturday Reel rather than adding new budget.`,
      actions: [{ label: 'Adjust budget', act: 'budget' }],
    };
  }

  // Channel-specific (Instagram, Facebook, Google, Referral)
  const chan = CHANNELS.find(c => t.includes(c.name.toLowerCase()));
  if (chan && !has('cheap', 'compare', 'each', 'all channel', 'by channel')) {
    const note = chan.name === 'Instagram' ? 'This is your most efficient channel - keep leaning in.'
      : chan.name === 'Referral' ? 'Free leads that convert at 18% - your highest-quality source. Worth a referral push.'
      : chan.cplTrendGood ? 'Trending the right way.'
      : 'CPL is creeping up - worth a look.';
    return {
      text: `${chan.name}: ${chan.leads} leads at ${chan.cpl} cost-per-lead this month (${chan.cplTrend} vs last month). ${note}`,
      actions: [{ label: `Open ${chan.name} detail`, act: `channel:${chan.name}` }],
    };
  }

  // Compare channels by cost
  if (has('cheap', 'expensive', 'compare', 'which channel', 'by channel', 'each channel', 'best channel', 'source')) {
    const ranked = [...CHANNELS].filter(c => money(c.cpl) > 0).sort((a, b) => money(a.cpl) - money(b.cpl));
    const lines = ranked.map(c => `- ${c.name}: ${c.cpl} CPL, ${c.leads} leads`).join('\n');
    return {
      text: `Cost per lead by channel (cheapest first):\n\n- Referral: $0 (free) - 4 leads, converts at 18%\n${lines}\n\nInstagram is your best paid channel at $12.40 - about 2x cheaper than Google. I'd move spend toward Instagram and push referrals harder.`,
      actions: [{ label: 'Open full dashboard', act: 'dashboard' }],
    };
  }

  // Metric explanations
  const metricMap = [
    { keys: ['cpl', 'cost per lead'], id: 'cpl' },
    { keys: ['ctr', 'click through', 'click-through'], id: 'ctr' },
    { keys: ['cpm', 'impression'], id: 'cpm' },
    { keys: ['conversion rate', 'conv rate', 'convert'], id: 'convRate' },
    { keys: ['landing page', 'lpv'], id: 'lpvRate' },
    { keys: ['frequency', 'fatigue'], id: 'frequency' },
  ];
  const hit = metricMap.find(m => m.keys.some(k => t.includes(k)));
  if (hit) {
    const m = METRIC_EDUCATION[hit.id];
    return { text: `${m.label}: ${m.explain}`, actions: [{ label: 'See it in my numbers', act: 'dashboard' }] };
  }

  // Content / creative ideas
  if (has('content', 'creative', 'reel', 'video', 'post', 'testimonial', 'idea', 'what should i make', 'caption')) {
    return {
      text: `For your academy, the content that converts is short Reels (under 30s) with upbeat music, plus parent testimonials - those pull about 2x the conversions of training footage. A strong hook like "Your kid deserves better than rec league" with a clear free-trial CTA works well. Post Saturday mornings for peak parent attention.`,
      actions: [{ label: 'Create ad content', act: 'createAd' }],
    };
  }

  // Overview / how am I doing
  if (has('how', 'doing', 'overview', 'summary', 'performance', 'going', 'leads', 'result', 'this month', 'status', 'picture')) {
    return {
      text: `Here's the picture this month:\n\n- ${CHANNELS.reduce((sum, c) => sum + c.leads, 0)} leads at $14.80 average cost-per-lead - solid for youth sports (under $15 is strong).\n- Instagram is carrying it at $12.40 CPL; Google is your priciest at $24.10.\n- Budget is on pace: $${BUDGET.spent} of $${BUDGET.monthly} with ${BUDGET.daysLeft} days left.\n- One drag: the Free Trial Story ad has 0 conversions, worth cutting.`,
      actions: [
        { label: 'Open dashboard', act: 'dashboard' },
        { label: 'What should I pause?', act: 'ask:which ads should I pause' },
      ],
    };
  }

  // Help / fallback
  return {
    text: `I can help with your marketing a few ways:\n\n- Explain your numbers (CPL, CTR, conversion rate...)\n- Tell you what's working and what to pause\n- Compare your channels\n- Launch a campaign or create ad content\n\nTry one of the suggestions below, or just ask in your own words.`,
    actions: [
      { label: "How's my marketing doing?", act: 'ask:how is my marketing doing' },
      { label: 'What should I pause?', act: 'ask:which ads should I pause' },
    ],
  };
}

/* ─── FULL DASHBOARD ─── */
function FullDashboard({ onClose }) {
  const [period, setPeriod] = useState('mtd');

  const allCampaigns = CHANNELS.flatMap(ch => ch.campaigns.map(c => ({ ...c, channel: ch.name, channelIcon: ch.icon })));
  const totalSpend = '$435';
  const totalImpressions = '21,910';
  const avgCPL = '$14.80';
  const totalConversions = 25;
  const avgCTR = '3.7%';
  const overallConvRate = '5.1%';

  const topMetrics = [
    { label: 'Total Spend', value: totalSpend, sub: 'Across all channels' },
    { label: 'Total Impressions', value: totalImpressions, sub: 'Ads served this period' },
    { label: 'Avg CPL', value: avgCPL, sub: 'Cost per lead (form + booking)' },
    { label: 'Total Conversions', value: String(totalConversions), sub: 'Form fills + trial bookings' },
    { label: 'Avg CTR', value: avgCTR, sub: 'Click-through rate' },
    { label: 'Conversion Rate', value: overallConvRate, sub: 'Conversions / landing page views' },
  ];

  const channelBreakdown = CHANNELS.map(ch => {
    const totalSpend = ch.campaigns.reduce((s, c) => s + parseFloat(c.spend.replace('$', '')), 0);
    const totalLeads = ch.campaigns.reduce((s, c) => s + c.formFills + c.trialBookings, 0);
    return { name: ch.name, icon: ch.icon, spend: `$${totalSpend.toFixed(0)}`, leads: totalLeads, cpl: ch.cpl, trend: ch.trend, trendUp: ch.trendUp, cplTrend: ch.cplTrend, cplTrendGood: ch.cplTrendGood };
  });

  return (
    <div className={s.dashFull}>
      <div className={s.dashHead}>
        <div className={s.dashHeadLeft}>
          <button className={s.dashBackBtn} onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <div className={s.dashTitle}>Marketing Dashboard</div>
            <div className={s.dashSubtitle}>{PERIODS.find(p => p.id === period).label}</div>
          </div>
        </div>
        <div className={s.dashControls}>
          <div className={s.dashPeriodGroup}>
            {PERIODS.map(p => (
              <button key={p.id} className={`${s.dashPeriodBtn} ${period === p.id ? s.dashPeriodActive : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className={s.dashBody}>
        <div className={s.dashNotes}>
          <span className={s.dashNotesLabel}>Sage</span>
          <span>Instagram is your most efficient channel at $12.40 CPL - 3x better than Google. Your Saturday Reel is driving 42% of all conversions. Consider reallocating $50 from the stale Summer Camp ad to the Saturday slot.</span>
        </div>

        <div className={s.dashSectionLabel}>Top-Level KPIs <span className={s.dashRef}>MKT-001</span></div>
        <div className={s.dashGrid}>
          {topMetrics.map((m, i) => (
            <div key={i} className={s.dashMetric}>
              <div className={s.dashMetricLabel}>{m.label}</div>
              <div className={s.dashMetricValue}>{m.value}</div>
              <div className={s.dashMetricSub}>{m.sub}</div>
            </div>
          ))}
        </div>

        <div className={s.dashSectionLabel}>Channel Breakdown <span className={s.dashRef}>MKT-001a</span></div>
        <div className={s.dashChannelRow}>
          {channelBreakdown.map(ch => (
            <div key={ch.name} className={s.dashChannelCard}>
              <div className={s.dashChannelTop}><span>{ch.icon}</span> {ch.name}</div>
              <div className={s.dashChannelLeads}>{ch.leads} leads</div>
              <div className={s.dashChannelMeta}>
                <span>Spend: {ch.spend}</span>
                <span>CPL: {ch.cpl}</span>
                <span className={ch.cplTrendGood ? s.dashTrendUp : s.dashTrendDown}>{ch.cplTrend}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={s.dashSectionLabel}>Campaign-Level Detail <span className={s.dashRef}>MKT-001a</span></div>
        <div className={s.dashTableWrap}>
          <table className={s.dashTable}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Ch</th>
                <th>Spend</th>
                <th>Impr.</th>
                <th>Reach</th>
                <th>Clicks</th>
                <th>CTR</th>
                <th>CPC</th>
                <th>LPV</th>
                <th>Fills</th>
                <th>Bookings</th>
                <th>CPL</th>
                <th>Conv %</th>
                <th>Demo</th>
              </tr>
            </thead>
            <tbody>
              {allCampaigns.map((c, i) => (
                <tr key={i}>
                  <td className={s.dashCampaignName}>{c.name}</td>
                  <td>{c.channelIcon}</td>
                  <td className={s.dashMono}>{c.spend}</td>
                  <td className={s.dashMono}>{c.impressions}</td>
                  <td className={s.dashMono}>{c.reach}</td>
                  <td className={s.dashMono}>{c.clicks}</td>
                  <td className={s.dashMono}>{c.ctr}</td>
                  <td className={s.dashMono}>{c.cpc}</td>
                  <td className={s.dashMono}>{c.lpv}</td>
                  <td className={s.dashMono}>{c.formFills}</td>
                  <td className={s.dashMono}>{c.trialBookings}</td>
                  <td className={s.dashMono}>{c.cpl}</td>
                  <td className={s.dashMono}>{c.convRate}</td>
                  <td>{c.demo.onTarget ? <span className={s.demoBadgeGreen}>On target</span> : <span className={s.demoBadgeYellow}>{c.demo.flag}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={s.dashSectionLabel}>Demographics <span className={s.dashRef}>MKT-001b</span></div>
        <div className={s.dashDemoGrid}>
          {allCampaigns.map((c, i) => (
            <div key={i} className={`${s.dashDemoCard} ${!c.demo.onTarget ? s.dashDemoWarn : ''}`}>
              <div className={s.dashDemoName}>{c.name}</div>
              <div className={s.dashDemoRow}><span>Age</span><span>{c.demo.age}</span></div>
              <div className={s.dashDemoRow}><span>Gender</span><span>{c.demo.gender}</span></div>
              <div className={s.dashDemoRow}><span>Geo</span><span>{c.demo.geo}</span></div>
              {!c.demo.onTarget && <div className={s.dashDemoFlag}>{c.demo.flag}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── CHANNEL DETAIL MODAL ─── */
function ChannelDetail({ channel, onClose }) {
  const [eduTip, setEduTip] = useState(null);

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose}>✕</button>
        <div className={s.modalTitle}>{channel.icon} {channel.name} - Campaign Detail</div>
        <div className={s.modalRef}>MKT-001a · MKT-003</div>

        {channel.campaigns.map((c, i) => (
          <div key={i} className={s.campaignDetailCard}>
            <div className={s.campaignDetailName}>{c.name}</div>
            <div className={s.campaignDetailGrid}>
              {[
                { k: 'Spend', v: c.spend },
                { k: 'Impressions', v: c.impressions },
                { k: 'CPM', v: c.cpm, edu: 'cpm' },
                { k: 'Reach', v: c.reach },
                { k: 'Frequency', v: c.frequency, edu: 'frequency' },
                { k: 'Clicks', v: c.clicks },
                { k: 'CTR', v: c.ctr, edu: 'ctr' },
                { k: 'CPC', v: c.cpc },
                { k: 'LPV', v: c.lpv },
                { k: 'LPV Rate', v: c.lpvRate, edu: 'lpvRate' },
                { k: 'Form Fills', v: c.formFills },
                { k: 'Bookings', v: c.trialBookings },
                { k: 'CPL', v: c.cpl, edu: 'cpl' },
                { k: 'Conv. Rate', v: c.convRate, edu: 'convRate' },
              ].map(stat => (
                <div
                  key={stat.k}
                  className={`${s.campaignDetailStat} ${stat.edu ? s.campaignDetailStatEdu : ''}`}
                  onMouseEnter={() => stat.edu && setEduTip(stat.edu)}
                  onMouseLeave={() => setEduTip(null)}
                >
                  <span>{stat.k} {stat.edu && <span className={s.eduIcon}>?</span>}</span>
                  <span>{stat.v}</span>
                </div>
              ))}
            </div>
            <div className={`${s.campaignDemoBanner} ${!c.demo.onTarget ? s.campaignDemoWarn : ''}`}>
              <span>Demo: {c.demo.age} · {c.demo.gender} · {c.demo.geo}</span>
              {c.demo.onTarget
                ? <span className={s.demoBadgeGreen}>On target</span>
                : <span className={s.demoBadgeYellow}>{c.demo.flag}</span>
              }
            </div>
          </div>
        ))}

        {/* Budget Pacing - inside channel detail */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>Budget Pacing</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>MKT-006</span>
          </div>
          <div className={s.budgetCard}>
            <div className={s.budgetRow}>
              <span className={s.budgetLabel}>Monthly budget</span>
              <span className={s.budgetValue}>${BUDGET.monthly}</span>
            </div>
            <div className={s.budgetRow}>
              <span className={s.budgetLabel}>Spent to date</span>
              <span className={s.budgetValue}>${BUDGET.spent}</span>
            </div>
            <div className={s.budgetBar}>
              <div className={s.budgetBarFill} style={{ width: `${Math.round((BUDGET.spent / BUDGET.monthly) * 100)}%` }} />
            </div>
            <div className={s.budgetRow}>
              <span className={s.budgetPacing}>
                <span className={s.pacingDot} />
                On pace
              </span>
              <span className={s.budgetDays}>{BUDGET.daysLeft} days left</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/* ─── BUDGET EDITOR MODAL ─── */
function BudgetEditor({ onClose }) {
  const camp = CAMPAIGN_BUDGETS.find(c => c.status === 'Active') || CAMPAIGN_BUDGETS[0];
  const [newDaily, setNewDaily] = useState(camp.daily.replace('$', ''));

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose}>✕</button>
        <div className={s.modalTitle}>Adjust Budget</div>
        <div className={s.modalRef}>MKT-006</div>

        <div className={s.budgetCurrentCard}>
          <div className={s.budgetCurrentRow}><span>Campaign</span><span>{camp.name}</span></div>
          <div className={s.budgetCurrentRow}><span>Current daily budget</span><span>{camp.daily}</span></div>
          <div className={s.budgetCurrentRow}><span>Current monthly estimate</span><span>{camp.monthly}</span></div>
          <div className={s.budgetCurrentRow}><span>Status</span><span>{camp.status}</span></div>
        </div>

        <div className={s.budgetFormGroup}>
          <label className={s.budgetFormLabel}>New daily budget</label>
          <div className={s.budgetInputWrap}>
            <span className={s.budgetInputPrefix}>$</span>
            <input className={s.budgetFormInput} type="number" step="0.50" value={newDaily} onChange={e => setNewDaily(e.target.value)} />
            <span className={s.budgetInputSuffix}>/ day</span>
          </div>
          <div className={s.budgetEstimate}>Estimated monthly: ${(parseFloat(newDaily || 0) * 30).toFixed(0)}</div>
        </div>

        <div className={s.budgetFormActions}>
          <button className={s.budgetCancelBtn} onClick={onClose}>Cancel</button>
          <button className={s.budgetSaveBtn} onClick={onClose}>Apply Budget Change</button>
        </div>
      </div>
    </div>
  );
}

/* ─── CREATE AD MODAL ─── */
function CreateAdModal({ onClose }) {
  const [step, setStep] = useState(0);
  const STEPS = ['Objective', 'Creative', 'Copy & CTA', 'Audience', 'Budget', 'Review'];

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modalPanel} onClick={e => e.stopPropagation()}>
        <button className={s.modalClose} onClick={onClose}>✕</button>
        <div className={s.modalTitle}>Create New Ad</div>
        <div className={s.modalRef}>MKT-005</div>

        <div className={s.wizardStepper}>
          {STEPS.map((st, i) => (
            <div key={st} className={`${s.wizardStep} ${i === step ? s.wizardStepActive : i < step ? s.wizardStepDone : ''}`}>
              <div className={s.wizardStepNum}>{i + 1}</div>
              <span className={s.wizardStepLabel}>{st}</span>
            </div>
          ))}
        </div>

        <div className={s.wizardBody}>
          {step === 0 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Campaign objective</label>
              <div className={s.objectiveGrid}>
                {['Trial Bookings', 'Form Fills (Leads)', 'Brand Awareness', 'Website Traffic'].map(o => (
                  <button key={o} className={s.objectiveBtn}>{o}</button>
                ))}
              </div>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> For youth sports academies, Trial Bookings drives the highest ROI. I'd recommend starting there.</div>
            </div>
          )}
          {step === 1 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Upload 3-5 ad creatives</label>
              <div className={s.uploadZone}>Drag images or video here, or click to browse</div>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> Your best performers are Reels under 30 seconds with upbeat music. Parent testimonials convert 2x better than training footage.</div>
            </div>
          )}
          {step === 2 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Primary text</label>
              <textarea className={s.wizardTextarea} rows={3} placeholder="Sage will suggest copy based on your brand voice..." />
              <label className={s.budgetFormLabel}>Headline</label>
              <input className={s.budgetFormInput} placeholder="e.g. Free Trial This Saturday" />
              <label className={s.budgetFormLabel}>CTA button</label>
              <select className={s.budgetFormSelect}><option>Book Now</option><option>Learn More</option><option>Sign Up</option><option>Get Offer</option></select>
            </div>
          )}
          {step === 3 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Targeting</label>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> Advantage+ audience is enabled - Meta's algorithm will find the best parents near your academy. Your existing members will be automatically excluded.</div>
              <div className={s.budgetCurrentCard}>
                <div className={s.budgetCurrentRow}><span>Location</span><span>Within 15mi of BAM Academy</span></div>
                <div className={s.budgetCurrentRow}><span>Targeting</span><span>Advantage+ (broad)</span></div>
                <div className={s.budgetCurrentRow}><span>Member exclusion</span><span>Enabled</span></div>
              </div>
            </div>
          )}
          {step === 4 && (
            <div className={s.wizardContent}>
              <label className={s.budgetFormLabel}>Daily budget</label>
              <div className={s.budgetInputWrap}>
                <span className={s.budgetInputPrefix}>$</span>
                <input className={s.budgetFormInput} type="number" defaultValue="10" />
                <span className={s.budgetInputSuffix}>/ day</span>
              </div>
              <label className={s.budgetFormLabel}>Schedule</label>
              <select className={s.budgetFormSelect}><option>Start immediately, run continuously</option><option>Set start and end date</option></select>
            </div>
          )}
          {step === 5 && (
            <div className={s.wizardContent}>
              <div className={s.sageTipSmall}><span className={s.sageTipLabel}>Sage</span> Everything looks good. Your campaign will go live once Meta reviews your ad (usually within 24 hours).</div>
              <div className={s.budgetCurrentCard}>
                <div className={s.budgetCurrentRow}><span>Objective</span><span>Trial Bookings</span></div>
                <div className={s.budgetCurrentRow}><span>Creatives</span><span>3 uploaded</span></div>
                <div className={s.budgetCurrentRow}><span>Daily budget</span><span>$10/day</span></div>
                <div className={s.budgetCurrentRow}><span>Schedule</span><span>Starts immediately</span></div>
              </div>
            </div>
          )}
        </div>

        <div className={s.wizardFooter}>
          {step > 0 && <button className={s.wizardBack} onClick={() => setStep(step - 1)}>Back</button>}
          <div className={s.wizardSpacer} />
          {step < 5
            ? <button className={s.wizardNext} onClick={() => setStep(step + 1)}>Next</button>
            : <button className={s.wizardSave} onClick={onClose}>Launch Campaign</button>
          }
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function Marketing() {
  const [briefInput, setBriefInput] = useState('');
  const [lastBrief, setLastBrief] = useState(null);
  const [cmdInput, setCmdInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [channelDetail, setChannelDetail] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [createAdOpen, setCreateAdOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sageFocused, setSageFocused] = useState(false);
  const typewriterText = useTypewriter(SAGE_PROMPTS);
  const cmdInputRef = useRef(null);
  const canvasRef = useRef(null);
  const threadRef = useRef(null);
  useBannerCanvas(canvasRef);

  // Keep the conversation scrolled to the latest message
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, chatOpen]);

  // Close tools dropdown on scroll
  useEffect(() => {
    if (!toolsOpen) return;
    const close = () => setToolsOpen(false);
    const scrollEl = document.querySelector('[class*="scroll"]');
    scrollEl?.addEventListener('scroll', close, { passive: true });
    return () => scrollEl?.removeEventListener('scroll', close);
  }, [toolsOpen]);

  const totalLeads = CHANNELS.reduce((sum, c) => sum + c.leads, 0);
  const avgCpl = '$14.80';
  const topChannel = CHANNELS[0].name;

  const handleCommand = (text) => {
    const cmd = (text || cmdInput).trim();
    if (!cmd) return;
    const reply = sageReply(cmd);
    setMessages(prev => {
      const seeded = prev.length === 0 ? [sageGreeting()] : prev;
      return [...seeded, { role: 'user', text: cmd }, { role: 'sage', ...reply }];
    });
    setChatOpen(true);
    setCmdInput('');
  };

  // Resolve an action button on a Sage message
  const runSageAction = (act) => {
    if (act === 'createAd') return setCreateAdOpen(true);
    if (act === 'budget') return setBudgetOpen(true);
    if (act === 'dashboard') return setDashOpen(true);
    if (act?.startsWith('channel:')) {
      const name = act.split(':')[1];
      return setChannelDetail(CHANNELS.find(c => c.name === name));
    }
    if (act?.startsWith('ask:')) return handleCommand(act.slice(4));
  };

  const toggleListening = () => {
    setIsListening(!isListening);
    if (!isListening) {
      setTimeout(() => {
        setIsListening(false);
        setCmdInput('Increase Saturday ad budget by $50 this week');
      }, 2500);
    }
  };

  const handleGenerateBrief = () => {
    if (!briefInput.trim()) return;
    setLastBrief({
      audience: briefInput,
      brief: `Content Brief: Target parents of ${briefInput}. Create a 30-second Instagram Reel showing high-energy training with upbeat music. Hook: "Your kid deserves better than rec league." Include a clear CTA to book a free trial. Tone: motivational, authentic. Post on Saturday morning for peak parent engagement.`,
    });
    setBriefInput('');
  };

  const pacingPct = Math.round((BUDGET.spent / BUDGET.monthly) * 100);

  return (
    <>
      <main className={sh.main}>
        {/* ═══ COMMAND BAR - Sage-powered top bar ═══ */}
        <div className={s.topBar}>
          <div className={s.topBarCanvas}>
            <canvas ref={canvasRef} />
          </div>
          <div className={s.topLeft}>
            <div className={s.topGreeting}>Marketing</div>
            <div className={s.topSub}>Manage ads, budgets, and content</div>
          </div>

          <div className={`${s.topSage} ${sageFocused ? s.topSageFocused : ''}`}>
            <div className={s.topSageGlow} />
            <div className={s.topSageOrb}>
              <span className={s.topSageOrbLetter}>S</span>
              <div className={s.topSageOrbPulse} />
            </div>
            <div className={s.topSageInputWrap}>
              <input
                ref={cmdInputRef}
                className={s.topSageInput}
                value={cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                placeholder={typewriterText}
                onFocus={() => setSageFocused(true)}
                onBlur={() => !cmdInput && setSageFocused(false)}
                onKeyDown={e => e.key === 'Enter' && handleCommand()}
              />
              {isListening && <span className={s.topSageListening}>Listening...</span>}
            </div>
            <div className={`${s.topSageMic} ${isListening ? s.topSageMicActive : ''}`} onClick={toggleListening}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              {isListening && <div className={s.topSageMicPulse} />}
            </div>
            <button className={s.topSageSend} onClick={() => handleCommand()} disabled={!cmdInput.trim()}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
            <div className={s.topSageWave}>
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className={s.topSageWaveBar} style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
          </div>

          <div className={s.topRight}>
            <div className={s.topChip}>
              <span className={s.topChipDot} style={{ background: 'var(--green)' }} />
              <span className={s.topChipValue}>{totalLeads}</span>
              <span className={s.topChipLabel}>leads MTD</span>
            </div>
            <div className={s.topChip}>
              <span className={s.topChipDot} style={{ background: 'var(--gold)' }} />
              <span className={s.topChipValue}>{avgCpl}</span>
              <span className={s.topChipLabel}>avg CPL</span>
            </div>
            <div className={s.topChip} onClick={() => setDashOpen(true)} style={{ cursor: 'pointer' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              <span className={s.topChipLabel}>Dashboard</span>
            </div>
            <button className={s.topBell}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <span className={s.topBellBadge}>3</span>
            </button>
          </div>
        </div>

        {/* Sage conversational advisor (MKT-013) */}
        <div className={s.topActions}>
          {chatOpen && (
            <div className={s.chatPanel}>
              <div className={s.chatHead}>
                <div className={s.chatHeadOrb}>S</div>
                <div className={s.chatHeadText}>
                  <div className={s.chatHeadName}>Sage · Marketing Advisor</div>
                  <div className={s.chatHeadSub}>Knows your ads, budget &amp; numbers</div>
                </div>
                <button className={s.chatClose} onClick={() => setChatOpen(false)} aria-label="Close">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className={s.chatThread} ref={threadRef}>
                {messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? s.chatRowUser : s.chatRowSage}>
                    {m.role === 'sage' && <div className={s.chatAvatar}>S</div>}
                    <div className={m.role === 'user' ? s.chatBubbleUser : s.chatBubbleSage}>
                      <div className={s.chatText}>{m.text}</div>
                      {m.actions?.length > 0 && (
                        <div className={s.chatActions}>
                          {m.actions.map(a => (
                            <button key={a.label} className={s.chatActBtn} onClick={() => runSageAction(a.act)}>{a.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className={s.chatSuggest}>
                {STARTERS.map(q => (
                  <button key={q} className={s.chatSuggestChip} onClick={() => handleCommand(q)}>{q}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={sh.scroll}>
          {/* ═══ META ADS - channel detail section with swipe nav ═══ */}
          <div className={s.channelSectionWrap}>
            <div className={s.channelSection}>
            <div className={s.channelSectionHead}>
              <div className={s.channelSectionTitle}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                <span>Meta Ads</span>
              </div>
              <div className={s.channelSectionActions}>
                <button className={s.channelSectionBtn} onClick={() => setCreateAdOpen(true)}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  Create campaign
                </button>
                <button className={s.channelSectionBtn} onClick={() => setBudgetOpen(true)}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  Manage
                </button>
                <button className={s.channelSectionBtn} onClick={() => setCreateAdOpen(true)}>
                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit ads
                </button>
              </div>
            </div>

            <div className={s.improveGrid}>
              <div className={s.improveCol}>
                <div className={s.improveColLabel} style={{ color: 'var(--green)' }}>Working well</div>
                {TOP_ADS.slice(0, 2).map(ad => (
                  <div key={ad.name} className={`${s.improveCard} ${ad.status === 'new' ? s.improveCardNew : s.improveCardHealthy}`}>
                    <div className={s.alertName}>{ad.name}</div>
                    <div className={s.alertMeta}>
                      <span>{ad.spend} spent</span><span>·</span><span>{ad.conversions} conversions</span><span>·</span><span>{ad.ctr} CTR</span>
                    </div>
                    <div className={`${s.adStatusLabel} ${ad.status === 'new' ? s.adStatusNew : s.adStatusHealthy}`}>
                      <span className={s.adStatusDot} />
                      {ad.status === 'new' ? 'New' : 'Healthy'}
                    </div>
                  </div>
                ))}
              </div>
              <div className={s.improveCol}>
                <div className={s.improveColLabel} style={{ color: 'var(--red)' }}>Underperforming</div>
                {ADS_NEEDING_REFRESH.map(ad => (
                  <div key={ad.name} className={`${s.improveCard} ${ad.status === 'Stop-loss' ? s.improveCardStopLoss : s.improveCardStale}`}>
                    <div className={s.alertName}>{ad.name}</div>
                    <div className={s.alertMeta}>
                      <span>{ad.days} days running</span><span>·</span><span>{ad.spend} spent</span><span>·</span><span>{ad.conversions} conversions</span>
                    </div>
                    <div className={`${s.adStatusLabel} ${ad.status === 'Stop-loss' ? s.adStatusStopLoss : s.adStatusStale}`}>
                      <span className={s.adStatusDot} />
                      {ad.status}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Budget Pacing - inside Meta section */}
            <div className={s.metaBudget}>
              <div className={s.metaBudgetHead}>
                <span className={s.metaBudgetTitle}>Budget Pacing</span>
                <button className={s.metaBudgetEdit} onClick={() => setBudgetOpen(true)}>Edit</button>
              </div>
              <div className={s.metaBudgetStats}>
                <div className={s.metaBudgetStat}>
                  <span className={s.metaBudgetStatValue}>${BUDGET.spent}</span>
                  <span className={s.metaBudgetStatLabel}>of ${BUDGET.monthly}</span>
                </div>
                <div className={s.metaBudgetStat}>
                  <span className={s.metaBudgetStatValue}>{BUDGET.daysLeft}</span>
                  <span className={s.metaBudgetStatLabel}>days left</span>
                </div>
                <div className={s.metaBudgetStat}>
                  <span className={`${s.metaBudgetStatValue} ${s.metaBudgetPacing}`}>
                    <span className={s.pacingDot} />
                    On pace
                  </span>
                  <span className={s.metaBudgetStatLabel}>status</span>
                </div>
              </div>
              <div className={s.budgetBar}>
                <div className={s.budgetBarFill} style={{ width: `${pacingPct}%` }} />
              </div>
            </div>

            </div>
            {/* Swipe nav chevron */}
            <div className={s.channelNavChevron} onMouseEnter={() => setToolsOpen(true)} onMouseLeave={() => setToolsOpen(false)}>
              <span className={s.chevronLabel}>more tools</span>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
              {toolsOpen && (
                <div className={s.chevronDropdown}>
                  <div className={s.chevronDropdownTitle}>Switch tool</div>
                  <button className={`${s.chevronDropdownItem} ${s.chevronDropdownActive}`}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    <span>Meta Ads</span>
                    <span className={s.chevronDropdownBadge}>Active</span>
                  </button>
                  {MORE_TOOLS.filter(t => t.name !== 'Meta Ads').map(t => (
                    <button key={t.name} className={s.chevronDropdownItem} onClick={e => { e.stopPropagation(); setToolsOpen(false); }}>
                      <span>{t.icon}</span>
                      <span>{t.name}</span>
                      {!t.enabled && <span className={s.chevronDropdownSoon}>Soon</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ═══ PERFORMANCE - channels + budget ═══ */}
          <div className={s.sectionBanner} style={{ '--accent': 'var(--gold)' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            <span>Performance</span>
          </div>

          {/* Lead Sources */}
          <div className={s.sectionHead}>
            <h3 className={s.sectionTitle}>Lead Sources</h3>
          </div>
          <div className={s.channelGrid}>
            {CHANNELS.map(ch => (
              <div key={ch.name} className={s.channelCard} onClick={() => setChannelDetail(ch)} style={{ '--ch-accent': ch.accent }}>
                <div className={s.channelAccent} />
                <div className={s.channelTop}>
                  <span className={s.channelIcon}>{ch.icon}</span>
                  <span className={s.channelName}>{ch.name}</span>
                  <span className={s.channelExpand}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                  </span>
                </div>
                <div className={s.channelLeads}>{ch.leads}</div>
                <div className={s.channelMeta}>
                  <span className={s.channelCpl}>CPL {ch.cpl}</span>
                  <span className={ch.cplTrendGood ? s.channelTrendUp : s.channelTrendDown}>{ch.cplTrend}</span>
                </div>
                {ch.campaigns.some(c => !c.demo.onTarget) && (
                  <div className={s.channelDemoFlag}>Demo off-target</div>
                )}
              </div>
            ))}
          </div>


          {/* spacer before end */}
          <div style={{ height: 24 }} />
        </div>
      </main>

      {/* Overlays */}
      {dashOpen && <FullDashboard onClose={() => setDashOpen(false)} />}
      {channelDetail && <ChannelDetail channel={channelDetail} onClose={() => setChannelDetail(null)} />}
      {budgetOpen && <BudgetEditor onClose={() => setBudgetOpen(false)} />}
      {createAdOpen && <CreateAdModal onClose={() => setCreateAdOpen(false)} />}
    </>
  );
}
