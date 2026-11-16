import { createDefaultDbQuery } from './_lib/db.js'
import { isAllowedShelf } from './uploadcsv.js'

export const saveBookToShelf = async ({
  userId,
  bookId,
  shelf,
  book = {},
  rating,
  queryFn,
}) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanBookId = String(bookId || book.bookId || book.id || '').trim()
  if (!cleanBookId) {
    throw new Error('Book id is required.')
  }

  const cleanShelf = String(shelf || 'to-read').trim().toLowerCase().replace(/\s+/g, '-')
  if (!isAllowedShelf(cleanShelf)) {
    throw new Error(`Invalid shelf: "${shelf}". Allowed shelves are to-read, read, currently-reading, did-not-finish.`)
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())

  // 1. Ensure the book exists in the books catalog
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
        [cleanIsbnVal, coverUrl]
      )
    } catch {
      // Best effort
    }
  }

  // 2. Upsert user shelf connection
  let shelfSql
  let shelfParams

  if (rating !== undefined && rating !== null) {
    const cleanRating = Math.min(5, Math.max(0, parseInt(rating, 10) || 0))
    shelfSql = `
      INSERT INTO user_shelves (
        user_id, book_id, bookshelves, my_rating, date_added, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (user_id, book_id)
      DO UPDATE SET
        bookshelves = EXCLUDED.bookshelves,
        my_rating = EXCLUDED.my_rating,
        updated_at = NOW()
      RETURNING user_id, book_id, bookshelves, my_rating;
    `.trim()
    shelfParams = [cleanUserId, cleanBookId, cleanShelf, cleanRating]
  } else {
    shelfSql = `
      INSERT INTO user_shelves (
        user_id, book_id, bookshelves, date_added, updated_at
      )
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, book_id)
      DO UPDATE SET
        bookshelves = EXCLUDED.bookshelves,
        updated_at = NOW()
      RETURNING user_id, book_id, bookshelves, my_rating;
    `.trim()
    shelfParams = [cleanUserId, cleanBookId, cleanShelf]
  }

  const rows = await executeQuery(shelfSql, shelfParams)
  return {
    success: true,
    userId: cleanUserId,
    bookId: cleanBookId,
    shelf: rows?.[0]?.bookshelves || cleanShelf,
    myRating: Number(rows?.[0]?.my_rating) || (rating !== undefined && rating !== null ? Number(rating) : 0),
  }
}

export const rateBook = async ({ userId, bookId, rating, queryFn }) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanBookId = String(bookId || '').trim()
  if (!cleanBookId) {
    throw new Error('Book id is required.')
  }

  const cleanRating = Math.min(5, Math.max(0, parseInt(rating, 10) || 0))
  const executeQuery = queryFn || (await createDefaultDbQuery())

  // Check if book exists in user_shelves
  const checkSql = `
    SELECT bookshelves FROM user_shelves
    WHERE user_id = $1 AND book_id = $2
    LIMIT 1;
  `.trim()

  const existing = await executeQuery(checkSql, [cleanUserId, cleanBookId])

  if (existing && existing.length > 0) {
    const updateSql = `
      UPDATE user_shelves
      SET my_rating = $3, updated_at = NOW()
      WHERE user_id = $1 AND book_id = $2
      RETURNING user_id, book_id, bookshelves, my_rating;
    `.trim()

    const rows = await executeQuery(updateSql, [cleanUserId, cleanBookId, cleanRating])
    return {
      success: true,
      userId: cleanUserId,
      bookId: cleanBookId,
      shelf: rows?.[0]?.bookshelves || existing[0]?.bookshelves || 'read',
      myRating: Number(rows?.[0]?.my_rating) || cleanRating,
    }
  }

  // If not yet saved on user_shelves, insert on 'read' shelf as default
  const insertSql = `
    INSERT INTO user_shelves (
      user_id, book_id, bookshelves, my_rating, date_added, updated_at
    )
    VALUES ($1, $2, 'read', $3, NOW(), NOW())
    ON CONFLICT (user_id, book_id)
    DO UPDATE SET
      my_rating = EXCLUDED.my_rating,
      updated_at = NOW()
    RETURNING user_id, book_id, bookshelves, my_rating;
  `.trim()

  const rows = await executeQuery(insertSql, [cleanUserId, cleanBookId, cleanRating])
  return {
    success: true,
    userId: cleanUserId,
    bookId: cleanBookId,
    shelf: rows?.[0]?.bookshelves || 'read',
    myRating: Number(rows?.[0]?.my_rating) || cleanRating,
  }
}

