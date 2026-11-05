import crypto from 'node:crypto'
import { createDefaultDbQuery } from './_lib/db.js'
import { getGoogleBooksApiKey, searchGoogleBooks, upsertCoverInDb } from './isbn.js'
import {
  USER_ID_COOKIE_NAME,
  cleanCsvValue,
  getUserIdFromCookie,
  normalizeCsvBook,
  parseCsvRows,
} from '../src/lib/goodreads.js'

export const CSV_TO_DB_COLUMNS = [
  { csvHeader: 'Book Id', dbColumn: 'book_id', type: 'string' },
  { csvHeader: 'Title', dbColumn: 'title', type: 'string' },
  { csvHeader: 'Author', dbColumn: 'author', type: 'string' },
  { csvHeader: 'ISBN', dbColumn: 'isbn', type: 'string' },
  { csvHeader: 'My Rating', dbColumn: 'my_rating', type: 'rating' },
  { csvHeader: 'Publisher', dbColumn: 'publisher', type: 'string' },
  { csvHeader: 'Binding', dbColumn: 'binding', type: 'string' },
  { csvHeader: 'Number of Pages', dbColumn: 'number_of_pages', type: 'int' },
  { csvHeader: 'Original Publication Year', dbColumn: 'original_publication_year', type: 'int' },
  { csvHeader: 'Date Read', dbColumn: 'date_read', type: 'date' },
  { csvHeader: 'Date Added', dbColumn: 'date_added', type: 'date' },
  { csvHeader: 'Bookshelves', dbColumn: 'bookshelves', type: 'string' },
  { csvHeader: 'My Review', dbColumn: 'my_review', type: 'string' },
  { csvHeader: 'Spoiler', dbColumn: 'spoiler', type: 'boolean' },
]

export const ALLOWED_SHELVES = new Set([
  'to-read',
  'read',
  'currently-reading',
  'did-not-finish',
])

export const isAllowedShelf = (shelf) => {
  if (!shelf) return false
  const normalized = String(shelf).trim().toLowerCase().replace(/\s+/g, '-')
  return ALLOWED_SHELVES.has(normalized)
}

export const cleanPositionsFromShelf = (str = '') => {
  if (!str) return ''
  return String(str)
    .replace(/\s*\([^)]*\)/g, '')
    .trim()
}

