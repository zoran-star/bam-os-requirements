import { useState } from 'react';
import PageBanner from '../components/PageBanner';
import s from '../styles/Marketing.module.css';
import sh from '../styles/shared.module.css';

const CHANNELS = [
  { name: 'Instagram', leads: 14, cpl: '$12.40', trend: '+22%', trendUp: true, icon: '📸' },
  { name: 'Facebook', leads: 8, cpl: '$18.60', trend: '+5%', trendUp: true, icon: '📘' },
  { name: 'Google', leads: 6, cpl: '$24.10', trend: '-8%', trendUp: false, icon: '🔍' },
  { name: 'Referral', leads: 4, cpl: '$0', trend: '+50%', trendUp: true, icon: '🤝' },
];

const ADS_NEEDING_REFRESH = [
  { name: 'Summer Skills Camp Promo', days: 47, status: 'Stale', spend: '$312', conversions: 2, trend: 'declining' },
  { name: 'Free Trial — Instagram Story', days: 62, status: 'Stop-loss', spend: '$158', conversions: 0, trend: 'zero' },
];

const TOP_ADS = [
  { name: 'Youth Basketball Reel — Saturday Energy', spend: '$89', conversions: 6, ctr: '4.2%', days: 12, status: 'healthy' },
  { name: 'Parent Testimonial — Maria R.', spend: '$134', conversions: 5, ctr: '3.8%', days: 21, status: 'healthy' },
  { name: 'Back-to-School Registration', spend: '$67', conversions: 3, ctr: '3.1%', days: 8, status: 'new' },
];

const BUDGET = { monthly: 500, spent: 312, daysLeft: 15, pacing: 'on-pace' };

export default function Marketing() {
  const [briefInput, setBriefInput] = useState('');
  const [lastBrief, setLastBrief] = useState(null);

  const totalLeads = CHANNELS.reduce((sum, c) => sum + c.leads, 0);
  const avgCpl = '$14.80';
  const topChannel = CHANNELS[0].name;

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
    <main className={sh.main}>
      <PageBanner
        title="Marketing"
        stats={[
          { value: `${totalLeads} Leads MTD`, explanation: 'Total leads this month' },
          { value: avgCpl, explanation: 'Avg cost per lead' },
          { value: topChannel, explanation: 'Top lead source' },
        ]}
      />

      <div className={sh.scroll}>
        {/* Sage tip */}
        <div className={s.sageTip}>
          <span className={s.sageTipLabel}>Sage</span>
          <span>Your Saturday ad is outperforming everything else by 3x — worth putting more budget there this week.</span>
        </div>

        {/* Lead Sources */}
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Lead Sources</h3>
          <span className={s.sectionRef}>MKT-001</span>
        </div>
        <div className={s.channelGrid}>
          {CHANNELS.map(ch => (
            <div key={ch.name} className={s.channelCard}>
              <div className={s.channelTop}>
                <span className={s.channelIcon}>{ch.icon}</span>
                <span className={s.channelName}>{ch.name}</span>
              </div>
              <div className={s.channelLeads}>{ch.leads}</div>
              <div className={s.channelMeta}>
                <span className={s.channelCpl}>CPL {ch.cpl}</span>
                <span className={ch.trendUp ? s.channelTrendUp : s.channelTrendDown}>{ch.trend}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Budget Pacing */}
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Budget Pacing</h3>
          <span className={s.sectionRef}>MKT-006</span>
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
            <div className={s.budgetBarFill} style={{ width: `${pacingPct}%` }} />
          </div>
          <div className={s.budgetRow}>
            <span className={s.budgetPacing}>
              <span className={s.pacingDot} />
              On pace
            </span>
            <span className={s.budgetDays}>{BUDGET.daysLeft} days left</span>
          </div>
        </div>

        {/* Ad Health */}
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Ads Needing Refresh</h3>
          <span className={s.sectionRef}>MKT-002</span>
        </div>
        {ADS_NEEDING_REFRESH.map(ad => (
          <div key={ad.name} className={s.alertCard}>
            <div className={s.alertLeft}>
              <div className={s.alertName}>{ad.name}</div>
              <div className={s.alertMeta}>
                <span>{ad.days} days running</span>
                <span>•</span>
                <span>{ad.spend} spent</span>
                <span>•</span>
                <span>{ad.conversions} conversions</span>
              </div>
            </div>
            <div className={s.alertRight}>
              <span className={ad.status === 'Stop-loss' ? s.alertBadgeRed : s.alertBadgeYellow}>{ad.status}</span>
              <button className={s.alertCta}>See Sage suggestion</button>
            </div>
          </div>
        ))}

        {/* Best Performing */}
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Best Performing Ads</h3>
          <span className={s.sectionRef}>MKT-004</span>
        </div>
        <div className={s.adsGrid}>
          {TOP_ADS.map(ad => (
            <div key={ad.name} className={s.adCard}>
              <div className={s.adName}>{ad.name}</div>
              <div className={s.adStats}>
                <div className={s.adStat}><span className={s.adStatLabel}>Spend</span><span className={s.adStatVal}>{ad.spend}</span></div>
                <div className={s.adStat}><span className={s.adStatLabel}>Conv.</span><span className={s.adStatVal}>{ad.conversions}</span></div>
                <div className={s.adStat}><span className={s.adStatLabel}>CTR</span><span className={s.adStatVal}>{ad.ctr}</span></div>
              </div>
              <div className={s.adFooter}>
                <span className={s.adDays}>{ad.days}d active</span>
                <span className={ad.status === 'new' ? s.adBadgeNew : s.adBadgeHealthy}>{ad.status}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Content Briefs */}
        <div className={s.sectionHead}>
          <h3 className={s.sectionTitle}>Content Briefs</h3>
          <span className={s.sectionRef}>CNT-001</span>
        </div>
        <div className={s.briefCard}>
          <div className={s.briefLabel}>Describe your target audience and content goal</div>
          <div className={s.briefInputRow}>
            <input
              className={s.briefInput}
              value={briefInput}
              onChange={e => setBriefInput(e.target.value)}
              placeholder="e.g. Parents of kids ages 8-12 who want competitive training"
              onKeyDown={e => e.key === 'Enter' && handleGenerateBrief()}
            />
            <button className={s.briefBtn} onClick={handleGenerateBrief} disabled={!briefInput.trim()}>
              Generate brief
            </button>
          </div>
          {lastBrief && (
            <div className={s.briefResult}>
              <div className={s.briefResultLabel}>Generated brief</div>
              <div className={s.briefResultText}>{lastBrief.brief}</div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
