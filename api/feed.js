import { createDefaultDbQuery } from './_lib/db.js'

let tableEnsured = false

export const ensureFeedEventsTable = async (executeQuery) => {
  if (tableEnsured) return
  await executeQuery(`
    CREATE TABLE IF NOT EXISTS feed_events (
      id BIGSERIAL PRIMARY KEY,
      user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      event_type VARCHAR(32) NOT NULL,
      book_id VARCHAR(64) REFERENCES books(book_id) ON DELETE CASCADE,
      collection_id BIGINT REFERENCES collections(collection_id) ON DELETE CASCADE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.trim())
  await executeQuery(`
    CREATE INDEX IF NOT EXISTS idx_feed_events_created_at ON feed_events (created_at DESC);
  `.trim())
  await executeQuery(`
    CREATE INDEX IF NOT EXISTS idx_feed_events_user_id ON feed_events (user_id);
  `.trim())
  tableEnsured = true
}

export const recordFeedEvent = async ({
  userId,
  eventType,
  bookId = null,
  collectionId = null,
  metadata = {},
  queryFn,
}) => {
  try {
    const cleanUserId = String(userId || '').trim()
    if (!cleanUserId || !eventType) return null

    const executeQuery = queryFn || (await createDefaultDbQuery())

    const cleanCollectionId = collectionId ? Number(collectionId) || null : null
    const cleanEventType = String(eventType).trim()
    const cleanBookId = bookId ? String(bookId).trim() : null

    let writeSql
    if (cleanCollectionId) {
      writeSql = `
        WITH updated_existing AS (
          UPDATE feed_events
          SET book_id = COALESCE($3, book_id),
              metadata = COALESCE(feed_events.metadata, '{}'::jsonb) || $5::jsonb,
              created_at = NOW()
          WHERE id = (
            SELECT id
            FROM feed_events
            WHERE user_id = $1
              AND event_type = $2
              AND collection_id = $4
              AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
            ORDER BY created_at DESC, id DESC
            LIMIT 1
          )
          RETURNING id, user_id, event_type, book_id, collection_id, metadata, created_at
        ),
        inserted_new AS (
          INSERT INTO feed_events (user_id, event_type, book_id, collection_id, metadata, created_at)
          SELECT $1, $2, $3, $4, $5::jsonb, NOW()
          WHERE NOT EXISTS (SELECT 1 FROM updated_existing)
          RETURNING id, user_id, event_type, book_id, collection_id, metadata, created_at
        )
        SELECT * FROM updated_existing
        UNION ALL
        SELECT * FROM inserted_new;
      `.trim()
    } else if (cleanEventType === 'shelf_add' && cleanBookId) {
      writeSql = `
        WITH existing_rows AS (
          SELECT id
          FROM feed_events
          WHERE user_id = $1
            AND event_type = 'shelf_add'
            AND book_id = $3
          ORDER BY created_at DESC, id DESC
        ),
        deleted_duplicates AS (
          DELETE FROM feed_events
          WHERE id IN (SELECT id FROM existing_rows OFFSET 1)
        ),
        updated_existing AS (
          UPDATE feed_events
          SET metadata = $5::jsonb,
              created_at = NOW()
          WHERE id = (SELECT id FROM existing_rows LIMIT 1)
          RETURNING id, user_id, event_type, book_id, collection_id, metadata, created_at
        ),
        inserted_new AS (
          INSERT INTO feed_events (user_id, event_type, book_id, collection_id, metadata, created_at)
          SELECT $1, $2, $3, $4, $5::jsonb, NOW()
          WHERE NOT EXISTS (SELECT 1 FROM existing_rows)
          RETURNING id, user_id, event_type, book_id, collection_id, metadata, created_at
        )
        SELECT * FROM updated_existing
        UNION ALL
        SELECT * FROM inserted_new;
      `.trim()
    } else {
      writeSql = `
        INSERT INTO feed_events (user_id, event_type, book_id, collection_id, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
        RETURNING id, user_id, event_type, book_id, collection_id, metadata, created_at;
      `.trim()
    }

    const params = [
      cleanUserId,
      cleanEventType,
      cleanBookId,
      cleanCollectionId,
      JSON.stringify(metadata || {}),
    ]

    let rows
    try {
      rows = await executeQuery(writeSql, params)
    } catch (err) {
      const msg = String(err?.message || '')
      if (err?.code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))) {
        await ensureFeedEventsTable(executeQuery)
        rows = await executeQuery(writeSql, params)
      } else {
        throw err
      }
    }

    return rows?.[0] || null
  } catch (err) {
    console.warn('Failed to record feed event:', err?.message || err)
    return null
  }
}

export const getFeedEvents = async ({
  limit = 20,
  before = null,
  userId = null,
  queryFn,
} = {}) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const cleanLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))

  const conditions = []
  const values = []
  let paramIdx = 1

  // Filter out events linked to private collections
  conditions.push('(col.is_private IS NULL OR col.is_private = FALSE)')

  if (before) {
    conditions.push(`fe.created_at < $${paramIdx++}`)
    values.push(before)
  }

  if (userId) {
    const cleanUserId = String(userId).trim()
    if (cleanUserId) {
      conditions.push(`fe.user_id = $${paramIdx++}`)
      values.push(cleanUserId)
    }
  }

  values.push(cleanLimit)

  const sql = `
    SELECT
      fe.id,
      fe.user_id,
      COALESCE(NULLIF(u.display_name, ''), fe.user_id) AS username,
      fe.event_type,
      fe.book_id,
      b.title AS book_title,
      b.author AS book_author,
      b.isbn AS book_isbn,
      b.description AS book_description,
      b.number_of_pages AS book_pages,
      b.original_publication_year AS book_published_year,
      COALESCE(cov.url, '') AS cover_url,
      fe.collection_id,
      col.title AS collection_title,
      col.description AS collection_description,
      col.is_private AS collection_is_private,
      fe.metadata,
      fe.created_at
    FROM feed_events fe
    LEFT JOIN users u ON u.user_id = fe.user_id
    LEFT JOIN books b ON b.book_id = fe.book_id
    LEFT JOIN covers cov ON cov.isbn = b.isbn AND b.isbn IS NOT NULL AND b.isbn <> ''
    LEFT JOIN collections col ON col.collection_id = fe.collection_id
    ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY fe.created_at DESC, fe.id DESC
    LIMIT $${paramIdx};
  `.trim()

  let rows
  try {
    rows = await executeQuery(sql, values)
  } catch (err) {
    const msg = String(err?.message || '')
    if (err?.code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))) {
      await ensureFeedEventsTable(executeQuery)
      rows = await executeQuery(sql, values)
    } else {
      throw err
    }
  }

  const seenCollectionDayKeys = new Set()
  const seenUserShelfAddKeys = new Set()
  const dedupedRows = []
  for (const row of rows || []) {
    if (row.event_type === 'shelf_add' && row.book_id) {
      const userBookKey = `${row.user_id}:${row.book_id}`
      if (seenUserShelfAddKeys.has(userBookKey)) {
        continue
      }
      seenUserShelfAddKeys.add(userBookKey)
    }
    if (row.collection_id) {
      const dayKey = row.created_at
        ? new Date(row.created_at).toISOString().slice(0, 10)
        : ''
      const mergeKey = `${row.user_id}:${row.event_type}:${row.collection_id}:${dayKey}`
      if (seenCollectionDayKeys.has(mergeKey)) {
        continue
      }
      seenCollectionDayKeys.add(mergeKey)
    }
    dedupedRows.push(row)
  }

  const collectionIds = [...new Set(dedupedRows.map((r) => r.collection_id).filter(Boolean))]
  const booksByCollectionId = {}
  if (collectionIds.length > 0) {
    try {
      const colBooksSql = `
        SELECT cb.collection_id, b.book_id, b.title, b.author, b.isbn,
               b.description, b.number_of_pages, b.original_publication_year,
               COALESCE(cov.url, '') AS cover_url
        FROM collection_books cb
        JOIN books b ON b.book_id = cb.book_id
        LEFT JOIN covers cov ON cov.isbn = b.isbn AND b.isbn IS NOT NULL AND b.isbn <> ''
        WHERE cb.collection_id = ANY($1)
        ORDER BY cb.created_at DESC
        LIMIT 60;
      `.trim()
      const colBooksRows = await executeQuery(colBooksSql, [collectionIds])
      for (const cbRow of colBooksRows || []) {
        const cId = String(cbRow.collection_id)
        if (!booksByCollectionId[cId]) booksByCollectionId[cId] = []
        booksByCollectionId[cId].push({
          bookId: cbRow.book_id,
          title: cbRow.title,
          author: cbRow.author,
          isbn: cbRow.isbn,
          coverUrl: cbRow.cover_url || '',
          imageUrl: cbRow.cover_url || '',
          description: cbRow.description || '',
          pages: cbRow.number_of_pages || '',
          publishedYear: cbRow.original_publication_year || '',
        })
      }
    } catch {
      // Best effort
    }
  }

  const events = dedupedRows.map((row) => {
    let parsedMetadata = {}
    if (row.metadata) {
      if (typeof row.metadata === 'object') {
        parsedMetadata = row.metadata
      } else if (typeof row.metadata === 'string') {
        try {
          parsedMetadata = JSON.parse(row.metadata)
        } catch {
          parsedMetadata = {}
        }
      }
    }

    const eventBook = row.book_id
      ? {
          bookId: row.book_id,
          title: row.book_title || '',
          author: row.book_author || '',
          isbn: row.book_isbn || '',
          coverUrl: row.cover_url || '',
          imageUrl: row.cover_url || '',
          description: row.book_description || '',
          pages: row.book_pages || '',
          publishedYear: row.book_published_year || '',
        }
      : null

    const eventCollectionBooks = row.collection_id ? (booksByCollectionId[String(row.collection_id)] || []) : []
    const metadataBooks = (Array.isArray(parsedMetadata.books) ? parsedMetadata.books : []).map((b) => ({
      ...b,
      imageUrl: b.imageUrl || b.coverUrl || '',
      coverUrl: b.coverUrl || b.imageUrl || '',
      description: b.description || '',
      pages: b.pages || b.numberOfPages || '',
      publishedYear: b.publishedYear || b.originalPublicationYear || '',
    }))

    const allBooks =
      row.collection_id && eventCollectionBooks.length > 0
        ? eventCollectionBooks
        : eventBook
        ? [eventBook]
        : metadataBooks.length > 0
        ? metadataBooks
        : eventCollectionBooks

    return {
      id: String(row.id),
      eventType: row.event_type,
      createdAt: row.created_at,
      user: {
        userId: row.user_id,
        displayName: row.username || row.user_id,
      },
      book: eventBook,
      books: allBooks,
      collection: row.collection_id
        ? {
            collectionId: String(row.collection_id),
            title: row.collection_title || '',
            description: row.collection_description || '',
            isPrivate: Boolean(row.collection_is_private),
            books: eventCollectionBooks,
          }
        : null,
      metadata: parsedMetadata,
    }
  })

  return {
    events,
    count: events.length,
    hasMore: events.length === cleanLimit,
    nextCursor: events.length > 0 ? events[events.length - 1].createdAt : null,
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS')
    return res.status(204).json({})
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS')
    return res.status(405).json({ error: 'Method not allowed. Use GET.' })
  }

  try {
    const executeQuery = req.dbQuery || (await createDefaultDbQuery())
    const limit = req.query?.limit ? parseInt(req.query.limit, 10) : 20
    const before = req.query?.before ? String(req.query.before).trim() : null
    const userId = req.query?.userId ? String(req.query.userId).trim() : null

    const result = await getFeedEvents({
      limit,
      before,
      userId,
      queryFn: executeQuery,
    })

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(result)
  } catch (err) {
    console.error('Failed to get feed events:', err)
    return res.status(500).json({ error: err?.message || 'Failed to retrieve feed events.' })
  }
}

