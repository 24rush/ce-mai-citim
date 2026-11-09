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
  searchGoogleBooks,
} from '../../api/isbn.js'
import profileHandler from '../../api/profile.js'
import shelvesHandler, { saveBookToShelf, removeBookFromShelf, getBookShelfStatus, getUserShelves } from '../../api/shelves.js'

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
  assert.equal(typeof res.payload.books[0].bookshelves, 'string')
  assert.equal(res.payload.books[0].bookshelves, 'read')
  assert.equal(res.payload.books[0].hasBookshelvesField, undefined)
  assert.equal(res.payload.books[0].bookshelf, undefined)
  assert.equal(res.payload.books[1].imageUrl, 'https://covers.openlibrary.org/b/isbn/0345391802-L.jpg')
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
  assert.equal(book.imageUrl, 'https://covers.openlibrary.org/b/isbn/0345391802-L.jpg')
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

  assert.equal(req.capturedQueries.length, 4)
  assert.match(req.capturedQueries[0].sqlText, /INSERT INTO users \(user_id, display_name, last_access\)/)
  assert.deepEqual(req.capturedQueries[0].values, [jsonPayload.userId, 'Alin'])

  assert.match(req.capturedQueries[1].sqlText, /DELETE FROM user_shelves WHERE user_id = \$1/)
  assert.deepEqual(req.capturedQueries[1].values, [jsonPayload.userId])

  assert.match(
    req.capturedQueries[2].sqlText,
    /INSERT INTO books \(book_id, title, author, isbn, publisher, binding, number_of_pages, original_publication_year\)/,
  )
  assert.deepEqual(req.capturedQueries[2].values, [
    '10884',
    'Einstein: His Life and Universe',
    'Walter Isaacson',
    '0743264738',
    'Simon & Schuster',
    'Hardcover',
    675,
    2007,
  ])

  assert.match(
    req.capturedQueries[3].sqlText,
    /INSERT INTO user_shelves \(user_id, book_id, bookshelves, my_rating, date_read, date_added, my_review, spoiler\)/,
  )
  assert.deepEqual(req.capturedQueries[3].values, [
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
  assert.equal(secondReq.capturedQueries.length, 4)
  assert.match(secondReq.capturedQueries[0].sqlText, /INSERT INTO users/)
  assert.deepEqual(secondReq.capturedQueries[0].values, [jsonPayload.userId, 'Alin'])
  assert.match(secondReq.capturedQueries[1].sqlText, /DELETE FROM user_shelves WHERE user_id = \$1/)
  assert.deepEqual(secondReq.capturedQueries[1].values, [jsonPayload.userId])
  assert.match(secondReq.capturedQueries[2].sqlText, /INSERT INTO books/)
  assert.match(secondReq.capturedQueries[3].sqlText, /INSERT INTO user_shelves/)
  assert.equal(secondReq.capturedQueries[3].values[0], jsonPayload.userId)

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
    if (sql.includes('SELECT user_id, display_name, auth_user_id FROM users WHERE auth_user_id = $1')) {
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
    if (sql.includes('SELECT user_id, display_name, auth_user_id FROM users WHERE auth_user_id = $1')) {
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
    if (sql.includes('SELECT user_id, display_name, auth_user_id FROM users WHERE auth_user_id = $1')) {
      const match = usersDb.find((u) => u.auth_user_id === values[0])
      return match ? [match] : []
    }
    if (sql.includes('SELECT user_id, auth_user_id, display_name FROM users WHERE user_id = $1')) {
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
    if (sql.includes('SELECT user_id, display_name, auth_user_id FROM users WHERE auth_user_id = $1')) {
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

  assert.equal(executedQueries.length, 2)
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
  ])

  assert.match(executedQueries[1].sql, /INSERT INTO user_shelves/)
  assert.deepEqual(executedQueries[1].values, ['user1234', 'book999', 'to-read'])
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

  const mockFetch = async () => ({
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
  })

  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      displayName: 'Bookworm',
      csv,
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

  // Verify database insertion for books table contains number_of_pages = 207 and original_publication_year = 2005
  const insertBookQuery = capturedQueries.find((q) => q.sqlText.includes('INSERT INTO books'))
  assert.ok(insertBookQuery)
  assert.ok(insertBookQuery.values.includes(207), 'DB insert values should include number_of_pages: 207')
  assert.ok(insertBookQuery.values.includes(2005), 'DB insert values should include original_publication_year: 2005')
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
