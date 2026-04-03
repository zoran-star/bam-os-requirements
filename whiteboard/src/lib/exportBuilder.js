export function buildExport(session, items, state) {
  const date = new Date().toISOString().split('T')[0]
  let approved = 0, withFeedback = 0, pending = 0

  items.forEach(item => {
    const s = state[item.id]
    if (s?.checked && !s?.feedback?.trim()) approved++
    else if (s?.feedback?.trim()) withFeedback++
    else pending++
  })

  let md = `---\nsession: ${session.sessionId}\nexported: ${date}\n---\n\n`
  md += `# Full Control Planning — ${session.title}\n`
  md += `**Exported:** ${date}\n`
  md += `**Approved:** ${approved} | **Has feedback:** ${withFeedback} | **Pending:** ${pending}\n\n`

  session.sectionData.subsections.forEach(sub => {
    md += `## ${sub.id}: ${sub.title}\n`
    sub.items.forEach(item => {
      const s = state[item.id]
      const checked = s?.checked || false
      const fb = s?.feedback?.trim() || ''
      const checkbox = checked ? '[x]' : '[ ]'
      const typeTag = item.type ? ` [${item.type === 'data' ? 'DATA POINT' : 'FEATURE'}]` : ''
      let line = `- ${checkbox} **${item.id} ${item.title}**${typeTag} — ${item.desc}`

      if (checked && !fb) line += ' — APPROVED'
      else if (fb) line += ` — FEEDBACK: "${fb}"`

      const tags = []
      if (item.required) tags.push('Required')
      tags.push(item.phase)
      tags.push(item.source)
      line += ` [${tags.join(', ')}]`
      md += line + '\n'
    })
    md += '\n'
  })

  const feedbackItems = []
  items.forEach(item => {
    const fb = state[item.id]?.feedback?.trim()
    if (fb) feedbackItems.push({ id: item.id, title: item.title, feedback: fb, type: item.type })
  })

  if (feedbackItems.length > 0) {
    md += `## All Feedback (Consolidated)\n`
    feedbackItems.forEach((fi, i) => {
      const typeTag = fi.type ? ` [${fi.type}]` : ''
      md += `${i + 1}. **${fi.id} ${fi.title}**${typeTag}: "${fi.feedback}"\n`
    })
    md += '\n'
  }

  if (state._sectionFeedback?.trim()) {
    md += `## Overall Section Feedback\n${state._sectionFeedback.trim()}\n`
  }

  return md
}
