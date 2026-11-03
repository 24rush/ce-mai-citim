const RESERVED_SEGMENTS = new Set(['read', 'to-read', 'currently-reading', 'api', 'goodreads'])

export const USER_ID_COOKIE_NAME = 'userId'

export const getUserIdFromCookie = (cookieString = typeof document !== 'undefined' ? document.cookie : '') => {
  if (!cookieString) {
    return ''
  }

  const match = String(cookieString).match(/(?:^|;\s*)userId=([^;]+)/)
  return match?.[1] ? decodeURIComponent(match[1].trim()) : ''
}

export const setUserIdCookie = (userId) => {
  if (!userId || typeof document === 'undefined') {
    return
  }

  const maxAgeSeconds = 60 * 60 * 24 * 365 * 10
  document.cookie = `${USER_ID_COOKIE_NAME}=${encodeURIComponent(String(userId).trim())}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`
}

export const extractGoodreadsUserId = (value) => {
  if (!value) {
    return ''
  }

  const normalized = String(value).trim()

  const goodreadsMatch = normalized.match(/goodreads\.com\/(?:user\/show\/)?(\d+)/i)
  if (goodreadsMatch?.[1]) {
    return goodreadsMatch[1]
  }

  const pathOnly = normalized.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '')
  if (!pathOnly) {
    return ''
  }

  const segments = pathOnly.split('/').filter(Boolean)
  const candidate = segments.find(
    (segment) => !RESERVED_SEGMENTS.has(segment.toLowerCase()) && /^[a-zA-Z0-9_-]+$/.test(segment),
  )

  return candidate || ''
}

export const buildGoodreadsApiUrl = (value) => {
  const userId = extractGoodreadsUserId(value)

  if (!userId) {
    return ''
  }

  return `/api/goodreads/${userId}`
}

export const buildBookShareUrl = (userId, shelf, bookId, origin = window.location.origin) => {
  if (!userId || !shelf || !bookId) {
    return ''
  }

  return `${origin.replace(/\/$/, '')}/${userId}/${shelf}/${encodeURIComponent(bookId)}`
}

export const cleanCsvValue = (value) => {
  if (value === null || value === undefined) {
    return ''
  }

  const trimmed = String(value).trim()
  const excelFormulaMatch = trimmed.match(/^="?(.*?)"?$/)
  if (excelFormulaMatch) {
    return excelFormulaMatch[1].trim()
  }

  return trimmed
}

export const parseCsvRows = (csvText = '') => {
  const text = String(csvText).replace(/^\uFEFF/, '')
  if (!text.trim()) {
    return []
  }

  const rows = []
  let currentRow = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"'
        i += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        currentField += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      currentRow.push(currentField)
      currentField = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && nextChar === '\n') {
        i += 1
      }
      currentRow.push(currentField)
      if (currentRow.some((cell) => cell.trim() !== '')) {
        rows.push(currentRow)
      }
      currentRow = []
      currentField = ''
    } else {
      currentField += char
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    if (currentRow.some((cell) => cell.trim() !== '')) {
      rows.push(currentRow)
    }
  }

  return rows
}

