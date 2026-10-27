import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookCover } from 'book-cover-3d'
import { ArrowUpDown, BookOpen, Share2, SquareArrowOutUpRight, UserSearch, WandSparkles } from 'lucide-react'
import {
  buildBookShareUrl,
  buildGoodreadsApiUrl,
  extractBookUrlFromDescription,
  extractDescriptionMetadata,
  extractGoodreadsUserId,
  getFinishedBooksTotals,
} from './lib/goodreads'
import GradientASCII from './components/GradientASCII'
import GooeyNav from './components/GooeyNav'
import GlideSelect from './components/GlideSelect'
import './App.css'

const SHELF_OPTIONS = [
  { id: 'read', label: 'Citite', query: 'read' },
  { id: 'to-read', label: 'De citit', query: 'to-read' },
  { id: 'currently-reading', label: 'În curs', query: 'currently-reading' },
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

const DEFAULT_USER_ID = '18354013'

function App() {
  const initialRouteState = useMemo(() => getRouteStateFromPath(window.location.pathname), [])
  const [books, setBooks] = useState([])
  const [username, setUsername] = useState('')
  const [activeShelf, setActiveShelf] = useState(() => initialRouteState.shelf || 'read')
  const [activeAuthorFilter, setActiveAuthorFilter] = useState('all')
  const [activeBookSort, setActiveBookSort] = useState('recently-read')
  const [currentUserId, setCurrentUserId] = useState(() => initialRouteState.userId || DEFAULT_USER_ID)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [profileUrlInput, setProfileUrlInput] = useState('')
  const [generatedProfileUrl, setGeneratedProfileUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [bookQrCodeDataUrl, setBookQrCodeDataUrl] = useState('')
  const [requestedBookId, setRequestedBookId] = useState(() => initialRouteState.bookId || '')
  const [selectedBook, setSelectedBook] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const availableBookSortOptions = useMemo(() => getBookSortOptions(activeShelf), [activeShelf])
  const [error, setError] = useState('')
  const carouselRef = useRef(null)
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const rafIdRef = useRef(null)
  const pointerDragRef = useRef({ startX: 0, startY: 0, hasMoved: false })
  const lastScrollTimeRef = useRef(0)

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({}, '', `/${DEFAULT_USER_ID}`)
    }
  }, [])

  useEffect(() => {
    const syncRouteState = () => {
      const { userId, shelf, bookId } = getRouteStateFromPath(window.location.pathname)

      if (userId) {
        setCurrentUserId(userId)
      } else {
        setCurrentUserId(DEFAULT_USER_ID)
      }

      setActiveShelf(shelf)
      setRequestedBookId(bookId)
    }

    window.addEventListener('popstate', syncRouteState)
    return () => window.removeEventListener('popstate', syncRouteState)
  }, [])

  useEffect(() => {
    let isCancelled = false
    const resolvedUserId = currentUserId || DEFAULT_USER_ID
    const shelfUrl = buildGoodreadsApiUrl(resolvedUserId, activeShelf)

    const loadBooks = async () => {
      try {
        setIsLoading(true)
        setError('')
        const { books: rssBooks, username: rssUsername } = await fetchBooksFromRss(shelfUrl)
        if (isCancelled) return
        setBooks(rssBooks)
        if (rssUsername) {
          setUsername(rssUsername)
        }
      } catch (loadError) {
        if (isCancelled) return
        console.error(loadError)
        setError('Ups! Nu am găsit nimic la această adresă.')
      } finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    loadBooks()

    return () => {
      isCancelled = true
    }
  }, [activeShelf, currentUserId])

  useEffect(() => {
    const defaultSortForShelf = activeShelf === 'read' ? 'recently-read' : (availableBookSortOptions[0]?.id || 'newest')

    if (activeShelf === 'read' && activeBookSort !== 'recently-read') {
      setActiveBookSort('recently-read')
      return
    }

    if (activeShelf !== 'read' && (!availableBookSortOptions.some((option) => option.id === activeBookSort) || activeBookSort === 'recently-read')) {
      setActiveBookSort(defaultSortForShelf)
    }
  }, [activeBookSort, activeShelf, availableBookSortOptions])

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

  useEffect(() => {
    if (!selectedBook?.link) {
      setBookQrCodeDataUrl('')
      return
    }

    QRCode.toDataURL(selectedBook.link)
      .then((dataUrl) => setBookQrCodeDataUrl(dataUrl))
      .catch(() => setBookQrCodeDataUrl(''))
  }, [selectedBook?.link])

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
        label: author,
        tag: String(count),
      }))
  }, [books])

  const glideAuthorOptions = useMemo(() => [
    { value: 'all', label: 'Toti autorii', tag: String(books.length) },
    ...authorOptions,
  ], [books.length, authorOptions])

  const glideSortOptions = useMemo(() => (
    availableBookSortOptions.map((option) => ({
      value: option.id,
      label: option.label,
    }))
  ), [availableBookSortOptions])

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

  const shouldShowCarouselNavigation = Boolean(currentUserId || username)

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
    pointerDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      hasMoved: false,
    }

    if (!carouselRef.current) {
      return
    }

    if (event.pointerType === 'touch') {
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
    const deltaX = Math.abs(event.clientX - pointerDragRef.current.startX)
    const deltaY = Math.abs(event.clientY - pointerDragRef.current.startY)
    if (deltaX > 8 || deltaY > 8) {
      pointerDragRef.current.hasMoved = true
    }

    if (!dragState.current.active || !carouselRef.current || event.pointerType === 'touch') {
      return
    }

    event.preventDefault()

    const delta = event.clientX - dragState.current.startX
    carouselRef.current.scrollLeft = dragState.current.scrollLeft - delta
  }

  const handlePointerUp = (event) => {
    if (!carouselRef.current || event.pointerType === 'touch') {
      return
    }

    if (event && typeof event.pointerId === 'number' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragState.current.active = false
  }

  const handleBookTap = (book) => {
    if (pointerDragRef.current.hasMoved) {
      return
    }
    if (Date.now() - lastScrollTimeRef.current < 150) {
      return
    }
    openBookDetails(book)
  }

  const syncBookCoverFocus = () => {
    if (!carouselRef.current) {
      return
    }

    if (rafIdRef.current) {
      return
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      if (!carouselRef.current) {
        return
      }

      const carousel = carouselRef.current
      const carouselRect = carousel.getBoundingClientRect()
      const carouselCenter = carouselRect.left + carousel.clientWidth / 2
      const maxDistance = carousel.clientWidth * 0.72
      const cards = carousel.querySelectorAll('.book-card')

      cards.forEach((card) => {
        const rect = card.getBoundingClientRect()
        const cardCenter = rect.left + rect.width / 2
        const distanceFromCenter = Math.abs(cardCenter - carouselCenter)
        const ratio = Math.max(0, 1 - distanceFromCenter / maxDistance)
        const scale = 0.85 + ratio * 0.28
        const translateY = (1 - ratio) * 14
        const opacity = 0.75 + ratio * 0.25

        card.style.setProperty('--card-scale', scale.toFixed(3))
        card.style.setProperty('--card-translate-y', `${translateY.toFixed(1)}px`)
        card.style.setProperty('--card-opacity', opacity.toFixed(3))
      })
    })
  }

  useEffect(() => {
    if (!carouselRef.current || visibleBooks.length === 0) {
      return undefined
    }

    const carousel = carouselRef.current
    syncBookCoverFocus()

    const handleScroll = () => {
      lastScrollTimeRef.current = Date.now()
      pointerDragRef.current.hasMoved = true
      syncBookCoverFocus()
    }

    carousel.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll)

    return () => {
      carousel.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [visibleBooks.length, activeShelf, activeAuthorFilter, activeBookSort])

  return (
    <div style={{ position: 'relative', minHeight: '100vh', width: '100%', overflowX: 'hidden' }}>
      <div style={{ width: '100%', height: '600px', position: 'absolute', top: 0, left: 0, zIndex: 0, pointerEvents: 'none' }}>
        <GradientASCII
          colors={["#4f8ff7", "#e8f0ff", "#b4d0ff", "#7cb4fb"]}
          shape="horizon"
          characters="abcdefghijklmnopqrstuvwxyz!@#()_+~`|}{[]:;?><,./-="
          cellSize={18}
          density={0.94}
          glyphOpacity={0.61}
          glow={0}
          depthOfField={0}
          flicker={0.3}
          softness={0.08}
          scale={2.1}
          flow={2}
          speed={0.25}
          gradientOpacity={0.9}
          grain={0.04}
          variation={0}
          mouseInteraction
          scrambleRadius={0.1}
          clickEffect="wave"
          intro
          lightMode
        />
      </div>

      <main className="app-shell" style={{ position: 'relative', zIndex: 1 }}>
        <header className="library-header">
          <div className="library-header-row">
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
              <GooeyNav
                items={SHELF_OPTIONS.map((shelf) => ({ label: shelf.label }))}
                activeIndex={Math.max(0, SHELF_OPTIONS.findIndex((shelf) => shelf.id === activeShelf))}
                onChange={(index) => {
                  const shelf = SHELF_OPTIONS[index]
                  if (!shelf) return
                  setActiveShelf(shelf.id)
                  const nextPath = currentUserId ? `/${currentUserId}/${shelf.id}` : `/${shelf.id}`
                  window.history.pushState({}, '', nextPath)
                  setRequestedBookId('')
                  setSelectedBook(null)
                }}
                theme="dark"
                color="#8b5cf6"
                size="md"
                initialActiveIndex={0}
                frame
                particleCount={8}
                spread={28}
                animationTime={520}
                timeVariance={300}
                gooeyness={0.5}
                wobble={0.2}
                hoverEffect
              />
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
                      <BookOpen size={16} strokeWidth={2.2} aria-hidden="true" />
                      Goodreads
                    </a>
                    <button type="button" className="book-detail-link share-link" onClick={handleShareBookLink}>
                      <Share2 size={16} strokeWidth={2.2} aria-hidden="true" />
                      Share
                    </button>
                  </div>
                </div>
                <div className="book-detail-body">
                  <h2>{selectedBook.title}</h2>
                  <p className="book-detail-author">{selectedBook.author}</p>

                  <div className="book-details">
                    <div className="book-detail-grid">
                      <div className="book-detail-metric">
                        <span className="book-detail-label">An</span>
                        <strong>{selectedBook.publishedYear || 'N/A'}</strong>
                      </div>
                      <div className="book-detail-metric">
                        <span className="book-detail-label">Pagini</span>
                        <strong>{selectedBook.pages ? selectedBook.pages.toLocaleString() : 'N/A'}</strong>
                      </div>
                    </div>
                    <div className="book-detail-qr-box">
                      {bookQrCodeDataUrl ? (
                        <img src={bookQrCodeDataUrl} alt={`QR code for ${selectedBook.title}`} className="book-detail-qr-image" />
                      ) : null}
                    </div>
                  </div>

                  <div className="book-detail-grid">
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

        {isLoading ? (
          <div className="book-controls book-controls-placeholder" aria-hidden="true" />
        ) : books.length > 0 ? (
          <div className="book-controls" aria-label="Book controls">
            <div className="toolbar-group">
              <GlideSelect
                options={glideAuthorOptions}
                value={activeAuthorFilter}
                onChange={(val) => setActiveAuthorFilter(val)}
                ariaLabel="Selectează autorul"
                showTags
                accentColor="#c4b5fd"
                surfaceColor="rgba(15, 23, 42, 0.85)"
                highlightColor="rgba(139, 92, 246, 0.35)"
                textColor="#f8fafc"
                size="md"
                align={isMobile ? 'left' : 'right'}
                placement='bottom'
                radius={16}
                menuWidth={240}
                icon={<UserSearch size={13} strokeWidth={2} />}
              />
            </div>

            <div className="toolbar-group">
              <GlideSelect
                options={glideSortOptions}
                value={activeBookSort}
                onChange={(val) => setActiveBookSort(val)}
                ariaLabel="Sortează cărțile"
                accentColor="#c4b5fd"
                surfaceColor="rgba(15, 23, 42, 0.85)"
                highlightColor="rgba(139, 92, 246, 0.35)"
                textColor="#f8fafc"
                size="md"
                align={isMobile ? 'left' : 'right'}
                radius={16}
                menuWidth={160}
                icon={<ArrowUpDown size={13} strokeWidth={2} />}
              />
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
          {shouldShowCarouselNavigation ? (
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
                  <div
                    className="book-cover-surface"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleBookTap(book)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openBookDetails(book)
                      }
                    }}
                    aria-label={`Deschide detaliile pentru ${book.title}`}
                  >
                    <BookCover
                      width={180}
                      height={260}
                      thickness={book.thickness}
                      rotate={20}
                      rotateHover={30}
                      perspective={900}
                      pagesOffset={4}
                      bgColor="#0f172a"
                      shadowColor="transparent"
                    >
                      <div className="book-cover-art">
                        <img src={book.imageUrl} alt={`${book.title} cover`} />
                      </div>
                    </BookCover>
                  </div>

                  <div className="book-meta">
                    <h2
                      onClick={() => handleBookTap(book)}
                      style={{ cursor: 'pointer' }}
                    >
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
                        <SquareArrowOutUpRight size={16} strokeWidth={2} aria-hidden="true" />
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
                        <Share2 size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {shouldShowCarouselNavigation ? (
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

        <button
          type="button"
          className="profile-url-trigger"
          onClick={() => setShowProfileModal(true)}
        >
          <WandSparkles size={16} strokeWidth={2} />
          Generează URL-ul tău
        </button>
      </main>
    </div>
  )
}

export default App