export const removeBookFromShelf = async ({ userId, bookId, queryFn }) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const cleanBookId = String(bookId || '').trim()
  if (!cleanBookId) {
    throw new Error('Book id is required.')
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    DELETE FROM user_shelves
    WHERE user_id = $1 AND book_id = $2
    RETURNING user_id, book_id;
  `.trim()

  const rows = await executeQuery(sql, [cleanUserId, cleanBookId])
  return {
    success: true,
    removed: Boolean(rows && rows.length > 0),
    userId: cleanUserId,
    bookId: cleanBookId,
  }
}

export const getBookShelfStatus = async ({ userId, bookId, queryFn }) => {
  const cleanUserId = String(userId || '').trim()
  const cleanBookId = String(bookId || '').trim()
  if (!cleanUserId || !cleanBookId) {
    return { onShelf: false, shelf: null }
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const rows = await executeQuery(
    'SELECT bookshelves FROM user_shelves WHERE user_id = $1 AND book_id = $2 LIMIT 1;',
    [cleanUserId, cleanBookId],
  )

  if (rows && rows.length > 0) {
    return { onShelf: true, shelf: rows[0].bookshelves }
  }

  return { onShelf: false, shelf: null }
}

export const getUserShelves = async ({ userId, queryFn }) => {
  const cleanUserId = String(userId || '').trim()
  if (!cleanUserId || !/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    SELECT
      us.book_id,
      us.bookshelves AS shelf,
      us.my_rating,
      us.my_review,
      us.spoiler,
      TO_CHAR(us.date_read, 'YYYY/MM/DD') AS date_read,
      TO_CHAR(us.date_added, 'YYYY/MM/DD') AS date_added,
      b.title,
      b.author,
      b.isbn
    FROM user_shelves us
    LEFT JOIN books b ON b.book_id = us.book_id
    WHERE us.user_id = $1
    ORDER BY us.updated_at DESC;
  `.trim()

  const rows = await executeQuery(sql, [cleanUserId])
  const books = (rows || []).map((row) => ({
    bookId: row.book_id,
    shelf: row.shelf,
    myRating: Number(row.my_rating) || 0,
    myReview: row.my_review || '',
    spoiler: Boolean(row.spoiler),
    dateRead: row.date_read || '',
    dateAdded: row.date_added || '',
    title: row.title || '',
    author: row.author || '',
    isbn: row.isbn || '',
  }))

  const shelvesByBookId = {}
  for (const item of books) {
    shelvesByBookId[item.bookId] = item
  }

  return {
    userId: cleanUserId,
    count: books.length,
    books,
    shelvesByBookId,
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS')
    return res.status(204).json({})
  }

  if (req.method === 'GET') {
    const userId = String(req.query?.userId || '').trim()
    const bookId = String(req.query?.bookId || '').trim()

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())

      if (bookId) {
        const result = await getBookShelfStatus({ userId, bookId, queryFn: executeQuery })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      }

      const result = await getUserShelves({ userId, queryFn: executeQuery })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to get shelf status:', err)
      const isClientError =
        err?.message?.includes('required') ||
        err?.message?.includes('8-character')
      return res.status(isClientError ? 400 : 500).json({ error: err?.message || 'Failed to check shelf status.' })
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

    const userId = body.userId
    const bookId = body.bookId
    const shelf = body.shelf
    const book = body.book || {}
    const rating = body.rating

    // Support undo / remove via POST as well
    if (body.action === 'remove' || body.action === 'delete') {
      try {
        const executeQuery = req.dbQuery || (await createDefaultDbQuery())
        const result = await removeBookFromShelf({
          userId,
          bookId,
          queryFn: executeQuery,
        })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      } catch (err) {
        console.error('Failed to remove book from shelf via POST:', err)
        const isClientError =
          err?.message?.includes('required') ||
          err?.message?.includes('8-character')
        return res.status(isClientError ? 400 : 500).json({
          error: err?.message || 'Failed to remove book from shelf.',
        })
      }
    }

    if (body.action === 'rate' || (rating !== undefined && !shelf)) {
      try {
        const executeQuery = req.dbQuery || (await createDefaultDbQuery())
        const result = await rateBook({
          userId,
          bookId,
          rating,
          queryFn: executeQuery,
        })
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).json(result)
      } catch (err) {
        console.error('Failed to rate book via POST:', err)
        const isClientError =
          err?.message?.includes('required') ||
          err?.message?.includes('8-character')
        return res.status(isClientError ? 400 : 500).json({
          error: err?.message || 'Failed to rate book.',
        })
      }
    }

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      const result = await saveBookToShelf({
        userId,
        bookId,
        shelf: shelf || 'to-read',
        book,
        rating,
        queryFn: executeQuery,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to save book to shelf:', err)
      const isClientError =
        err?.message?.includes('required') ||
        err?.message?.includes('Invalid shelf') ||
        err?.message?.includes('8-character')
      return res.status(isClientError ? 400 : 500).json({
        error: err?.message || 'Failed to save book to shelf.',
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
    const bookId = body.bookId || req.query?.bookId

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      const result = await removeBookFromShelf({
        userId,
        bookId,
        queryFn: executeQuery,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to remove book from shelf:', err)
      const isClientError =
        err?.message?.includes('required') ||
        err?.message?.includes('8-character')
      return res.status(isClientError ? 400 : 500).json({
        error: err?.message || 'Failed to remove book from shelf.',
      })
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS')
  return res.status(405).json({ error: 'Method Not Allowed' })
}

