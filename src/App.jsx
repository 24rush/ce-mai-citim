import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookCover } from 'book-cover-3d'
import {
  buildBookShareUrl,
  buildGoodreadsApiUrl,
  extractBookUrlFromDescription,
  extractDescriptionMetadata,
  extractGoodreadsUserId,
  getFinishedBooksTotals,
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

const getRouteStateFromPath = (pathname = window.location.pathname) => {
  const segments = pathname.split('/').filter(Boolean)
  const userSegment = segments[0] || ''
  const shelfSegment = segments[1] || 'read'
  const bookSegment = segments[2] || ''

  const userId = extractGoodreadsUserId(userSegment)
  const shelf = SHELF_OPTIONS.some((option) => option.id === shelfSegment) ? shelfSegment : 'read'

  return {
    userId,
    shelf,
    bookId: bookSegment,
  }
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
        const bookIdFromFeed = item.querySelector('book_id')?.textContent?.trim() || bookNode.querySelector('book_id')?.textContent?.trim() || ''

        const descriptionText = item.querySelector('description')?.textContent || ''
        const descriptionMeta = extractDescriptionMetadata(descriptionText)
        const descriptionBookUrl = extractBookUrlFromDescription(item.querySelector('description')?.innerHTML || '')

        const link = descriptionBookUrl ||
          `https://www.goodreads.com/book/show/${bookIdFromFeed}` || '#'

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
        const finishedAt = descriptionMeta.finishedAt || readAt || ''
        const averageRating = Number.parseFloat(descriptionMeta.averageRating || '0')

        const publishedYear = Number.parseInt(descriptionMeta.publishedYear || '0', 10)

        const rating = Number.parseFloat(rawRating)
        const pages = Number.parseInt(rawPages, 10)
        const thickness = Number.isFinite(pages) && pages > 0 ? Math.min(Math.max(Math.round(pages / 8), 18), 80) : 35

        return {
          id: bookIdFromFeed || `${title}-${index}`,
          bookId: bookIdFromFeed || `${title}-${index}`,
          title,
          author: item.querySelector('author_name')?.textContent?.trim(),
          imageUrl,
          link,
          rating: Number.isFinite(rating) ? Math.min(Math.max(rating, 0), 5) : 0,
          thickness,
          pages: Number.isFinite(pages) && pages > 0 ? pages : 0,
          readAt,
          finishedAt,
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
  const [requestedBookId, setRequestedBookId] = useState(() => getRouteStateFromPath().bookId)
  const [selectedBook, setSelectedBook] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const availableBookSortOptions = getBookSortOptions(activeShelf)
  const [error, setError] = useState('')
  const carouselRef = useRef(null)
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0 })

  useEffect(() => {
    const syncRouteState = () => {
      const { userId, shelf, bookId } = getRouteStateFromPath(window.location.pathname)

      if (userId) {
        setCurrentUserId(userId)
      }

      setActiveShelf(shelf)
      setRequestedBookId(bookId)
    }

    window.addEventListener('popstate', syncRouteState)
    syncRouteState()

    return () => window.removeEventListener('popstate', syncRouteState)
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

  useEffect(() => {
    if (!requestedBookId) {
      setSelectedBook(null)
      return
    }

    if (!books.length) {
      return
    }

    const matchedBook = books.find((book) => String(book.bookId || book.id) === String(requestedBookId))

    if (matchedBook) {
      setSelectedBook(matchedBook)
      setError('')
      return
    }

    setSelectedBook(null)
    setError('Cartea nu a fost găsită pe acest raft.')
  }, [books, requestedBookId])

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
  const yearlySummary = useMemo(() => getFinishedBooksTotals(books, 2026), [books])

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

  const openBookDetails = (book) => {
    if (!book || !currentUserId) {
      return
    }

    const bookId = String(book.bookId || book.id)
    const nextPath = `/${currentUserId}/${activeShelf}/${encodeURIComponent(bookId)}`
    window.history.pushState({}, '', nextPath)
    setRequestedBookId(bookId)
    setSelectedBook(book)
    setError('')
  }

  const shareBookLink = async (book) => {
    if (!book || !currentUserId) {
      return
    }

    const bookId = String(book.bookId || book.id)
    const shareUrl = buildBookShareUrl(currentUserId, activeShelf, bookId, window.location.origin)

    if (!shareUrl) {
      return
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: book.title,
          text: `Vezi cartea: ${book.title}`,
          url: shareUrl,
        })
        return
      }

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl)
      }
    } catch (shareError) {
      console.error(shareError)
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl)
        }
      } catch (copyError) {
        console.error(copyError)
      }
    }
  }

  const closeBookDetails = () => {
    const routePath = currentUserId ? `/${currentUserId}/${activeShelf}` : '/'
    window.history.pushState({}, '', routePath)
    setRequestedBookId('')
    setSelectedBook(null)
    setError('')
  }

  const handleShareBookLink = async () => {
    if (!selectedBook || !currentUserId) {
      return
    }

    const bookId = String(selectedBook.bookId || selectedBook.id)
    const shareUrl = buildBookShareUrl(currentUserId, activeShelf, bookId, window.location.origin)

    if (!shareUrl) {
      return
    }

    try {
      if (navigator.share) {
        await navigator.share({
          title: selectedBook.title,
          text: `Vezi cartea: ${selectedBook.title}`,
          url: shareUrl,
        })
        return
      }

      await navigator.clipboard.writeText(shareUrl)
    } catch (shareError) {
      console.error(shareError)
      try {
        await navigator.clipboard.writeText(shareUrl)
      } catch (copyError) {
        console.error(copyError)
      }
    }
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

    const interactiveTarget = event.target.closest('button, a, input, textarea, select')
    if (interactiveTarget) {
      return
    }

    dragState.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: carouselRef.current.scrollLeft,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event) => {
    if (!dragState.current.active || !carouselRef.current) {
      return
    }

    event.preventDefault()

    const delta = event.clientX - dragState.current.startX
    carouselRef.current.scrollLeft = dragState.current.scrollLeft - delta
  }

  const handlePointerUp = (event) => {
    if (!carouselRef.current) {
      return
    }

    if (event && typeof event.pointerId === 'number' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

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

        {yearlySummary.count > 5 && yearlySummary.totalPages > 0 ? (
          <div className="reading-summary book-detail-label" aria-live="polite">
            <span>{yearlySummary.count} cărți citite în 2026</span>
            <span>// {yearlySummary.totalPages.toLocaleString()} pagini</span>
          </div>
        ) : null
        }

        {username ? (
          <div className="shelf-pills" aria-label="Book shelves">
            {SHELF_OPTIONS.map((shelf) => (
              <button
                key={shelf.id}
                type="button"
                className={shelf.id === activeShelf ? 'shelf-pill active' : 'shelf-pill'}
                onClick={() => {
                  setActiveShelf(shelf.id)
                  const nextPath = currentUserId ? `/${currentUserId}/${shelf.id}` : `/${shelf.id}`
                  window.history.pushState({}, '', nextPath)
                  setRequestedBookId('')
                  setSelectedBook(null)
                }}
              >
                {shelf.label}
              </button>
            ))}
          </div>
        ) : null}

      </header>

      {selectedBook ? (
        <div className="book-detail-backdrop" onClick={closeBookDetails}>
          <div className="book-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="book-detail-header">
              <div className="profile-modal-header-spacer" />
              <button
                type="button"
                className="toolbar-clear-button"
                onClick={closeBookDetails}
                aria-label="Close book details"
              >
                ×
              </button>
            </div>

            <div className="book-detail-content">
              <div>
                <div className="book-detail-cover">
                  <img src={selectedBook.imageUrl} alt={`${selectedBook.title} cover`} />
                </div>

                <div className="book-detail-links">
                  <a href={selectedBook.link} target="_blank" rel="noreferrer" className="book-detail-link">
                    Goodreads
                  </a>
                  <button type="button" className="book-detail-link share-link" onClick={handleShareBookLink}>
                    Share
                  </button>
                </div>
              </div>
              <div className="book-detail-body">
                <h2>{selectedBook.title}</h2>
                <p className="book-detail-author">{selectedBook.author}</p>


                <div className="book-detail-grid">
                  <div className="book-detail-metric">
                    {selectedBook.rating ? (
                      <div className="book-detail-rating">
                        <span className="book-detail-label">Rating</span>
                        <div className="book-rating" style={{ justifyContent: 'left' }} aria-label={`User rating: ${selectedBook.rating} out of 5`}>
                          {renderStars(selectedBook.rating)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="book-detail-metric">
                    {selectedBook.averageRating ? (
                      <div className="book-detail-rating">
                        <span className="book-detail-label">Goodreads rating</span>
                        <strong>{selectedBook.averageRating.toFixed(2)}</strong>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="book-detail-grid">
                  <div className="book-detail-metric">
                    <span className="book-detail-label">An publicare</span>
                    <strong>{selectedBook.publishedYear || 'N/A'}</strong>
                  </div>
                  <div className="book-detail-metric">
                    <span className="book-detail-label">Pagini</span>
                    <strong>{selectedBook.pages ? selectedBook.pages.toLocaleString() : 'N/A'}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

      <section
        className="carousel-panel"
        aria-label="Book carousel"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
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
          <div className="books-carousel" ref={carouselRef}>
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

                  <div className="book-actions">
                    <button
                      type="button"
                      className="book-preview-button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        openBookDetails(book)
                      }}
                      aria-label={`Open details for ${book.title}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" strokeWidth={0.4} width="16" height="16" fill="currentColor" class="bi bi-eye" viewBox="0 0 16 16">
                        <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z" />
                        <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="book-preview-button book-share-button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        shareBookLink(book)
                      }}
                      aria-label={`Share link for ${book.title}`}
                    >
                      <svg fill="#ffffff" height="200px" width="200px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" xml:space="preserve" transform="matrix(-1, 0, 0, 1, 0, 0)"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <g> <path d="M384,153.6c-39.799,0-74.906,18.543-98.381,47.027l-138.812-92.535c4.284-9.583,6.793-20.122,6.793-31.292 C153.6,34.381,119.219,0,76.8,0C34.381,0,0,34.381,0,76.8c0,42.419,34.381,76.8,76.8,76.8c22.025,0,41.745-9.395,55.757-24.252 l138.854,92.578C261.897,239.821,256,259.925,256,281.6c0,14.362,2.901,27.93,7.262,40.815l-73.95,33.613 C171.273,326.835,139.247,307.2,102.4,307.2C45.85,307.2,0,353.05,0,409.6C0,466.15,45.85,512,102.4,512 c56.559,0,102.4-45.85,102.4-102.4c0-10.581-2.065-20.591-5.043-30.191l74.078-33.673C296.021,383.761,336.802,409.6,384,409.6 c70.69,0,128-57.31,128-128S454.69,153.6,384,153.6z M76.8,128c-28.228,0-51.2-22.972-51.2-51.2s22.972-51.2,51.2-51.2 S128,48.572,128,76.8S105.028,128,76.8,128z M102.4,486.4c-42.351,0-76.8-34.449-76.8-76.8s34.449-76.8,76.8-76.8 c42.351,0,76.8,34.449,76.8,76.8S144.751,486.4,102.4,486.4z M384,384c-56.465,0-102.4-45.935-102.4-102.4 c0-56.465,45.935-102.4,102.4-102.4c56.465,0,102.4,45.935,102.4,102.4C486.4,338.065,440.465,384,384,384z"></path> </g> </g> </g></svg>
                    </button>
                  </div>
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
