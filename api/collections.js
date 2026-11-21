import { createDefaultDbQuery } from './_lib/db.js'
import { normalizeCsvBook } from '../src/lib/goodreads.js'

const mapCollectionRowToBook = (row, index) =>
  normalizeCsvBook(
    {
      'Book Id': row.book_id,
      Title: row.title,
      Author: row.author,
      ISBN: row.isbn,
      Publisher: row.publisher,
      Binding: row.binding,
      'Number of Pages': row.number_of_pages,
      'Original Publication Year': row.original_publication_year,
      description: row.description ? String(row.description).slice(0, 500) : '',
      mainCategory: row.main_category,
      imageUrl: row.cover_url || '',
    },
    index,
  )

const ensureCollectionsTables = async (executeQuery) => {
  await executeQuery(`
    CREATE TABLE IF NOT EXISTS collections (
      collection_id BIGSERIAL PRIMARY KEY,
      user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description VARCHAR(140) DEFAULT '',
      is_private BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.trim())
  await executeQuery(`
    ALTER TABLE collections ADD COLUMN IF NOT EXISTS description VARCHAR(140) DEFAULT '';
  `.trim())
  await executeQuery(`
    ALTER TABLE collections ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;
  `.trim())
  await executeQuery(`
    CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections (user_id);
  `.trim())
  await executeQuery(`
    CREATE TABLE IF NOT EXISTS collection_books (
      id BIGSERIAL PRIMARY KEY,
      collection_id BIGINT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
      book_id VARCHAR(64) NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_collection_books UNIQUE (collection_id, book_id)
    );
  `.trim())
  await executeQuery(`
    CREATE INDEX IF NOT EXISTS idx_collection_books_collection_id ON collection_books (collection_id);
  `.trim())
}

const withAutoMigrate = async (executeQuery, fn) => {
  try {
    return await fn()
  } catch (err) {
    const msg = String(err?.message || '')
    if (
      err?.code === '42P01' ||
      err?.code === '42703' ||
      (msg.includes('relation') && msg.includes('does not exist')) ||
      (msg.includes('column') && msg.includes('does not exist'))
    ) {
      await ensureCollectionsTables(executeQuery)
      return await fn()
    }
    throw err
  }
}

const groupRowsIntoCollections = (rows = []) => {
  const map = new Map()
  for (const row of rows) {
    const colId = String(row.collection_id)
    if (!map.has(colId)) {
      map.set(colId, {
        id: colId,
        collectionId: colId,
        userId: row.user_id,
        username: row.display_name || '',
        title: row.collection_title,
        description: row.collection_description || '',
        isPrivate: Boolean(row.is_private),
        createdAt: row.collection_created_at,
        books: [],
      })
    }
    if (row.book_id) {
      const col = map.get(colId)
      col.books.push(mapCollectionRowToBook(row, col.books.length))
    }
  }
  return [...map.values()]
}

export const getUserCollections = async ({ userId, includePrivate = true, queryFn }) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    SELECT
      c.collection_id,
      c.user_id,
      c.title AS collection_title,
      c.description AS collection_description,
      c.is_private,
      c.created_at AS collection_created_at,
      u.display_name,
      b.book_id,
      b.title,
      b.author,
      b.isbn,
      b.publisher,
      b.binding,
      b.number_of_pages,
      b.original_publication_year,
      b.description,
      b.main_category,
      cb.created_at AS book_added_at,
      COALESCE(cv.url, '') AS cover_url
    FROM collections c
    JOIN users u ON u.user_id = c.user_id
    LEFT JOIN collection_books cb ON cb.collection_id = c.collection_id
    LEFT JOIN books b ON b.book_id = cb.book_id
    LEFT JOIN covers cv ON cv.isbn = b.isbn AND b.isbn IS NOT NULL AND b.isbn <> ''
    WHERE c.user_id = $1
      ${includePrivate ? '' : 'AND c.is_private = FALSE'}
    ORDER BY c.created_at DESC, cb.created_at DESC;
  `.trim()

  const rows = await withAutoMigrate(executeQuery, () => executeQuery(sql, [cleanUserId]))
  return groupRowsIntoCollections(rows)
}

export const getExploreCollections = async ({ queryFn } = {}) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    SELECT
      c.collection_id,
      c.user_id,
      c.title AS collection_title,
      c.description AS collection_description,
      c.is_private,
      c.created_at AS collection_created_at,
      u.display_name,
      b.book_id,
      b.title,
      b.author,
      b.isbn,
      b.publisher,
      b.binding,
      b.number_of_pages,
      b.original_publication_year,
      b.description,
      b.main_category,
      cb.created_at AS book_added_at,
      COALESCE(cv.url, '') AS cover_url
    FROM collections c
    JOIN users u ON u.user_id = c.user_id
    LEFT JOIN collection_books cb ON cb.collection_id = c.collection_id
    LEFT JOIN books b ON b.book_id = cb.book_id
    LEFT JOIN covers cv ON cv.isbn = b.isbn AND b.isbn IS NOT NULL AND b.isbn <> ''
    WHERE c.is_private = FALSE
    ORDER BY c.created_at DESC, cb.created_at DESC;
  `.trim()

  const rows = await withAutoMigrate(executeQuery, () => executeQuery(sql, []))
  return groupRowsIntoCollections(rows)
}

export const createCollection = async ({
  userId,
  title,
  description = '',
  isPrivate = false,
  queryFn,
}) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanTitle = String(title || '').trim().slice(0, 120)
  if (!cleanTitle) {
    throw new Error('Collection title is required.')
  }

  const cleanDescription = String(description || '').trim().slice(0, 140)
  const privateFlag = Boolean(isPrivate)

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    INSERT INTO collections (user_id, title, description, is_private, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING collection_id, user_id, title, description, is_private, created_at;
  `.trim()

  const rows = await withAutoMigrate(executeQuery, () =>
    executeQuery(sql, [cleanUserId, cleanTitle, cleanDescription, privateFlag]),
  )
  const row = rows?.[0]
  return {
    success: true,
    collection: {
      id: String(row?.collection_id || ''),
      collectionId: String(row?.collection_id || ''),
      userId: row?.user_id || cleanUserId,
      title: row?.title || cleanTitle,
      description: row?.description ?? cleanDescription,
      isPrivate: Boolean(row?.is_private ?? privateFlag),
      createdAt: row?.created_at || new Date().toISOString(),
      books: [],
    },
  }
}

