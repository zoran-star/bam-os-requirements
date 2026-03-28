import { useState, useRef, useMemo } from 'react';
import useBannerCanvas from '../hooks/useBannerCanvas';
import useTypewriter from '../hooks/useTypewriter';
import ContentEngineView from '../views/ContentEngineView';
import s from '../styles/Content.module.css';
import sh from '../styles/shared.module.css';

/* Token bridge for ContentEngineView */
const CONTENT_ENGINE_TOKENS = {
  bg: '#F8F7F5', surface: '#FFFFFF', surfaceEl: '#FAFAF8', surfaceHov: '#F0EFEC',
  surfaceAlt: '#F5F4F1', border: 'rgba(0,0,0,0.07)', borderMed: 'rgba(0,0,0,0.12)',
  borderStr: 'rgba(0,0,0,0.18)', text: '#1C1B18', textSub: '#6E6B63', textMute: '#A5A19A',
  accent: '#C8A84E', accentGhost: 'rgba(200,168,78,0.08)', accentBorder: 'rgba(200,168,78,0.25)',
  green: '#3EAF5C', greenSoft: 'rgba(62,175,92,0.10)', amber: '#E09D24', amberSoft: 'rgba(224,157,36,0.10)',
  blue: '#6366f1', red: '#E05A42', redSoft: 'rgba(224,90,66,0.10)',
  cardHover: 'rgba(200,168,78,0.04)', inputGlow: 'rgba(200,168,78,0.15)',
};

/* ══════════════════════════════════════════════════════════════
   SAGE AI PROMPTS
   ══════════════════════════════════════════════════════════════ */
const SAGE_PROMPTS = [
  'Generate 3 reels about member wins...',
  'What content performed best this week?',
  'Create a brief from my latest podcast...',
  'Schedule this carousel for Thursday...',
  'Which content plan needs attention?',
  'Show me pending review items...',
];

/* ══════════════════════════════════════════════════════════════
   CONTENT TYPE CONFIG
   ══════════════════════════════════════════════════════════════ */
const CONTENT_TYPES = [
  { key: 'reel_script', label: 'Reel', color: '#C8A84E', cssClass: 'Reel' },
  { key: 'instagram_carousel', label: 'Carousel', color: '#6366f1', cssClass: 'Carousel' },
  { key: 'x_thread', label: 'Thread', color: '#6B8AE0', cssClass: 'Thread' },
  { key: 'blog_post', label: 'Blog', color: '#3EAF5C', cssClass: 'Blog' },
  { key: 'newsletter', label: 'Newsletter', color: '#E09D24', cssClass: 'Newsletter' },
];

const typeConfig = (type) => CONTENT_TYPES.find(t => t.key === type) || CONTENT_TYPES[0];

