import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractGoodreadsUserId,
  buildGoodreadsApiUrl,
  buildBookShareUrl,
  parseGoodreadsCsv,
  normalizeCsvBook,
  matchesShelf,
  getFinishedBooksTotals,
  getRouteStateFromPath,
  isRootPath,
  cleanCsvValue,
  convertIsbn10To13,
  convertIsbn13To10,
  resolveBookIsbns,
  normalizeSearchText,
  matchesBookSearch,
} from './goodreads.js'
import uploadCsvHandler, { parseCsvForDatabase, isAllowedShelf } from '../../api/uploadcsv.js'
import getUserBooksHandler from '../../api/goodreads/[userId].js'
import coverHandler from '../../api/cover.js'
import isbnHandler, {
  buildGoogleBooksQuery,
  extractCoverFromVolume,
  extractIsbnFromVolume,
  extractPublishedYearFromVolume,
  extractPageCountFromVolume,
  extractDescriptionFromVolume,
  extractMainCategoryFromVolume,
  searchGoogleBooks,
} from '../../api/isbn.js'
import profileHandler from '../../api/profile.js'
import shelvesHandler, { saveBookToShelf, removeBookFromShelf, getBookShelfStatus, getUserShelves, rateBook } from '../../api/shelves.js'
import searchHandler, { searchGoogleBooksVolumes } from '../../api/search.js'
import collectionsHandler, {
  createCollection,
  addBookToCollection,
  removeBookFromCollection,
  deleteCollection,
  updateCollectionPrivacy,
  updateCollectionTitle,
  updateCollection,
  getUserCollections,
  getExploreCollections,
  getUserCollectionSummaries,
  getBookCollectionIds,
} from '../../api/collections.js'
import feedHandler, {
  recordFeedEvent,
  getFeedEvents,
  ensureFeedEventsTable,
} from '../../api/feed.js'

const createMockRes = () => {
  const res = {
    statusCode: 0,
    payload: null,
    headers: {},
    setHeader(name, value) {
      res.headers[name] = value
    },
    status(code) {
      res.statusCode = code
      return res
    },
    json(payload) {
      res.payload = payload
      return res
    },
  }
  return res
}

test('get books endpoint joins covers and returns all shelves', async () => {
  const req = {
    method: 'GET',
    query: { userId: 'abcd1234' },
    async dbQuery(sqlText, values) {
      req.capturedSql = sqlText
      req.capturedValues = values
      return [
        {
          display_name: 'Alin',
          book_id: '10884',
          title: 'Einstein',
          author: 'Walter Isaacson',
          isbn: '0743264738',
          my_rating: 4,
          number_of_pages: 675,
          original_publication_year: 2007,
          description: 'A great biography of Albert Einstein',
          main_category: 'Biography & Autobiography',
          date_read: '2026/10/10',
          date_added: '2026/10/09',
          bookshelves: 'read',
          spoiler: false,
          cover_url: 'https://blob.vercel-storage.com/covers/0743264738.jpg',
        },
        {
          display_name: 'Alin',
          book_id: '555',
          title: 'No Cover Book',
          author: 'Someone',
          isbn: '0345391802',
          my_rating: 3,
          bookshelves: '',
          spoiler: false,
          cover_url: null,
        },
        {
          display_name: 'Alin',
          book_id: '777',
          title: 'Future Read',
          author: 'Someone Else',
          bookshelves: 'to-read',
          spoiler: false,
          cover_url: null,
        },
      ]
    },
  }
  const res = createMockRes()

  await getUserBooksHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(req.capturedValues, ['abcd1234'])
  assert.match(req.capturedSql, /LEFT JOIN user_shelves us ON us\.user_id = u\.user_id/)
  assert.match(req.capturedSql, /LEFT JOIN books b ON b\.book_id = us\.book_id/)
  assert.match(req.capturedSql, /LEFT JOIN covers c ON c\.isbn = b\.isbn/)
  assert.equal(res.payload.username, 'Alin')
  assert.equal(res.payload.books.length, 3)
  assert.equal(res.payload.books[0].imageUrl, 'https://blob.vercel-storage.com/covers/0743264738.jpg')
  assert.equal(res.payload.books[0].pages, 675)
  assert.equal(res.payload.books[0].description, 'A great biography of Albert Einstein')
  assert.equal(res.payload.books[0].mainCategory, 'Biography & Autobiography')
  assert.equal(typeof res.payload.books[0].bookshelves, 'string')
  assert.equal(res.payload.books[0].bookshelves, 'read')
  assert.equal(res.payload.books[0].hasBookshelvesField, undefined)
  assert.equal(res.payload.books[0].bookshelf, undefined)
  assert.equal(res.payload.books[1].imageUrl, '')
  assert.equal(res.payload.books[2].bookId, '777')
  assert.equal(res.payload.books[2].bookshelves, 'to-read')
  assert.equal(res.payload.books[2].imageUrl, '')
})

test('get books endpoint rejects invalid user ids and returns 404 for unknown users', async () => {
  const badRes = createMockRes()
  await getUserBooksHandler({ method: 'GET', query: { userId: 'nope' } }, badRes)
  assert.equal(badRes.statusCode, 400)

  const missingRes = createMockRes()
  await getUserBooksHandler(
    { method: 'GET', query: { userId: 'zzzz9999' }, dbQuery: async () => [] },
    missingRes,
  )
  assert.equal(missingRes.statusCode, 404)
})

test('extracts user id from Goodreads homepage URL', () => {
  assert.equal(
    extractGoodreadsUserId('https://www.goodreads.com/user/show/18354013-Test_User'),
    '18354013',
  )
})

test('extracts user id from a /{user_id} pathname', () => {
  assert.equal(extractGoodreadsUserId('/18354013'), '18354013')
})

test('extracts user id from nested /{user_id}/{shelf} pathname', () => {
  assert.equal(extractGoodreadsUserId('/18354013/read'), '18354013')
  assert.equal(extractGoodreadsUserId('/18354013/read/12345'), '18354013')
})

test('builds a same-origin Goodreads API URL for the browser', () => {
  assert.equal(buildGoodreadsApiUrl('/18354013'), '/api/goodreads/18354013')
})

test('returns an empty API URL when no user id can be found', () => {
  assert.equal(buildGoodreadsApiUrl('/'), '')
})

test('builds a book share URL with the Goodreads user, shelf, and book id', () => {
  assert.equal(
    buildBookShareUrl('18354013', 'read', '123456', 'https://example.com'),
    'https://example.com/18354013/read/123456',
  )
})

test('isRootPath identifies root vs user profile paths', () => {
  assert.equal(isRootPath(''), true)
  assert.equal(isRootPath('/'), true)
  assert.equal(isRootPath('///'), true)
  assert.equal(isRootPath('/18354013'), false)
  assert.equal(isRootPath('/v48k1p9x'), false)
  assert.equal(isRootPath('/v48k1p9x/read'), false)
  assert.equal(isRootPath('/other-user/to-read/12345'), false)
})

test('getRouteStateFromPath extracts correct route info without false redirects', () => {
  assert.deepEqual(getRouteStateFromPath('/'), {
    userId: '',
    shelf: 'read',
    bookId: '',
  })
  assert.deepEqual(getRouteStateFromPath('/v48k1p9x'), {
    userId: 'v48k1p9x',
    shelf: 'read',
    bookId: '',
  })
  assert.deepEqual(getRouteStateFromPath('/v48k1p9x/to-read'), {
    userId: 'v48k1p9x',
    shelf: 'to-read',
    bookId: '',
  })
  assert.deepEqual(getRouteStateFromPath('/v48k1p9x/read/9999'), {
    userId: 'v48k1p9x',
    shelf: 'read',
    bookId: '9999',
  })
})

test('parses exported Goodreads CSV rows into normalized book objects', () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,My Review,Spoiler',
    '10884,"Einstein: His Life and Universe",Walter Isaacson,"=""0743264738""",4,Simon & Schuster,Hardcover,675,2007,2026/10/10,2026/10/09,"februarie-2019, biography","Great biography, very detailed.",false',
    '27833670,Dark Matter,Blake Crouch,"=""1101904224""",0,Crown,Hardcover,342,2016,,2026/10/15,to-read,,',
  ].join('\n')

  const books = parseGoodreadsCsv(csv)

  assert.equal(books.length, 2)

  assert.equal(books[0].bookId, '10884')
  assert.equal(books[0].title, 'Einstein: His Life and Universe')
  assert.equal(books[0].author, 'Walter Isaacson')
  assert.equal(books[0].isbn, '0743264738')
  assert.equal(books[0].rating, 4)
  assert.equal(books[0].publisher, 'Simon & Schuster')
  assert.equal(books[0].binding, 'Hardcover')
  assert.equal(books[0].pages, 675)
  assert.equal(books[0].publishedYear, 2007)
  assert.equal(books[0].readAt, '2026/10/10')
  assert.equal(books[0].dateAdded, '2026/10/09')
  assert.equal(typeof books[0].bookshelves, 'string')
  assert.equal(books[0].bookshelves, 'februarie-2019, biography')
  assert.equal(books[0].hasBookshelvesField, undefined)
  assert.equal(books[0].bookshelf, undefined)
  assert.equal(books[0].review, 'Great biography, very detailed.')
  assert.equal(books[0].spoiler, false)
  assert.equal(books[0].link, 'https://www.goodreads.com/book/show/10884')
  assert.equal(matchesShelf(books[0], 'read'), true)
  assert.equal(matchesShelf(books[0], 'to-read'), false)

  assert.equal(books[1].bookId, '27833670')
  assert.equal(books[1].title, 'Dark Matter')
  assert.equal(typeof books[1].bookshelves, 'string')
  assert.equal(books[1].bookshelves, 'to-read')
  assert.equal(matchesShelf(books[1], 'to-read'), true)
  assert.equal(matchesShelf(books[1], 'read'), false)
})

test('normalizes a CSV-keyed book object directly', () => {
  const book = normalizeCsvBook({
    'Book Id': '42',
    Title: 'The Hitchhiker\'s Guide to the Galaxy',
    Author: 'Douglas Adams',
    ISBN: '="0345391802"',
    'My Rating': '5',
    Publisher: 'Del Rey',
    Binding: 'Paperback',
    'Number of Pages': '224',
    'Original Publication Year': '1979',
    'Date Read': '2026/05/01',
    'Date Added': '2026/04/20',
    Bookshelves: 'currently-reading',
    'My Review': 'Don\'t Panic',
    Spoiler: 'true',
  })

  assert.equal(book.bookId, '42')
  assert.equal(book.rating, 5)
  assert.equal(book.pages, 224)
  assert.equal(book.publishedYear, 1979)
  assert.equal(book.spoiler, true)
  assert.equal(typeof book.bookshelves, 'string')
  assert.equal(book.bookshelves, 'currently-reading')
  assert.equal(book.hasBookshelvesField, undefined)
  assert.equal(book.bookshelf, undefined)
  assert.equal(book.imageUrl, '')
  assert.equal(matchesShelf(book, 'currently-reading'), true)
})

test('counts completed books and pages finished in a given year', () => {
  const books = [
    { pages: 320, readAt: '2026/01/10' },
    { pages: 280, readAt: '2026/08/12' },
    { pages: 410, readAt: '2025/12/31' },
    { pages: 225, readAt: '2026/02/03' },
    { pages: 144, readAt: '2024/11/04' },
  ]

  const summary = getFinishedBooksTotals(books, 2026)

  assert.equal(summary.count, 3)
  assert.equal(summary.totalPages, 320 + 280 + 225)
})

