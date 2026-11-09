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

export const SHELF_IDS = ['read', 'to-read', 'currently-reading', 'did-not-finish']

export const isRootPath = (pathname = '') => {
  const normalized = String(pathname || '').trim().replace(/\/+$/, '')
  return normalized === '' || normalized === '/'
}

export const getRouteStateFromPath = (pathname = typeof window !== 'undefined' ? window.location.pathname : '') => {
  const segments = String(pathname || '').split('/').filter(Boolean)
  const userSegment = segments[0] || ''
  const shelfSegment = segments[1] || 'read'
  const bookSegment = segments[2] || ''

  const userId = extractGoodreadsUserId(userSegment)
  const shelf = SHELF_IDS.includes(shelfSegment) ? shelfSegment : 'read'

  return {
    userId,
    shelf,
    bookId: bookSegment,
  }
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

  let str = String(value).trim()

  // Repeatedly strip leading = and enclosing quotes (e.g. ="=""164722215X""" or ="164722215X")
  let prev
  do {
    prev = str
    str = str.trim()
    if (str.startsWith('=')) {
      str = str.slice(1).trim()
    }
    if (
      (str.startsWith('"') && str.endsWith('"') && str.length >= 2) ||
      (str.startsWith("'") && str.endsWith("'") && str.length >= 2)
    ) {
      str = str.slice(1, -1).trim()
    }
  } while (str !== prev)

  // Unescape CSV-escaped double quotes ("" -> ")
  str = str.replace(/""/g, '"')

  // If unescaping left outer quotes or leading =, clean once more
  while (
    (str.startsWith('"') && str.endsWith('"') && str.length >= 2) ||
    str.startsWith('=')
  ) {
    if (str.startsWith('=')) {
      str = str.slice(1).trim()
    } else {
      str = str.slice(1, -1).trim()
    }
  }

  if (/^"+$/.test(str)) {
    return ''
  }

  return str.trim()
}

export const cleanIsbnValue = (val = '') => {
  if (!val) return ''
  const cleaned = cleanCsvValue(val)
  return String(cleaned).replace(/[^0-9X]/gi, '').trim().toUpperCase()
}

export const convertIsbn10To13 = (isbn10 = '') => {
  const clean = cleanIsbnValue(isbn10)
  if (clean.length !== 10) return ''
  const base = `978${clean.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    sum += Number.parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3)
  }
  const check = (10 - (sum % 10)) % 10
  return `${base}${check}`
}

export const convertIsbn13To10 = (isbn13 = '') => {
  const clean = cleanIsbnValue(isbn13)
  if (clean.length !== 13 || !clean.startsWith('978')) return ''
  const base = clean.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i += 1) {
    sum += Number.parseInt(base[i], 10) * (10 - i)
  }
  const rem = (11 - (sum % 11)) % 11
  const check = rem === 10 ? 'X' : String(rem)
  return `${base}${check}`
}

export const resolveBookIsbns = ({ isbn = '', isbn13 = '' } = {}) => {
  const clean1 = cleanIsbnValue(isbn)
  const clean2 = cleanIsbnValue(isbn13)

  let foundIsbn10 = ''
  let foundIsbn13 = ''

  if (clean1.length === 10) foundIsbn10 = clean1
  else if (clean1.length === 13) foundIsbn13 = clean1

  if (clean2.length === 13) foundIsbn13 = clean2
  else if (clean2.length === 10 && !foundIsbn10) foundIsbn10 = clean2

  if (foundIsbn10 && !foundIsbn13) {
    foundIsbn13 = convertIsbn10To13(foundIsbn10)
  }

  if (foundIsbn13 && !foundIsbn10) {
    foundIsbn10 = convertIsbn13To10(foundIsbn13)
  }

  const primaryIsbn = clean1 || clean2 || foundIsbn10 || foundIsbn13 || ''

  return {
    isbn: primaryIsbn,
    isbn10: foundIsbn10,
    isbn13: foundIsbn13,
  }
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
  const rawIsbn = getField('ISBN', 'isbn')
  const rawIsbn13 = getField('ISBN13', 'isbn13', 'isbn 13', 'isbn_13')
  const { isbn, isbn10, isbn13 } = resolveBookIsbns({ isbn: rawIsbn, isbn13: rawIsbn13 })
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
  const defaultCoverUrl = isbn
    ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
    : isbn13
      ? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`
      : isbn10
        ? `https://covers.openlibrary.org/b/isbn/${isbn10}-L.jpg`
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
    isbn10,
    isbn13,
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
