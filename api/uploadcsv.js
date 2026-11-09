import crypto from 'node:crypto'
import { createDefaultDbQuery } from './_lib/db.js'
import { getGoogleBooksApiKey, searchGoogleBooks, upsertCoverInDb } from './isbn.js'
import {
  USER_ID_COOKIE_NAME,
  cleanCsvValue,
  getUserIdFromCookie,
  normalizeCsvBook,
  parseCsvRows,
  resolveBookIsbns,
} from '../src/lib/goodreads.js'

export const BOOK_DB_COLUMNS = [
  { csvHeader: 'Book Id', dbColumn: 'book_id', type: 'string' },
  { csvHeader: 'Title', dbColumn: 'title', type: 'string' },
  { csvHeader: 'Author', dbColumn: 'author', type: 'string' },
  { csvHeader: 'ISBN', dbColumn: 'isbn', type: 'string' },
  { csvHeader: 'Publisher', dbColumn: 'publisher', type: 'string' },
  { csvHeader: 'Binding', dbColumn: 'binding', type: 'string' },
  { csvHeader: 'Number of Pages', dbColumn: 'number_of_pages', type: 'int' },
  { csvHeader: 'Original Publication Year', dbColumn: 'original_publication_year', type: 'int' },
]

export const USER_SHELF_DB_COLUMNS = [
  { csvHeader: 'Bookshelves', dbColumn: 'bookshelves', type: 'string' },
  { csvHeader: 'My Rating', dbColumn: 'my_rating', type: 'rating' },
  { csvHeader: 'Date Read', dbColumn: 'date_read', type: 'date' },
  { csvHeader: 'Date Added', dbColumn: 'date_added', type: 'date' },
  { csvHeader: 'My Review', dbColumn: 'my_review', type: 'string' },
  { csvHeader: 'Spoiler', dbColumn: 'spoiler', type: 'boolean' },
]

