import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractGoodreadsUserId,
  buildGoodreadsRssUrl,
  buildGoodreadsApiUrl,
  buildBookShareUrl,
  extractDescriptionMetadata,
  extractBookUrlFromDescription,
  getFinishedBooksTotals,
} from './goodreads.js'

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

test('builds RSS URL from a pathname ending in a user id', () => {
  assert.equal(
    buildGoodreadsRssUrl('/18354013'),
    'https://proxy.cors.dev/https://www.goodreads.com/review/list_rss/18354013?shelf=read',
  )
})

test('builds a proxied Goodreads API URL for the browser', () => {
  assert.equal(buildGoodreadsApiUrl('/18354013'), 'https://proxy.cors.dev/https://www.goodreads.com/review/list_rss/18354013?shelf=read')
})

test('builds a shelf-specific proxied Goodreads API URL for the browser', () => {
  assert.equal(buildGoodreadsApiUrl('/18354013', 'to-read'), 'https://proxy.cors.dev/https://www.goodreads.com/review/list_rss/18354013?shelf=to-read')
})

test('returns an empty RSS URL when no user id can be found', () => {
  assert.equal(buildGoodreadsRssUrl('/'), '')
})

test('builds a book share URL with the Goodreads user, shelf, and book id', () => {
  assert.equal(
    buildBookShareUrl('18354013', 'read', '123456', 'https://example.com'),
    'https://example.com/18354013/read/123456',
  )
})

test('extracts the read date, average rating, and published year from the Goodreads description block', () => {
  const description = `
    <a href="https://www.goodreads.com/book/show/10884.Einstein?utm_medium=api&amp;utm_source=rss">
      <img alt="Einstein: His Life and Universe" src="https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1328011405l/10884._SY75_.jpg" />
    </a><br/>
    author: Walter Isaacson<br/>
    name: Alin<br/>
    average rating: 4.16<br/>
    book published: 2007<br/>
    rating: 3<br/>
    read at: 2026/10/10<br/>
    date added: 2026/10/09<br/>
    shelves: februarie-2019<br/>
    review: <br/><br/>
  `

  const result = extractDescriptionMetadata(description)

  assert.equal(result.readAt, '2026/10/10')
  assert.equal(result.averageRating, '4.16')
  assert.equal(result.publishedYear, '2007')
  assert.equal(result.rating, '3')
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

test('extracts the first book URL from the Goodreads description block', () => {
  const description = `
    <a href="https://www.goodreads.com/book/show/10884.Einstein?utm_medium=api&amp;utm_source=rss">
      <img alt="Einstein: His Life and Universe" src="https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1328011405l/10884._SY75_.jpg" />
    </a><br/>
    author: Walter Isaacson<br/>
    rating: 3
  `

  assert.equal(
    extractBookUrlFromDescription(description),
    'https://www.goodreads.com/book/show/10884.Einstein',
  )
})