export const addBookToCollection = async ({
  userId,
  collectionId,
  bookId,
  book = {},
  queryFn,
}) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanCollectionId = String(collectionId || '').trim()
  if (!cleanCollectionId) {
    throw new Error('Collection id is required.')
  }

  const cleanBookId = String(bookId || book.bookId || book.id || '').trim()
  if (!cleanBookId) {
    throw new Error('Book id is required.')
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())

  // 1. Verify collection belongs to userId
  const checkSql = `
    SELECT collection_id, user_id, title
    FROM collections
    WHERE collection_id = $1 AND user_id = $2;
  `.trim()
  const owned = await withAutoMigrate(executeQuery, () =>
    executeQuery(checkSql, [cleanCollectionId, cleanUserId]),
  )
  if (!owned || owned.length === 0) {
    throw new Error('Collection not found or unauthorized.')
  }

  // 2. Ensure the book exists in the books catalog
  const title = String(book.title || `Book ${cleanBookId}`).trim()
  const author = String(book.author || '').trim()
  const isbn = String(book.isbn || '').trim()
  const publisher = String(book.publisher || '').trim()
  const binding = String(book.binding || '').trim()
  const pages = Number.parseInt(book.pages || book.numberOfPages, 10) || null
  const publishedYear = Number.parseInt(book.publishedYear || book.originalPublicationYear, 10) || null
  const description = book.description ? String(book.description).slice(0, 500) : null
  const mainCategory = book.mainCategory ? String(book.mainCategory) : null

  const bookSql = `
    INSERT INTO books (
      book_id, title, author, isbn, publisher, binding, number_of_pages, original_publication_year, description, main_category
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (book_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      author = EXCLUDED.author,
      isbn = COALESCE(NULLIF(EXCLUDED.isbn, ''), books.isbn),
      publisher = COALESCE(NULLIF(EXCLUDED.publisher, ''), books.publisher),
      binding = COALESCE(NULLIF(EXCLUDED.binding, ''), books.binding),
      number_of_pages = COALESCE(EXCLUDED.number_of_pages, books.number_of_pages),
      original_publication_year = COALESCE(EXCLUDED.original_publication_year, books.original_publication_year),
      description = COALESCE(NULLIF(EXCLUDED.description, ''), books.description),
      main_category = COALESCE(NULLIF(EXCLUDED.main_category, ''), books.main_category),
      updated_at = NOW();
  `.trim()

  await executeQuery(bookSql, [
    cleanBookId,
    title,
    author,
    isbn,
    publisher,
    binding,
    pages,
    publishedYear,
    description,
    mainCategory,
  ])

  const coverUrl = book.coverUrl || book.imageUrl
  const cleanIsbnVal = String(isbn || '').replace(/[^0-9X]/gi, '').trim()
  if (coverUrl && cleanIsbnVal) {
    try {
      await executeQuery(
        `INSERT INTO covers (isbn, url) VALUES ($1, $2) ON CONFLICT (isbn) DO UPDATE SET url = EXCLUDED.url;`,
        [cleanIsbnVal, coverUrl],
      )
    } catch {
      // Best effort
    }
  }

  // 3. Link book to collection
  const linkSql = `
    INSERT INTO collection_books (collection_id, book_id, created_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (collection_id, book_id) DO NOTHING
    RETURNING collection_id, book_id;
  `.trim()

  await executeQuery(linkSql, [cleanCollectionId, cleanBookId])

  const normalizedAddedBook = normalizeCsvBook(
    {
      'Book Id': cleanBookId,
      Title: title,
      Author: author,
      ISBN: isbn,
      Publisher: publisher,
      Binding: binding,
      'Number of Pages': pages,
      'Original Publication Year': publishedYear,
      description: description || '',
      mainCategory: mainCategory || '',
      imageUrl: coverUrl || '',
    },
    0,
  )

  return {
    success: true,
    collectionId: cleanCollectionId,
    bookId: cleanBookId,
    book: normalizedAddedBook,
  }
}

