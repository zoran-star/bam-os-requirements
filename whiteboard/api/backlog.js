import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_ID = process.env.NOTION_BACKLOG_DB

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const response = await notion.databases.query({
      database_id: DB_ID,
      sorts: [
        { property: 'Status', direction: 'ascending' },
        { property: 'Priority', direction: 'ascending' },
      ],
    })

    const items = response.results.map(page => ({
      id: page.id,
      title: page.properties['Title']?.title?.[0]?.plain_text || '',
      changeType: page.properties['Change Type']?.select?.name || '',
      target: page.properties['Target']?.rich_text?.[0]?.plain_text || '',
      description: page.properties['Description']?.rich_text?.[0]?.plain_text || '',
      status: page.properties['Status']?.select?.name || 'Proposed',
      priority: page.properties['Priority']?.select?.name || 'Medium',
      sourceSession: page.properties['Source Session']?.rich_text?.[0]?.plain_text || '',
    }))

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30')
    return res.status(200).json(items)
  } catch (err) {
    console.error('Failed to fetch backlog:', err.message)
    return res.status(500).json({ error: 'Failed to fetch backlog', detail: err.message })
  }
}
