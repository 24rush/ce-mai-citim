import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookCover } from 'book-cover-3d'
import {
  buildGoodreadsApiUrl,
  extractBookUrlFromDescription,
  extractDescriptionMetadata,
  extractGoodreadsUserId,
} from './lib/goodreads'
import './App.css'

const SHELF_OPTIONS = [
  { id: 'read', label: 'Citite', query: 'read' },
  { id: 'to-read', label: 'De citit', query: 'to-read' },
  { id: 'currently-reading', label: 'În curs de lectură', query: 'currently-reading' },
]

const BOOK_SORT_OPTIONS = [
  {
    id: 'recently-read',
    label: 'Recent citite',
    getValue: (book) => Date.parse(book.readAt || 0) || 0,
  },
  {
    id: 'best-rated',
    label: 'Rating',
    getValue: (book) => Number(book.rating) || 0,
  },
  {
    id: 'avg-rated',
    label: 'Rating useri',
    getValue: (book) => Number(book.averageRating) || 0,
  },
  {
    id: 'newest',
    label: 'Nou apărute',
    getValue: (book) => Number(book.publishedYear) || 0,
  },
]

const getBookSortOptions = (shelfId) => {
  if (shelfId === 'to-read' || shelfId === 'currently-reading') {
    return BOOK_SORT_OPTIONS.filter((option) => option.id !== 'recently-read' && option.id !== 'best-rated')
  }

  return BOOK_SORT_OPTIONS
}

export const parseRssBooks = (xmlText) => {
  const parser = new DOMParser()
  const xml = parser.parseFromString(xmlText, 'application/xml')
  const parseError = xml.querySelector('parsererror')

  if (parseError) {
    throw new Error('Unable to parse Goodreads RSS feed.')
  }

  const items = [...xml.querySelectorAll('item')]
  const username = items[0]?.querySelector('user_name')?.textContent?.trim() || ''

  return {
    username,
    books: items
      .map((item, index) => {
        const bookNode = item.querySelector('book') || item

        const title = item.querySelector('title')?.textContent?.trim() || `Book ${index + 1}`

        const descriptionText = item.querySelector('description')?.textContent || ''
        const descriptionMeta = extractDescriptionMetadata(descriptionText)
        const descriptionBookUrl = extractBookUrlFromDescription(item.querySelector('description')?.innerHTML || '')

        const link = descriptionBookUrl ||
          `https://www.goodreads.com/book/show/${item.querySelector('book_id')?.textContent?.trim() || bookNode.querySelector('book_id')?.textContent?.trim() || ''}` || '#'

        const imageUrl =
          bookNode.querySelector('book_large_image_url')?.textContent?.trim() ||
          item.querySelector('book_large_image_url')?.textContent?.trim() ||
          item.querySelector('book_medium_image_url')?.textContent?.trim() ||
          item.querySelector('book_small_image_url')?.textContent?.trim() ||
          'https://images-na.ssl-images-amazon.com/images/S/compressed.photo.goodreads.com/books/1545059380i/27833670.jpg'

        const rawRating =
          item.querySelector('user_rating')?.textContent?.trim() ||
          descriptionMeta.rating ||
          '0'

        const rawPages = bookNode.querySelector('num_pages')?.textContent?.trim() || '0'
        const readAt = descriptionMeta.readAt || ''
        const averageRating = Number.parseFloat(descriptionMeta.averageRating || '0')

        const publishedYear = Number.parseInt(descriptionMeta.publishedYear || '0', 10)

        const rating = Number.parseFloat(rawRating)
        const pages = Number.parseInt(rawPages, 10)
        const thickness = Number.isFinite(pages) && pages > 0 ? Math.min(Math.max(Math.round(pages / 8), 18), 80) : 35

        return {
          id: `${title}-${index}`,
          title,
          author: item.querySelector('author_name')?.textContent?.trim(),
          imageUrl,
          link,
          rating: Number.isFinite(rating) ? Math.min(Math.max(rating, 0), 5) : 0,
          thickness,
          readAt,
          averageRating: Number.isFinite(averageRating) ? averageRating : 0,
          publishedYear: Number.isFinite(publishedYear) ? publishedYear : 0,
        }
      })
      .filter(Boolean),
  }
}

const fetchBooksFromRss = async (rssUrl) => {
  const response = await fetch(rssUrl)

  if (!response.ok) {
    throw new Error(`RSS request failed with status ${response.status}`)
  }

  const xmlText = await response.text()
  return parseRssBooks(xmlText)
}