export const determineShelf = ({
  bookshelves = '',
  bookshelvesWithPositions = '',
  exclusiveShelf = '',
  dateRead = '',
} = {}) => {
  const normalize = (val) =>
    cleanPositionsFromShelf(val)
      .toLowerCase()
      .replace(/\s+/g, '-')

  const normBookshelves = normalize(bookshelves)
  const normPositions = normalize(bookshelvesWithPositions)
  const normExclusive = normalize(exclusiveShelf)

  const candidates = [normBookshelves, normPositions, normExclusive].filter(Boolean)

  // 1. Did Not Finish
  for (const c of candidates) {
    if (
      c === 'did-not-finish' ||
      c === 'didnotfinish' ||
      c === 'dnf' ||
      c === 'abandonate' ||
      c === 'abandonat' ||
      c.includes('did-not-finish') ||
      c.includes('didnotfinish') ||
      c.includes('dnf')
    ) {
      return 'did-not-finish'
    }
  }

  // 2. Currently Reading
  for (const c of candidates) {
    if (
      c === 'currently-reading' ||
      c === 'in-curs' ||
      c.includes('currently-reading')
    ) {
      return 'currently-reading'
    }
  }

  // 3. To Read
  for (const c of candidates) {
    if (
      c === 'to-read' ||
      c === 'de-citit' ||
      c.includes('to-read')
    ) {
      return 'to-read'
    }
  }

  // 4. Read: either Bookshelves, Bookshelves with positions, Exclusive Shelf, or Date Read
  for (const c of candidates) {
    if (
      c === 'read' ||
      c === 'citite' ||
      c === 'citit' ||
      c.includes('read')
    ) {
      return 'read'
    }
  }

  if (dateRead) {
    return 'read'
  }

  return null
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export const generateUserId = () => {
  const bytes = crypto.randomBytes(8)
  let id = ''
  for (let i = 0; i < 8; i += 1) {
    id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  }
  return id
}

export const resolveUserId = (providedUserId, cookieHeader = '', { isNewUser = false } = {}) => {
  if (isNewUser) {
    return generateUserId()
  }
  const candidate = String(providedUserId || getUserIdFromCookie(cookieHeader) || '').trim()
  if (/^[a-zA-Z0-9]{8}$/.test(candidate)) {
    return candidate
  }
  return generateUserId()
}

const coerceColumnValue = (rawValue, type) => {
  const cleaned = cleanCsvValue(rawValue)

  if (type === 'rating') {
    const parsed = Number.parseInt(cleaned, 10)
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 5) : 0
  }

  if (type === 'int') {
    if (!cleaned) return null
    const parsed = Number.parseInt(cleaned, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (type === 'date') {
    if (!cleaned) return null
    const normalizedDate = cleaned.replace(/\//g, '-')
    return /^\d{4}-\d{1,2}-\d{1,2}$/.test(normalizedDate) ? normalizedDate : null
  }

  if (type === 'boolean') {
    return /^(true|1|yes)$/i.test(cleaned)
  }

  return cleaned || null
}

export const parseCsvForDatabase = (csvText = '') => {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) {
    return { dbRows: [], books: [] }
  }

  const firstLineHeaders = rows[0].map((header) => cleanCsvValue(header))
  const headerIndexMap = new Map()
  firstLineHeaders.forEach((header, index) => {
    if (header) {
      headerIndexMap.set(header.toLowerCase(), index)
    }
  })

  const dedupedRowsMap = new Map()
  const books = []

  rows.slice(1).forEach((cells, rowIndex) => {
    const dbRow = {}
    const rawRecord = {}

    for (const col of CSV_TO_DB_COLUMNS) {
      const colIndex = headerIndexMap.get(col.csvHeader.toLowerCase())
      const rawCell = colIndex !== undefined ? (cells[colIndex] ?? '') : ''
      rawRecord[col.csvHeader] = rawCell
      dbRow[col.dbColumn] = coerceColumnValue(rawCell, col.type)
    }

    if (!dbRow.isbn) {
      const isbn13ColIndex =
        headerIndexMap.get('isbn13') ??
        headerIndexMap.get('isbn 13') ??
        headerIndexMap.get('isbn_13')
      if (isbn13ColIndex !== undefined) {
        const cleanedIsbn13 = cleanCsvValue(cells[isbn13ColIndex] ?? '')
        if (cleanedIsbn13) {
          dbRow.isbn = cleanedIsbn13
          rawRecord['ISBN'] = cleanedIsbn13
        }
      }
    }

    if (!dbRow.book_id && !dbRow.title) {
      return
    }

    const bookshelvesPositionsColIndex =
      headerIndexMap.get('bookshelves with positions') ??
      headerIndexMap.get('bookshelves_with_positions') ??
      headerIndexMap.get('bookshelveswithpositions')

    const exclusiveShelfColIndex =
      headerIndexMap.get('exclusive shelf') ??
      headerIndexMap.get('exclusive_shelf') ??
      headerIndexMap.get('exclusive-shelf') ??
      headerIndexMap.get('exclusiveshelf')

    const rawBookshelves = rawRecord['Bookshelves'] ?? ''
    const rawPositions =
      bookshelvesPositionsColIndex !== undefined
        ? cleanCsvValue(cells[bookshelvesPositionsColIndex] ?? '')
        : ''
    const rawExclusive =
      exclusiveShelfColIndex !== undefined
        ? cleanCsvValue(cells[exclusiveShelfColIndex] ?? '')
        : ''
    const rawDateRead = rawRecord['Date Read'] ?? ''

    const resolvedShelf = determineShelf({
      bookshelves: rawBookshelves,
      bookshelvesWithPositions: rawPositions,
      exclusiveShelf: rawExclusive,
      dateRead: rawDateRead,
    })

    if (!resolvedShelf || !isAllowedShelf(resolvedShelf)) {
      return
    }

    dbRow.bookshelves = resolvedShelf
    rawRecord['Bookshelves'] = resolvedShelf

    dbRow.book_id = dbRow.book_id || `${dbRow.title}-${rowIndex}`
    dbRow.title = dbRow.title || `Book ${rowIndex + 1}`

    dedupedRowsMap.set(dbRow.book_id, dbRow)
    books.push(normalizeCsvBook(rawRecord, rowIndex))
  })

  return { dbRows: [...dedupedRowsMap.values()], books }
}

export const upsertUserInDatabase = async ({ userId, displayName, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())

  const sqlText = `
    INSERT INTO users (user_id, display_name, last_access)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      last_access = NOW();
  `.trim()

  await executeQuery(sqlText, [userId, displayName])
}

export const deleteUserBooksFromDatabase = async ({ userId, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  await executeQuery('DELETE FROM books WHERE user_id = $1', [userId])
}

export const insertBooksIntoDatabase = async ({ userId, dbRows, queryFn }) => {
  if (!dbRows.length) {
    return 0
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const dbColumnNames = CSV_TO_DB_COLUMNS.map((col) => col.dbColumn)
  const allColumns = ['user_id', ...dbColumnNames]

  const valuePlaceholders = []
  const values = []

  dbRows.forEach((row) => {
    const rowPlaceholders = allColumns.map((_, colIdx) => `$${values.length + colIdx + 1}`)
    valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`)

    values.push(userId)
    for (const colName of dbColumnNames) {
      values.push(row[colName])
    }
  })

  const updateAssignments = [
    ...dbColumnNames
      .filter((col) => col !== 'book_id')
      .map((col) => `${col} = EXCLUDED.${col}`),
    'updated_at = NOW()',
  ]

  const sqlText = `
    INSERT INTO books (${allColumns.join(', ')})
    VALUES ${valuePlaceholders.join(',\n           ')}
    ON CONFLICT (user_id, book_id)
    DO UPDATE SET
      ${updateAssignments.join(',\n      ')};
  `.trim()

  await executeQuery(sqlText, values)
  return dbRows.length
}

export const enrichMissingIsbns = async ({
  dbRows = [],
  books = [],
  apiKey = getGoogleBooksApiKey(),
  fetchFn = fetch,
  queryFn,
} = {}) => {
  if (!dbRows.length) {
    return { dbRows, books }
  }

  const targets = []
  dbRows.forEach((row, index) => {
    const rawIsbn = String(row.isbn || '').replace(/[^0-9X]/gi, '').trim()
    if (rawIsbn.length < 8 && row.title) {
      targets.push({
        row,
        book: books[index],
        title: row.title,
        author: row.author || '',
      })
    }
  })

  if (targets.length === 0) {
    return { dbRows, books }
  }

  const discoveredCovers = []
  const CONCURRENCY = 5
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async ({ row, book, title, author }) => {
        try {
          const result = await searchGoogleBooks({
            title,
            author,
            apiKey,
            fetchFn,
          })
          if (result?.isbn) {
            row.isbn = result.isbn
            const resolvedCoverUrl =
              result.coverUrl ||
              `https://covers.openlibrary.org/b/isbn/${result.isbn}-L.jpg`
            if (book) {
              book.isbn = result.isbn
              book.imageUrl = resolvedCoverUrl
            }
            if (result.coverUrl) {
              discoveredCovers.push({ isbn: result.isbn, url: result.coverUrl })
            }
          }
        } catch (err) {
          console.warn(`[uploadcsv] Failed to lookup ISBN for "${title}":`, err?.message)
        }
      }),
    )
  }

  if (discoveredCovers.length > 0 && queryFn) {
    for (const { isbn, url } of discoveredCovers) {
      try {
        await upsertCoverInDb({ isbn, url, queryFn })
      } catch (coverErr) {
        console.warn(`[uploadcsv] Failed to save cover for ISBN ${isbn}:`, coverErr?.message)
      }
    }
  }

  return { dbRows, books, covers: discoveredCovers }
}