const STATUS_CFG = {
  pending_review:  { color: '#9ca3af', bg: 'rgba(156,163,175,0.1)', label: 'Pending' },
  approved:        { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', label: 'Approved' },
  in_progress:     { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', label: 'In Progress' },
  produced:        { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', label: 'Produced' },
  scheduled:       { color: '#f9a8d4', bg: 'rgba(249,168,212,0.1)', label: 'Scheduled' },
  posted:          { color: '#C8A84E', bg: 'rgba(200,168,78,0.1)', label: 'Posted' },
  rejected:        { color: '#f87171', bg: 'rgba(248,113,113,0.1)', label: 'Rejected' },
};

/* ══════════════════════════════════════════════════════════════
   MOCK DATA — Content Plans (renamed from Campaigns)
   ══════════════════════════════════════════════════════════════ */
const CONTENT_PLANS = [
  { id: 'cp1', name: 'Spring Growth Push', description: 'Focus on trial conversions and member success stories', isDefault: true, reelsPerRun: 3, carouselsPerRun: 2, tone: 'organic' },
  { id: 'cp2', name: 'Summer Shred Series', description: 'Transformation content and workout snippets', isDefault: false, reelsPerRun: 4, carouselsPerRun: 1, tone: 'balanced' },
  { id: 'cp3', name: 'Community Spotlight', description: 'Member highlights, coach features, gym culture', isDefault: false, reelsPerRun: 2, carouselsPerRun: 3, tone: 'organic' },
];

/* ══════════════════════════════════════════════════════════════
   MOCK DATA — Content Pieces
   ══════════════════════════════════════════════════════════════ */
const CONTENT_PIECES = [
  { id: 'c1', type: 'reel_script', hook: '3 things I wish I knew before starting my fitness journey', status: 'pending_review', contentPlanId: 'cp1', avatar: 'Busy Professional', created: '2026-03-20', body: 'Hook: "I wasted 6 months doing the wrong things..."\n\n1. Consistency beats intensity\n2. Nutrition is 80% of the game\n3. Find a community that holds you accountable\n\nCTA: Book a free trial and skip the mistakes I made.' },
  { id: 'c2', type: 'instagram_carousel', hook: 'The 5-4-3-2-1 morning routine our top athletes swear by', status: 'pending_review', contentPlanId: 'cp1', avatar: 'Competitive Athlete', created: '2026-03-20', body: 'Slide 1: Title card\nSlide 2: 5 minutes of mobility\nSlide 3: 4 glasses of water\nSlide 4: 3 deep breaths\nSlide 5: 2 eggs + protein\nSlide 6: 1 clear intention for the day\nSlide 7: CTA' },
  { id: 'c3', type: 'reel_script', hook: 'POV: You finally find a gym where the coach knows your name', status: 'approved', contentPlanId: 'cp1', avatar: 'Busy Professional', created: '2026-03-19', scheduledFor: '2026-03-24', body: 'Scene: Walk into gym, coach waves. Quick montage of personalized cues during workout. End with high-five and "see you Thursday."' },
  { id: 'c4', type: 'x_thread', hook: 'Why most gym marketing fails (and what actually works)', status: 'approved', contentPlanId: 'cp1', avatar: null, created: '2026-03-18', body: 'Thread:\n1/ Most gyms spend money on ads showing equipment. Nobody cares about your machines.\n2/ What converts: real member stories, real results, real community.\n3/ Stop selling "fitness." Sell the feeling of belonging.\n4/ Our best-performing content? A reel of a member hitting a PR. Zero production value. 47k views.' },
  { id: 'c5', type: 'blog_post', hook: 'How to choose the right training program for your goals', status: 'in_progress', contentPlanId: 'cp2', avatar: 'Beginner', created: '2026-03-17', body: 'Draft blog post covering: goal assessment framework, training splits by experience level, when to hire a coach vs. follow a program, common mistakes.' },
  { id: 'c6', type: 'reel_script', hook: 'Day in the life of a BAM coach', status: 'produced', contentPlanId: 'cp3', avatar: null, created: '2026-03-16', body: '5:30 AM alarm. 6 AM first class. Programming review. 1-on-1 coaching. Team huddle. Evening group session. Recovery shake.' },
  { id: 'c7', type: 'instagram_carousel', hook: 'Member transformation: Sarah went from "I hate mornings" to 5 AM warrior', status: 'posted', contentPlanId: 'cp3', avatar: 'Busy Professional', created: '2026-03-14', postedAt: '2026-03-18', body: 'Before/after story carousel with quotes from Sarah and her coach.' },
  { id: 'c8', type: 'newsletter', hook: 'This week at BAM: New class schedule + member spotlight', status: 'posted', contentPlanId: 'cp1', avatar: null, created: '2026-03-12', postedAt: '2026-03-15', body: 'Weekly newsletter template with schedule updates, one member spotlight, and a Sage AI tip of the week.' },
  { id: 'c9', type: 'reel_script', hook: 'The workout that changed everything for Carlos', status: 'scheduled', contentPlanId: 'cp2', avatar: 'Competitive Athlete', created: '2026-03-19', scheduledFor: '2026-03-25', body: 'Testimonial-style reel. Carlos talks about discovering power cleans and how it translated to his sport.' },
  { id: 'c10', type: 'instagram_carousel', hook: '6 signs you need a deload week (and how to do it right)', status: 'approved', contentPlanId: 'cp2', avatar: 'Competitive Athlete', created: '2026-03-18', body: 'Educational carousel covering signs of overtraining and proper deload strategies.' },
  { id: 'c11', type: 'x_thread', hook: 'I asked 50 gym owners what their #1 retention strategy is', status: 'in_progress', contentPlanId: 'cp1', avatar: null, created: '2026-03-17', body: 'Research thread compiling retention insights from industry conversations.' },
  { id: 'c12', type: 'reel_script', hook: 'Stop doing cardio like this (here\'s what actually works)', status: 'pending_review', contentPlanId: 'cp2', avatar: 'Beginner', created: '2026-03-21', body: 'Myth-busting reel about steady-state vs. HIIT for different goals.' },
  { id: 'c13', type: 'blog_post', hook: 'The complete guide to nutrition for strength training', status: 'pending_review', contentPlanId: 'cp2', avatar: 'Competitive Athlete', created: '2026-03-21', body: 'Long-form guide on macros, meal timing, and supplements for strength athletes.' },
  { id: 'c14', type: 'newsletter', hook: 'March member wins + spring schedule changes', status: 'approved', contentPlanId: 'cp1', avatar: null, created: '2026-03-20', scheduledFor: '2026-03-22', body: 'End-of-month newsletter celebrating member achievements and announcing spring class updates.' },
];

/* ══════════════════════════════════════════════════════════════
   MOCK DATA — Research Insights
   ══════════════════════════════════════════════════════════════ */
const SOURCE_LABELS = {
  'r/personaltraining': 'Personal Training Communities',
  'r/fitness': 'Fitness Communities',
  'r/socialmediamarketing': 'Social Media Marketing',
  'r/gym': 'Gym Communities',
};

const RESEARCH_INSIGHTS = [
  { id: 'r1', title: 'Members want more behind-the-scenes content', category: 'trend', source: 'r/personaltraining', relevance: 92 },
  { id: 'r2', title: '"Accountability partner" is the #1 reason cited for staying', category: 'pain_point', source: 'r/fitness', relevance: 88 },
  { id: 'r3', title: 'Short-form video outperforms long-form by 4x for gym content', category: 'trend', source: 'r/socialmediamarketing', relevance: 85 },
  { id: 'r4', title: 'Price is rarely the real objection — it\'s fear of not fitting in', category: 'villain', source: 'r/gym', relevance: 91 },
];

/* ══════════════════════════════════════════════════════════════
   MOCK DATA — Brief Angles (pre-extracted)
   ══════════════════════════════════════════════════════════════ */
const SAMPLE_ANGLES = [
  { id: 'a1', title: 'The Consistency Compound Effect', hook: '"Small daily wins add up to massive transformations"', tags: ['motivation', 'transformation'] },
  { id: 'a2', title: 'Community Over Competition', hook: '"Nobody PRs alone"', tags: ['community', 'culture'] },
  { id: 'a3', title: 'Coach Knowledge Drop', hook: '"Here\'s what I tell every new athlete on day one"', tags: ['education', 'coaching'] },
];

/* ══════════════════════════════════════════════════════════════
   QUICK ACTIONS
   ══════════════════════════════════════════════════════════════ */
const QA_ICONS = {
  generate: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  brief: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  review: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  calendar: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
};

const QUICK_ACTIONS = [
  { label: 'Generate content', icon: 'generate', action: 'generate' },
  { label: 'New brief', icon: 'brief', action: 'brief' },
  { label: 'Swipe review', icon: 'review', action: 'review' },
  { label: 'View calendar', icon: 'calendar', action: 'calendar' },
];

/* ══════════════════════════════════════════════════════════════
   SUB-NAV CONFIG
   ══════════════════════════════════════════════════════════════ */
const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
  { key: 'pipeline', label: 'Pipeline', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
  { key: 'calendar', label: 'Calendar', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> },
  { key: 'brief', label: 'Brief', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
  { key: 'plans', label: 'Content Plans', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> },
  { key: 'analytics', label: 'Analytics', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> },
  { key: 'engine', label: 'Script Engine', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> },
];

/* ══════════════════════════════════════════════════════════════
   TYPE ICON HELPER
   ══════════════════════════════════════════════════════════════ */
const TypeIcon = ({ type, size = 14 }) => {
  const icons = {
    reel_script: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>,
    instagram_carousel: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    x_thread: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    blog_post: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    newsletter: <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  };
  return icons[type] || icons.reel_script;
};

/* ══════════════════════════════════════════════════════════════
   KANBAN COLUMNS
   ══════════════════════════════════════════════════════════════ */
const KANBAN_COLS = [
  { key: 'review', label: 'Pending Review', statuses: ['pending_review'], color: '#9ca3af' },
  { key: 'approved', label: 'Approved', statuses: ['approved', 'scheduled'], color: '#4ade80' },
  { key: 'production', label: 'In Production', statuses: ['in_progress', 'produced'], color: '#a78bfa' },
  { key: 'posted', label: 'Posted', statuses: ['posted'], color: '#C8A84E' },
];

/* ══════════════════════════════════════════════════════════════
   CALENDAR HELPERS
   ══════════════════════════════════════════════════════════════ */
const WEEK_START = new Date(2026, 2, 16);
const CAL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CAL_DATES = CAL_DAYS.map((_, i) => {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + i);
  return d;
});

/* ══════════════════════════════════════════════════════════════
   CONTENT PAGE COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function Content() {
  const canvasRef = useRef(null);
  useBannerCanvas(canvasRef);
  const typewriterText = useTypewriter(SAGE_PROMPTS);

  /* ─── State ─── */
  const [tab, setTab] = useState('dashboard');
  const [cmdInput, setCmdInput] = useState('');
  const [cmdResponse, setCmdResponse] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [activeContentPlanId, setActiveContentPlanId] = useState('cp1');
  const [pipelineView, setPipelineView] = useState('kanban');
  const [drawerPiece, setDrawerPiece] = useState(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [swipeMode, setSwipeMode] = useState(false);
  const [swipeIdx, setSwipeIdx] = useState(0);
  const [briefText, setBriefText] = useState('');
  const [briefAngles, setBriefAngles] = useState([]);
  const [selectedAngles, setSelectedAngles] = useState([]);
  const [analyticsPeriod, setAnalyticsPeriod] = useState('week');

  /* ─── Derived ─── */
  const filteredPieces = activeContentPlanId === 'all'
    ? CONTENT_PIECES
    : CONTENT_PIECES.filter(p => p.contentPlanId === activeContentPlanId);

  const pendingPieces = filteredPieces.filter(p => p.status === 'pending_review');
  const activePlanName = CONTENT_PLANS.find(p => p.id === activeContentPlanId)?.name || 'All Plans';

  const pipelineStats = useMemo(() => {
    const counts = {};
    filteredPieces.forEach(p => {
      const key = p.status === 'scheduled' ? 'approved' : p.status;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [filteredPieces]);

  /* ─── Handlers ─── */
  const toggleListening = () => setIsListening(!isListening);

  const handleCommand = () => {
    if (!cmdInput.trim()) return;
    const input = cmdInput;
    setCmdInput('');
    setIsListening(false);
    const responses = {
      generate: { reply: 'I\'ll generate 3 reels and 2 carousels for your "' + activePlanName + '" content plan. This will take about 30 seconds.', actions: ['Generate now', 'Cancel'] },
      review: { reply: 'You have ' + pendingPieces.length + ' pieces waiting for review. Want to start a swipe review?', actions: ['Start review', 'Show list'] },
      schedule: { reply: 'You have 3 approved pieces ready to schedule. I can auto-schedule them based on your best posting times.', actions: ['Auto-schedule', 'Manual'] },
    };
    const key = input.toLowerCase().includes('generat') ? 'generate' : input.toLowerCase().includes('review') ? 'review' : 'schedule';
    setCmdResponse({ input, ...responses[key] });
  };

  const handleQuickAction = (action) => {
    if (action === 'generate') setGenerateOpen(true);
    if (action === 'brief') setTab('brief');
    if (action === 'review') { setSwipeMode(true); setSwipeIdx(0); }
    if (action === 'calendar') setTab('calendar');
  };

  const extractAngles = () => {
    if (!briefText.trim()) return;
    setBriefAngles(SAMPLE_ANGLES);
    setSelectedAngles(SAMPLE_ANGLES.map(a => a.id));
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER — DASHBOARD VIEW
     ══════════════════════════════════════════════════════════════ */
  const renderDashboard = () => (
    <>
      {/* Quick Actions */}
      <div className={s.cmdChips}>
        {QUICK_ACTIONS.map(qa => (
          <button key={qa.action} className={s.cmdChip} onClick={() => handleQuickAction(qa.action)}>
            <span className={s.cmdChipIcon}>{QA_ICONS[qa.icon]}</span>
            {qa.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className={s.statsBar}>
        <div className={s.statCard}>
          <div className={s.statLabel}>Pipeline</div>
          <div className={s.statValue}>{filteredPieces.length}</div>
          <div className={s.statSuffix}>total pieces</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Pending Review</div>
          <div className={s.statValue}>{pendingPieces.length}</div>
          <div className={s.statSuffix}>awaiting approval</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Posted This Week</div>
          <div className={s.statValue}>{filteredPieces.filter(p => p.status === 'posted').length}</div>
          <div className={`${s.statDelta} ${s.statDeltaUp}`}>
            <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
            +33%
          </div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Approval Rate</div>
          <div className={s.statValue}>78%</div>
          <div className={s.statSuffix}>last 30 days</div>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className={s.dashGrid}>
        {/* Pending Review */}
        <div className={s.dashCard}>
          <div className={s.dashCardTitle}>
            <span className={s.dashCardTitleIcon}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </span>
            Pending Review ({pendingPieces.length})
          </div>
          <div className={s.pendingList}>
            {pendingPieces.slice(0, 4).map(piece => {
              const tc = typeConfig(piece.type);
              return (
                <div key={piece.id} className={s.pendingItem} onClick={() => setDrawerPiece(piece)}>
                  <div className={`${s.pendingTypeIcon} ${s['pendingType' + tc.cssClass]}`}>
                    <TypeIcon type={piece.type} />
                  </div>
                  <div className={s.pendingInfo}>
                    <div className={s.pendingHook}>{piece.hook}</div>
                    <div className={s.pendingType}>{tc.label}{piece.avatar ? ` \u00B7 ${piece.avatar}` : ''}</div>
                  </div>
                  <button style={{ background: 'var(--gold)', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); setDrawerPiece(piece); }}>
                    Review
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* This Week's Calendar */}
        <div className={s.dashCard}>
          <div className={s.dashCardTitle}>
            <span className={s.dashCardTitleIcon}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            Scheduled This Week
          </div>
          <div className={s.pendingList}>
            {filteredPieces.filter(p => p.scheduledFor).slice(0, 4).map(piece => {
              const tc = typeConfig(piece.type);
              return (
                <div key={piece.id} className={s.pendingItem} onClick={() => setDrawerPiece(piece)}>
                  <div className={`${s.pendingTypeIcon} ${s['pendingType' + tc.cssClass]}`}>
                    <TypeIcon type={piece.type} />
                  </div>
                  <div className={s.pendingInfo}>
                    <div className={s.pendingHook}>{piece.hook}</div>
                    <div className={s.pendingType}>{tc.label} &middot; {new Date(piece.scheduledFor).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Research Insights */}
        <div className={`${s.dashCard} ${s.dashCardFull}`}>
          <div className={s.dashCardTitle}>
            <span className={s.dashCardTitleIcon}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </span>
            Research Insights
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ts)', marginLeft: 8 }}>Trending topics from fitness communities relevant to your gym</span>
          </div>
          <div className={s.pendingList}>
            {RESEARCH_INSIGHTS.map(insight => (
              <div key={insight.id} className={s.pendingItem}>
                <div className={`${s.pendingTypeIcon} ${s.pendingTypeReel}`}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                </div>
                <div className={s.pendingInfo}>
                  <div className={s.pendingHook}>{insight.title}</div>
                  <div className={s.pendingType}>
                    {SOURCE_LABELS[insight.source] || insight.source} &middot;{' '}
                    <span title="Based on your gym type, member demographics, and content history" style={{ cursor: 'help' }}>{insight.relevance}% match to your audience</span> &middot;{' '}
                    {insight.category.replace('_', ' ')}
                  </div>
                </div>
                <button style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--gold)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                  onClick={() => {}}>
                  Create content →
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );

  /* ══════════════════════════════════════════════════════════════
     RENDER — PIPELINE VIEW
     ══════════════════════════════════════════════════════════════ */
  const renderPipeline = () => (
    <div className={s.pipelineWrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className={s.pipelineViewToggle}>
          <button className={`${s.pipelineViewBtn} ${pipelineView === 'kanban' ? s.pipelineViewBtnActive : ''}`} onClick={() => setPipelineView('kanban')}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginRight: 4, verticalAlign: 'middle' }}><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/></svg>
            Board
          </button>
          <button className={`${s.pipelineViewBtn} ${pipelineView === 'list' ? s.pipelineViewBtnActive : ''}`} onClick={() => setPipelineView('list')}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginRight: 4, verticalAlign: 'middle' }}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            List
          </button>
        </div>
        <div className={s.cmdChips}>
          <button className={s.cmdChip} onClick={() => setGenerateOpen(true)}>
            <span className={s.cmdChipIcon}>{QA_ICONS.generate}</span>
            Generate
          </button>
          <button className={s.cmdChip} onClick={() => { setSwipeMode(true); setSwipeIdx(0); }}>
            <span className={s.cmdChipIcon}>{QA_ICONS.review}</span>
            Swipe Review
          </button>
        </div>
      </div>

      {pipelineView === 'kanban' ? (
        <div className={s.kanbanBoard}>
          {KANBAN_COLS.map(col => {
            const colPieces = filteredPieces.filter(p => col.statuses.includes(p.status));
            return (
              <div key={col.key} className={s.kanbanCol}>
                <div className={s.kanbanColHeader}>
                  <div className={s.kanbanColTitle}>
                    <span className={s.kanbanColDot} style={{ background: col.color }} />
                    {col.label}
                  </div>
                  <span className={s.kanbanColCount}>{colPieces.length}</span>
                </div>
                {colPieces.map(piece => {
                  const tc = typeConfig(piece.type);
                  return (
                    <div key={piece.id} className={s.kanbanCard} onClick={() => setDrawerPiece(piece)}>
                      <div className={s.kanbanCardType} style={{ color: tc.color }}>
                        <TypeIcon type={piece.type} size={12} />
                        {tc.label}
                      </div>
                      <div className={s.kanbanCardHook}>{piece.hook}</div>
                      <div className={s.kanbanCardMeta}>
                        {piece.avatar && (
                          <>
                            <span className={s.kanbanCardAvatar}>{piece.avatar.charAt(0)}</span>
                            <span>{piece.avatar}</span>
                          </>
                        )}
                      </div>
                      {piece.scheduledFor && (
                        <div className={s.kanbanCardScheduled}>
                          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>
                          {new Date(piece.scheduledFor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={s.pipelineList}>
          {filteredPieces.map(piece => {
            const tc = typeConfig(piece.type);
            const st = STATUS_CFG[piece.status] || STATUS_CFG.pending_review;
            return (
              <div key={piece.id} className={s.pipelineRow} onClick={() => setDrawerPiece(piece)}>
                <div className={s.pipelineRowType} style={{ background: tc.color + '18', color: tc.color }}>
                  <TypeIcon type={piece.type} size={14} />
                </div>
                <div className={s.pipelineRowHook}>{piece.hook}</div>
                <span className={s.pipelineRowStatus} style={{ background: st.bg, color: st.color }}>{st.label}</span>
                <span className={s.pipelineRowDate}>{piece.created}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════
     RENDER — CALENDAR VIEW
     ══════════════════════════════════════════════════════════════ */
  const renderCalendar = () => {
    const scheduledPieces = filteredPieces.filter(p => p.scheduledFor || p.postedAt);
    const today = new Date();

    return (
      <>
        <div className={s.calToolbar}>
          <div className={s.weekNav}>
            <button className={s.weekNavBtn}>&larr;</button>
            <span className={s.weekLabel}>Mar 16 &ndash; 22, 2026</span>
            <button className={s.weekNavBtn}>&rarr;</button>
          </div>
        </div>
        <div className={s.calendarGrid}>
          {CAL_DATES.map((date, dayIdx) => {
            const dateStr = date.toISOString().split('T')[0];
            const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth();
            const dayPieces = scheduledPieces.filter(p => {
              const d = p.scheduledFor || p.postedAt;
              return d === dateStr;
            });
            return (
              <div key={dayIdx} className={`${s.calDay} ${isToday ? s.calDayToday : ''}`}>
                <div className={s.calDayLabel}>{CAL_DAYS[dayIdx]}</div>
                <div className={`${s.calDayNum} ${isToday ? s.calDayNumToday : ''}`}>{date.getDate()}</div>
                {dayPieces.map(piece => {
                  const tc = typeConfig(piece.type);
                  return (
                    <div
                      key={piece.id}
                      className={`${s.calEvent} ${s['calEvent' + tc.cssClass]}`}
                      onClick={() => setDrawerPiece(piece)}
                    >
                      {tc.label}: {piece.hook.length > 30 ? piece.hook.slice(0, 30) + '...' : piece.hook}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER — BRIEF VIEW
     ══════════════════════════════════════════════════════════════ */
  const renderBrief = () => (
    <div className={s.briefWrap}>
      {/* Step 1: Select Content Plan */}
      <div className={s.briefStep}>
        <div className={s.briefStepHeader}>
          <div className={s.briefStepNum}>1</div>
          <div className={s.briefStepTitle}>Select Content Plan</div>
        </div>
        <div className={s.cmdChips}>
          {CONTENT_PLANS.map(plan => (
            <button
              key={plan.id}
              className={s.cmdChip}
              style={activeContentPlanId === plan.id ? { borderColor: 'var(--gold)', color: 'var(--gold)', background: 'rgba(200,168,78,0.05)' } : {}}
              onClick={() => setActiveContentPlanId(plan.id)}
            >
              {plan.name}
              {plan.isDefault && <span style={{ fontSize: 9, opacity: 0.6 }}>(default)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Paste Content */}
      <div className={s.briefStep}>
        <div className={s.briefStepHeader}>
          <div className={s.briefStepNum}>2</div>
          <div className={s.briefStepTitle}>Paste Your Content</div>
        </div>
        <textarea
          className={s.briefTextarea}
          value={briefText}
          onChange={e => setBriefText(e.target.value)}
          placeholder="Paste a podcast transcript, interview notes, article, or any raw content you want to turn into social media posts..."
        />
        <div className={s.briefCharCount}>{briefText.length} characters</div>
        <button className={s.briefBtn} onClick={extractAngles} disabled={!briefText.trim()}>
          {QA_ICONS.generate}
          Extract Angles
        </button>
      </div>

      {/* Step 3: Review Angles */}
      {briefAngles.length > 0 && (
        <div className={s.briefStep}>
          <div className={s.briefStepHeader}>
            <div className={s.briefStepNum}>3</div>
            <div className={s.briefStepTitle}>Review Angles ({selectedAngles.length} selected)</div>
          </div>
          {briefAngles.map(angle => (
            <div
              key={angle.id}
              className={`${s.briefAngleCard} ${selectedAngles.includes(angle.id) ? s.briefAngleCardSelected : ''}`}
              onClick={() => setSelectedAngles(prev =>
                prev.includes(angle.id) ? prev.filter(id => id !== angle.id) : [...prev, angle.id]
              )}
            >
              <div className={s.briefAngleTitle}>{angle.title}</div>
              <div className={s.briefAngleHook}>{angle.hook}</div>
              <div className={s.briefAngleTags}>
                {angle.tags.map(tag => (
                  <span key={tag} className={s.briefAngleTag}>{tag}</span>
                ))}
              </div>
            </div>
          ))}
          <button className={s.briefBtn} disabled={selectedAngles.length === 0}>
            {QA_ICONS.generate}
            Generate {selectedAngles.length} Piece{selectedAngles.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════
     RENDER — CONTENT PLANS VIEW
     ══════════════════════════════════════════════════════════════ */
  const renderPlans = () => (
    <div className={s.plansGrid}>
      {CONTENT_PLANS.map(plan => {
        const planPieces = CONTENT_PIECES.filter(p => p.contentPlanId === plan.id);
        const posted = planPieces.filter(p => p.status === 'posted').length;
        return (
          <div key={plan.id} className={`${s.planCard} ${plan.isDefault ? s.planCardDefault : ''}`}>
            <div className={s.planCardHeader}>
              <div className={s.planCardName}>{plan.name}</div>
              {plan.isDefault && <span className={s.planCardDefaultBadge}>Default</span>}
            </div>
            <div className={s.planCardDesc}>{plan.description}</div>
            <div className={s.planCardStats}>
              <div className={s.planCardStat}>
                <span className={s.planCardStatLabel}>Total</span>
                <span className={s.planCardStatValue}>{planPieces.length}</span>
              </div>
              <div className={s.planCardStat}>
                <span className={s.planCardStatLabel}>Posted</span>
                <span className={s.planCardStatValue}>{posted}</span>
              </div>
              <div className={s.planCardStat}>
                <span className={s.planCardStatLabel}>Per Run</span>
                <span className={s.planCardStatValue}>{plan.reelsPerRun}R / {plan.carouselsPerRun}C</span>
              </div>
            </div>
            <div className={s.planCardStack}>
              {CONTENT_TYPES.slice(0, 3).map(ct => (
                <span key={ct.key} className={s.planCardStackItem} style={{ background: ct.color + '15', color: ct.color }}>
                  <TypeIcon type={ct.key} size={10} />
                  {ct.label}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  /* ══════════════════════════════════════════════════════════════
     RENDER — ANALYTICS VIEW
     ══════════════════════════════════════════════════════════════ */
  const renderAnalytics = () => {
    const funnelData = [
      { label: 'Generated', count: filteredPieces.length, color: '#9ca3af' },
      { label: 'Approved', count: filteredPieces.filter(p => ['approved', 'scheduled', 'in_progress', 'produced', 'posted'].includes(p.status)).length, color: '#4ade80' },
      { label: 'Produced', count: filteredPieces.filter(p => ['produced', 'posted'].includes(p.status)).length, color: '#a78bfa' },
      { label: 'Posted', count: filteredPieces.filter(p => p.status === 'posted').length, color: '#C8A84E' },
    ];
    const maxCount = Math.max(...funnelData.map(f => f.count), 1);

    const typeCounts = {};
    filteredPieces.forEach(p => {
      typeCounts[p.type] = (typeCounts[p.type] || 0) + 1;
    });
    const maxTypeCount = Math.max(...Object.values(typeCounts), 1);

    return (
      <div className={s.analyticsWrap}>
        {/* Period toggle */}
        <div className={s.analyticsPeriod}>
          {['week', 'month', '3m'].map(p => (
            <button
              key={p}
              className={`${s.analyticsPeriodBtn} ${analyticsPeriod === p ? s.analyticsPeriodBtnActive : ''}`}
              onClick={() => setAnalyticsPeriod(p)}
            >
              {p === 'week' ? '7 Days' : p === 'month' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className={s.statsBar}>
          <div className={s.statCard}>
            <div className={s.statLabel}>Generated</div>
            <div className={s.statValue}>{filteredPieces.length}</div>
            <div className={`${s.statDelta} ${s.statDeltaUp}`}>
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
              +24%
            </div>
          </div>
          <div className={s.statCard}>
            <div className={s.statLabel}>Approval Rate</div>
            <div className={s.statValue}>78%</div>
            <div className={`${s.statDelta} ${s.statDeltaUp}`}>
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>
              +5%
            </div>
          </div>
          <div className={s.statCard}>
            <div className={s.statLabel}>Avg Time to Post</div>
            <div className={s.statValue}>2.4d</div>
            <div className={s.statSuffix}>from approval</div>
          </div>
          <div className={s.statCard}>
            <div className={s.statLabel}>Avg Time to Review</div>
            <div className={s.statValue}>8.2h</div>
            <div className={`${s.statDelta} ${s.statDeltaDown}`}>
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              -12%
            </div>
          </div>
        </div>

        {/* Funnel */}
        <div className={s.funnelWrap}>
          <div className={s.funnelTitle}>Content Pipeline Funnel</div>
          <div className={s.funnelSteps}>
            {funnelData.map(step => (
              <div key={step.label} className={s.funnelStep}>
                <div className={s.funnelStepCount}>{step.count}</div>
                <div
                  className={s.funnelBar}
                  style={{
                    height: Math.max((step.count / maxCount) * 120, 4),
                    background: step.color,
                  }}
                />
                <div className={s.funnelStepLabel}>{step.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Type Breakdown */}
        <div className={s.typeBreakdown}>
          <div className={s.funnelTitle}>Content Type Breakdown</div>
          {CONTENT_TYPES.map(ct => {
            const count = typeCounts[ct.key] || 0;
            return (
              <div key={ct.key} className={s.typeRow}>
                <div className={s.typeIcon} style={{ background: ct.color + '15', color: ct.color }}>
                  <TypeIcon type={ct.key} size={14} />
                </div>
                <div className={s.typeLabel}>{ct.label}</div>
                <div className={s.typeBarWrap}>
                  <div className={s.typeBarFill} style={{ width: `${(count / maxTypeCount) * 100}%`, background: ct.color }} />
                </div>
                <div className={s.typeCount}>{count}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER — CONTENT DETAIL DRAWER
     ══════════════════════════════════════════════════════════════ */
  const renderDrawer = () => {
    if (!drawerPiece) return null;
    const tc = typeConfig(drawerPiece.type);
    const st = STATUS_CFG[drawerPiece.status] || STATUS_CFG.pending_review;

    return (
      <div className={s.drawerOverlay} onClick={() => setDrawerPiece(null)}>
        <div className={s.drawer} onClick={e => e.stopPropagation()}>
          <button className={s.drawerClose} onClick={() => setDrawerPiece(null)}>&times;</button>
          <div className={s.drawerHeader}>
            <div className={s.drawerType}>
              <span className={s.drawerTypeDot} style={{ background: tc.color }} />
              <span className={s.drawerTypeLabel} style={{ color: tc.color }}>{tc.label}</span>
            </div>
            <div className={s.drawerTitle}>{drawerPiece.hook}</div>
            <span className={s.drawerStatus} style={{ background: st.bg, color: st.color }}>{st.label}</span>
          </div>
          <div className={s.drawerSection}>
            <div className={s.drawerSectionTitle}>Details</div>
            <div className={s.drawerRow}><span>Content Plan</span><span>{CONTENT_PLANS.find(p => p.id === drawerPiece.contentPlanId)?.name || '—'}</span></div>
            <div className={s.drawerRow}><span>Avatar</span><span>{drawerPiece.avatar || '—'}</span></div>
            <div className={s.drawerRow}><span>Created</span><span>{drawerPiece.created}</span></div>
            {drawerPiece.scheduledFor && <div className={s.drawerRow}><span>Scheduled</span><span>{drawerPiece.scheduledFor}</span></div>}
            {drawerPiece.postedAt && <div className={s.drawerRow}><span>Posted</span><span>{drawerPiece.postedAt}</span></div>}
          </div>
          {drawerPiece.body && (
            <div className={s.drawerSection}>
              <div className={s.drawerSectionTitle}>Content</div>
              <div className={s.drawerBody}>{drawerPiece.body}</div>
            </div>
          )}
          <div className={s.drawerFooter}>
            {drawerPiece.status === 'pending_review' && (
              <>
                <button className={s.btnPrimary} onClick={() => setDrawerPiece(null)}>Approve</button>
                <button className={s.btnDanger} onClick={() => setDrawerPiece(null)}>Reject</button>
              </>
            )}
            {drawerPiece.status === 'approved' && (
              <button className={s.btnPrimary} onClick={() => setDrawerPiece(null)}>Schedule</button>
            )}
            <button className={s.btnSecondary} onClick={() => setDrawerPiece(null)}>Close</button>
          </div>
        </div>
      </div>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER — SWIPE REVIEW
     ══════════════════════════════════════════════════════════════ */
  const renderSwipeReview = () => {
    if (!swipeMode) return null;
    const items = pendingPieces;
    if (items.length === 0) return (
      <div className={s.modalOverlay} onClick={() => setSwipeMode(false)}>
        <div className={s.modal} onClick={e => e.stopPropagation()}>
          <div className={s.emptyState}>
            <div className={s.emptyIcon}>
              <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div className={s.emptyText}>All caught up! No pending reviews.</div>
          </div>
          <button className={s.btnSecondary} onClick={() => setSwipeMode(false)} style={{ alignSelf: 'center' }}>Close</button>
        </div>
      </div>
    );

    const piece = items[swipeIdx % items.length];
    const tc = typeConfig(piece.type);

    return (
      <div className={s.modalOverlay} onClick={() => setSwipeMode(false)}>
        <div className={s.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className={s.modalHead}>
            <h3>Swipe Review</h3>
            <button className={s.modalClose} onClick={() => setSwipeMode(false)}>&times;</button>
          </div>
          <div className={s.swipeCounter}>{swipeIdx + 1} of {items.length}</div>
          <div className={s.swipeCard}>
            <div className={s.swipeCardType} style={{ color: tc.color }}>
              <TypeIcon type={piece.type} />
              {tc.label}
              {piece.avatar && <span style={{ color: 'var(--tm)', fontWeight: 500 }}>&middot; {piece.avatar}</span>}
            </div>
            <div className={s.swipeCardHook}>{piece.hook}</div>
            {piece.body && <div className={s.swipeCardBody}>{piece.body}</div>}
          </div>
          <div className={s.swipeActions}>
            <button className={`${s.swipeBtn} ${s.swipeBtnReject}`} onClick={() => setSwipeIdx(i => i + 1)} title="Reject">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <button className={`${s.swipeBtn} ${s.swipeBtnSkip}`} onClick={() => setSwipeIdx(i => i + 1)} title="Skip">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
            </button>
            <button className={`${s.swipeBtn} ${s.swipeBtnApprove}`} onClick={() => setSwipeIdx(i => i + 1)} title="Approve">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER — GENERATE MODAL
     ══════════════════════════════════════════════════════════════ */
  const renderGenerateModal = () => {
    if (!generateOpen) return null;
    return (
      <div className={s.modalOverlay} onClick={() => setGenerateOpen(false)}>
        <div className={s.modal} onClick={e => e.stopPropagation()}>
          <div className={s.modalHead}>
            <h3>Generate Content</h3>
            <button className={s.modalClose} onClick={() => setGenerateOpen(false)}>&times;</button>
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Content Plan</label>
            <select className={s.formSelect} value={activeContentPlanId} onChange={e => setActiveContentPlanId(e.target.value)}>
              {CONTENT_PLANS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Content Types</label>
            <div className={s.cmdChips}>
              {CONTENT_TYPES.map(ct => (
                <span key={ct.key} className={s.cmdChip} style={{ borderColor: ct.color + '40', color: ct.color }}>
                  <TypeIcon type={ct.key} size={12} />
                  {ct.label}
                </span>
              ))}
            </div>
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Reels per run</label>
            <select className={s.formSelect} defaultValue="3">
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className={s.formGroup}>
            <label className={s.formLabel}>Carousels per run</label>
            <select className={s.formSelect} defaultValue="2">
              {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className={s.modalFooter}>
            <button className={s.btnSecondary} onClick={() => setGenerateOpen(false)}>Cancel</button>
            <button className={s.btnPrimary} onClick={() => setGenerateOpen(false)}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ marginRight: 4, verticalAlign: 'middle' }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              Generate
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ══════════════════════════════════════════════════════════════
     MAIN RENDER
     ══════════════════════════════════════════════════════════════ */
  const viewRenderers = {
    dashboard: renderDashboard,
    pipeline: renderPipeline,
    calendar: renderCalendar,
    brief: renderBrief,
    plans: renderPlans,
    analytics: renderAnalytics,
    engine: () => <ContentEngineView tokens={CONTENT_ENGINE_TOKENS} dark={false} />,
  };

  return (
    <main className={sh.main}>
      {/* ═══ COMMAND BAR HEADER ═══ */}
      <div className={s.cmdBarHeader}>
        <canvas ref={canvasRef} className={s.cmdBarCanvas} />
        <div className={s.cmdBarInner}>
          <div className={s.cmdLeft}>
            <h1 className={s.cmdGreeting}>Content</h1>
            <span className={s.cmdSubGreeting}>{filteredPieces.length} pieces &middot; {pendingPieces.length} pending review</span>
          </div>
          <div className={s.cmdCenter}>
            <div className={s.cmdSageOrb}>S</div>
            <input
              className={s.cmdSageInput}
              value={cmdInput}
              onChange={e => setCmdInput(e.target.value)}
              placeholder={typewriterText}
              onKeyDown={e => e.key === 'Enter' && handleCommand()}
            />
            {isListening && <span className={s.cmdListenBadge}>Listening...</span>}
            <button className={`${s.cmdMicBtn} ${isListening ? s.cmdMicBtnActive : ''}`} onClick={toggleListening}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <button className={s.cmdSendBtn} onClick={() => handleCommand()} disabled={!cmdInput.trim()}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <div className={s.planSwitcher}>
            <span className={s.planLabel}>Plan:</span>
            <select className={s.planSelect} value={activeContentPlanId} onChange={e => setActiveContentPlanId(e.target.value)}>
              <option value="all">All Plans</option>
              {CONTENT_PLANS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className={sh.scroll}>
        {/* Sage response */}
        {cmdResponse && (
          <div className={s.cmdResponse}>
            <div className={s.cmdResponseQ}>You said: &ldquo;{cmdResponse.input}&rdquo;</div>
            <div className={s.cmdResponseA}>{cmdResponse.reply}</div>
            <div className={s.cmdResponseActions}>
              {cmdResponse.actions.map(a => (
                <button
                  key={a}
                  className={a === 'Cancel' ? s.cmdActionCancel : s.cmdActionConfirm}
                  onClick={() => setCmdResponse(null)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sub-navigation */}
        <div className={s.subNav}>
          {TABS.map(t => (
            <button
              key={t.key}
              className={`${s.subNavBtn} ${tab === t.key ? s.subNavBtnActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className={s.subNavIcon}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Active view */}
        {viewRenderers[tab]?.()}
      </div>

      {/* Overlays */}
      {renderDrawer()}
      {renderSwipeReview()}
      {renderGenerateModal()}
    </main>
  );
}
