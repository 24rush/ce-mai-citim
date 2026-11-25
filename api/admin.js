import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { createDefaultDbQuery, ensureEnvLoaded } from './_lib/db.js'
import { getGoogleBooksApiKey } from './isbn.js'
import { recordFeedEvent } from './feed.js'
import { ensureUserProfileColumns } from './profile.js'
import { saveBookToShelf, rateBook, removeBookFromShelf } from './shelves.js'
import {
  getUserCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addBookToCollection,
  removeBookFromCollection,
} from './collections.js'
import {
  generateUserId,
  parseCsvForDatabase,
  enrichMissingIsbns,
  insertBooksIntoDatabase,
  deleteUserBooksFromDatabase,
} from './uploadcsv.js'

export const getConfiguredAdminEmail = (req) => {
  ensureEnvLoaded()
  const raw =
    req?.adminEmail ??
    process.env.ADMIN_EMAIL ??
    process.env.admin_email ??
    ''
  return String(raw).trim().toLowerCase()
}

export const extractBearerToken = (req) => {
  const header = req?.headers?.authorization || req?.headers?.Authorization || ''
  const match = String(header).match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

const verifiedTokenCache = new Map()
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000
let cachedSupabaseAuthClient = null
let cachedSupabaseClientKey = ''

const getServerSupabaseClient = (url, key) => {
  const composite = `${url}:::${key}`
  if (!cachedSupabaseAuthClient || cachedSupabaseClientKey !== composite) {
    cachedSupabaseAuthClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    cachedSupabaseClientKey = composite
  }
  return cachedSupabaseAuthClient
}

export const verifyAdminRequest = async (req) => {
  const adminEmail = getConfiguredAdminEmail(req)
  if (!adminEmail) {
    return {
      ok: false,
      status: 403,
      error: 'ADMIN_EMAIL is not configured on the server.',
    }
  }

  const token = extractBearerToken(req)
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Authentication token is required.',
    }
  }

  const useCache = typeof req.verifyAuthToken !== 'function'
  const cacheKey = useCache
    ? crypto.createHash('sha256').update(`${adminEmail}:${token}`).digest('hex')
    : ''

  if (useCache) {
    const cached = verifiedTokenCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return {
        ok: true,
        email: cached.email,
        authUserId: cached.authUserId,
      }
    }
    if (cached) {
      verifiedTokenCache.delete(cacheKey)
    }
  }

  let authUser = null
  if (!useCache) {
    try {
      authUser = await req.verifyAuthToken(token)
    } catch {
      authUser = null
    }
  } else {
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
    const supabaseKey =
      process.env.SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      ''

    if (!supabaseUrl || !supabaseKey) {
      return {
        ok: false,
        status: 500,
        error: 'Supabase configuration is missing on the server.',
      }
    }

    const supabase = getServerSupabaseClient(supabaseUrl, supabaseKey)
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data?.user) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid or expired authentication session.',
      }
    }
    authUser = data.user
  }

  const callerEmail = String(authUser?.email || '').trim().toLowerCase()
  if (!callerEmail || callerEmail !== adminEmail) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Admin access required.',
    }
  }

  if (useCache) {
    if (verifiedTokenCache.size > 50) {
      const oldestKey = verifiedTokenCache.keys().next().value
      if (oldestKey) verifiedTokenCache.delete(oldestKey)
    }
    verifiedTokenCache.set(cacheKey, {
      email: authUser.email,
      authUserId: authUser.id,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    })
  }

  return {
    ok: true,
    email: authUser.email,
    authUserId: authUser.id,
  }
}