function App() {
  const [books, setBooks] = useState([])
  const [username, setUsername] = useState('')
  const [activeShelf, setActiveShelf] = useState('read')
  const [activeAuthorFilter, setActiveAuthorFilter] = useState('all')
  const [activeBookSort, setActiveBookSort] = useState('recently-read')
  const [currentUserId, setCurrentUserId] = useState(() => extractGoodreadsUserId(window.location.pathname) || '')
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileUrlInput, setProfileUrlInput] = useState('')
  const [generatedProfileUrl, setGeneratedProfileUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const availableBookSortOptions = getBookSortOptions(activeShelf)
  const [error, setError] = useState('')
  const carouselRef = useRef(null)
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0 })

  useEffect(() => {
    const syncUserId = () => {
      setCurrentUserId(extractGoodreadsUserId(window.location.pathname) || '')
    }

    window.addEventListener('popstate', syncUserId)
    syncUserId()

    return () => window.removeEventListener('popstate', syncUserId)
  }, [])

  useEffect(() => {
    const loadBooks = async () => {
      const resolvedUserId = currentUserId || extractGoodreadsUserId(window.location.pathname) || ''
      const isRootPath = window.location.pathname === '/' || window.location.pathname === ''

      if (!resolvedUserId && isRootPath) {
        const fallbackUserId = '18354013'
        window.history.replaceState({}, '', `/${fallbackUserId}`)
        setCurrentUserId(fallbackUserId)
        setError('')
        setIsLoading(false)
        return
      }

      if (!resolvedUserId) {
        setError('Ups! Nu am găsit nimic la această adresă.')
        setIsLoading(false)
        return
      }

      const shelfUrl = buildGoodreadsApiUrl(resolvedUserId, activeShelf)

      try {
        setIsLoading(true)
        setError('')
        const { books: rssBooks, username: rssUsername } = await fetchBooksFromRss(shelfUrl)
        setBooks(rssBooks)
        if (rssUsername) {
          setUsername(rssUsername)
        }
      } catch (loadError) {
        console.error(loadError)
        setError('Ups! Nu am găsit nimic la această adresă.')
      } finally {
        setIsLoading(false)
      }
    }

    loadBooks()
  }, [activeShelf, currentUserId])

  useEffect(() => {
    if (!availableBookSortOptions.some((option) => option.id === activeBookSort)) {
      setActiveBookSort(availableBookSortOptions[0]?.id || 'recently-read')
    }
  }, [activeBookSort, availableBookSortOptions])

  const authorOptions = useMemo(() => {
    const counts = new Map()

    books.forEach((book) => {
      if (!book.author) {
        return
      }

      const authorName = String(book.author).trim()
      counts.set(authorName, (counts.get(authorName) || 0) + 1)
    })

    return [...counts.entries()]
      .sort(([authorA, countA], [authorB, countB]) => {
        if (countB !== countA) {
          return countB - countA
        }

        return authorA.localeCompare(authorB)
      })
      .map(([author, count]) => ({
        value: author,
        label: `${author} (${count})`,
      }))
  }, [books])

  useEffect(() => {
    if (activeAuthorFilter !== 'all' && !authorOptions.some((option) => option.value === activeAuthorFilter)) {
      setActiveAuthorFilter('all')
    }
  }, [activeAuthorFilter, authorOptions])

  const filteredBooks = useMemo(() => {
    if (activeAuthorFilter === 'all') {
      return books
    }

    return books.filter((book) => book.author === activeAuthorFilter)
  }, [activeAuthorFilter, books])

  const activeSort = availableBookSortOptions.find((option) => option.id === activeBookSort) || availableBookSortOptions[0]

  const visibleBooks = useMemo(() => {
    const sortOption = activeSort

    return [...filteredBooks].sort((bookA, bookB) => {
      const valueA = sortOption.getValue(bookA)
      const valueB = sortOption.getValue(bookB)

      if (valueA !== valueB) {
        return valueB - valueA
      }

      const readDateA = Date.parse(bookA.readAt || 0) || 0
      const readDateB = Date.parse(bookB.readAt || 0) || 0

      if (readDateA !== readDateB) {
        return readDateB - readDateA
      }

      return bookB.title.localeCompare(bookA.title)
    })
  }, [activeBookSort, activeSort, filteredBooks])

  useEffect(() => {
    if (!carouselRef.current) {
      return
    }

    carouselRef.current.scrollTo({
      left: 0,
      behavior: 'auto',
    })
  }, [activeShelf, visibleBooks.length])

  const renderStars = (rating) => {
    const filledStars = Math.round(rating || 0)

    return Array.from({ length: 5 }, (_, index) => (
      <span key={`${rating}-${index}`} className={index < filledStars ? 'star filled' : 'star'}>
        ★
      </span>
    ))
  }

  const handleProfileUrlInput = (event) => {
    const nextValue = event.target.value
    setProfileUrlInput(nextValue)

    const userId = extractGoodreadsUserId(nextValue)

    if (!userId) {
      setGeneratedProfileUrl('')
      setQrCodeDataUrl('')
      setError('URL-ul nu pare să fie valid. Folosește un URL de tipul: https://www.goodreads.com/user/show/{user_id}-{username}')
      return
    }

    const nextPath = `/${userId}`
    const nextUrl = `${window.location.origin}${nextPath}`
    window.history.pushState({}, '', nextPath)
    setGeneratedProfileUrl(nextUrl)
    setCurrentUserId(userId)
    setError('')

    QRCode.toDataURL(nextUrl)
      .then((dataUrl) => setQrCodeDataUrl(dataUrl))
      .catch((qrError) => {
        console.error(qrError)
        setQrCodeDataUrl('')
      })
  }

  const handleCopyGeneratedUrl = async () => {
    if (!generatedProfileUrl) {
      return
    }

    try {
      await navigator.clipboard.writeText(generatedProfileUrl)
    } catch (copyError) {
      console.error(copyError)
    }
  }

  const handleGoToGeneratedUrl = () => {
    if (!generatedProfileUrl) {
      return
    }

    window.open(generatedProfileUrl, '_blank', 'noopener,noreferrer')
  }

  const scrollBooks = (direction) => {
    if (!carouselRef.current) {
      return
    }

    const firstCard = carouselRef.current.querySelector('.book-card')

    if (!firstCard) {
      return
    }

    const carouselStyles = window.getComputedStyle(carouselRef.current)
    const gap = Number.parseFloat(carouselStyles.columnGap || carouselStyles.gap || '12') || 12
    const cardWidth = firstCard.getBoundingClientRect().width

    carouselRef.current.scrollBy({
      left: direction * (cardWidth + gap),
      behavior: 'smooth',
    })
  }

  const handlePointerDown = (event) => {
    if (!carouselRef.current) {
      return
    }

    dragState.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: carouselRef.current.scrollLeft,
    }

    carouselRef.current.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event) => {
    if (!dragState.current.active || !carouselRef.current) {
      return
    }

    const delta = event.clientX - dragState.current.startX
    carouselRef.current.scrollLeft = dragState.current.scrollLeft - delta
  }

  const handlePointerUp = (event) => {
    if (!carouselRef.current) {
      return
    }

    carouselRef.current.releasePointerCapture(event.pointerId)
    dragState.current.active = false
  }

  const syncBookCoverFocus = () => {
    if (!carouselRef.current) {
      return
    }

    const carousel = carouselRef.current
    const carouselCenter = carousel.scrollLeft + carousel.clientWidth / 2
    const cards = carousel.querySelectorAll('.book-card')

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect()
      const cardCenter = rect.left + rect.width / 2
      const distanceFromCenter = Math.abs(cardCenter - (carousel.getBoundingClientRect().left + carousel.clientWidth / 2))
      const maxDistance = carousel.clientWidth * 0.72
      const ratio = Math.max(0, 1 - distanceFromCenter / maxDistance)
      const scale = 0.85 + ratio * 0.28
      const translateY = (1 - ratio) * 14
      const opacity = 0.75 + ratio * 0.25

      card.style.setProperty('--card-scale', String(scale))
      card.style.setProperty('--card-translate-y', `${translateY}px`)
      card.style.setProperty('--card-opacity', String(opacity))
    })
  }

  useEffect(() => {
    if (!carouselRef.current || visibleBooks.length === 0) {
      return undefined
    }

    const carousel = carouselRef.current
    syncBookCoverFocus()

    const handleScroll = () => syncBookCoverFocus()

    carousel.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)

    return () => {
      carousel.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [visibleBooks.length, activeShelf, activeAuthorFilter, activeBookSort])

  return (
    <main className="app-shell">
      <header className="library-header">
        <div className="library-header-row">
          <button
            type="button"
            className="profile-url-trigger"
            onClick={() => setShowProfileModal(true)}
          >
            Generează URL-ul tău
          </button>
          {username ? (
            <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
              Ce mai citește <span className="text-violet-300">{username}</span>
            </h1>
          ) : (
            <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
              Ce mai citim
            </h1>
          )}
        </div>

        {username ? (
          <div className="shelf-pills" aria-label="Book shelves">
            {SHELF_OPTIONS.map((shelf) => (
              <button
                key={shelf.id}
                type="button"
                className={shelf.id === activeShelf ? 'shelf-pill active' : 'shelf-pill'}
                onClick={() => setActiveShelf(shelf.id)}
              >
                {shelf.label}
              </button>
            ))}
          </div>
        ) : null}

      </header>

      {showProfileModal ? (
        <div className="profile-modal-backdrop" onClick={() => setShowProfileModal(false)}>
          <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="profile-modal-header">
              <div className="profile-modal-header-spacer" />
              <button
                type="button"
                className="toolbar-clear-button"
                onClick={() => setShowProfileModal(false)}
                aria-label="Close profile URL popup"
              >
                ×
              </button>
            </div>

            <div className="profile-modal-form">
              <label htmlFor="profile-url-input" className="profile-modal-label">
                Introdu URL-ul profilului tău de Goodreads
              </label>
              <input
                id="profile-url-input"
                type="url"
                value={profileUrlInput}
                onChange={handleProfileUrlInput}
                placeholder="https://www.goodreads.com/user/show/18354013-alin-iordache"
                className="profile-modal-input"
              />
            </div>

            {generatedProfileUrl ? (
              <div className="profile-url-result">
                <label htmlFor="profile-url-input" className="profile-modal-label">
                  URL-ul tau pe 'Ce mai citim'
                </label>
                <div className="profile-url-field">
                  <span>{generatedProfileUrl}</span>
                </div>

                {qrCodeDataUrl ? (
                  <div className="profile-qr-wrapper">
                    <img src={qrCodeDataUrl} alt="QR code for generated website URL" className="profile-qr-image" />
                  </div>
                ) : null}

                <div className="profile-url-actions">
                  <button type="button" className="profile-url-copy" onClick={handleCopyGeneratedUrl}>
                    Copy
                  </button>
                  <button type="button" className="profile-url-go" onClick={handleGoToGeneratedUrl}>
                    Go
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <div className="status-banner">{error}</div> : null}

      {!isLoading && books.length > 0 ? (
        <div className="book-controls" aria-label="Book controls">
          <div className="toolbar-group">
            <select
              id="book-author-select"
              className="toolbar-select"
              value={activeAuthorFilter}
              onChange={(event) => setActiveAuthorFilter(event.target.value)}
            >
              <option value="all">Toti autorii</option>
              {authorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {activeAuthorFilter !== 'all' ? (
              <button
                type="button"
                className="toolbar-clear-button"
                aria-label="Clear author filter"
                onClick={() => setActiveAuthorFilter('all')}
                title="Clear author filter"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="toolbar-group">
            <select
              id="book-sort-select"
              className="toolbar-select"
              value={activeBookSort}
              onChange={(event) => setActiveBookSort(event.target.value)}
            >
              {availableBookSortOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <section className="carousel-panel" aria-label="Book carousel">
        {username ? (
          <button
            type="button"
            className="nav-button"
            onClick={() => scrollBooks(-1)}
            aria-label="Scroll books left"
          >
            ←
          </button>
        ) : null}

        {isLoading ? (
          <div className="books-carousel loading-carousel" aria-live="polite" aria-label="Loading books">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`loading-${index}`} className="book-card loading-card">
                <div className="loading-cover" />
                <div className="loading-text" />
                <div className="loading-text short" />
              </div>
            ))}
          </div>
        ) : username && visibleBooks.length === 0 ? (
          <div className="books-carousel empty-carousel" aria-live="polite" aria-label="Empty shelf">
            <div className="empty-shelf-state">
              <h2>Nu exista nimic pe acest raft.</h2>
            </div>
          </div>
        ) : (
          <div
            className="books-carousel"
            ref={carouselRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {visibleBooks.map((book) => (
              <article key={book.id} className="book-card">
                <div className="book-cover-surface" aria-hidden="true">
                  <BookCover
                    width={180}
                    height={260}
                    thickness={book.thickness}
                    rotate={20}
                    rotateHover={30}
                    perspective={900}
                    pagesOffset={4}
                    bgColor="#0f172a"
                    shadowColor="rgba(15, 23, 42, 0.45)"
                  >
                    <div className="book-cover-art">
                      <img src={book.imageUrl} alt={`${book.title} cover`} />
                    </div>
                  </BookCover>
                </div>

                <div className="book-meta">
                  <h2>
                    {book.title}
                  </h2>
                  <p>{book.author}</p>
                  {activeShelf === 'read' ? (
                    <>
                      <div className="book-rating" aria-label={`User rating: ${book.rating} out of 5`}>
                        {renderStars(book.rating)}
                      </div>
                    </>
                  ) : null}
                  {book.averageRating ? (
                    <div className="book-average-rating" aria-label={`Average Goodreads rating: ${book.averageRating}`}>
                      <span style={{ marginRight: '4px' }} aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-people-fill" viewBox="0 0 16 16">
                          <path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.355.68-2.75 1.936-3.72A6.3 6.3 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1zM4.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" />
                        </svg>
                      </span>
                      {book.averageRating.toFixed(2)}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}

        {username ? (
          <button
            type="button"
            className="nav-button"
            onClick={() => scrollBooks(1)}
            aria-label="Scroll books right"
          >
            →
          </button>
        ) : null}

      </section>
    </main>
  )
}

export default App