test('uploadcsv lambda handler parses multipart form-data CSV and returns parsed books', async () => {
  const boundary = '----GoodreadsCsvBoundary123'
  const csvContent = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,My Review,Spoiler',
    '10884,"Einstein: His Life and Universe",Walter Isaacson,"=""0743264738""",4,Simon & Schuster,Hardcover,675,2007,2026/10/10,2026/10/09,read,"Great biography",false',
  ].join('\r\n')

  const multipartBody = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="authUserId"',
    '',
    'auth-user-1234',
    `--${boundary}`,
    'Content-Disposition: form-data; name="displayName"',
    '',
    'Alin',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="goodreads_library_export.csv"',
    'Content-Type: text/csv',
    '',
    csvContent,
    `--${boundary}--`,
  ].join('\r\n')

  const req = {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.from(multipartBody, 'utf8'),
    capturedQueries: [],
    async dbQuery(sqlText, values) {
      req.capturedQueries.push({ sqlText, values })
    },
  }

  let statusCode = 0
  let jsonPayload = null
  const headers = {}
  const res = {
    setHeader(name, value) {
      headers[name] = value
    },
    status(code) {
      statusCode = code
      return this
    },
    json(payload) {
      jsonPayload = payload
      return this
    },
  }

  await uploadCsvHandler(req, res)

  assert.equal(statusCode, 200)
  assert.equal(jsonPayload.username, 'Alin')
  assert.match(jsonPayload.userId, /^[a-z0-9]{8}$/)
  assert.match(headers['Set-Cookie'], new RegExp(`userId=${jsonPayload.userId}`))
  assert.equal(jsonPayload.count, 1)
  assert.equal(jsonPayload.books[0].bookId, '10884')
  assert.equal(jsonPayload.books[0].title, 'Einstein: His Life and Universe')
  assert.equal(jsonPayload.books[0].pages, 675)

  const insertUserQuery = req.capturedQueries.find((q) => q.sqlText.includes('INSERT INTO users'))
  assert.ok(insertUserQuery)
  assert.deepEqual(insertUserQuery.values, [jsonPayload.userId, 'Alin', 'auth-user-1234'])
  assert.equal(insertUserQuery.sqlText.includes('last_access'), false)

  const deleteShelvesQuery = req.capturedQueries.find((q) => q.sqlText.includes('DELETE FROM user_shelves'))
  assert.ok(deleteShelvesQuery)
  assert.deepEqual(deleteShelvesQuery.values, [jsonPayload.userId])

  const insertBookQuery = req.capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.match(
    insertBookQuery.sqlText,
    /INSERT INTO books \(book_id, title, author, isbn, publisher, binding, number_of_pages, original_publication_year, description, main_category, google_books_queried\)/,
  )
  assert.deepEqual(insertBookQuery.values, [
    '10884',
    'Einstein: His Life and Universe',
    'Walter Isaacson',
    '0743264738',
    'Simon & Schuster',
    'Hardcover',
    675,
    2007,
    null,
    null,
    true,
  ])

  const insertShelfQuery = req.capturedQueries.find((q) => q.sqlText.includes('INSERT INTO user_shelves'))
  assert.ok(insertShelfQuery)
  assert.deepEqual(insertShelfQuery.values, [
    jsonPayload.userId,
    '10884',
    'read',
    4,
    '2026-10-10',
    '2026-10-09',
    'Great biography',
    false,
  ])

  // Subsequent upload with existing 8-char userId in cookie reuses it
  const secondReq = {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: `userId=${jsonPayload.userId}`,
    },
    body: Buffer.from(multipartBody, 'utf8'),
    capturedQueries: [],
    async dbQuery(sqlText, values) {
      secondReq.capturedQueries.push({ sqlText, values })
    },
  }
  let secondPayload = null
  const secondRes = {
    setHeader() { },
    status() {
      return this
    },
    json(payload) {
      secondPayload = payload
      return this
    },
  }

  await uploadCsvHandler(secondReq, secondRes)
  assert.equal(secondPayload.userId, jsonPayload.userId)
  const secondInsertUser = secondReq.capturedQueries.find((q) => q.sqlText.includes('INSERT INTO users'))
  assert.ok(secondInsertUser)
  assert.deepEqual(secondInsertUser.values, [jsonPayload.userId, 'Alin', 'auth-user-1234'])
  assert.equal(secondInsertUser.sqlText.includes('last_access'), false)
  const secondDeleteShelves = secondReq.capturedQueries.find((q) => q.sqlText.includes('DELETE FROM user_shelves'))
  assert.ok(secondDeleteShelves)
  assert.deepEqual(secondDeleteShelves.values, [jsonPayload.userId])
  assert.ok(secondReq.capturedQueries.some((q) => q.sqlText.includes('INSERT INTO books')))
  const secondInsertShelf = secondReq.capturedQueries.find((q) => q.sqlText.includes('INSERT INTO user_shelves'))
  assert.ok(secondInsertShelf)
  assert.equal(secondInsertShelf.values[0], jsonPayload.userId)

  // Third upload with isNewUser: true generates a fresh userId even with existing cookie
  const thirdReq = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `userId=${jsonPayload.userId}`,
    },
    body: JSON.stringify({
      displayName: 'Alin 2',
      csv: csvContent,
      isNewUser: true,
      authUserId: 'auth-user-5678',
    }),
    capturedQueries: [],
    async dbQuery(sqlText, values) {
      thirdReq.capturedQueries.push({ sqlText, values })
    },
  }
  let thirdPayload = null
  const thirdRes = {
    setHeader() { },
    status() {
      return this
    },
    json(payload) {
      thirdPayload = payload
      return this
    },
  }

  await uploadCsvHandler(thirdReq, thirdRes)
  assert.notEqual(thirdPayload.userId, jsonPayload.userId)
  assert.match(thirdPayload.userId, /^[a-z0-9]{8}$/)
  assert.equal(thirdPayload.username, 'Alin 2')
})

test('uploadcsv only saves books on allowed shelves: to-read, read, currently-reading, and did-not-finish', () => {
  assert.equal(isAllowedShelf('read'), true)
  assert.equal(isAllowedShelf('to-read'), true)
  assert.equal(isAllowedShelf('currently-reading'), true)
  assert.equal(isAllowedShelf('did-not-finish'), true)
  assert.equal(isAllowedShelf('did not finish'), true)
  assert.equal(isAllowedShelf('favorites'), false)
  assert.equal(isAllowedShelf(''), false)
  assert.equal(isAllowedShelf('wishlist'), false)

  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '1,Book One,Author 1,111,5,Pub,Paperback,200,2020,2020/01/01,2020/01/01,read,,,false',
    '2,Book Two,Author 2,222,0,Pub,Paperback,300,2021,,2021/01/01,to-read,,,false',
    '3,Book Three,Author 3,333,0,Pub,Paperback,250,2022,,2022/01/01,currently-reading,,,false',
    '4,Book Four,Author 4,444,2,Pub,Paperback,150,2023,,2023/01/01,did-not-finish,,,false',
    '5,Book Five,Author 5,555,2,Pub,Paperback,180,2023,,2023/01/01,did not finish,,,false',
    '6,Book Six,Author 6,666,4,Pub,Paperback,400,2024,,2024/01/01,favorites,,,false',
    '7,Book Seven,Author 7,777,0,Pub,Paperback,350,2024,,2024/01/01,,,,false',
  ].join('\n')

  const { dbRows, books } = parseCsvForDatabase(csv)
  assert.equal(dbRows.length, 5)
  assert.equal(books.length, 5)

  const savedIds = dbRows.map((r) => r.book_id)
  assert.deepEqual(savedIds, ['1', '2', '3', '4', '5'])
  assert.equal(dbRows[3].bookshelves, 'did-not-finish')
  assert.equal(dbRows[4].bookshelves, 'did-not-finish')
})

test('uploadcsv picks up shelf from Bookshelves with positions when Bookshelves is empty', () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '10,Book Ten,Author 10,1010,4,Pub,Paperback,200,2020,2020/01/01,2020/01/01,,"read (#1)",,false',
    '20,Book Twenty,Author 20,2020,5,Pub,Paperback,250,2021,,2021/01/01,,"to-read (#5)",,false',
    '30,Book Thirty,Author 30,3030,3,Pub,Paperback,180,2022,,2022/01/01,,"currently-reading (#2)",,false',
    '40,Book Forty,Author 40,4040,2,Pub,Paperback,150,2023,,2023/01/01,,"did-not-finish (#1)",,false',
  ].join('\n')

  const { dbRows, books } = parseCsvForDatabase(csv)
  assert.equal(dbRows.length, 4)
  assert.equal(dbRows[0].bookshelves, 'read')
  assert.equal(dbRows[1].bookshelves, 'to-read')
  assert.equal(dbRows[2].bookshelves, 'currently-reading')
  assert.equal(dbRows[3].bookshelves, 'did-not-finish')
  assert.equal(books[0].bookshelves, 'read')
})

test('uploadcsv enriches missing ISBN via Google Books API during import', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '99,Sapiens,Yuval Noah Harari,,5,Harper,Paperback,443,2014,2021/01/01,2021/01/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            volumeInfo: {
              title: 'Sapiens',
              authors: ['Yuval Noah Harari'],
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780062316097' },
              ],
              imageLinks: {
                thumbnail: 'http://books.google.com/sapiens.jpg&edge=curl',
              },
            },
          },
        ],
      }
    },
  })

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Reader',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.books[0].isbn, '9780062316097')
  assert.equal(
    res.payload.books[0].imageUrl,
    'https://books.google.com/sapiens.jpg',
  )

  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes('9780062316097'))

  const insertCoverQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(insertCoverQuery)
  assert.deepEqual(insertCoverQuery.values, [
    '9780062316097',
    'https://books.google.com/sapiens.jpg',
  ])
})

test('cover endpoint rejects invalid methods and missing fields', async () => {
  const getRes = createMockRes()
  await coverHandler({ method: 'GET' }, getRes)
  assert.equal(getRes.statusCode, 405)

  const noIsbnRes = createMockRes()
  await coverHandler(
    {
      method: 'POST',
      body: { isbn: '', image: 'abc' },
    },
    noIsbnRes,
  )
  assert.equal(noIsbnRes.statusCode, 400)
  assert.match(noIsbnRes.payload.error, /ISBN is required/)

  const noFileRes = createMockRes()
  await coverHandler(
    {
      method: 'POST',
      body: { isbn: '0743264738', image: '' },
    },
    noFileRes,
  )
  assert.equal(noFileRes.statusCode, 400)
  assert.match(noFileRes.payload.error, /image file is required/i)
})

test('cover endpoint saves binary image to vercel blob and upserts into covers table', async () => {
  const boundary = '----CoverBoundaryXYZ'
  const fakeImageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="isbn"\r\n\r\n0743264738\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    fakeImageBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])

  let capturedBlobCall = null
  const capturedQueries = []

  const req = {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody,
    async blobPut(path, data, options) {
      capturedBlobCall = { path, data, options }
      return { url: `https://mock.blob.vercel-storage.com/${path}` }
    },
    async dbQuery(sqlText, values) {
      capturedQueries.push({ sqlText, values })
    },
  }
  const res = createMockRes()

  await coverHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(res.payload.isbn, '0743264738')
  assert.equal(res.payload.url, 'https://mock.blob.vercel-storage.com/covers/0743264738.jpg')

  assert.equal(capturedBlobCall.path, 'covers/0743264738.jpg')
  assert.deepEqual(capturedBlobCall.data, fakeImageBytes)
  assert.equal(capturedBlobCall.options.access, 'public')

  const upsertQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(upsertQuery)
  assert.deepEqual(upsertQuery.values, ['0743264738', 'https://mock.blob.vercel-storage.com/covers/0743264738.jpg'])
})

test('cover endpoint accepts JSON base64 image data and saves to blob and db', async () => {
  const fakeImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const base64Data = fakeImageBytes.toString('base64')

  let capturedBlobCall = null
  const capturedQueries = []

  const req = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: {
      isbn: '978-0143127741',
      dataUrl: `data:image/png;base64,${base64Data}`,
    },
    async blobPut(path, data, options) {
      capturedBlobCall = { path, data, options }
      return { url: `https://mock.blob.vercel-storage.com/${path}` }
    },
    async dbQuery(sqlText, values) {
      capturedQueries.push({ sqlText, values })
    },
  }
  const res = createMockRes()

  await coverHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.isbn, '9780143127741')
  assert.equal(capturedBlobCall.path, 'covers/9780143127741.jpg')
  assert.equal(capturedBlobCall.options.contentType, 'image/png')
  assert.deepEqual(capturedBlobCall.data, fakeImageBytes)

  const upsertQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(upsertQuery)
  assert.equal(upsertQuery.values[0], '9780143127741')
})

