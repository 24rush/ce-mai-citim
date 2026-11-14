import {
  getGoogleBooksApiKey,
  cleanIsbn,
  isValidIsbn,
  extractCoverFromVolume,
  extractIsbnFromVolume,
  extractPublishedYearFromVolume,
  extractPageCountFromVolume,
  extractDescriptionFromVolume,
  extractMainCategoryFromVolume,
} from './isbn.js'

export const searchGoogleBooksVolumes = async ({
  query,
  limit = 10,
  apiKey = getGoogleBooksApiKey(),
  fetchFn = fetch,
} = {}) => {
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) return []

  const keyParam = apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''
  const maxResults = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 20)

  let apiUrl
  if (isValidIsbn(cleanQuery)) {
    apiUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(
      cleanIsbn(cleanQuery),
    )}&maxResults=${maxResults}&printType=books${keyParam}`
  } else {
    apiUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
      cleanQuery,
    )}&maxResults=${maxResults}&printType=books${keyParam}`
  }

  const res = await fetchFn(apiUrl)
  if (!res.ok) {
    throw new Error(`Google Books API responded with status ${res.status}`)
  }

  const data = await res.json()
  const items = Array.isArray(data?.items) ? data.items : []

  return items.slice(0, maxResults).map((item) => {
    const vol = item?.volumeInfo || {}
    const isbn = extractIsbnFromVolume(item)
    const coverUrl = extractCoverFromVolume(item)
    const publishedYear = extractPublishedYearFromVolume(item)
    const pageCount = extractPageCountFromVolume(item)
    const description = extractDescriptionFromVolume(item)
    const mainCategory = extractMainCategoryFromVolume(item)
    const bookId = item.id ? `gb_${item.id}` : `gb_${Math.random().toString(36).slice(2, 10)}`

    return {
      bookId,
      id: bookId,
      title: vol.title || 'Titlu necunoscut',
      author: Array.isArray(vol.authors)
        ? vol.authors.join(', ')
        : (vol.authors || 'Autor necunoscut'),
      publishedYear: publishedYear || null,
      pages: pageCount || null,
      description: description || null,
      mainCategory: mainCategory || null,
      isbn: isbn || null,
      coverUrl: coverUrl || null,
      imageUrl: coverUrl || null,
      link:
        vol.infoLink ||
        vol.canonicalVolumeLink ||
        (isbn ? `https://www.goodreads.com/search?q=${encodeURIComponent(isbn)}` : null),
    }
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, OPTIONS')
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const q = String(req.query?.q || '').trim()
  if (!q) {
    return res.status(400).json({ error: 'Search query "q" is required.' })
  }

  const limit = req.query?.limit ? Number.parseInt(req.query.limit, 10) : 10

  try {
    const books = await searchGoogleBooksVolumes({
      query: q,
      limit,
      apiKey: req.googleBooksApiKey,
      fetchFn: req.fetchFn,
    })

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).json({ success: true, books })
  } catch (err) {
    console.error('Search Google Books failed:', err)
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to search Google Books.',
    })
  }
}