export const removeBookFromCollection = async ({
  userId,
  collectionId,
  bookId,
  queryFn,
}) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanCollectionId = String(collectionId || '').trim()
  if (!cleanCollectionId) {
    throw new Error('Collection id is required.')
  }

  const cleanBookId = String(bookId || '').trim()
  if (!cleanBookId) {
    throw new Error('Book id is required.')
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    DELETE FROM collection_books
    WHERE collection_id = $1
      AND book_id = $2
      AND EXISTS (
        SELECT 1 FROM collections c WHERE c.collection_id = $1 AND c.user_id = $3
      )
    RETURNING collection_id, book_id;
  `.trim()

  const rows = await withAutoMigrate(executeQuery, () =>
    executeQuery(sql, [cleanCollectionId, cleanBookId, cleanUserId]),
  )

  return {
    success: true,
    collectionId: cleanCollectionId,
    bookId: cleanBookId,
    removed: Boolean(rows && rows.length > 0),
  }
}

export const deleteCollection = async ({ userId, collectionId, queryFn }) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanCollectionId = String(collectionId || '').trim()
  if (!cleanCollectionId) {
    throw new Error('Collection id is required.')
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    DELETE FROM collections
    WHERE collection_id = $1 AND user_id = $2
    RETURNING collection_id;
  `.trim()

  const rows = await withAutoMigrate(executeQuery, () =>
    executeQuery(sql, [cleanCollectionId, cleanUserId]),
  )

  return {
    success: true,
    collectionId: cleanCollectionId,
    deleted: Boolean(rows && rows.length > 0),
  }
}

export const updateCollection = async ({
  userId,
  collectionId,
  title,
  description,
  isPrivate,
  queryFn,
}) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanCollectionId = String(collectionId || '').trim()
  if (!cleanCollectionId) {
    throw new Error('Collection id is required.')
  }

  const updates = []
  const values = []
  let paramIdx = 1

  if (title !== undefined) {
    const cleanTitle = String(title || '').trim()
    if (!cleanTitle) {
      throw new Error('Title is required.')
    }
    if (cleanTitle.length > 100) {
      throw new Error('Title cannot exceed 100 characters.')
    }
    updates.push(`title = $${paramIdx++}`)
    values.push(cleanTitle)
  }

  if (description !== undefined) {
    const cleanDescription = String(description || '').trim()
    if (cleanDescription.length > 500) {
      throw new Error('Description cannot exceed 500 characters.')
    }
    updates.push(`description = $${paramIdx++}`)
    values.push(cleanDescription)
  }

  if (isPrivate !== undefined) {
    updates.push(`is_private = $${paramIdx++}`)
    values.push(Boolean(isPrivate))
  }

  if (updates.length === 0) {
    throw new Error('No valid fields provided to update.')
  }

  updates.push('updated_at = NOW()')
  values.push(cleanCollectionId, cleanUserId)

  const sql = `
    UPDATE collections
    SET ${updates.join(', ')}
    WHERE collection_id = $${paramIdx++} AND user_id = $${paramIdx++}
    RETURNING collection_id, user_id, title, description, is_private, created_at, updated_at;
  `.trim()

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const rows = await withAutoMigrate(executeQuery, () =>
    executeQuery(sql, values),
  )

  if (!rows || rows.length === 0) {
    throw new Error('Collection not found or unauthorized.')
  }

  const row = rows[0]
  return {
    success: true,
    collectionId: String(row.collection_id),
    title: row.title,
    isPrivate: Boolean(row.is_private),
    collection: {
      id: String(row.collection_id),
      collectionId: String(row.collection_id),
      userId: row.user_id,
      title: row.title,
      description: row.description || '',
      isPrivate: Boolean(row.is_private),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  }
}