test('extractCoverFromVolume upgrades to HTTPS, strips &edge=curl, and selects highest resolution', () => {
  const item = {
    volumeInfo: {
      imageLinks: {
        smallThumbnail: 'http://books.google.com/small.jpg',
        thumbnail: 'http://books.google.com/thumb.jpg&edge=curl',
        medium: 'http://books.google.com/medium.jpg&edge=curl',
      },
    },
  }
  assert.equal(
    extractCoverFromVolume(item),
    'https://books.google.com/medium.jpg',
  )
  assert.equal(extractCoverFromVolume({}), null)
})

test('buildGoogleBooksQuery formats intitle and inauthor', () => {
  assert.equal(
    buildGoogleBooksQuery('Project Hail Mary', 'Andy Weir'),
    'intitle:Project Hail Mary inauthor:Andy Weir',
  )
  assert.equal(buildGoogleBooksQuery('1984'), 'intitle:1984')
  assert.equal(buildGoogleBooksQuery(''), '')
})

test('extractIsbnFromVolume prioritizes ISBN_13 over ISBN_10', () => {
  const volumeWithBoth = {
    volumeInfo: {
      industryIdentifiers: [
        { type: 'ISBN_10', identifier: '0553418025' },
        { type: 'ISBN_13', identifier: '978-0553418026' },
      ],
    },
  }
  assert.equal(extractIsbnFromVolume(volumeWithBoth), '9780553418026')

  const volumeWith10Only = {
    volumeInfo: {
      industryIdentifiers: [{ type: 'ISBN_10', identifier: '0-553-41802-5' }],
    },
  }
  assert.equal(extractIsbnFromVolume(volumeWith10Only), '0553418025')

  assert.equal(extractIsbnFromVolume({}), null)
})

test('searchGoogleBooks queries Google Books API and extracts ISBN', async () => {
  let requestedUrl = ''
  const mockFetch = async (url) => {
    requestedUrl = url
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'The Martian',
                authors: ['Andy Weir'],
                industryIdentifiers: [
                  { type: 'ISBN_13', identifier: '978-0553418026' },
                ],
                imageLinks: {
                  thumbnail: 'http://books.google.com/martian.jpg',
                },
              },
            },
          ],
        }
      },
    }
  }

  const result = await searchGoogleBooks({
    title: 'The Martian',
    author: 'Andy Weir',
    apiKey: 'test-api-key',
    fetchFn: mockFetch,
  })

  assert.ok(result)
  assert.equal(result.isbn, '9780553418026')
  assert.equal(result.title, 'The Martian')
  assert.equal(result.author, 'Andy Weir')
  assert.equal(result.thumbnail, 'https://books.google.com/martian.jpg')
  assert.ok(requestedUrl.includes('key=test-api-key'))
  assert.ok(requestedUrl.includes('intitle%3AThe%20Martian'))
})

test('isbn lambda handler returns 400 when title is missing', async () => {
  const req = {
    method: 'GET',
    query: {},
  }
  const res = createMockRes()

  await isbnHandler(req, res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.payload.error, 'Book title is required.')
})

test('isbn lambda handler returns 405 for unsupported HTTP methods', async () => {
  const req = {
    method: 'DELETE',
  }
  const res = createMockRes()

  await isbnHandler(req, res)

  assert.equal(res.statusCode, 405)
})

test('isbn lambda handler queries Google Books API and updates DB if userId & bookId provided', async () => {
  const capturedDbQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedDbQueries.push({ sqlText, values })
    return [{ book_id: 'book123', title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719' }]
  }

  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            volumeInfo: {
              title: 'Dune',
              authors: ['Frank Herbert'],
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '978-0441172719' },
              ],
              imageLinks: {
                thumbnail: 'http://books.google.com/dune.jpg&edge=curl',
              },
            },
          },
        ],
      }
    },
  })

  const req = {
    method: 'GET',
    query: {
      title: 'Dune',
      author: 'Frank Herbert',
      userId: 'testuser',
      bookId: 'book123',
    },
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await isbnHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(res.payload.isbn, '9780441172719')
  assert.equal(res.payload.coverUrl, 'https://books.google.com/dune.jpg')
  assert.equal(res.payload.updated, true)

  const updateQuery = capturedDbQueries.find((q) => q.sqlText.includes('UPDATE books'))
  assert.ok(updateQuery)
  assert.deepEqual(updateQuery.values, ['9780441172719', 'book123'])

  const coverQuery = capturedDbQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(coverQuery)
  assert.deepEqual(coverQuery.values, ['9780441172719', 'https://books.google.com/dune.jpg'])
})

test('isbn lambda handler supports backfill mode for user books', async () => {
  const capturedDbQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedDbQueries.push({ sqlText, values })
    if (sqlText.includes('b.book_id') || sqlText.includes('SELECT book_id')) {
      return [
        { book_id: 'b1', title: 'Foundation', author: 'Isaac Asimov' },
        { book_id: 'b2', title: 'Solaris', author: 'Stanislaw Lem' },
      ]
    }
    return [{ book_id: values[1], isbn: values[0] }]
  }

  const mockFetch = async (url) => ({
    ok: true,
    async json() {
      const isSolaris = url.includes('Solaris')
      return {
        items: [
          {
            volumeInfo: {
              title: isSolaris ? 'Solaris' : 'Foundation',
              authors: [isSolaris ? 'Stanislaw Lem' : 'Isaac Asimov'],
              industryIdentifiers: [
                {
                  type: 'ISBN_13',
                  identifier: isSolaris ? '9780156027601' : '9780553293357',
                },
              ],
            },
          },
        ],
      }
    },
  })

  const req = {
    method: 'POST',
    body: {
      backfill: true,
      userId: 'user1234',
    },
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await isbnHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(res.payload.updatedCount, 2)
  assert.equal(res.payload.scannedCount, 2)
  assert.equal(res.payload.books.length, 2)
})

