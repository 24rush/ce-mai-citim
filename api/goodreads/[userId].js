import { createDefaultDbQuery } from '../_lib/db.js'
import { normalizeCsvBook } from '../../src/lib/goodreads.js'

export const buildDefaultCoverUrl = (isbn) => {
  const cleanIsbn = String(isbn || '').replace(/[^0-9X]/gi, '').trim()
  return cleanIsbn ? `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(cleanIsbn)}-L.jpg` : ''
}

export const USER_BOOKS_SQL = `
  SELECT
    u.display_name,
    b.book_id,
    b.title,
    b.author,
    b.isbn,
    b.my_rating,
    b.publisher,
    b.binding,
    b.number_of_pages,
    b.original_publication_year,
    TO_CHAR(b.date_read, 'YYYY/MM/DD') AS date_read,
    TO_CHAR(b.date_added, 'YYYY/MM/DD') AS date_added,
    b.bookshelves,
    b.my_review,
    b.spoiler,
    COALESCE(c.url, CASE WHEN b.isbn IS NOT NULL AND b.isbn <> '' THEN 'https://covers.openlibrary.org/b/isbn/' || b.isbn || '-L.jpg' ELSE '' END) AS cover_url
  FROM users u
  LEFT JOIN books b ON b.user_id = u.user_id
  LEFT JOIN covers c ON c.isbn = b.isbn AND b.isbn IS NOT NULL AND b.isbn <> ''
  WHERE u.user_id = $1
  ORDER BY b.date_read DESC NULLS LAST, b.date_added DESC NULLS LAST;
`.trim()

export const mapRowToBook = (row, index) =>
  normalizeCsvBook(
    {
      'Book Id': row.book_id,
      Title: row.title,
      Author: row.author,
      ISBN: row.isbn,
      'My Rating': row.my_rating,
      Publisher: row.publisher,
      Binding: row.binding,
      'Number of Pages': row.number_of_pages,
      'Original Publication Year': row.original_publication_year,
      'Date Read': row.date_read,
      'Date Added': row.date_added,
      Bookshelves: row.bookshelves ?? '',
      'My Review': row.my_review,
      Spoiler: row.spoiler,
      imageUrl: row.cover_url || buildDefaultCoverUrl(row.isbn),
    },
    index,
  )

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const userId = String(req.query?.userId || '').trim()
  if (!/^[a-zA-Z0-9]{8}$/.test(userId)) {
    return res.status(400).json({ error: 'A valid 8-character user id is required.' })
  }

  try {
    const executeQuery = req.dbQuery || (await createDefaultDbQuery())
    const rows = await executeQuery(USER_BOOKS_SQL, [userId])

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' })
    }

    const username = rows[0].display_name || ''
    const books = rows
      .filter((row) => row.book_id)
      .map(mapRowToBook)

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({ userId, username, books })
  } catch (error) {
    console.error('Failed to load books for user:', userId, error)
    return res.status(500).json({ error: error?.message || 'Failed to load books.' })
  }
}