export const assertSeedUser = async (userId, executeQuery) => {
  const cleanUserId = String(userId || '').trim()
  if (!/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const rows = await executeQuery(
    `SELECT user_id, display_name, COALESCE(description, '') AS description, auth_user_id, last_access
     FROM users
     WHERE user_id = $1 AND auth_user_id LIKE 'seed:%'
     LIMIT 1;`,
    [cleanUserId],
  )

  if (!rows || rows.length === 0) {
    throw new Error('Managed seed user not found.')
  }

  return rows[0]
}

export const listSeedUsers = async ({ queryFn } = {}) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    SELECT
      u.user_id,
      u.display_name,
      COALESCE(u.description, '') AS description,
      u.last_access,
      COUNT(DISTINCT us.book_id)::int AS total_books,
      COUNT(DISTINCT CASE WHEN us.bookshelves = 'read' THEN us.book_id END)::int AS read_count,
      COUNT(DISTINCT CASE WHEN us.bookshelves = 'to-read' THEN us.book_id END)::int AS to_read_count,
      COUNT(DISTINCT CASE WHEN us.bookshelves = 'currently-reading' THEN us.book_id END)::int AS reading_count,
      COUNT(DISTINCT CASE WHEN us.bookshelves = 'did-not-finish' THEN us.book_id END)::int AS dnf_count,
      (SELECT COUNT(*)::int FROM collections c WHERE c.user_id = u.user_id) AS collection_count
    FROM users u
    LEFT JOIN user_shelves us ON us.user_id = u.user_id
    WHERE u.auth_user_id LIKE 'seed:%'
    GROUP BY u.user_id, u.display_name, u.description, u.last_access
    ORDER BY u.last_access DESC;
  `.trim()

  let rows
  try {
    rows = await executeQuery(sql, [])
  } catch (err) {
    if (err?.code === '42703') {
      await ensureUserProfileColumns(executeQuery)
      rows = await executeQuery(sql, [])
    } else {
      throw err
    }
  }

  return (rows || []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name || row.user_id,
    description: row.description || '',
    lastAccess: row.last_access,
    totalBooks: Number(row.total_books) || 0,
    readCount: Number(row.read_count) || 0,
    toReadCount: Number(row.to_read_count) || 0,
    readingCount: Number(row.reading_count) || 0,
    dnfCount: Number(row.dnf_count) || 0,
    collectionCount: Number(row.collection_count) || 0,
  }))
}

export const getSeedUserDetails = async ({ userId, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const seedUser = await assertSeedUser(userId, executeQuery)

  const booksSql = `
    SELECT
      us.book_id,
      us.bookshelves AS shelf,
      us.my_rating,
      us.my_review,
      TO_CHAR(us.date_read, 'YYYY/MM/DD') AS date_read,
      TO_CHAR(us.date_added, 'YYYY/MM/DD') AS date_added,
      b.title,
      b.author,
      b.isbn,
      b.number_of_pages,
      b.original_publication_year,
      b.description,
      COALESCE(c.url, '') AS cover_url
    FROM user_shelves us
    JOIN books b ON b.book_id = us.book_id
    LEFT JOIN covers c ON c.isbn = b.isbn AND b.isbn IS NOT NULL AND b.isbn <> ''
    WHERE us.user_id = $1
    ORDER BY us.updated_at DESC;
  `.trim()

  const [bookRows, collections] = await Promise.all([
    executeQuery(booksSql, [seedUser.user_id]),
    getUserCollections({
      userId: seedUser.user_id,
      includePrivate: true,
      queryFn: executeQuery,
    }),
  ])

  const books = (bookRows || []).map((row) => ({
    bookId: row.book_id,
    id: row.book_id,
    title: row.title || '',
    author: row.author || '',
    isbn: row.isbn || '',
    shelf: row.shelf || 'read',
    myRating: Number(row.my_rating) || 0,
    myReview: row.my_review || '',
    dateRead: row.date_read || '',
    dateAdded: row.date_added || '',
    pages: Number(row.number_of_pages) || 0,
    publishedYear: Number(row.original_publication_year) || 0,
    description: row.description || '',
    coverUrl: row.cover_url || '',
    imageUrl: row.cover_url || '',
  }))

  return {
    user: {
      userId: seedUser.user_id,
      displayName: seedUser.display_name || seedUser.user_id,
      description: seedUser.description || '',
      lastAccess: seedUser.last_access,
    },
    books,
    collections,
  }
}

export const createSeedUser = async ({ displayName, description = '', queryFn }) => {
  const cleanName = String(displayName || '').trim().slice(0, 80)
  if (!cleanName) {
    throw new Error('Display name is required.')
  }
  const cleanDesc = String(description || '').trim().slice(0, 140)
  const executeQuery = queryFn || (await createDefaultDbQuery())

  const userId = generateUserId()
  const seedAuthId = `seed:${userId}`

  const insertSql = `
    INSERT INTO users (user_id, display_name, description, auth_user_id, last_access)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING user_id, display_name, COALESCE(description, '') AS description, last_access;
  `.trim()

  let rows
  try {
    rows = await executeQuery(insertSql, [userId, cleanName, cleanDesc, seedAuthId])
  } catch (err) {
    if (err?.code === '42703') {
      await ensureUserProfileColumns(executeQuery)
      rows = await executeQuery(insertSql, [userId, cleanName, cleanDesc, seedAuthId])
    } else {
      throw err
    }
  }

  const row = rows?.[0]
  return {
    userId: row?.user_id || userId,
    displayName: row?.display_name || cleanName,
    description: row?.description ?? cleanDesc,
    lastAccess: row?.last_access || new Date().toISOString(),
    totalBooks: 0,
    readCount: 0,
    toReadCount: 0,
    readingCount: 0,
    dnfCount: 0,
    collectionCount: 0,
  }
}

export const updateSeedUser = async ({ userId, displayName, description, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const seedUser = await assertSeedUser(userId, executeQuery)

  const cleanName =
    displayName !== undefined ? String(displayName || '').trim().slice(0, 80) : seedUser.display_name
  if (!cleanName) {
    throw new Error('Display name cannot be empty.')
  }

  const cleanDesc =
    description !== undefined ? String(description || '').trim().slice(0, 140) : seedUser.description

  const rows = await executeQuery(
    `UPDATE users
     SET display_name = $1,
         description = $2,
         last_access = NOW()
     WHERE user_id = $3 AND auth_user_id LIKE 'seed:%'
     RETURNING user_id, display_name, COALESCE(description, '') AS description, last_access;`,
    [cleanName, cleanDesc, seedUser.user_id],
  )

  const row = rows?.[0]
  return {
    userId: row?.user_id || seedUser.user_id,
    displayName: row?.display_name || cleanName,
    description: row?.description ?? cleanDesc,
    lastAccess: row?.last_access,
  }
}

export const deleteSeedUser = async ({ userId, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const cleanUserId = String(userId || '').trim()
  if (!/^[a-zA-Z0-9]{8}$/.test(cleanUserId)) {
    throw new Error('A valid 8-character user id is required.')
  }

  const rows = await executeQuery(
    `DELETE FROM users
     WHERE user_id = $1 AND auth_user_id LIKE 'seed:%'
     RETURNING user_id;`,
    [cleanUserId],
  )

  if (!rows || rows.length === 0) {
    throw new Error('Managed seed user not found.')
  }

  return { success: true, deletedUserId: cleanUserId }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return res.status(204).end ? res.status(204).end() : res.status(204).json({})
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  res.setHeader('Cache-Control', 'no-store')

  const authCheck = await verifyAdminRequest(req)
  if (!authCheck.ok) {
    return res.status(authCheck.status).json({ error: authCheck.error })
  }

  if (req.method === 'GET') {
    if (req.query?.check === 'true' || req.query?.check === '1') {
      return res.status(200).json({ isAdmin: true, email: authCheck.email })
    }

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      const targetUserId = String(req.query?.userId || '').trim()
      if (targetUserId) {
        const details = await getSeedUserDetails({
          userId: targetUserId,
          queryFn: executeQuery,
        })
        return res.status(200).json(details)
      }

      const users = await listSeedUsers({ queryFn: executeQuery })
      return res.status(200).json({ isAdmin: true, email: authCheck.email, users })
    } catch (err) {
      console.error('[admin GET] Error:', err)
      const status = err?.message?.includes('not found') ? 404 : 500
      return res.status(status).json({ error: err?.message || 'Failed to load admin data.' })
    }
  }

  let body = req.body || {}
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }

  const action = String(body.action || '').trim()

  try {
    const executeQuery = req.dbQuery || (await createDefaultDbQuery())

    if (action === 'create_user') {
      const user = await createSeedUser({
        displayName: body.displayName,
        description: body.description,
        queryFn: executeQuery,
      })
      return res.status(201).json({ success: true, user })
    }

    if (action === 'update_user') {
      const user = await updateSeedUser({
        userId: body.userId,
        displayName: body.displayName,
        description: body.description,
        queryFn: executeQuery,
      })
      return res.status(200).json({ success: true, user })
    }

    if (action === 'delete_user') {
      const result = await deleteSeedUser({
        userId: body.userId,
        queryFn: executeQuery,
      })
      return res.status(200).json(result)
    }

    // All remaining actions operate on an existing managed seed user
    const seedUser = await assertSeedUser(body.userId, executeQuery)
    const userId = seedUser.user_id

    if (action === 'save_book') {
      const result = await saveBookToShelf({
        userId,
        bookId: body.bookId,
        shelf: body.shelf,
        rating: body.rating,
        book: body.book || {},
        queryFn: executeQuery,
      })
      await executeQuery('UPDATE users SET last_access = NOW() WHERE user_id = $1;', [userId])
      return res.status(200).json(result)
    }

    if (action === 'rate_book') {
      if (body.book && body.book.title) {
        // Ensure canonical book exists in books table before rating
        const existingShelf = await executeQuery(
          'SELECT bookshelves FROM user_shelves WHERE user_id = $1 AND book_id = $2 LIMIT 1;',
          [userId, String(body.bookId || body.book.bookId || body.book.id || '').trim()],
        )
        if (!existingShelf || existingShelf.length === 0) {
          await saveBookToShelf({
            userId,
            bookId: body.bookId,
            shelf: body.shelf || 'read',
            book: body.book,
            queryFn: executeQuery,
          })
        }
      }
      const result = await rateBook({
        userId,
        bookId: body.bookId,
        rating: body.rating,
        queryFn: executeQuery,
      })
      await executeQuery('UPDATE users SET last_access = NOW() WHERE user_id = $1;', [userId])
      return res.status(200).json(result)
    }

    if (action === 'remove_book') {
      const result = await removeBookFromShelf({
        userId,
        bookId: body.bookId,
        queryFn: executeQuery,
      })
      return res.status(200).json(result)
    }

    if (action === 'upload_csv') {
      const csvText = String(body.csvText || body.csv || '')
      if (!csvText.trim()) {
        return res.status(400).json({ error: 'CSV content is required.' })
      }

      const { dbRows, books } = parseCsvForDatabase(csvText)
      if (!dbRows.length) {
        return res.status(400).json({ error: 'No valid books found in the uploaded CSV.' })
      }

      const apiKey = req.googleBooksApiKey || getGoogleBooksApiKey()
      const fetchFn = req.fetchFn || fetch

      await enrichMissingIsbns({
        dbRows,
        books,
        apiKey,
        fetchFn,
        queryFn: executeQuery,
      })

      if (body.replaceExisting) {
        await deleteUserBooksFromDatabase({ userId, queryFn: executeQuery })
      }

      await insertBooksIntoDatabase({
        userId,
        dbRows,
        queryFn: executeQuery,
      })

      await executeQuery('UPDATE users SET last_access = NOW() WHERE user_id = $1;', [userId])

      await recordFeedEvent({
        userId,
        eventType: 'csv_upload',
        metadata: {
          bookCount: dbRows.length,
          username: seedUser.display_name || '',
          books: (books || []).slice(0, 12).map((b) => ({
            bookId: String(b.bookId || b.id || ''),
            title: b.title || '',
            author: b.author || '',
            isbn: b.isbn || '',
            coverUrl: b.imageUrl || b.coverUrl || '',
          })),
        },
        queryFn: executeQuery,
      })

      return res.status(200).json({
        success: true,
        userId,
        count: dbRows.length,
      })
    }

    if (action === 'create_collection') {
      const result = await createCollection({
        userId,
        title: body.title,
        description: body.description || '',
        isPrivate: Boolean(body.isPrivate),
        queryFn: executeQuery,
      })
      return res.status(201).json(result)
    }

    if (action === 'update_collection') {
      const result = await updateCollection({
        userId,
        collectionId: body.collectionId,
        title: body.title,
        description: body.description,
        isPrivate: body.isPrivate,
        queryFn: executeQuery,
      })
      return res.status(200).json(result)
    }

    if (action === 'delete_collection') {
      const result = await deleteCollection({
        userId,
        collectionId: body.collectionId,
        queryFn: executeQuery,
      })
      return res.status(200).json(result)
    }

    if (action === 'add_book_to_collection') {
      const result = await addBookToCollection({
        userId,
        collectionId: body.collectionId,
        bookId: body.bookId,
        book: body.book || {},
        queryFn: executeQuery,
      })
      await executeQuery('UPDATE users SET last_access = NOW() WHERE user_id = $1;', [userId])
      return res.status(200).json(result)
    }

    if (action === 'remove_book_from_collection') {
      const result = await removeBookFromCollection({
        userId,
        collectionId: body.collectionId,
        bookId: body.bookId,
        isbn: body.isbn || '',
        queryFn: executeQuery,
      })
      return res.status(200).json(result)
    }

    return res.status(400).json({ error: `Unsupported admin action: "${action}"` })
  } catch (err) {
    console.error(`[admin POST ${action}] Error:`, err)
    const msg = err?.message || 'Admin operation failed.'
    const isClientErr =
      msg.includes('required') ||
      msg.includes('empty') ||
      msg.includes('Invalid') ||
      msg.includes('exceed')
    const status = msg.includes('not found') ? 404 : isClientErr ? 400 : 500
    return res.status(status).json({ error: msg })
  }
}

