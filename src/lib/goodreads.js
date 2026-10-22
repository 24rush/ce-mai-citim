export const extractGoodreadsUserId = (value) => {
  if (!value) {
    return ''
  }

  const normalized = String(value).trim()

  if (/^\d+$/.test(normalized)) {
    return normalized
  }

  const pathOnly = normalized.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '')

  if (/^\d+$/.test(pathOnly)) {
    return pathOnly
  }

  const match = normalized.match(/goodreads\.com\/(?:user\/show\/)?(\d+)/i)
  return match?.[1] || ''
}

export const buildGoodreadsApiUrl = (value, shelf = 'read') => {
  const userId = extractGoodreadsUserId(value)

  if (!userId) {
    return ''
  }

  const params = new URLSearchParams({ shelf })
  return `https://proxy.cors.dev/https://www.goodreads.com/review/list_rss/${userId}?${params.toString()}`
}

export const buildGoodreadsRssUrl = (value, shelf = 'read') => {
  const userId = extractGoodreadsUserId(value)

  if (!userId) {
    return ''
  }

  const params = new URLSearchParams({ shelf })
  return `https://proxy.cors.dev/https://www.goodreads.com/review/list_rss/${userId}?${params.toString()}`
}

export const buildBookShareUrl = (userId, shelf, bookId, origin = window.location.origin) => {
  if (!userId || !shelf || !bookId) {
    return ''
  }

  return `${origin.replace(/\/$/, '')}/${userId}/${shelf}/${encodeURIComponent(bookId)}`
}

export const extractBookUrlFromDescription = (descriptionHtml = '') => {
  if (!descriptionHtml) {
    return ''
  }

  const match = String(descriptionHtml).match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/i)

  if (!match?.[1]) {
    return ''
  }

  const url = match[1].replace(/&amp;/gi, '&')
  const parsed = new URL(url)

  if (parsed.hostname === 'www.goodreads.com' && parsed.pathname.startsWith('/book/show/')) {
    return `${parsed.origin}${parsed.pathname}`
  }

  return url.replace(/[?&](utm_[a-z_]+|utm_[^&]+)=.*?(&|$)/gi, '$2').replace(/[?&]$/g, '')
}

export const extractDescriptionMetadata = (descriptionHtml = '') => {
  if (!descriptionHtml) {
    return { readAt: '', averageRating: '', publishedYear: '', rating: '' }
  }

  const text = String(descriptionHtml)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()

  const readAtMatch = text.match(/read at:\s*([0-9]{4}[/-][0-9]{1,2}[/-][0-9]{1,2}|[0-9]{4})/i)
  const averageRatingMatch = text.match(/average rating:\s*([0-9]+(?:\.[0-9]+)?)/i)
  const publishedYearMatch = text.match(/book published:\s*([0-9]{4})/i)
  const ratingMatch = text.match(/(?<!average\s)rating:\s*([0-9]+(?:\.[0-9]+)?)/i)

  return {
    readAt: readAtMatch?.[1]?.trim() || '',
    averageRating: averageRatingMatch?.[1]?.trim() || '',
    publishedYear: publishedYearMatch?.[1]?.trim() || '',
    rating: ratingMatch?.[1]?.trim() || '',
  }
}

export const getFinishedBooksTotals = (books = [], year) => {
  if (!Number.isInteger(year)) {
    return { count: 0, totalPages: 0 }
  }

  let count = 0
  let totalPages = 0

  books.forEach((book) => {
    const readDate = book.readAt || ''
    if (!readDate) {
      return
    }

    const yearMatch = String(readDate).match(/^(\d{4})/)
    if (!yearMatch || Number(yearMatch[1]) !== year) {
      return
    }

    const pages = Number(book.pages) || 0
    count += 1
    totalPages += pages
  })

  return { count, totalPages }
}