export const CSV_TO_DB_COLUMNS = [
  ...BOOK_DB_COLUMNS,
  ...USER_SHELF_DB_COLUMNS,
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

    const isbnColIndex = headerIndexMap.get('isbn')
    const isbn13ColIndex =
      headerIndexMap.get('isbn13') ??
      headerIndexMap.get('isbn 13') ??
      headerIndexMap.get('isbn_13')

    const rawIsbn = isbnColIndex !== undefined ? cells[isbnColIndex] : ''
    const rawIsbn13 = isbn13ColIndex !== undefined ? cells[isbn13ColIndex] : ''
    const resolved = resolveBookIsbns({ isbn: rawIsbn, isbn13: rawIsbn13 })

    dbRow.isbn = resolved.isbn || null
    rawRecord['ISBN'] = resolved.isbn || ''
    rawRecord['ISBN13'] = resolved.isbn13 || ''

    // If Original Publication Year is missing/empty/0, check alternative year headers (e.g. 'Year Published')
    if (!dbRow.original_publication_year || dbRow.original_publication_year <= 0) {
      const yearPublishedIndex =
        headerIndexMap.get('year published') ??
        headerIndexMap.get('year_published') ??
        headerIndexMap.get('yearpublished')
      if (yearPublishedIndex !== undefined) {
        const altYear = coerceColumnValue(cells[yearPublishedIndex], 'int')
        if (altYear && altYear > 0) {
          dbRow.original_publication_year = altYear
          rawRecord['Original Publication Year'] = String(altYear)
        }
      }
    }

    // If Number of Pages is missing/empty/0, check alternative page headers (e.g. 'Pages', 'num_pages')
    if (!dbRow.number_of_pages || dbRow.number_of_pages <= 0) {
      const altPagesIndex =
        headerIndexMap.get('pages') ??
        headerIndexMap.get('num_pages') ??
        headerIndexMap.get('number_of_pages')
      if (altPagesIndex !== undefined) {
        const altPages = coerceColumnValue(cells[altPagesIndex], 'int')
        if (altPages && altPages > 0) {
          dbRow.number_of_pages = altPages
          rawRecord['Number of Pages'] = String(altPages)
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

export const upsertUserInDatabase = async ({ userId, displayName, authUserId, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())

  if (authUserId) {
    const sqlText = `
      INSERT INTO users (user_id, display_name, auth_user_id, last_access)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        auth_user_id = COALESCE(EXCLUDED.auth_user_id, users.auth_user_id),
        last_access = NOW();
    `.trim()
    await executeQuery(sqlText, [userId, displayName, authUserId])
  } else {
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
}

export const deleteUserBooksFromDatabase = async ({ userId, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())
  await executeQuery('DELETE FROM user_shelves WHERE user_id = $1', [userId])
}

export const insertBooksIntoDatabase = async ({ userId, dbRows, queryFn }) => {
  if (!dbRows.length) {
    return 0
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())

  // 1. Insert or update canonical books in the books table
  const bookColumnNames = BOOK_DB_COLUMNS.map((col) => col.dbColumn)
  const bookPlaceholders = []
  const bookValues = []

  dbRows.forEach((row) => {
    const rowPlaceholders = bookColumnNames.map((_, colIdx) => `$${bookValues.length + colIdx + 1}`)
    bookPlaceholders.push(`(${rowPlaceholders.join(', ')})`)
    for (const colName of bookColumnNames) {
      bookValues.push(row[colName])
    }
  })

  const bookUpdateAssignments = [
    'title = EXCLUDED.title',
    'author = EXCLUDED.author',
    "isbn = COALESCE(NULLIF(EXCLUDED.isbn, ''), books.isbn)",
    'publisher = EXCLUDED.publisher',
    'binding = EXCLUDED.binding',
    'number_of_pages = COALESCE(EXCLUDED.number_of_pages, books.number_of_pages)',
    'original_publication_year = COALESCE(EXCLUDED.original_publication_year, books.original_publication_year)',
    'updated_at = NOW()',
  ]

  const booksSqlText = `
    INSERT INTO books (${bookColumnNames.join(', ')})
    VALUES ${bookPlaceholders.join(',\n           ')}
    ON CONFLICT (book_id)
    DO UPDATE SET
      ${bookUpdateAssignments.join(',\n      ')};
  `.trim()

  await executeQuery(booksSqlText, bookValues)

  // 2. Insert or update user shelf connections in the user_shelves table
  const shelfDataColumns = USER_SHELF_DB_COLUMNS.map((col) => col.dbColumn)
  const allShelfColumns = ['user_id', 'book_id', ...shelfDataColumns]
  const shelfPlaceholders = []
  const shelfValues = []

  dbRows.forEach((row) => {
    const rowPlaceholders = allShelfColumns.map((_, colIdx) => `$${shelfValues.length + colIdx + 1}`)
    shelfPlaceholders.push(`(${rowPlaceholders.join(', ')})`)

    shelfValues.push(userId)
    shelfValues.push(row.book_id)
    for (const colName of shelfDataColumns) {
      shelfValues.push(row[colName])
    }
  })

  const shelfUpdateAssignments = [
    ...shelfDataColumns.map((col) => `${col} = EXCLUDED.${col}`),
    'updated_at = NOW()',
  ]

  const shelfSqlText = `
    INSERT INTO user_shelves (${allShelfColumns.join(', ')})
    VALUES ${shelfPlaceholders.join(',\n           ')}
    ON CONFLICT (user_id, book_id)
    DO UPDATE SET
      ${shelfUpdateAssignments.join(',\n      ')};
  `.trim()

  await executeQuery(shelfSqlText, shelfValues)
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
    const missingIsbn = rawIsbn.length < 8
    const missingPages = !row.number_of_pages || row.number_of_pages <= 0
    const missingYear = !row.original_publication_year || row.original_publication_year <= 0

    if ((missingIsbn || missingPages || missingYear) && (row.title || rawIsbn)) {
      targets.push({
        row,
        book: books[index],
        title: row.title,
        author: row.author || '',
        isbn: rawIsbn,
        missingIsbn,
        missingPages,
        missingYear,
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
      batch.map(async ({ row, book, title, author, isbn, missingIsbn, missingPages, missingYear }) => {
        try {
          const result = await searchGoogleBooks({
            title,
            author,
            isbn,
            apiKey,
            fetchFn,
          })
          if (!result) return

          // 1. Fill missing ISBN if the csv does not contain it
          if (missingIsbn && result.isbn) {
            row.isbn = result.isbn
            const resolvedCoverUrl =
              result.coverUrl ||
              `https://covers.openlibrary.org/b/isbn/${result.isbn}-L.jpg`
            if (book) {
              book.isbn = result.isbn
              book.imageUrl = resolvedCoverUrl
            }
            if (result.coverUrl) {
              const resIsbns = resolveBookIsbns({ isbn: result.isbn })
              if (resIsbns.isbn13) discoveredCovers.push({ isbn: resIsbns.isbn13, url: result.coverUrl })
              if (resIsbns.isbn10 && resIsbns.isbn10 !== resIsbns.isbn13) {
                discoveredCovers.push({ isbn: resIsbns.isbn10, url: result.coverUrl })
              }
              if (!resIsbns.isbn13 && !resIsbns.isbn10) {
                discoveredCovers.push({ isbn: result.isbn, url: result.coverUrl })
              }
            }
          } else if (result.coverUrl && (!book?.imageUrl || book.imageUrl.includes('covers.openlibrary.org'))) {
            if (book && !book.imageUrl) {
              book.imageUrl = result.coverUrl
            }
            const cleanCurIsbn = String(row.isbn || result.isbn || '').replace(/[^0-9X]/gi, '').trim()
            if (cleanCurIsbn) {
              const resIsbns = resolveBookIsbns({ isbn: cleanCurIsbn })
              if (resIsbns.isbn13) discoveredCovers.push({ isbn: resIsbns.isbn13, url: result.coverUrl })
              if (resIsbns.isbn10 && resIsbns.isbn10 !== resIsbns.isbn13) {
                discoveredCovers.push({ isbn: resIsbns.isbn10, url: result.coverUrl })
              }
            }
          }

          // 2. Fill missing publication year if the csv does not contain it
          if (missingYear) {
            const pubYear =
              result.publishedYear ||
              (result.publishedDate
                ? Number.parseInt(String(result.publishedDate).match(/\b([12]\d{3})\b/)?.[1] || '', 10)
                : null)
            if (pubYear && pubYear > 0) {
              row.original_publication_year = pubYear
              if (book) {
                book.publishedYear = pubYear
              }
            }
          }

          // 3. Fill missing number of pages if the csv does not contain it
          if (missingPages && result.pageCount && result.pageCount > 0) {
            row.number_of_pages = result.pageCount
            if (book) {
              book.pages = result.pageCount
              book.thickness = Math.min(Math.max(Math.round(result.pageCount / 8), 18), 80)
            }
          }
        } catch (err) {
          console.warn(`[uploadcsv] Failed to lookup metadata for "${title}":`, err?.message)
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

export const enrichMissingMetadata = enrichMissingIsbns

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
      isNewUser: Boolean(req.body.isNewUser || req.query?.isNewUser),
      authUserId: String(req.body.authUserId || req.query?.authUserId || '').trim() || null,
    }
  }

  const rawBuffer = await readRawStreamFirst(req)

  if (contentType.includes('multipart/form-data')) {
    const fields = parseMultipartFormData(rawBuffer, rawContentType)
    return {
      userId: String(fields.userId || req.query?.userId || '').trim(),
      displayName: String(fields.displayName || req.query?.displayName || '').trim(),
      csvText: String(fields.file || fields.csv || ''),
      isNewUser: Boolean(fields.isNewUser === 'true' || fields.isNewUser === true || req.query?.isNewUser),
      authUserId: String(fields.authUserId || req.query?.authUserId || '').trim() || null,
    }
  }

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(rawBuffer.toString('utf8') || '{}')
    return {
      userId: String(parsed.userId || req.query?.userId || '').trim(),
      displayName: String(parsed.displayName || req.query?.displayName || '').trim(),
      csvText: String(parsed.csv || parsed.file || ''),
      isNewUser: Boolean(parsed.isNewUser || req.query?.isNewUser),
      authUserId: String(parsed.authUserId || req.query?.authUserId || '').trim() || null,
    }
  }

  return {
    userId: String(req.query?.userId || '').trim(),
    displayName: String(req.query?.displayName || '').trim(),
    csvText: rawBuffer.toString('utf8'),
    isNewUser: Boolean(req.query?.isNewUser),
    authUserId: String(req.query?.authUserId || '').trim() || null,
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
    const { userId: rawUserId, displayName, csvText, isNewUser, authUserId } =
      await extractUploadPayload(req)

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
      authUserId,
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
