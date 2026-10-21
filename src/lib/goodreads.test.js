import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractGoodreadsUserId,
  buildGoodreadsRssUrl,
  buildGoodreadsApiUrl,
  extractDescriptionMetadata,
  extractBookUrlFromDescription,
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

test('builds RSS URL from a pathname ending in a user id', () => {
  assert.equal(
    buildGoodreadsRssUrl('/18354013'),
    'https://www.goodreads.com/review/list_rss/18354013?shelf=read',
  )
})

test('builds a same-origin Goodreads API URL for the browser', () => {
  assert.equal(buildGoodreadsApiUrl('/18354013'), '/api/goodreads/18354013?shelf=read')
})

test('builds a shelf-specific Goodreads API URL for the browser', () => {
  assert.equal(buildGoodreadsApiUrl('/18354013', 'to-read'), '/api/goodreads/18354013?shelf=to-read')
})

test('returns an empty RSS URL when no user id can be found', () => {
  assert.equal(buildGoodreadsRssUrl('/'), '')
})

test('extracts read date, average rating, and published year from the Goodreads description block', () => {
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