test('profile endpoint generates new profile url for new login user id and associates it', async () => {
  const usersDb = []

  const mockDbQuery = async (sql, values = []) => {
    if (sql.includes('ALTER TABLE') || sql.includes('CREATE UNIQUE INDEX')) {
      return []
    }
    if (sql.includes('FROM users WHERE auth_user_id = $1')) {
      const match = usersDb.find((u) => u.auth_user_id === values[0])
      return match ? [match] : []
    }
    if (sql.includes('INSERT INTO users')) {
      const newUser = {
        user_id: values[0],
        display_name: values[1],
        auth_user_id: values[2],
      }
      usersDb.push(newUser)
      return [newUser]
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { host: 'localhost:5173' },
    body: {
      authUserId: 'supa-uuid-1',
      email: 'alex@example.com',
      displayName: 'Alex',
    },
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await profileHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.isNew, true)
  assert.equal(res.payload.displayName, 'alex')
  assert.match(res.payload.userId, /^[a-z0-9]{8}$/)
  assert.equal(res.payload.profileUrl, `http://localhost:5173/${res.payload.userId}`)
  assert.ok(res.headers['Set-Cookie'].includes(`userId=${res.payload.userId}`))
  assert.equal(usersDb.length, 1)
  assert.equal(usersDb[0].auth_user_id, 'supa-uuid-1')
})

test('profile endpoint returns existing profile url when same auth user id logs in', async () => {
  const usersDb = [
    {
      user_id: 'existing1',
      display_name: 'Existing User',
      auth_user_id: 'supa-uuid-2',
    },
  ]

  const mockDbQuery = async (sql, values = []) => {
    if (sql.includes('ALTER TABLE') || sql.includes('CREATE UNIQUE INDEX')) {
      return []
    }
    if (sql.includes('FROM users WHERE auth_user_id = $1')) {
      const match = usersDb.find((u) => u.auth_user_id === values[0])
      return match ? [match] : []
    }
    if (sql.includes('UPDATE users SET last_access')) {
      return []
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { host: 'localhost:5173' },
    body: {
      authUserId: 'supa-uuid-2',
      email: 'user2@example.com',
    },
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await profileHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.isNew, false)
  assert.equal(res.payload.userId, 'existing1')
  assert.equal(res.payload.displayName, 'Existing User')
  assert.equal(res.payload.profileUrl, 'http://localhost:5173/existing1')
})

test('profile endpoint claims unassociated existing user id when user logs in', async () => {
  const usersDb = [
    {
      user_id: 'anon1234',
      display_name: 'Anonymous Library',
      auth_user_id: null,
    },
  ]

  const mockDbQuery = async (sql, values = []) => {
    if (sql.includes('ALTER TABLE') || sql.includes('CREATE UNIQUE INDEX')) {
      return []
    }
    if (sql.includes('FROM users WHERE auth_user_id = $1')) {
      const match = usersDb.find((u) => u.auth_user_id === values[0])
      return match ? [match] : []
    }
    if (sql.includes('FROM users WHERE user_id = $1')) {
      const match = usersDb.find((u) => u.user_id === values[0])
      return match ? [match] : []
    }
    if (sql.includes('UPDATE users\n           SET auth_user_id = $1')) {
      const match = usersDb.find((u) => u.user_id === values[2])
      if (match) {
        match.auth_user_id = values[0]
        if (values[1]) match.display_name = values[1]
      }
      return []
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { host: 'localhost:5173' },
    body: {
      authUserId: 'supa-uuid-3',
      displayName: 'Claimed User',
      existingUserId: 'anon1234',
    },
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await profileHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.isNew, true)
  assert.equal(res.payload.userId, 'anon1234')
  assert.equal(res.payload.displayName, 'Claimed User')
  assert.equal(usersDb[0].auth_user_id, 'supa-uuid-3')
})

test('profile endpoint validates authUserId and methods', async () => {
  const res1 = createMockRes()
  await profileHandler({ method: 'DELETE' }, res1)
  assert.equal(res1.statusCode, 405)

  const res2 = createMockRes()
  await profileHandler({ method: 'POST', body: {} }, res2)
  assert.equal(res2.statusCode, 400)
  assert.equal(res2.payload.error, 'authUserId is required.')
})

test('profile endpoint defaults initial display name to email prefix without domain on first login', async () => {
  const usersDb = []

  const mockDbQuery = async (sql, values = []) => {
    if (sql.includes('ALTER TABLE') || sql.includes('CREATE UNIQUE INDEX')) {
      return []
    }
    if (sql.includes('FROM users WHERE auth_user_id = $1')) {
      return []
    }
    if (sql.includes('INSERT INTO users')) {
      const newUser = {
        user_id: values[0],
        display_name: values[1],
        auth_user_id: values[2],
      }
      usersDb.push(newUser)
      return [newUser]
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { host: 'localhost:5173' },
    body: {
      authUserId: 'supa-uuid-4',
      email: 'marius.ionescu@company.org',
    },
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await profileHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.displayName, 'marius.ionescu')
  assert.equal(usersDb[0].display_name, 'marius.ionescu')
})

test('profile endpoint updates display name on PATCH', async () => {
  const usersDb = [
    {
      user_id: 'user1234',
      display_name: 'Old Name',
      auth_user_id: 'supa-uuid-5',
    },
  ]

  const mockDbQuery = async (sql, values = []) => {
    if (sql.includes('ALTER TABLE') || sql.includes('CREATE UNIQUE INDEX')) {
      return []
    }
    if (sql.includes('UPDATE users')) {
      const target = usersDb.find((u) => u.user_id === values[1] || u.auth_user_id === values[2])
      if (target) {
        target.display_name = values[0]
      }
      return []
    }
    return []
  }

  const req = {
    method: 'PATCH',
    body: {
      userId: 'user1234',
      displayName: 'New Awesome Name',
    },
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await profileHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(res.payload.displayName, 'New Awesome Name')
  assert.equal(usersDb[0].display_name, 'New Awesome Name')
})

test('profile endpoint updates description on PATCH', async () => {
  const usersDb = [
    {
      user_id: 'user1234',
      display_name: 'Alin',
      description: 'Old Description',
      auth_user_id: 'supa-uuid-5',
    },
  ]

  const mockDbQuery = async (sql, values = []) => {
    if (sql.includes('ALTER TABLE') || sql.includes('CREATE UNIQUE INDEX')) {
      return []
    }
    if (sql.includes('UPDATE users')) {
      const target = usersDb.find((u) => u.user_id === values[1] || u.auth_user_id === values[2])
      if (target) {
        target.description = values[0]
      }
      return []
    }
    return []
  }

  const req = {
    method: 'PATCH',
    body: {
      userId: 'user1234',
      description: 'Pasionat de SF și literatură clasică',
    },
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await profileHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(res.payload.description, 'Pasionat de SF și literatură clasică')
  assert.equal(usersDb[0].description, 'Pasionat de SF și literatură clasică')
})

test('shelves endpoint validates input parameters', async () => {
  await assert.rejects(
    () => saveBookToShelf({ userId: 'invalid', bookId: '123', shelf: 'to-read' }),
    /8-character user id/,
  )

  await assert.rejects(
    () => saveBookToShelf({ userId: 'user1234', bookId: '', shelf: 'to-read' }),
    /Book id is required/,
  )

  await assert.rejects(
    () => saveBookToShelf({ userId: 'user1234', bookId: '123', shelf: 'invalid-shelf' }),
    /Invalid shelf/,
  )
})

test('saveBookToShelf saves canonical book and upserts user_shelves', async () => {
  const executedQueries = []
  const mockDbQuery = async (sql, values) => {
    executedQueries.push({ sql, values })
    if (sql.includes('INSERT INTO user_shelves')) {
      return [{ user_id: values[0], book_id: values[1], bookshelves: values[2] }]
    }
    return []
  }

  const result = await saveBookToShelf({
    userId: 'user1234',
    bookId: 'book999',
    shelf: 'to-read',
    book: {
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      pages: 412,
      publishedYear: 1965,
    },
    queryFn: mockDbQuery,
  })

  assert.equal(result.success, true)
  assert.equal(result.userId, 'user1234')
  assert.equal(result.bookId, 'book999')
  assert.equal(result.shelf, 'to-read')

  assert.equal(executedQueries.length, 3)
  assert.match(executedQueries[0].sql, /INSERT INTO books/)
  assert.deepEqual(executedQueries[0].values, [
    'book999',
    'Dune',
    'Frank Herbert',
    '9780441172719',
    '',
    '',
    412,
    1965,
    null,
    null,
  ])

  assert.match(executedQueries[1].sql, /INSERT INTO user_shelves/)
  assert.deepEqual(executedQueries[1].values, ['user1234', 'book999', 'to-read'])
  assert.match(executedQueries[2].sql, /INSERT INTO feed_events/)
})

test('saveBookToShelf sets date_read to CURRENT_DATE when shelf is read', async () => {
  const executedQueries = []
  const mockDbQuery = async (sql, values) => {
    executedQueries.push({ sql, values })
    if (sql.includes('INSERT INTO user_shelves')) {
      return [{
        user_id: values[0],
        book_id: values[1],
        bookshelves: values[2],
        date_read: '2026/11/21',
      }]
    }
    return []
  }

  const result = await saveBookToShelf({
    userId: 'user1234',
    bookId: 'book999',
    shelf: 'read',
    book: {
      title: 'Dune',
      author: 'Frank Herbert',
    },
    queryFn: mockDbQuery,
  })

  assert.equal(result.success, true)
  assert.equal(result.shelf, 'read')
  assert.equal(result.dateRead, '2026/11/21')
  assert.match(executedQueries[1].sql, /date_read/)
  assert.match(executedQueries[1].sql, /CASE WHEN \$3 = 'read' THEN CURRENT_DATE ELSE NULL END/)
  assert.match(executedQueries[1].sql, /CASE WHEN EXCLUDED\.bookshelves = 'read' THEN CURRENT_DATE ELSE NULL END/)
})

test('rateBook sets date_read to CURRENT_DATE on read shelf for new books', async () => {
  const executedQueries = []
  const mockDbQuery = async (sql, values) => {
    executedQueries.push({ sql, values })
    if (sql.includes('SELECT bookshelves FROM user_shelves')) {
      return []
    }
    if (sql.includes('INSERT INTO user_shelves')) {
      return [{
        user_id: values[0],
        book_id: values[1],
        bookshelves: 'read',
        my_rating: values[2],
        date_read: '2026/11/21',
      }]
    }
    return []
  }

  const result = await rateBook({
    userId: 'user1234',
    bookId: 'book999',
    rating: 5,
    queryFn: mockDbQuery,
  })

  assert.equal(result.success, true)
  assert.equal(result.shelf, 'read')
  assert.equal(result.myRating, 5)
  assert.equal(result.dateRead, '2026/11/21')
  assert.match(executedQueries[1].sql, /CURRENT_DATE/)
})

test('getBookShelfStatus returns shelf status for user book', async () => {
  const shelvesDb = [{ user_id: 'user1234', book_id: 'book999', bookshelves: 'currently-reading' }]
  const mockDbQuery = async (sql, values) => {
    const match = shelvesDb.find((s) => s.user_id === values[0] && s.book_id === values[1])
    return match ? [match] : []
  }

  const found = await getBookShelfStatus({
    userId: 'user1234',
    bookId: 'book999',
    queryFn: mockDbQuery,
  })
  assert.equal(found.onShelf, true)
  assert.equal(found.shelf, 'currently-reading')

  const missing = await getBookShelfStatus({
    userId: 'user1234',
    bookId: 'unknown',
    queryFn: mockDbQuery,
  })
  assert.equal(missing.onShelf, false)
  assert.equal(missing.shelf, null)
})

test('removeBookFromShelf deletes entry from user_shelves table', async () => {
  const executedQueries = []
  const mockDbQuery = async (sql, values) => {
    executedQueries.push({ sql, values })
    if (sql.includes('DELETE FROM user_shelves')) {
      return [{ user_id: values[0], book_id: values[1] }]
    }
    return []
  }

  const result = await removeBookFromShelf({
    userId: 'user1234',
    bookId: 'book999',
    queryFn: mockDbQuery,
  })

  assert.equal(result.success, true)
  assert.equal(result.removed, true)
  assert.equal(result.userId, 'user1234')
  assert.equal(result.bookId, 'book999')
  assert.equal(executedQueries.length, 1)
  assert.match(executedQueries[0].sql, /DELETE FROM user_shelves/)
  assert.deepEqual(executedQueries[0].values, ['user1234', 'book999'])
})

test('shelves handler handles GET, POST, DELETE, and rejects unsupported methods', async () => {
  const mockDbQuery = async (sql, values) => {
    if (sql.includes('SELECT bookshelves')) {
      return [{ bookshelves: 'read' }]
    }
    if (sql.includes('INSERT INTO user_shelves')) {
      return [{ user_id: values[0], book_id: values[1], bookshelves: values[2] }]
    }
    if (sql.includes('UPDATE user_shelves')) {
      return [{ bookshelves: 'read', my_rating: values[2] }]
    }
    if (sql.includes('DELETE FROM user_shelves')) {
      return [{ user_id: values[0], book_id: values[1] }]
    }
    return []
  }

  // GET
  const getReq = {
    method: 'GET',
    query: { userId: 'user1234', bookId: 'b1' },
    dbQuery: mockDbQuery,
  }
  const getRes = createMockRes()
  await shelvesHandler(getReq, getRes)
  assert.equal(getRes.statusCode, 200)
  assert.equal(getRes.payload.onShelf, true)
  assert.equal(getRes.payload.shelf, 'read')

  // POST (save)
  const postReq = {
    method: 'POST',
    body: {
      userId: 'user1234',
      bookId: 'b1',
      shelf: 'currently-reading',
      book: { title: 'Book 1' },
    },
    dbQuery: mockDbQuery,
  }
  const postRes = createMockRes()
  await shelvesHandler(postReq, postRes)
  assert.equal(postRes.statusCode, 200)
  assert.equal(postRes.payload.success, true)
  assert.equal(postRes.payload.shelf, 'currently-reading')

  // POST with action remove
  const postRemoveReq = {
    method: 'POST',
    body: {
      userId: 'user1234',
      bookId: 'b1',
      action: 'remove',
    },
    dbQuery: mockDbQuery,
  }
  const postRemoveRes = createMockRes()
  await shelvesHandler(postRemoveReq, postRemoveRes)
  assert.equal(postRemoveRes.statusCode, 200)
  assert.equal(postRemoveRes.payload.success, true)
  assert.equal(postRemoveRes.payload.removed, true)

  // DELETE
  const delReq = {
    method: 'DELETE',
    body: {
      userId: 'user1234',
      bookId: 'b1',
    },
    dbQuery: mockDbQuery,
  }
  const delRes = createMockRes()
  await shelvesHandler(delReq, delRes)
  assert.equal(delRes.statusCode, 200)
  assert.equal(delRes.payload.success, true)
  assert.equal(delRes.payload.removed, true)

  // PUT -> 405
  const putRes = createMockRes()
  await shelvesHandler({ method: 'PUT' }, putRes)
  assert.equal(putRes.statusCode, 405)

  // POST with action rate
  const postRateReq = {
    method: 'POST',
    body: {
      userId: 'user1234',
      bookId: 'b1',
      action: 'rate',
      rating: 4,
    },
    dbQuery: mockDbQuery,
  }
  const postRateRes = createMockRes()
  await shelvesHandler(postRateReq, postRateRes)
  assert.equal(postRateRes.statusCode, 200)
  assert.equal(postRateRes.payload.success, true)
  assert.equal(postRateRes.payload.myRating, 4)
})

test('rateBook updates rating in user_shelves or inserts read shelf entry', async () => {
  const executed = []
  const mockDbQuery = async (sql, values) => {
    executed.push({ sql, values })
    if (sql.includes('SELECT bookshelves')) {
      return [{ bookshelves: 'read' }]
    }
    if (sql.includes('UPDATE user_shelves')) {
      return [{ bookshelves: 'read', my_rating: values[2] }]
    }
    return []
  }

  const result = await rateBook({
    userId: 'user1234',
    bookId: 'book456',
    rating: 5,
    queryFn: mockDbQuery,
  })

  assert.equal(result.success, true)
  assert.equal(result.userId, 'user1234')
  assert.equal(result.bookId, 'book456')
  assert.equal(result.shelf, 'read')
  assert.equal(result.myRating, 5)
  assert.equal(executed.length, 3)
  assert.match(executed[1].sql, /UPDATE user_shelves/)
  assert.deepEqual(executed[1].values, ['user1234', 'book456', 5])
  assert.match(executed[2].sql, /INSERT INTO feed_events/)
})

test('getUserShelves returns all user books alongside their reviews at page load', async () => {
  const mockDbQuery = async (sql, values) => {
    assert.deepEqual(values, ['user1234'])
    return [
      {
        book_id: '10884',
        shelf: 'read',
        my_rating: 5,
        my_review: 'Brilliant biography of Einstein',
        spoiler: false,
        date_read: '2026/01/15',
        date_added: '2025/12/01',
        title: 'Einstein',
        author: 'Walter Isaacson',
        isbn: '0743264738',
      },
      {
        book_id: '99999',
        shelf: 'to-read',
        my_rating: 0,
        my_review: '',
        spoiler: false,
        date_read: null,
        date_added: '2026/02/01',
        title: 'Dune',
        author: 'Frank Herbert',
        isbn: '9780441172719',
      },
    ]
  }

  const result = await getUserShelves({
    userId: 'user1234',
    queryFn: mockDbQuery,
  })

  assert.equal(result.userId, 'user1234')
  assert.equal(result.count, 2)
  assert.equal(result.books.length, 2)
  assert.equal(result.books[0].myReview, 'Brilliant biography of Einstein')
  assert.equal(result.shelvesByBookId['10884'].shelf, 'read')
  assert.equal(result.shelvesByBookId['10884'].myReview, 'Brilliant biography of Einstein')
  assert.equal(result.shelvesByBookId['99999'].shelf, 'to-read')

  // GET without bookId returns all user shelves at page load
  const getReq = {
    method: 'GET',
    query: { userId: 'user1234' },
    dbQuery: mockDbQuery,
  }
  const getRes = createMockRes()
  await shelvesHandler(getReq, getRes)
  assert.equal(getRes.statusCode, 200)
  assert.equal(getRes.payload.count, 2)
  assert.equal(getRes.payload.shelvesByBookId['10884'].myReview, 'Brilliant biography of Einstein')
})

test('correctly parses Excel-escaped ISBN and ISBN13 columns and derives both', async () => {
  const sampleRow = [
    'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
    '54396808,Unstoppable: Siggi B. Wilzig\'s Astonishing Journey from Auschwitz Survivor and Penniless Immigrant to Wall Street Legend,Joshua M. Greene,"Greene, Joshua M.",Deborah E. Lipstadt,"=""164722215X""","=""9781647222154""",0,Insight Editions,Hardcover,352,2021,,,2026/10/22,currently-reading,currently-reading (#1),currently-reading,,,,1,0',
  ].join('\n')

  const { dbRows, books } = parseCsvForDatabase(sampleRow)

  assert.equal(dbRows.length, 1)
  assert.equal(books.length, 1)

  const book = books[0]
  assert.equal(book.bookId, '54396808')
  assert.equal(book.isbn, '164722215X')
  assert.equal(book.isbn10, '164722215X')
  assert.equal(book.isbn13, '9781647222154')
  assert.equal(book.bookshelves, 'currently-reading')

  // Verify ISBN conversion algorithms
  assert.equal(convertIsbn10To13('164722215X'), '9781647222154')
  assert.equal(convertIsbn13To10('9781647222154'), '164722215X')

  // Verify derivation when only ISBN13 is provided
  const onlyIsbn13 = resolveBookIsbns({ isbn: '="""', isbn13: '="9781647222154"' })
  assert.equal(onlyIsbn13.isbn, '9781647222154')
  assert.equal(onlyIsbn13.isbn13, '9781647222154')
  assert.equal(onlyIsbn13.isbn10, '164722215X')

  // Verify cleanCsvValue strips =, quotes, and double quotes
  assert.equal(cleanCsvValue('="164722215X"'), '164722215X')
  assert.equal(cleanCsvValue('="=""164722215X"""'), '164722215X')
  assert.equal(cleanCsvValue('="""'), '')
  assert.equal(cleanCsvValue('=""'), '')
})

test('extractPublishedYearFromVolume and extractPageCountFromVolume correctly parse Google volume info', () => {
  const vol1 = {
    volumeInfo: {
      publishedDate: '2005-11-15',
      pageCount: 207,
    },
  }
  assert.equal(extractPublishedYearFromVolume(vol1), 2005)
  assert.equal(extractPageCountFromVolume(vol1), 207)

  const vol2 = {
    volumeInfo: {
      publishedDate: '1998',
      pageCount: '350',
    },
  }
  assert.equal(extractPublishedYearFromVolume(vol2), 1998)
  assert.equal(extractPageCountFromVolume(vol2), 350)

  const emptyVol = { volumeInfo: {} }
  assert.equal(extractPublishedYearFromVolume(emptyVol), null)
  assert.equal(extractPageCountFromVolume(emptyVol), null)
  assert.equal(extractPublishedYearFromVolume(null), null)
  assert.equal(extractPageCountFromVolume(null), null)
})

test('searchGoogleBooks returns publishedDate, publishedYear, and pageCount from Google Books API', async () => {
  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            volumeInfo: {
              title: 'Harry Potter and the Half-Blood Prince',
              authors: ['J.K. Rowling'],
              publishedDate: '2005-11-15',
              pageCount: 207,
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780439784542' },
              ],
              imageLinks: {
                thumbnail: 'https://books.google.com/hp6.jpg',
              },
            },
          },
        ],
      }
    },
  })

  const result = await searchGoogleBooks({
    title: 'Harry Potter and the Half-Blood Prince',
    author: 'J.K. Rowling',
    isbn: '9780439784542',
    fetchFn: mockFetch,
  })

  assert.ok(result)
  assert.equal(result.publishedDate, '2005-11-15')
  assert.equal(result.publishedYear, 2005)
  assert.equal(result.pageCount, 207)
  assert.equal(result.isbn, '9780439784542')
})

