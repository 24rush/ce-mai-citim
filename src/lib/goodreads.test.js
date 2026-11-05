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
} from './goodreads.js'
import uploadCsvHandler, { parseCsvForDatabase, isAllowedShelf } from '../../api/uploadcsv.js'
import getUserBooksHandler from '../../api/goodreads/[userId].js'
import coverHandler from '../../api/cover.js'
import isbnHandler, {
  buildGoogleBooksQuery,
  extractCoverFromVolume,
  extractIsbnFromVolume,
  searchGoogleBooks,
} from '../../api/isbn.js'

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

  assert.equal(req.capturedQueries.length, 3)
  assert.match(req.capturedQueries[0].sqlText, /INSERT INTO users \(user_id, display_name, last_access\)/)
  assert.deepEqual(req.capturedQueries[0].values, [jsonPayload.userId, 'Alin'])

  assert.match(req.capturedQueries[1].sqlText, /DELETE FROM books WHERE user_id = \$1/)
  assert.deepEqual(req.capturedQueries[1].values, [jsonPayload.userId])

  assert.match(
    req.capturedQueries[2].sqlText,
    /INSERT INTO books \(user_id, book_id, title, author, isbn, my_rating, publisher, binding, number_of_pages, original_publication_year, date_read, date_added, bookshelves, my_review, spoiler\)/,
  )
  assert.deepEqual(req.capturedQueries[2].values, [
    jsonPayload.userId,
    '10884',
    'Einstein: His Life and Universe',
    'Walter Isaacson',
    '0743264738',
    4,
    'Simon & Schuster',
    'Hardcover',
    675,
    2007,
    '2026-10-10',
    '2026-10-09',
    'read',
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
  assert.equal(secondReq.capturedQueries.length, 3)
  assert.match(secondReq.capturedQueries[0].sqlText, /INSERT INTO users/)
  assert.deepEqual(secondReq.capturedQueries[0].values, [jsonPayload.userId, 'Alin'])
  assert.match(secondReq.capturedQueries[1].sqlText, /DELETE FROM books WHERE user_id = \$1/)
  assert.deepEqual(secondReq.capturedQueries[1].values, [jsonPayload.userId])
  assert.match(secondReq.capturedQueries[2].sqlText, /INSERT INTO books/)
  assert.equal(secondReq.capturedQueries[2].values[0], jsonPayload.userId)

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
  assert.deepEqual(updateQuery.values, ['9780441172719', 'testuser', 'book123'])

  const coverQuery = capturedDbQueries.find((q) => q.sqlText.includes('INSERT INTO covers'))
  assert.ok(coverQuery)
  assert.deepEqual(coverQuery.values, ['9780441172719', 'https://books.google.com/dune.jpg'])
})

test('isbn lambda handler supports backfill mode for user books', async () => {
  const capturedDbQueries = []
  const mockDbQuery = async (sqlText, values) => {
    capturedDbQueries.push({ sqlText, values })
    if (sqlText.includes('SELECT book_id')) {
      return [
        { book_id: 'b1', title: 'Foundation', author: 'Isaac Asimov' },
        { book_id: 'b2', title: 'Solaris', author: 'Stanislaw Lem' },
      ]
    }
    return [{ book_id: values[2], isbn: values[0] }]
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
