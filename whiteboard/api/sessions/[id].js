import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const DB_ID = process.env.NOTION_SESSIONS_DB

export default async function handler(req, res) {
  const { id } = req.query

  if (req.method === 'GET') {
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
      const sectionDataRaw = (page.properties['SECTION Data']?.rich_text || []).map(r => r.plain_text).join('') || '{}'

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

  if (req.method === 'PATCH') {
    try {
      // Find the page by Session ID
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

      const pageId = response.results[0].id
      const { assignedTo } = req.body

      const properties = {}

      if (assignedTo !== undefined) {
        properties['Assigned To'] = {
          multi_select: assignedTo.map(name => ({ name }))
        }
      }

      await notion.pages.update({ page_id: pageId, properties })

      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('Failed to update session:', err.message)
      return res.status(500).json({ error: 'Failed to update session', detail: err.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