const readRawStreamFirst = async (req) => {
  if (req && typeof req[Symbol.asyncIterator] === 'function' && !req.readableEnded) {
    const chunks = []
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
    }
    if (chunks.length > 0) {
      return Buffer.concat(chunks)
    }
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8')
  }

  return Buffer.alloc(0)
}

export const parseMultipartFormData = (buffer, contentType = '') => {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || '').trim()

  if (!boundary) {
    throw new Error('Missing multipart boundary.')
  }

  const rawText = buffer.toString('utf8')
  const parts = rawText.split(`--${boundary}`)
  const fields = {}

  for (const part of parts) {
    if (!part || part === '--' || part === '--\r\n' || part.trim() === '--') {
      continue
    }

    const trimmedPart = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
    let separatorIndex = trimmedPart.indexOf('\r\n\r\n')
    let separatorLength = 4
    if (separatorIndex === -1) {
      separatorIndex = trimmedPart.indexOf('\n\n')
      separatorLength = 2
    }

    if (separatorIndex === -1) {
      continue
    }

    const headerSection = trimmedPart.slice(0, separatorIndex)
    const bodyContent = trimmedPart.slice(separatorIndex + separatorLength)

    const nameMatch = headerSection.match(/name="([^"]+)"/i)
    if (!nameMatch?.[1]) {
      continue
    }

    const fieldName = nameMatch[1]
    fields[fieldName] = bodyContent
  }

  return fields
}

