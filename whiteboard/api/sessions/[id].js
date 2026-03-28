const { Client } = require('@notionhq/client')

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_ID = process.env.NOTION_SESSIONS_DB

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.query

  try {
    const response = await notion.databases.query({
      database_id: DB_ID,
      filter: {
        property: 'Session ID',
        rich_text: { equals: id },
      },
    })

    if (response.results.length === 0) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const page = response.results[0]
    const sectionDataRaw = page.properties['SECTION Data']?.rich_text?.[0]?.plain_text || '{}'

    let sectionData = {}
    try { sectionData = JSON.parse(sectionDataRaw) } catch {}

    const session = {
      id: page.id,
      title: page.properties['Title']?.title?.[0]?.plain_text || '',
      sessionId: page.properties['Session ID']?.rich_text?.[0]?.plain_text || '',
      status: page.properties['Status']?.select?.name || 'To Do',
      description: page.properties['Description']?.rich_text?.[0]?.plain_text || '',
      assignedTo: page.properties['Assigned To']?.multi_select?.map(s => s.name) || [],
      sectionNumber: page.properties['Section Number']?.number || 0,
      sessionType: page.properties['Session Type']?.select?.name || '',
      completedDate: page.properties['Completed Date']?.date?.start || null,
      sectionData,
    }

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json(session)
  } catch (err) {
    console.error('Failed to fetch session:', err.message)
    return res.status(500).json({ error: 'Failed to fetch session', detail: err.message })
  }
}
