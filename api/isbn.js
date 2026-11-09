import { createDefaultDbQuery, ensureEnvLoaded } from './_lib/db.js'
import { convertIsbn10To13, convertIsbn13To10 } from '../src/lib/goodreads.js'

export const getGoogleBooksApiKey = () => {
  ensureEnvLoaded()
  return (
    process.env.GOOGLE_BOOKS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  ).trim()
}

export const cleanIsbn = (val = '') => {
  if (!val) return ''
  return String(val).replace(/[^0-9X]/gi, '').trim()
}

export const isValidIsbn = (val = '') => {
  const cleaned = cleanIsbn(val)
  return cleaned.length === 10 || cleaned.length === 13
}

export const buildGoogleBooksQuery = (title = '', author = '') => {
  const cleanTitle = String(title || '').trim()
  const cleanAuthor = String(author || '').trim()
  if (!cleanTitle) return ''

  const parts = [`intitle:${cleanTitle}`]
  if (cleanAuthor) {
    parts.push(`inauthor:${cleanAuthor}`)
  }
  return parts.join(' ')
}

export const extractCoverFromVolume = (item) => {
  const links = item?.volumeInfo?.imageLinks
  if (!links || typeof links !== 'object') return null

  const candidate =
    links.extraLarge ||
    links.large ||
    links.medium ||
    links.small ||
    links.thumbnail ||
    links.smallThumbnail ||
    null

  if (!candidate) return null

  let url = String(candidate).trim().replace(/^http:\/\//i, 'https://')
  url = url.replace(/&edge=curl/gi, '')
  return url
}

export const extractIsbnFromVolume = (item) => {
  const identifiers = item?.volumeInfo?.industryIdentifiers
  if (!Array.isArray(identifiers)) return null

  let isbn13 = null
  let isbn10 = null

  for (const idObj of identifiers) {
    const rawId = cleanIsbn(idObj?.identifier)
    if (!rawId) continue

    if (idObj?.type === 'ISBN_13' || rawId.length === 13) {
      isbn13 = rawId
    } else if (idObj?.type === 'ISBN_10' || rawId.length === 10) {
      isbn10 = rawId
    }
  }

  return isbn13 || isbn10 || null
}

export const extractBestIsbnFromItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return null

  let firstIsbn10 = null
  for (const item of items) {
    const isbn = extractIsbnFromVolume(item)
    if (isbn) {
      if (isbn.length === 13) {
        return isbn
      }
      if (!firstIsbn10) {
        firstIsbn10 = isbn
      }
    }
  }
  return firstIsbn10
}

export const extractPublishedYearFromVolume = (item) => {
  const publishedDate = item?.volumeInfo?.publishedDate
  if (!publishedDate) return null
  const str = String(publishedDate).trim()
  const match = str.match(/\b([12]\d{3})\b/)
  if (match) {
    const year = Number.parseInt(match[1], 10)
    if (Number.isFinite(year) && year > 0) {
      return year
    }
  }
  return null
}