test('uploadcsv fills in publication year and number of pages when CSV does not contain them', async () => {
  // CSV with empty Number of Pages and empty Original Publication Year
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '777,The Road,Cormac McCarthy,9780307387899,5,Vintage,Paperback,,,2022/05/01,2022/05/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const mockFetch = async (url) => {
    if (typeof url === 'string' && url.includes('covers.openlibrary.org')) {
      return { ok: false, status: 404 }
    }
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'The Road',
                authors: ['Cormac McCarthy'],
                publishedDate: '2005-11-15',
                pageCount: 207,
                industryIdentifiers: [
                  { type: 'ISBN_13', identifier: '9780307387899' },
                ],
                imageLinks: {
                  thumbnail: 'https://books.google.com/theroad.jpg',
                },
              },
            },
          ],
        }
      },
    }
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Bookworm',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.books.length, 1)

  const returnedBook = res.payload.books[0]
  assert.equal(returnedBook.publishedYear, 2005)
  assert.equal(returnedBook.pages, 207)
  assert.equal(returnedBook.thickness, 26) // Math.round(207 / 8) = 26
  assert.equal(returnedBook.imageUrl, 'https://books.google.com/theroad.jpg')

  // Verify database insertion for books table contains number_of_pages = 207 and original_publication_year = 2005
  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes(207), 'DB insert values should include number_of_pages: 207')
  assert.ok(insertBookQuery.values.includes(2005), 'DB insert values should include original_publication_year: 2005')

  const insertCoverQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(insertCoverQuery, 'Should insert cover into covers table')
  assert.ok(insertCoverQuery.values.includes('https://books.google.com/theroad.jpg'))
})

test('uploadcsv does NOT overwrite publication year or number of pages if CSV already contains them', async () => {
  // CSV with existing Number of Pages (350) and Original Publication Year (2012)
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '888,Already Filled Book,Famous Author,,4,Penguin,Paperback,350,2012,2022/05/01,2022/05/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  // Google Books returns different publishedDate (2005-11-15) and pageCount (207)
  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            volumeInfo: {
              title: 'Already Filled Book',
              authors: ['Famous Author'],
              publishedDate: '2005-11-15',
              pageCount: 207,
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780143127741' },
              ],
            },
          },
        ],
      }
    },
  })

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Bookworm',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  const returnedBook = res.payload.books[0]
  // Should keep original CSV values: 350 pages and year 2012
  assert.equal(returnedBook.pages, 350)
  assert.equal(returnedBook.publishedYear, 2012)
  // But ISBN was enriched
  assert.equal(returnedBook.isbn, '9780143127741')

  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes(350))
  assert.ok(insertBookQuery.values.includes(2012))
})

test('uploadcsv uses Year Published when Original Publication Year is empty in CSV', () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves',
    '999,Sample Book,Author Name,1234567890,5,Pub,Paperback,250,2019,,2022/01/01,2022/01/01,read',
  ].join('\n')

  const { dbRows, books } = parseCsvForDatabase(csv)
  assert.equal(dbRows.length, 1)
  assert.equal(dbRows[0].original_publication_year, 2019)
  assert.equal(books[0].publishedYear, 2019)
})

test('uploadcsv falls back to Google Books cover when Open Library has no cover', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '101,Meditations,Marcus Aurelius,9780140449334,5,Penguin,Paperback,,180,2023/01/01,2023/01/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const mockFetch = async (url) => {
    if (typeof url === 'string' && url.includes('covers.openlibrary.org')) {
      return { ok: false, status: 404 }
    }
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'Meditations',
                authors: ['Marcus Aurelius'],
                publishedDate: '2006-04-27',
                pageCount: 304,
                industryIdentifiers: [
                  { type: 'ISBN_13', identifier: '9780140449334' },
                ],
                imageLinks: {
                  thumbnail: 'https://books.google.com/meditations.jpg&edge=curl',
                },
              },
            },
          ],
        }
      },
    }
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Philosopher',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  const book = res.payload.books[0]
  assert.equal(book.imageUrl, 'https://books.google.com/meditations.jpg')

  const insertCover = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(insertCover, 'Should save discovered cover to DB')
  assert.ok(insertCover.values.includes('https://books.google.com/meditations.jpg'))
})

test('uploadcsv prioritizes Open Library cover when ISBN is present and skips Google Books', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '102,Meditations OL,Marcus Aurelius,9780140449334,5,Penguin,Paperback,300,180,2023/01/01,2023/01/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const calls = []
  const mockFetch = async (url) => {
    calls.push(url)
    if (typeof url === 'string' && url.includes('covers.openlibrary.org')) {
      return { ok: true, status: 200 }
    }
    return { ok: false, status: 500 }
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Philosopher',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  const book = res.payload.books[0]
  assert.equal(book.imageUrl, 'https://covers.openlibrary.org/b/isbn/9780140449334-L.jpg')
  assert.equal(
    calls.some((u) => u.includes('googleapis.com')),
    false,
    'Must NOT query Google Books when Open Library has cover',
  )

  const insertCover = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(insertCover, 'Should save Open Library cover to DB')
  assert.ok(insertCover.values.includes('https://covers.openlibrary.org/b/isbn/9780140449334-L.jpg'))
})

test('searchGoogleBooks continues to title search to find cover if exact ISBN volume lacks cover', async () => {
  const calls = []
  const mockFetch = async (url) => {
    calls.push(url)
    if (url.includes('q=isbn:')) {
      // First call by ISBN has no imageLinks
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                volumeInfo: {
                  title: 'Dune',
                  authors: ['Frank Herbert'],
                  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172719' }],
                  pageCount: 658,
                },
              },
            ],
          }
        },
      }
    }

    // Subsequent search by title has imageLinks
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'Dune',
                authors: ['Frank Herbert'],
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172719' }],
                imageLinks: {
                  thumbnail: 'http://books.google.com/dune_cover.jpg',
                },
              },
            },
          ],
        }
      },
    }
  }

  const result = await searchGoogleBooks({
    title: 'Dune',
    author: 'Frank Herbert',
    isbn: '9780441172719',
    fetchFn: mockFetch,
  })

  assert.ok(result)
  assert.equal(result.coverUrl, 'https://books.google.com/dune_cover.jpg')
  assert.equal(result.pageCount, 658)
  assert.ok(calls.length >= 2, 'Should have continued to title search to pick up the cover')
})

test('uploadcsv queries Google only for books that are not already in the database from other users', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '101,Existing Book,Known Author,,5,PublisherA,Paperback,,,2023/01/01,2023/01/01,read,,,false',
    '202,New Book,Fresh Author,,4,PublisherB,Paperback,,,2023/01/02,2023/01/02,read,,,false',
  ].join('\n')

  const googleCalls = []
  const mockFetch = async (url) => {
    googleCalls.push(url)
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'New Book',
                authors: ['Fresh Author'],
                publishedDate: '2021-05-10',
                pageCount: 310,
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9789999999999' }],
                imageLinks: { thumbnail: 'https://books.google.com/new_book.jpg' },
              },
            },
          ],
        }
      },
    }
  }

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    // When checking for existing books in DB, return '101' as already in DB
    if (sqlText.includes('FROM books b') && sqlText.includes('WHERE b.book_id = ANY')) {
      return [
        {
          book_id: '101',
          title: 'Existing Book',
          author: 'Known Author',
          isbn: '9780123456789',
          number_of_pages: 420,
          original_publication_year: 2018,
          cover_url: 'https://covers.database.com/existing_book.jpg',
        },
      ]
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Collector',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.books.length, 2)

  // Book 1 (Existing Book) was populated from DB
  const book1 = res.payload.books.find((b) => b.bookId === '101')
  assert.ok(book1)
  assert.equal(book1.isbn, '9780123456789')
  assert.equal(book1.pages, 420)
  assert.equal(book1.publishedYear, 2018)
  assert.equal(book1.imageUrl, 'https://covers.database.com/existing_book.jpg')

  // Book 2 (New Book) was populated from Google Books
  const book2 = res.payload.books.find((b) => b.bookId === '202')
  assert.ok(book2)
  assert.equal(book2.isbn, '9789999999999')
  assert.equal(book2.pages, 310)
  assert.equal(book2.publishedYear, 2021)
  assert.equal(book2.imageUrl, 'https://books.google.com/new_book.jpg')

  // Google Books API must ONLY have been queried for the book not in DB (New Book), NEVER for Existing Book!
  assert.ok(googleCalls.length > 0, 'Google should be called for new books')
  for (const callUrl of googleCalls) {
    assert.ok(!callUrl.includes('Existing'), 'Google should NOT be called for existing books')
    assert.ok(!callUrl.includes('Known'), 'Google should NOT be called for known authors')
  }
})

