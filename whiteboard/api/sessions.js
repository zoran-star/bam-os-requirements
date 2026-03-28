import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_ID = process.env.NOTION_SESSIONS_DB

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const response = await notion.databases.query({
      database_id: DB_ID,
      sorts: [{ property: 'Section Number', direction: 'ascending' }],
    })

    const sessions = response.results.map(page => ({
      id: page.id,
      title: page.properties['Title']?.title?.[0]?.plain_text || '',
      sessionId: page.properties['Session ID']?.rich_text?.[0]?.plain_text || '',
      status: page.properties['Status']?.select?.name || 'To Do',
      description: page.properties['Description']?.rich_text?.[0]?.plain_text || '',
      assignedTo: page.properties['Assigned To']?.multi_select?.map(s => s.name) || [],
      sectionNumber: page.properties['Section Number']?.number || 0,
      sessionType: page.properties['Session Type']?.select?.name || '',
      completedDate: page.properties['Completed Date']?.date?.start || null,
    }))

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json(sessions)
  } catch (err) {
    console.error('Failed to fetch sessions:', err.message)
    return res.status(500).json({ error: 'Failed to fetch sessions', detail: err.message })
  }
}