export const extractUploadPayload = async (req) => {
  const rawContentType = String(req.headers?.['content-type'] || req.headers?.['Content-Type'] || '')
  const contentType = rawContentType.toLowerCase()

  if (
    req.body &&
    typeof req.body === 'object' &&
    !Buffer.isBuffer(req.body) &&
    (req.body.csv || req.body.file || req.body.displayName)
  ) {
    return {
      userId: String(req.body.userId || req.query?.userId || '').trim(),
      displayName: String(req.body.displayName || req.query?.displayName || '').trim(),
      csvText: String(req.body.csv || req.body.file || ''),
      isNewUser: Boolean(req.body.isNewUser || req.body.generateNewUser || req.query?.isNewUser === 'true'),
    }
  }

  const rawBuffer = await readRawStreamFirst(req)

  if (contentType.includes('multipart/form-data')) {
    const fields = parseMultipartFormData(rawBuffer, rawContentType)
    return {
      userId: String(fields.userId || req.query?.userId || '').trim(),
      displayName: String(fields.displayName || req.query?.displayName || '').trim(),
      csvText: String(fields.file || fields.csv || ''),
      isNewUser: Boolean(fields.isNewUser === 'true' || req.query?.isNewUser === 'true'),
    }
  }

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(rawBuffer.toString('utf8') || '{}')
    return {
      userId: String(parsed.userId || req.query?.userId || '').trim(),
      displayName: String(parsed.displayName || req.query?.displayName || '').trim(),
      csvText: String(parsed.csv || parsed.file || ''),
      isNewUser: Boolean(parsed.isNewUser || parsed.generateNewUser || req.query?.isNewUser === 'true'),
    }
  }

  return {
    userId: String(req.query?.userId || '').trim(),
    displayName: String(req.query?.displayName || '').trim(),
    csvText: rawBuffer.toString('utf8'),
    isNewUser: req.query?.isNewUser === 'true',
  }
}

export default async function handler(req, res) {
  const origin = req.headers?.origin || 'http://localhost:5173'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') {
    return res.status(204).end ? res.status(204).end() : res.status(204).json({})
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { userId: rawUserId, displayName, csvText, isNewUser } = await extractUploadPayload(req)

    if (!displayName) {
      console.warn('[uploadcsv] 400: Display name is missing')
      return res.status(400).json({ error: 'Display name is required.' })
    }

    if (!csvText || !csvText.trim()) {
      console.warn('[uploadcsv] 400: CSV file content is empty')
      return res.status(400).json({ error: 'CSV file content is required.' })
    }

    const { dbRows, books } = parseCsvForDatabase(csvText)

    if (dbRows.length === 0) {
      console.warn('[uploadcsv] 400: No valid books parsed from CSV')
      return res.status(400).json({ error: 'No valid books found in the uploaded CSV.' })
    }

    const executeQuery = req.dbQuery || (await createDefaultDbQuery())
    const apiKey = req.googleBooksApiKey || getGoogleBooksApiKey()
    const fetchFn = req.fetchFn || fetch

    await enrichMissingIsbns({
      dbRows,
      books,
      apiKey,
      fetchFn,
      queryFn: executeQuery,
    })

    const cookieHeader = req.headers?.cookie || req.headers?.Cookie || ''
    const userId = resolveUserId(rawUserId, cookieHeader, { isNewUser })
    const maxAgeSeconds = 60 * 60 * 24 * 365 * 10
    res.setHeader(
      'Set-Cookie',
      `${USER_ID_COOKIE_NAME}=${encodeURIComponent(userId)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`,
    )

    await upsertUserInDatabase({
      userId,
      displayName,
      queryFn: executeQuery,
    })
    await deleteUserBooksFromDatabase({
      userId,
      queryFn: executeQuery,
    })
    await insertBooksIntoDatabase({
      userId,
      dbRows,
      queryFn: executeQuery,
    })

    return res.status(200).json({
      userId,
      username: displayName,
      count: dbRows.length,
      books,
    })
  } catch (error) {
    console.error('Failed to process uploaded Goodreads CSV:', error)
    return res.status(500).json({
      error: error?.message || 'Failed to process and store CSV upload.',
    })
  }
}