test('extractDescriptionFromVolume and extractMainCategoryFromVolume correctly parse Google volume info', () => {
  assert.equal(
    extractDescriptionFromVolume({
      volumeInfo: { description: '  An epic post-apocalyptic journey.  ' },
    }),
    'An epic post-apocalyptic journey.',
  )
  assert.equal(
    extractDescriptionFromVolume({
      volumeInfo: { description: 'A'.repeat(600) },
    }),
    'A'.repeat(500),
  )
  assert.equal(extractDescriptionFromVolume(null), null)
  assert.equal(extractDescriptionFromVolume({ volumeInfo: {} }), null)

  assert.equal(
    extractMainCategoryFromVolume({
      volumeInfo: { mainCategory: 'Fiction' },
    }),
    'Fiction',
  )
  assert.equal(
    extractMainCategoryFromVolume({
      volumeInfo: { categories: ['Science Fiction & Fantasy', 'Adventure'] },
    }),
    'Science Fiction & Fantasy',
  )
  assert.equal(extractMainCategoryFromVolume(null), null)
})

test('searchGoogleBooks returns description and mainCategory from Google Books API', async () => {
  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            volumeInfo: {
              title: 'Dune',
              authors: ['Frank Herbert'],
              description: 'Set on the desert planet Arrakis...',
              mainCategory: 'Science Fiction',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172719' }],
            },
          },
        ],
      }
    },
  })

  const result = await searchGoogleBooks({
    title: 'Dune',
    author: 'Frank Herbert',
    apiKey: 'fake-key',
    fetchFn: mockFetch,
  })
  assert.equal(result.description, 'Set on the desert planet Arrakis...')
  assert.equal(result.mainCategory, 'Science Fiction')
  assert.equal(result.isbn, '9780441172719')
})

test('uploadcsv enriches description and mainCategory from Google Books and saves to books table', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '303,Dune Messiah,Frank Herbert,,5,Ace,Paperback,336,1969,2023/01/01,2023/01/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            volumeInfo: {
              title: 'Dune Messiah',
              authors: ['Frank Herbert'],
              description: 'Dune Messiah continues the story of Paul Atreides...',
              categories: ['Fiction'],
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441102693' }],
              imageLinks: { thumbnail: 'http://books.google.com/dunemessiah.jpg' },
            },
          },
        ],
      }
    },
  })

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'ScifiFan',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.books.length, 1)

  const returnedBook = res.payload.books[0]
  assert.equal(returnedBook.description, 'Dune Messiah continues the story of Paul Atreides...')
  assert.equal(returnedBook.mainCategory, 'Fiction')

  // Verify database insertion for books table contains description and main_category
  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(
    insertBookQuery.values.includes('Dune Messiah continues the story of Paul Atreides...'),
    'DB insert values should include description',
  )
  assert.ok(insertBookQuery.values.includes('Fiction'), 'DB insert values should include main_category')
})

test('description and mainCategory only come from google books not csv', () => {
  // CSV with rogue Description and Main Category columns
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Description,Main Category',
    '404,Some Book,Some Author,9781234567890,5,Pub,Paperback,200,2020,2023/01/01,2023/01/01,read,CSV rogue description,CSV rogue category',
  ].join('\n')

  const { dbRows, books } = parseCsvForDatabase(csv)
  assert.equal(dbRows.length, 1)
  // dbRows should NOT take description or main_category from CSV
  assert.equal(dbRows[0].description, null)
  assert.equal(dbRows[0].main_category, null)

  // books should NOT take description or mainCategory from CSV
  assert.equal(books.length, 1)
  assert.equal(books[0].description, '')
  assert.equal(books[0].mainCategory, '')

  // normalizeCsvBook with CSV header keys directly should also ignore Description and Main Category
  const normalized = normalizeCsvBook({
    'Book Id': '404',
    Title: 'Some Book',
    Description: 'CSV rogue description',
    'Main Category': 'CSV rogue category',
    category: 'another rogue category',
  })
  assert.equal(normalized.description, '')
  assert.equal(normalized.mainCategory, '')

  // But directly passing description and mainCategory properties (from Google Books or DB row) works:
  const withGoogleProps = normalizeCsvBook({
    'Book Id': '404',
    Title: 'Some Book',
    description: 'Real Google Books Description',
    mainCategory: 'Science Fiction',
  })
  assert.equal(withGoogleProps.description, 'Real Google Books Description')
  assert.equal(withGoogleProps.mainCategory, 'Science Fiction')
})

test('uploadcsv calls google books when Open Library has no cover to fill in description and mainCategory', async () => {
  // CSV book already has ISBN, Pages, and Publication Year
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '505,Project Hail Mary,Andy Weir,9780593135204,5,Ballantine,Hardcover,496,2021,2023/05/01,2023/05/01,read,,,false',
  ].join('\n')

  const googleCalls = []
  const mockFetch = async (url) => {
    if (typeof url === 'string' && url.includes('covers.openlibrary.org')) {
      return { ok: false, status: 404 }
    }
    googleCalls.push(url)
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'Project Hail Mary',
                authors: ['Andy Weir'],
                description: 'Ryland Grace is the sole survivor on a desperate mission...',
                mainCategory: 'Science Fiction',
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780593135204' }],
                imageLinks: { thumbnail: 'https://books.google.com/hailmary.jpg' },
              },
            },
          ],
        }
      },
    }
  }

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Astronaut',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(googleCalls.length, 1, 'Should call Google Books for the book to get description and category')
  assert.ok(googleCalls[0].includes('isbn:9780593135204'), 'Should query Google Books by ISBN')

  const returnedBook = res.payload.books[0]
  assert.equal(returnedBook.description, 'Ryland Grace is the sole survivor on a desperate mission...')
  assert.equal(returnedBook.mainCategory, 'Science Fiction')
  assert.equal(returnedBook.pages, 496, 'Should keep original CSV pages')
  assert.equal(returnedBook.publishedYear, 2021, 'Should keep original CSV year')

  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes('Ryland Grace is the sole survivor on a desperate mission...'))
  assert.ok(insertBookQuery.values.includes('Science Fiction'))
})

test('uploadcsv when isbn is required uses description and category from that single request without making a second request', async () => {
  // CSV book has NO ISBN
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '606,Neuromancer,William Gibson,,5,Ace,Paperback,271,1984,2023/06/01,2023/06/01,read,,,false',
  ].join('\n')

  const googleCalls = []
  const mockFetch = async (url) => {
    googleCalls.push(url)
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'Neuromancer',
                authors: ['William Gibson'],
                description: 'Case was the sharpest data-thief in the matrix...',
                mainCategory: 'Cyberpunk',
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441569595' }],
                imageLinks: { thumbnail: 'https://books.google.com/neuromancer.jpg' },
              },
            },
          ],
        }
      },
    }
  }

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Hacker',
      csv,
      authUserId: 'mock-auth-user',
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  // Exactly ONE call was made to Google Books: it retrieved ISBN, description, category, and cover together!
  assert.equal(googleCalls.length, 1, 'Only one request to Google Books should be made!')

  const returnedBook = res.payload.books[0]
  assert.equal(returnedBook.isbn, '9780441569595', 'ISBN should be enriched')
  assert.equal(returnedBook.description, 'Case was the sharpest data-thief in the matrix...')
  assert.equal(returnedBook.mainCategory, 'Cyberpunk')
  assert.equal(returnedBook.imageUrl, 'https://books.google.com/neuromancer.jpg')

  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes('9780441569595'))
  assert.ok(insertBookQuery.values.includes('Case was the sharpest data-thief in the matrix...'))
  assert.ok(insertBookQuery.values.includes('Cyberpunk'))
})

test('uploadcsv limits the length of description text to 500 chars', async () => {
  const longDesc = 'A long time ago in a galaxy far, far away. '.repeat(20) // > 800 chars
  assert.ok(longDesc.length > 500)

  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '707,Star Wars,George Lucas,9780345260796,5,Del Rey,Paperback,260,1976,2023/07/01,2023/07/01,read,,,false',
  ].join('\n')

  const mockFetch = async (url) => {
    if (typeof url === 'string' && url.includes('covers.openlibrary.org')) {
      return { ok: false, status: 404 }
    }
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'Star Wars',
                authors: ['George Lucas'],
                description: longDesc,
                categories: ['Science Fiction'],
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780345260796' }],
              },
            },
          ],
        }
      },
    }
  }

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { displayName: 'Jedi', csv, authUserId: 'mock-auth-user' },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  const returnedBook = res.payload.books[0]
  assert.equal(returnedBook.description.length, 500)
  assert.equal(returnedBook.description, longDesc.slice(0, 500))

  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes(longDesc.slice(0, 500)))
})

test('uploadcsv rejects unauthenticated requests with 401', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '101,Some Book,Author,9780000000001,4,Publisher,Paperback,200,2020,2023/01/01,2023/01/01,read,,,false',
  ].join('\n')

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { csv }, // No authUserId
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 401)
  assert.match(res.payload.error, /unauthorized|authentication required/i)
})

test('uploadcsv allows request without displayName and does not update last_access', async () => {
  const csv = [
    'Book Id,Title,Author,ISBN,My Rating,Publisher,Binding,Number of Pages,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,My Review,Spoiler',
    '102,Fast Upload Book,Author,9780000000002,5,Publisher,Paperback,300,2021,2023/02/01,2023/02/01,read,,,false',
  ].join('\n')

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      csv,
      authUserId: 'authenticated-user-xyz',
      // No displayName!
    },
    googleBooksApiKey: 'mock-key',
    fetchFn: async () => ({ ok: false }),
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await uploadCsvHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.books.length, 1)

  // Verify that last_access was NOT in any query
  for (const query of capturedQueries) {
    assert.equal(query.sqlText.includes('last_access'), false, 'last_access must NOT be updated')
  }

  // Verify user insertion had no displayName requirement
  const insertUserQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO users'))
  assert.ok(insertUserQuery)
  assert.equal(insertUserQuery.values.includes('authenticated-user-xyz'), true)
})

test('searchGoogleBooksVolumes returns top 10 mapped books from Google Books', async () => {
  let requestedUrl = ''
  const mockFetch = async (url) => {
    requestedUrl = url
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              id: 'vol123',
              volumeInfo: {
                title: 'Dune',
                authors: ['Frank Herbert'],
                publishedDate: '1965-08-01',
                pageCount: 688,
                description: 'A masterpiece of science fiction.',
                mainCategory: 'Fiction',
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172719' }],
                imageLinks: { thumbnail: 'http://books.google.com/dune.jpg&edge=curl' },
                infoLink: 'https://books.google.com/dune',
              },
            },
          ],
        }
      },
    }
  }

  const results = await searchGoogleBooksVolumes({
    query: 'Dune',
    limit: 10,
    apiKey: 'test-key',
    fetchFn: mockFetch,
  })

  assert.ok(requestedUrl.includes('q=Dune'))
  assert.ok(requestedUrl.includes('maxResults=10'))
  assert.equal(results.length, 1)
  assert.equal(results[0].bookId, 'gb_vol123')
  assert.equal(results[0].title, 'Dune')
  assert.equal(results[0].author, 'Frank Herbert')
  assert.equal(results[0].publishedYear, 1965)
  assert.equal(results[0].pages, 688)
  assert.equal(results[0].description, 'A masterpiece of science fiction.')
  assert.equal(results[0].mainCategory, 'Fiction')
  assert.equal(results[0].isbn, '9780441172719')
  assert.equal(results[0].imageUrl, 'https://books.google.com/dune.jpg')
  assert.equal(results[0].link, 'https://books.google.com/dune')
})