export const extractPageCountFromVolume = (item) => {
  const pageCount = item?.volumeInfo?.pageCount
  if (pageCount !== undefined && pageCount !== null && pageCount !== '') {
    const parsed = Number.parseInt(pageCount, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

export const buildSearchResult = (topItem, defaultIsbn, defaultTitle, defaultAuthor) => {
  if (!topItem) return null
  const resolvedIsbn = defaultIsbn || extractIsbnFromVolume(topItem) || null
  const coverUrl = extractCoverFromVolume(topItem)
  const publishedDate = topItem?.volumeInfo?.publishedDate || null
  const publishedYear = extractPublishedYearFromVolume(topItem)
  const pageCount = extractPageCountFromVolume(topItem)

  return {
    isbn: resolvedIsbn,
    title: topItem?.volumeInfo?.title || defaultTitle,
    author: topItem?.volumeInfo?.authors?.[0] || defaultAuthor,
    coverUrl,
    imageUrl: coverUrl,
    thumbnail: coverUrl,
    publishedDate,
    publishedYear,
    pageCount,
  }
}

export const searchGoogleBooks = async ({
  title,
  author,
  isbn: queryIsbn,
  apiKey = getGoogleBooksApiKey(),
  fetchFn = fetch,
} = {}) => {
  const cleanTitle = String(title || '').trim()
  const cleanAuthor = String(author || '').trim()
  const cleanProvidedIsbn = cleanIsbn(queryIsbn)
  if (!cleanTitle && !cleanProvidedIsbn) return null

  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''

  // 1. If ISBN is provided, try exact ISBN query first
  if (cleanProvidedIsbn) {
    try {
      const isbnUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(
        cleanProvidedIsbn,
      )}&maxResults=1&printType=books${keyParam}`
      const res = await fetchFn(isbnUrl)
      if (res.ok) {
        const data = await res.json()
        const topItem = data?.items?.[0]
        if (topItem) {
          const isbn = extractIsbnFromVolume(topItem) || cleanProvidedIsbn
          return buildSearchResult(topItem, isbn, cleanTitle, cleanAuthor)
        }
      }
    } catch {
      // Continue to title/author search
    }
  }

  // 2. Primary strict search: intitle: + inauthor:
  const primaryQuery = buildGoogleBooksQuery(cleanTitle, cleanAuthor)
  if (primaryQuery) {
    try {
      const primaryUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
        primaryQuery,
      )}&maxResults=5&printType=books${keyParam}`
      const res = await fetchFn(primaryUrl)
      if (res.ok) {
        const data = await res.json()
        const isbn = extractBestIsbnFromItems(data?.items)
        if (isbn || data?.items?.length > 0) {
          const topItem =
            (isbn && data.items.find((item) => extractIsbnFromVolume(item) === isbn)) ||
            data.items[0]
          return buildSearchResult(topItem, isbn, cleanTitle, cleanAuthor)
        }
      }
    } catch {
      // Continue to fallback search
    }
  }

  // 3. Fallback general search: title + author
  const fallbackQuery = `${cleanTitle} ${cleanAuthor}`.trim()
  if (fallbackQuery && fallbackQuery !== primaryQuery) {
    try {
      const fallbackUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
        fallbackQuery,
      )}&maxResults=5&printType=books${keyParam}`
      const fallbackRes = await fetchFn(fallbackUrl)
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json()
        const fallbackIsbn = extractBestIsbnFromItems(fallbackData?.items)
        if (fallbackIsbn || fallbackData?.items?.length > 0) {
          const topItem =
            (fallbackIsbn &&
              fallbackData.items.find((item) => extractIsbnFromVolume(item) === fallbackIsbn)) ||
            fallbackData.items[0]
          return buildSearchResult(topItem, fallbackIsbn, cleanTitle, cleanAuthor)
        }
      }
    } catch {
      // Return null on failure
    }
  }

  return null
}

export const updateBookIsbnInDb = async ({ userId: _userId, bookId, isbn, queryFn }) => {
  if (!bookId || !isbn) return null
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    UPDATE books
    SET isbn = $1, updated_at = NOW()
    WHERE book_id = $2
      AND (isbn IS NULL OR isbn = '')
    RETURNING book_id, title, author, isbn;
  `.trim()

  const rows = await executeQuery(sql, [isbn, bookId])
  return rows?.[0] || null
}

export const upsertCoverInDb = async ({ isbn, url, queryFn }) => {
  const clean = cleanIsbn(isbn)
  if (!clean || !url) return null
  const executeQuery = queryFn || (await createDefaultDbQuery())
  const sql = `
    INSERT INTO covers (isbn, url)
    VALUES ($1, $2)
    ON CONFLICT (isbn)
    DO UPDATE SET url = EXCLUDED.url
    RETURNING isbn, url;
  `.trim()

  const rows = await executeQuery(sql, [clean, url])

  const altIsbn =
    clean.length === 13 ? convertIsbn13To10(clean) : convertIsbn10To13(clean)
  if (altIsbn && altIsbn !== clean) {
    try {
      await executeQuery(sql, [altIsbn, url])
    } catch {
      // Best effort
    }
  }

  return rows?.[0] || null
}

export const backfillUserBooksWithoutIsbn = async ({
  userId,
  limit = 10,
  apiKey,
  fetchFn = fetch,
  queryFn,
} = {}) => {
  if (!userId) {
    return { success: false, error: 'User id is required.' }
  }

  const executeQuery = queryFn || (await createDefaultDbQuery())
  const selectSql = `
    SELECT b.book_id, b.title, b.author
    FROM user_shelves us
    JOIN books b ON b.book_id = us.book_id
    WHERE us.user_id = $1
      AND (b.isbn IS NULL OR b.isbn = '')
    LIMIT $2;
  `.trim()

  const booksToUpdate = await executeQuery(selectSql, [userId, limit])
  if (!booksToUpdate || booksToUpdate.length === 0) {
    return { success: true, updatedCount: 0, scannedCount: 0, books: [] }
  }

  const updatedBooks = []
  for (const book of booksToUpdate) {
    try {
      const result = await searchGoogleBooks({
        title: book.title,
        author: book.author,
        apiKey,
        fetchFn,
      })
      if (result?.isbn) {
        await updateBookIsbnInDb({
          userId,
          bookId: book.book_id,
          isbn: result.isbn,
          queryFn: executeQuery,
        })
        if (result.coverUrl) {
          try {
            await upsertCoverInDb({
              isbn: result.isbn,
              url: result.coverUrl,
              queryFn: executeQuery,
            })
          } catch {
            // Ignore cover upsert errors in backfill
          }
        }
        updatedBooks.push({
          bookId: book.book_id,
          title: book.title,
          author: book.author,
          isbn: result.isbn,
          coverUrl: result.coverUrl || null,
        })
      }
    } catch (err) {
      console.error(`Failed to lookup ISBN for book ${book.book_id} (${book.title}):`, err)
    }
  }

  return {
    success: true,
    updatedCount: updatedBooks.length,
    scannedCount: booksToUpdate.length,
    books: updatedBooks,
  }
}

export const parseJsonBody = async (req) => {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }

  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'))
    } catch {
      return {}
    }
  }

  if (typeof req[Symbol.asyncIterator] === 'function') {
    try {
      const chunks = []
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)
      }
      if (chunks.length > 0) {
        const text = Buffer.concat(chunks).toString('utf8')
        return JSON.parse(text)
      }
    } catch {
      return {}
    }
  }

  return {}
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

  ensureEnvLoaded()

  try {
    const query = req.query || {}
    const body = req.method === 'POST' ? await parseJsonBody(req) : {}

    const title = String(body.title || query.title || '').trim()
    const author = String(body.author || query.author || '').trim()
    const userId = String(body.userId || query.userId || '').trim()
    const bookId = String(body.bookId || query.bookId || '').trim()
    const isBackfill = Boolean(
      body.backfill ||
      query.backfill === 'true' ||
      body.action === 'backfill' ||
      query.action === 'backfill',
    )
    const limit = Math.min(
      Math.max(Number.parseInt(body.limit || query.limit || '10', 10) || 10, 1),
      25,
    )

    const apiKey = getGoogleBooksApiKey()
    const fetchFn = req.fetchFn || fetch
    const queryFn = req.dbQuery

    // Handle backfill mode
    if (isBackfill) {
      if (!userId) {
        return res.status(400).json({ error: 'User id is required for backfill.' })
      }
      const backfillResult = await backfillUserBooksWithoutIsbn({
        userId,
        limit,
        apiKey,
        fetchFn,
        queryFn,
      })
      return res.status(200).json(backfillResult)
    }

    if (!title) {
      return res.status(400).json({ error: 'Book title is required.' })
    }

    const searchResult = await searchGoogleBooks({
      title,
      author,
      isbn: body.isbn || query.isbn,
      apiKey,
      fetchFn,
    })

    if (!searchResult || !searchResult.isbn) {
      return res.status(404).json({
        success: false,
        isbn: null,
        message: 'No ISBN found for the given title and author.',
      })
    }

    let updatedDbRecord = null
    if (userId && bookId) {
      try {
        updatedDbRecord = await updateBookIsbnInDb({
          userId,
          bookId,
          isbn: searchResult.isbn,
          queryFn,
        })
      } catch (dbErr) {
        console.error('Failed to update book ISBN in database:', dbErr)
      }
    }

    if (searchResult.coverUrl) {
      try {
        await upsertCoverInDb({
          isbn: searchResult.isbn,
          url: searchResult.coverUrl,
          queryFn,
        })
      } catch (coverErr) {
        console.error('Failed to save cover in database:', coverErr)
      }
    }

    return res.status(200).json({
      success: true,
      isbn: searchResult.isbn,
      title: searchResult.title,
      author: searchResult.author,
      coverUrl: searchResult.coverUrl,
      imageUrl: searchResult.coverUrl,
      thumbnail: searchResult.thumbnail,
      publishedDate: searchResult.publishedDate || null,
      publishedYear: searchResult.publishedYear || null,
      pageCount: searchResult.pageCount || null,
      updated: Boolean(updatedDbRecord),
    })
  } catch (error) {
    console.error('ISBN lookup error:', error)
    return res.status(500).json({ error: error?.message || 'Failed to lookup ISBN.' })
  }
}