export const normalizeCsvBook = (record = {}, index = 0) => {
  const getField = (...keys) => {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null && record[key] !== '') {
        return record[key]
      }
    }
    return ''
  }

  const bookId = cleanCsvValue(getField('Book Id', 'bookId', 'book_id', 'id'))
  const title = cleanCsvValue(getField('Title', 'title')) || `Book ${index + 1}`
  const author = cleanCsvValue(getField('Author', 'author', 'author_name'))
  const isbn = cleanCsvValue(getField('ISBN', 'isbn', 'ISBN13', 'isbn13'))
  const rawRating = cleanCsvValue(getField('My Rating', 'myRating', 'my_rating', 'rating', 'user_rating'))
  const publisher = cleanCsvValue(getField('Publisher', 'publisher'))
  const binding = cleanCsvValue(getField('Binding', 'binding'))
  const rawPages = cleanCsvValue(getField('Number of Pages', 'numberOfPages', 'num_pages', 'pages'))
  const rawPublishedYear = cleanCsvValue(
    getField('Original Publication Year', 'originalPublicationYear', 'publishedYear', 'Year Published', 'yearPublished'),
  )
  const readAt = cleanCsvValue(getField('Date Read', 'dateRead', 'date_read', 'readAt', 'finishedAt'))
  const dateAdded = cleanCsvValue(getField('Date Added', 'dateAdded', 'date_added'))
  const rawBookshelves = cleanCsvValue(getField('Bookshelves', 'bookshelves'))
  const rawPositions = cleanCsvValue(
    getField('Bookshelves with positions', 'bookshelves with positions', 'bookshelves_with_positions'),
  )
  const rawExclusive = cleanCsvValue(getField('Exclusive Shelf', 'exclusiveShelf', 'exclusive_shelf'))
  const cleanedPositions = rawPositions ? rawPositions.replace(/\s*\([^)]*\)/g, '').trim() : ''
  const bookshelves = rawBookshelves || cleanedPositions || rawExclusive || ''
  const review = cleanCsvValue(getField('My Review', 'myReview', 'my_review', 'review'))
  const rawSpoiler = cleanCsvValue(getField('Spoiler', 'spoiler'))
  const rawAverageRating = cleanCsvValue(getField('Average Rating', 'averageRating', 'average_rating'))

  const rating = Number.parseFloat(rawRating || '0')
  const pages = Number.parseInt(rawPages || '0', 10)
  const publishedYear = Number.parseInt(rawPublishedYear || '0', 10)
  const averageRating = Number.parseFloat(rawAverageRating || '0')
  const thickness =
    Number.isFinite(record.thickness) && record.thickness > 0
      ? record.thickness
      : Number.isFinite(pages) && pages > 0
        ? Math.min(Math.max(Math.round(pages / 8), 18), 80)
        : 35

  const resolvedId = bookId || `${title}-${index}`
  const cleanIsbn = isbn ? String(isbn).replace(/[^0-9X]/gi, '').trim() : ''
  const defaultCoverUrl = cleanIsbn
    ? `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg`
    : ''
  const rawImageUrl = cleanCsvValue(getField('imageUrl', 'image_url', 'coverUrl', 'cover_url'))
  const imageUrl =
    rawImageUrl && !rawImageUrl.includes('compressed.photo.goodreads.com') && !rawImageUrl.includes('ssl-images-amazon.com')
      ? rawImageUrl
      : defaultCoverUrl
  const link =
    cleanCsvValue(getField('link', 'url')) ||
    (bookId ? `https://www.goodreads.com/book/show/${bookId}` : '#')

  const spoiler =
    typeof record.spoiler === 'boolean'
      ? record.spoiler
      : /^(true|1|yes)$/i.test(rawSpoiler)

  return {
    id: cleanCsvValue(record.id) || resolvedId,
    bookId: resolvedId,
    title,
    author,
    isbn,
    rating: Number.isFinite(rating) ? Math.min(Math.max(rating, 0), 5) : 0,
    publisher,
    binding,
    pages: Number.isFinite(pages) && pages > 0 ? pages : 0,
    thickness,
    publishedYear: Number.isFinite(publishedYear) ? publishedYear : 0,
    readAt,
    finishedAt: cleanCsvValue(record.finishedAt) || readAt,
    dateAdded,
    bookshelves,
    review,
    spoiler,
    averageRating: Number.isFinite(averageRating) ? averageRating : 0,
    imageUrl,
    link,
  }
}

export const parseGoodreadsCsv = (csvText = '') => {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) {
    return []
  }

  const headers = rows[0].map((header) => cleanCsvValue(header))

  return rows.slice(1).map((cells, rowIndex) => {
    const record = {}
    headers.forEach((header, colIndex) => {
      if (header) {
        record[header] = cells[colIndex] ?? ''
      }
    })
    return normalizeCsvBook(record, rowIndex)
  })
}

export const matchesShelf = (book, shelf = 'read') => {
  if (!book) {
    return false
  }

  const targetShelf = String(shelf || '').trim().toLowerCase()
  const bookShelf = String(book.bookshelves || '').trim().toLowerCase()

  if (targetShelf === 'to-read') {
    return bookShelf === 'to-read'
  }

  if (targetShelf === 'currently-reading') {
    return bookShelf === 'currently-reading'
  }

  if (targetShelf === 'read') {
    if (
      bookShelf === 'to-read' ||
      bookShelf === 'currently-reading' ||
      bookShelf === 'did-not-finish'
    ) {
      return false
    }
    return true
  }

  return bookShelf === targetShelf
}

export const getFinishedBooksTotals = (books = [], year) => {
  if (!Number.isInteger(year)) {
    return { count: 0, totalPages: 0 }
  }

  let count = 0
  let totalPages = 0

  books.forEach((book) => {
    const readDate = book.readAt || book['Date Read'] || ''
    if (!readDate) {
      return
    }

    const yearMatch = String(readDate).match(/^(\d{4})/)
    if (!yearMatch || Number(yearMatch[1]) !== year) {
      return
    }

    const pages = Number(book.pages ?? book['Number of Pages']) || 0
    count += 1
    totalPages += pages
  })

  return { count, totalPages }
}