test('search endpoint validates query and handles GET requests', async () => {
  const reqMissingQ = { method: 'GET', query: {} }
  const resMissingQ = createMockRes()
  await searchHandler(reqMissingQ, resMissingQ)
  assert.equal(resMissingQ.statusCode, 400)

  const reqPost = { method: 'POST', query: { q: 'Dune' } }
  const resPost = createMockRes()
  await searchHandler(reqPost, resPost)
  assert.equal(resPost.statusCode, 405)

  const mockFetch = async () => ({
    ok: true,
    async json() {
      return {
        items: [
          {
            id: 'gb_item1',
            volumeInfo: {
              title: 'Hyperion',
              authors: ['Dan Simmons'],
              publishedDate: '1989',
            },
          },
        ],
      }
    },
  })

  const reqValid = {
    method: 'GET',
    query: { q: 'Hyperion' },
    googleBooksApiKey: 'mock-key',
    fetchFn: mockFetch,
  }
  const resValid = createMockRes()
  await searchHandler(reqValid, resValid)
  assert.equal(resValid.statusCode, 200)
  assert.equal(resValid.payload.success, true)
  assert.equal(resValid.payload.books.length, 1)
  assert.equal(resValid.payload.books[0].title, 'Hyperion')
  assert.equal(resValid.payload.books[0].author, 'Dan Simmons')
  assert.equal(resValid.payload.books[0].publishedYear, 1989)
})

test('getRouteStateFromPath supports collections route', () => {
  assert.deepEqual(getRouteStateFromPath('/v48k1p9x/collections'), {
    userId: 'v48k1p9x',
    shelf: 'collections',
    bookId: '',
  })
})

test('collections endpoint creates collections, adds books, lists user & explore collections, and removes books', async () => {
  const capturedQueries = []
  const mockQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    if (sqlText.includes('INSERT INTO collections')) {
      return [
        {
          collection_id: 101,
          user_id: values[0],
          title: values[1],
          description: values[2],
          is_private: values[3],
          created_at: '2026-11-14T20:00:00Z',
        },
      ]
    }
      if (sqlText.includes('SELECT collection_id, user_id, title') || sqlText.includes('verified_collection')) {
        return [{ collection_count: 1, collection_id: 101, user_id: 'abcd1234', title: 'Top SF' }]
      }
      if (sqlText.includes('DELETE FROM collection_books')) {
        return [{ collection_id: 101, book_id: 'gb_dune' }]
      }
      if (sqlText.includes('FROM collections c')) {
        return [
          {
            collection_id: 101,
            user_id: 'abcd1234',
            collection_title: 'Top SF',
            collection_created_at: '2026-11-14T20:00:00Z',
            display_name: 'Alin',
            book_id: 'gb_dune',
            book_added_at: '2026-11-14T20:01:00Z',
            title: 'Dune',
            author: 'Frank Herbert',
            isbn: '9780441172719',
            number_of_pages: 688,
            original_publication_year: 1965,
            description: 'Arrakis sci-fi classic',
            main_category: 'Fiction',
            cover_url: 'https://books.google.com/dune.jpg',
          },
        ]
      }
      return []
    }

    // 1. Create collection (default public + 140 char description)
    const createRes = createMockRes()
    await collectionsHandler(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          action: 'create',
          userId: 'abcd1234',
          title: 'Top SF',
          description: 'My favorite sci-fi novels',
        },
        dbQuery: mockQuery,
      },
      createRes,
    )
    assert.equal(createRes.statusCode, 200)
    assert.equal(createRes.payload.collection.id, '101')
    assert.equal(createRes.payload.collection.title, 'Top SF')
    assert.equal(createRes.payload.collection.description, 'My favorite sci-fi novels')
    assert.equal(createRes.payload.collection.isPrivate, false)

    // 2. Add book to collection
    const addBookRes = createMockRes()
    await collectionsHandler(
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          action: 'add-book',
          userId: 'abcd1234',
          collectionId: 101,
          bookId: 'gb_dune',
          book: {
            title: 'Dune',
            author: 'Frank Herbert',
            isbn: '9780441172719',
            pages: 688,
            publishedYear: 1965,
            description: 'Arrakis sci-fi classic',
            mainCategory: 'Fiction',
            coverUrl: 'https://books.google.com/dune.jpg',
          },
        },
        dbQuery: mockQuery,
      },
      addBookRes,
    )
    assert.equal(addBookRes.statusCode, 200)
    assert.equal(addBookRes.payload.bookId, 'gb_dune')

    // 3. Get user collections
    const getUserRes = createMockRes()
    await collectionsHandler(
      {
        method: 'GET',
        query: { userId: 'abcd1234' },
        dbQuery: mockQuery,
      },
      getUserRes,
    )
    assert.equal(getUserRes.statusCode, 200)
    assert.equal(getUserRes.payload.collections.length, 1)
    assert.equal(getUserRes.payload.collections[0].title, 'Top SF')
    assert.equal(getUserRes.payload.collections[0].books.length, 1)
    assert.equal(getUserRes.payload.collections[0].books[0].title, 'Dune')

    // 4. Get explore collections
    const getExploreRes = createMockRes()
    await collectionsHandler(
      {
        method: 'GET',
        query: { explore: 'true' },
        dbQuery: mockQuery,
      },
      getExploreRes,
    )
    assert.equal(getExploreRes.statusCode, 200)
    assert.equal(getExploreRes.payload.collections.length, 1)
    assert.equal(getExploreRes.payload.collections[0].username, 'Alin')

    // 5. Remove book from collection
    const removeBookRes = createMockRes()
    await collectionsHandler(
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: { userId: 'abcd1234', collectionId: 101, bookId: 'gb_dune' },
        dbQuery: mockQuery,
      },
      removeBookRes,
    )
    assert.equal(removeBookRes.statusCode, 200)
    assert.equal(removeBookRes.payload.removed, true)
  })

test('collections endpoint toggles collection privacy between private and public', async () => {
  let isPrivateState = false
  const mockQuery = async (sqlText, values) => {
    if (sqlText.includes('UPDATE collections')) {
      isPrivateState = Boolean(values[0])
      return [
        {
          collection_id: values[1],
          user_id: values[2],
          title: 'Top SF',
          description: 'Sci-fi collection',
          is_private: isPrivateState,
          created_at: '2026-11-14T20:00:00Z',
          updated_at: '2026-11-17T09:00:00Z',
        },
      ]
    }
    return []
  }

  // 1. Toggle to private via PATCH
  const patchRes = createMockRes()
  await collectionsHandler(
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: {
        userId: 'abcd1234',
        collectionId: '101',
        isPrivate: true,
      },
      dbQuery: mockQuery,
    },
    patchRes,
  )
  assert.equal(patchRes.statusCode, 200)
  assert.equal(patchRes.payload.success, true)
  assert.equal(patchRes.payload.isPrivate, true)
  assert.equal(patchRes.payload.collection.isPrivate, true)

  // 2. Toggle back to public via PATCH
  const patchResPublic = createMockRes()
  await collectionsHandler(
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: {
        userId: 'abcd1234',
        collectionId: '101',
        isPrivate: false,
      },
      dbQuery: mockQuery,
    },
    patchResPublic,
  )
  assert.equal(patchResPublic.statusCode, 200)
  assert.equal(patchResPublic.payload.success, true)
  assert.equal(patchResPublic.payload.isPrivate, false)
  assert.equal(patchResPublic.payload.collection.isPrivate, false)

  // 3. Toggle via POST action: 'update_privacy'
  const postRes = createMockRes()
  await collectionsHandler(
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        action: 'update_privacy',
        userId: 'abcd1234',
        collectionId: '101',
        isPrivate: true,
      },
      dbQuery: mockQuery,
    },
    postRes,
  )
  assert.equal(postRes.statusCode, 200)
  assert.equal(postRes.payload.success, true)
  assert.equal(postRes.payload.isPrivate, true)

  // 4. Unauthorized / not found error handling
  const unauthorizedRes = createMockRes()
  await collectionsHandler(
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: {
        userId: 'hack9999',
        collectionId: '101',
        isPrivate: false,
      },
      dbQuery: async () => [],
    },
    unauthorizedRes,
  )
  assert.equal(unauthorizedRes.statusCode, 400)
  assert.match(unauthorizedRes.payload.error, /unauthorized|not found/i)

  // 5. Direct call to updateCollectionPrivacy
  const directResult = await updateCollectionPrivacy({
    userId: 'abcd1234',
    collectionId: '101',
    isPrivate: true,
    queryFn: mockQuery,
  })
  assert.equal(directResult.success, true)
  assert.equal(directResult.isPrivate, true)
})

test('collections endpoint updates collection title via PATCH, POST, and direct function', async () => {
  let dbCollection = {
    collection_id: '101',
    user_id: 'abcd1234',
    title: 'Titlu Vechi',
    description: 'Descriere',
    is_private: false,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  }

  const mockQuery = async (sqlText, values) => {
    if (sqlText.includes('UPDATE collections') && sqlText.includes('title = $1')) {
      dbCollection = {
        ...dbCollection,
        title: values[0],
        updated_at: '2026-03-02T00:00:00Z',
      }
      return [dbCollection]
    }
    return []
  }

  // 1. Update title via PATCH
  const patchRes = createMockRes()
  await collectionsHandler(
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: {
        userId: 'abcd1234',
        collectionId: '101',
        title: 'SF Favorit',
      },
      dbQuery: mockQuery,
    },
    patchRes,
  )
  assert.equal(patchRes.statusCode, 200)
  assert.equal(patchRes.payload.success, true)
  assert.equal(patchRes.payload.title, 'SF Favorit')
  assert.equal(patchRes.payload.collection.title, 'SF Favorit')

  // 2. Update title via POST action: 'update_title'
  const postRes = createMockRes()
  await collectionsHandler(
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        action: 'update_title',
        userId: 'abcd1234',
        collectionId: '101',
        title: 'Fantasy Clasic',
      },
      dbQuery: mockQuery,
    },
    postRes,
  )
  assert.equal(postRes.statusCode, 200)
  assert.equal(postRes.payload.success, true)
  assert.equal(postRes.payload.title, 'Fantasy Clasic')

  // 3. Direct call to updateCollectionTitle
  const directResult = await updateCollectionTitle({
    userId: 'abcd1234',
    collectionId: '101',
    title: 'Non-Fiction',
    queryFn: mockQuery,
  })
  assert.equal(directResult.success, true)
  assert.equal(directResult.title, 'Non-Fiction')

  // 4. Reject empty title
  const emptyRes = createMockRes()
  await collectionsHandler(
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: {
        userId: 'abcd1234',
        collectionId: '101',
        title: '   ',
      },
      dbQuery: mockQuery,
    },
    emptyRes,
  )
  assert.equal(emptyRes.statusCode, 400)
  assert.match(emptyRes.payload.error, /title is required/i)

  // 5. Update title, description, and privacy together via PATCH
  const fullMockQuery = async (sqlText, values) => {
    if (sqlText.includes('UPDATE collections')) {
      dbCollection = {
        ...dbCollection,
        title: values[0],
        description: values[1],
        is_private: values[2],
        updated_at: '2026-03-03T00:00:00Z',
      }
      return [dbCollection]
    }
    return []
  }

  const editRes = createMockRes()
  await collectionsHandler(
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: {
        userId: 'abcd1234',
        collectionId: '101',
        title: 'SF & Fantasy Edit',
        description: 'Descriere nouă',
        isPrivate: true,
      },
      dbQuery: fullMockQuery,
    },
    editRes,
  )
  assert.equal(editRes.statusCode, 200)
  assert.equal(editRes.payload.success, true)
  assert.equal(editRes.payload.title, 'SF & Fantasy Edit')
  assert.equal(editRes.payload.isPrivate, true)
})