export const updateCollectionPrivacy = async ({
  userId,
  collectionId,
  isPrivate,
  queryFn,
}) => {
  return updateCollection({ userId, collectionId, isPrivate, queryFn })
}

export const updateCollectionTitle = async ({
  userId,
  collectionId,
  title,
  queryFn,
}) => {
  return updateCollection({ userId, collectionId, title, queryFn })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS')
    return res.status(200).end()
  }

  if (req.method === 'GET') {
    const explore = req.query?.explore === 'true' || req.query?.explore === '1'
    const userId = String(req.query?.userId || '').trim()
    const includePrivate =
      req.query?.includePrivate === undefined
        ? true
        : req.query?.includePrivate !== 'false' && req.query?.includePrivate !== '0'

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      const collections = explore
        ? await getExploreCollections({ queryFn: executeQuery })
        : await getUserCollections({ userId, includePrivate, queryFn: executeQuery })

      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300')
      return res.status(200).json({ success: true, collections })
    } catch (err) {
      console.error('Failed to get collections:', err)
      const isClientError =
        err?.message?.includes('required') || err?.message?.includes('8-character')
      return res.status(isClientError ? 400 : 500).json({
        error: err?.message || 'Failed to get collections.',
      })
    }
  }

  if (req.method === 'POST') {
    let body = req.body || {}
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        body = {}
      }
    }

    const action = body.action || (body.collectionId && (body.bookId || body.book) ? 'add-book' : 'create')

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())

      if (action === 'update_privacy' || action === 'update-privacy' || action === 'toggle_privacy') {
        const result = await updateCollectionPrivacy({
          userId: body.userId,
          collectionId: body.collectionId,
          isPrivate: body.isPrivate,
          queryFn: executeQuery,
        })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      }

      if (action === 'update_title' || action === 'update-title' || action === 'rename') {
        const result = await updateCollectionTitle({
          userId: body.userId,
          collectionId: body.collectionId,
          title: body.title,
          queryFn: executeQuery,
        })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      }

      if (action === 'add-book') {
        const result = await addBookToCollection({
          userId: body.userId,
          collectionId: body.collectionId,
          bookId: body.bookId,
          book: body.book || {},
          queryFn: executeQuery,
        })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      }

      const result = await createCollection({
        userId: body.userId,
        title: body.title,
        description: body.description,
        isPrivate: body.isPrivate,
        queryFn: executeQuery,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to process collection POST:', err)
      const isClientError =
        err?.message?.includes('required') ||
        err?.message?.includes('8-character') ||
        err?.message?.includes('unauthorized') ||
        err?.message?.includes('not found')
      return res.status(isClientError ? 400 : 500).json({
        error: err?.message || 'Failed to save collection.',
      })
    }
  }

  if (req.method === 'PATCH') {
    let body = req.body || {}
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        body = {}
      }
    }

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      const result = await updateCollection({
        userId: body.userId,
        collectionId: body.collectionId,
        title: body.title,
        description: body.description,
        isPrivate: body.isPrivate,
        queryFn: executeQuery,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to update collection:', err)
      const isClientError =
        err?.message?.includes('required') ||
        err?.message?.includes('8-character') ||
        err?.message?.includes('unauthorized') ||
        err?.message?.includes('not found') ||
        err?.message?.includes('cannot exceed') ||
        err?.message?.includes('provided')
      return res.status(isClientError ? 400 : 500).json({
        error: err?.message || 'Failed to update collection.',
      })
    }
  }

  if (req.method === 'DELETE') {
    let body = req.body || {}
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        body = {}
      }
    }

    const userId = body.userId || req.query?.userId
    const collectionId = body.collectionId || req.query?.collectionId
    const bookId = body.bookId || req.query?.bookId

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      if (bookId) {
        const result = await removeBookFromCollection({
          userId,
          collectionId,
          bookId,
          queryFn: executeQuery,
        })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      }

      const result = await deleteCollection({
        userId,
        collectionId,
        queryFn: executeQuery,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to delete from collections:', err)
      const isClientError =
        err?.message?.includes('required') || err?.message?.includes('8-character')
      return res.status(isClientError ? 400 : 500).json({
        error: err?.message || 'Failed to delete collection.',
      })
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS')
  return res.status(405).json({ error: 'Method Not Allowed' })
}