test('collections endpoint supports lightweight summaries and book membership checks', async () => {
  const collectionsTable = [
    { collection_id: '201', user_id: 'user1234', title: 'Top Sci-Fi' },
    { collection_id: '202', user_id: 'user1234', title: 'Favorit 2026' },
  ]
  const collectionBooksTable = [
    { collection_id: '201', book_id: 'book-999' },
  ]

  const mockQuery = async (sql, values = []) => {
    if (sql.includes('SELECT collection_id, title FROM collections WHERE user_id = $1')) {
      return collectionsTable.filter((c) => c.user_id === values[0])
    }
    if (sql.includes('SELECT DISTINCT c.collection_id')) {
      // values: [userId, bookId, isbn]
      const [uId, bId, isbn] = values
      return collectionBooksTable
        .filter((cb) => cb.book_id === bId)
        .map((cb) => ({ collection_id: cb.collection_id }))
    }
    return []
  }

  // 1. Direct getUserCollectionSummaries
  const summaries = await getUserCollectionSummaries({ userId: 'user1234', queryFn: mockQuery })
  assert.equal(summaries.length, 2)
  assert.equal(summaries[0].id, '201')
  assert.equal(summaries[0].title, 'Top Sci-Fi')

  // 2. Direct getBookCollectionIds
  const colIds = await getBookCollectionIds({
    userId: 'user1234',
    bookId: 'book-999',
    queryFn: mockQuery,
  })
  assert.deepEqual(colIds, ['201'])

  const emptyColIds = await getBookCollectionIds({
    userId: 'user1234',
    bookId: 'book-nonexistent',
    queryFn: mockQuery,
  })
  assert.deepEqual(emptyColIds, [])

  // 3. Handler GET with summary=true
  const summaryRes = createMockRes()
  await collectionsHandler(
    {
      method: 'GET',
      query: { userId: 'user1234', summary: 'true' },
      dbQuery: mockQuery,
    },
    summaryRes,
  )
  assert.equal(summaryRes.statusCode, 200)
  assert.equal(summaryRes.payload.success, true)
  assert.equal(summaryRes.payload.collections.length, 2)
  assert.equal(summaryRes.payload.collections[1].title, 'Favorit 2026')

  // 4. Handler GET with bookId
  const bookCheckRes = createMockRes()
  await collectionsHandler(
    {
      method: 'GET',
      query: { userId: 'user1234', bookId: 'book-999' },
      dbQuery: mockQuery,
    },
    bookCheckRes,
  )
  assert.equal(bookCheckRes.statusCode, 200)
  assert.equal(bookCheckRes.payload.success, true)
  assert.deepEqual(bookCheckRes.payload.collectionIds, ['201'])
})

test('isbn endpoint server-side check skips Google Books if google_books_queried is already true in DB', async () => {
  const fetchCalls = []
  const mockFetch = async (url) => {
    fetchCalls.push(url)
    return { ok: true, async json() { return { items: [] } } }
  }

  const mockDbQuery = async (sqlText, values) => {
    if (sqlText.includes('SELECT') && sqlText.includes('FROM books')) {
      return [
        {
          book_id: 'book-already-queried',
          title: 'Some Book',
          author: 'Some Author',
          isbn: '9781111111111',
          description: null, // Even with null description!
          main_category: null,
          google_books_queried: true, // Already queried previously
          cover_url: 'https://covers.database.com/book.jpg',
        },
      ]
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      bookId: 'book-already-queried',
      userId: 'testuser',
    },
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await isbnHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(fetchCalls.length, 0, 'Must NOT query Google Books because google_books_queried is true in DB')
})

test('isbn endpoint server-side check queries Google Books when google_books_queried is false and marks it true in DB', async () => {
  const fetchCalls = []
  const mockFetch = async (url) => {
    fetchCalls.push(url)
    return {
      ok: true,
      async json() {
        return {
          items: [
            {
              volumeInfo: {
                title: 'Unenriched Book',
                authors: ['New Author'],
                description: 'A fascinating story discovered on-demand.',
                mainCategory: 'History',
                industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782222222222' }],
              },
            },
          ],
        }
      },
    }
  }

  const capturedQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedQueries.push({ sqlText, values })
    if (sqlText.includes('SELECT') && sqlText.includes('FROM books')) {
      return [
        {
          book_id: 'book-needs-enrichment',
          title: 'Unenriched Book',
          author: 'New Author',
          isbn: '9782222222222',
          description: null,
          main_category: null,
          google_books_queried: false,
          cover_url: null,
        },
      ]
    }
    return []
  }

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      bookId: 'book-needs-enrichment',
      userId: 'testuser',
    },
    fetchFn: mockFetch,
    dbQuery: mockDbQuery,
  }
  const res = createMockRes()

  await isbnHandler(req, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.success, true)
  assert.equal(res.payload.description, 'A fascinating story discovered on-demand.')
  assert.equal(res.payload.mainCategory, 'History')
  assert.ok(fetchCalls.length >= 1, 'Should query Google Books because book has not been queried')

  const updateQuery = capturedQueries.find((q) => q.sqlText.includes('UPDATE books'))
  assert.ok(updateQuery, 'Should update books table')
  assert.ok(updateQuery.sqlText.includes('google_books_queried'), 'Should update google_books_queried in DB')
  assert.ok(updateQuery.values.includes(true), 'Should set google_books_queried to true in values')
})

test('matchesBookSearch performs client-side search across title, author, isbn, category and ignores diacritics', () => {
  const book = {
    title: 'Pădurea Spânzuraților',
    author: 'Liviu Rebreanu',
    publisher: 'Minerva',
    isbn: '9789732104567',
    mainCategory: 'Ficțiune',
  }

  // Matches title with and without diacritics
  assert.equal(matchesBookSearch(book, 'padurea'), true)
  assert.equal(matchesBookSearch(book, 'PĂDUREA'), true)
  assert.equal(matchesBookSearch(book, 'spanzur'), true)

  // Matches author
  assert.equal(matchesBookSearch(book, 'rebreanu'), true)
  assert.equal(matchesBookSearch(book, 'liviu'), true)

  // Matches multiple terms (author + title)
  assert.equal(matchesBookSearch(book, 'liviu padurea'), true)

  // Matches publisher and category
  assert.equal(matchesBookSearch(book, 'minerva'), true)
  assert.equal(matchesBookSearch(book, 'fictiune'), true)

  // Matches ISBN
  assert.equal(matchesBookSearch(book, '9789732104567'), true)

  // Empty query matches all
  assert.equal(matchesBookSearch(book, ''), true)
  assert.equal(matchesBookSearch(book, '   '), true)

  // Non-matching query
  assert.equal(matchesBookSearch(book, 'harry potter'), false)
  assert.equal(matchesBookSearch(null, 'padurea'), false)
})

test('recordFeedEvent records events to database', async () => {
  const captured = []
  const mockDbQuery = async (sql, values) => {
    captured.push({ sql, values })
    return [{ id: 1, user_id: values[0], event_type: values[1], created_at: new Date().toISOString() }]
  }

  const result = await recordFeedEvent({
    userId: 'user1234',
    eventType: 'shelf_add',
    bookId: 'book999',
    metadata: { shelf: 'to-read' },
    queryFn: mockDbQuery,
  })

  assert.equal(result.id, 1)
  assert.equal(result.user_id, 'user1234')
  assert.equal(result.event_type, 'shelf_add')
  assert.equal(captured.length, 1)
  assert.match(captured[0].sql, /INSERT INTO feed_events/)
  assert.equal(captured[0].values[0], 'user1234')
  assert.equal(captured[0].values[1], 'shelf_add')
  assert.equal(captured[0].values[2], 'book999')
})

test('getFeedEvents returns formatted events with limit 20 and filters private collections', async () => {
  const captured = []
  const mockRows = [
    {
      id: '10',
      user_id: 'user1234',
      username: 'Alex Reader',
      event_type: 'shelf_add',
      book_id: 'b1',
      book_title: 'Dune',
      book_author: 'Frank Herbert',
      book_isbn: '9780441172719',
      cover_url: 'https://example.com/dune.jpg',
      collection_id: null,
      collection_title: null,
      collection_description: null,
      collection_is_private: null,
      metadata: { shelf: 'read', rating: 5 },
      created_at: '2026-11-24T19:00:00Z',
    },
    {
      id: '9',
      user_id: 'user5678',
      username: 'Elena',
      event_type: 'collection_created',
      book_id: null,
      book_title: null,
      book_author: null,
      book_isbn: null,
      cover_url: '',
      collection_id: '42',
      collection_title: 'Sci-Fi Classics',
      collection_description: 'Best of space opera',
      collection_is_private: false,
      metadata: { title: 'Sci-Fi Classics' },
      created_at: '2026-11-24T18:30:00Z',
    },
    {
      id: '8',
      user_id: 'user1234',
      username: 'Alex Reader',
      event_type: 'csv_upload',
      book_id: null,
      book_title: null,
      book_author: null,
      book_isbn: null,
      cover_url: '',
      collection_id: null,
      collection_title: null,
      collection_description: null,
      collection_is_private: null,
      metadata: { bookCount: 142 },
      created_at: '2026-11-24T18:00:00Z',
    },
  ]

  const mockDbQuery = async (sql, values) => {
    captured.push({ sql, values })
    return mockRows
  }

  const result = await getFeedEvents({ limit: 20, queryFn: mockDbQuery })

  assert.equal(result.count, 3)
  assert.equal(result.events.length, 3)
  assert.match(captured[0].sql, /FROM feed_events/)
  assert.match(captured[0].sql, /col\.is_private IS NULL OR col\.is_private = FALSE/)
  assert.equal(captured[0].values[0], 20) // default limit 20

  // Event 1: shelf_add with book
  const ev1 = result.events[0]
  assert.equal(ev1.id, '10')
  assert.equal(ev1.eventType, 'shelf_add')
  assert.equal(ev1.user.userId, 'user1234')
  assert.equal(ev1.user.displayName, 'Alex Reader')
  assert.equal(ev1.book.bookId, 'b1')
  assert.equal(ev1.book.title, 'Dune')
  assert.equal(ev1.metadata.rating, 5)

  // Event 2: collection_created
  const ev2 = result.events[1]
  assert.equal(ev2.eventType, 'collection_created')
  assert.equal(ev2.collection.collectionId, '42')
  assert.equal(ev2.collection.title, 'Sci-Fi Classics')

  // Event 3: csv_upload
  const ev3 = result.events[2]
  assert.equal(ev3.eventType, 'csv_upload')
  assert.equal(ev3.metadata.bookCount, 142)
})

test('feed endpoint handles GET requests, sets no-store, and rejects non-GET methods', async () => {
  const reqGet = {
    method: 'GET',
    query: { limit: '20' },
    dbQuery: async () => [
      {
        id: '1',
        user_id: 'user1234',
        username: 'Test User',
        event_type: 'shelf_add',
        book_id: 'b1',
        book_title: 'Dune',
        metadata: { shelf: 'to-read' },
        created_at: '2026-11-24T19:00:00Z',
      },
    ],
  }
  const resGet = createMockRes()
  await feedHandler(reqGet, resGet)

  assert.equal(resGet.statusCode, 200)
  assert.equal(resGet.headers['Cache-Control'], 'no-store')
  assert.equal(resGet.payload.count, 1)
  assert.equal(resGet.payload.events[0].book.title, 'Dune')

  // OPTIONS returns 204
  const reqOptions = { method: 'OPTIONS' }
  const resOptions = createMockRes()
  await feedHandler(reqOptions, resOptions)
  assert.equal(resOptions.statusCode, 204)

  // POST returns 405 Method Not Allowed
  const reqPost = { method: 'POST' }
  const resPost = createMockRes()
  await feedHandler(reqPost, resPost)
  assert.equal(resPost.statusCode, 405)
})








