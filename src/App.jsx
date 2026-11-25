import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowLeft, ArrowUpDown, Bookmark, BookOpen, Check, ChevronDown, Compass, Copy, FileText, Globe, Library, Loader2, Lock, LogOut, MoreVertical, Pencil, Plus, QrCode, Save, Search, Share2, Shield, Sparkles, Star, Trash2, Upload, UserRoundPen, UserSearch, WandSparkles, X } from 'lucide-react'
import PeekRating from './components/PeekRating'
import {
  buildBookShareUrl,
  buildGoodreadsApiUrl,
  getFinishedBooksTotals,
  getRouteStateFromPath,
  getUserIdFromCookie,
  isAdminPath,
  isRootPath,
  matchesBookSearch,
  matchesShelf,
  normalizeCsvBook,
  parseGoodreadsCsv,
  setUserIdCookie,
} from './lib/goodreads'
import RubberSegment from './components/RubberSegment'
import JellyRadio from './components/JellyRadio'
import GlideSelect from './components/GlideSelect'
import AuthModalView from './components/AuthModalView'
import { createClient, isSupabaseConfigured } from './lib/client'
import './App.css'

const AdminPage = lazy(() => import('./components/AdminPage'))


const SHELF_OPTIONS = [
  { id: 'read', label: 'Citite', query: 'read' },
  { id: 'to-read', label: 'De citit', query: 'to-read' },
  { id: 'currently-reading', label: 'În curs', query: 'currently-reading' },
  { id: 'did-not-finish', label: 'DNF', query: 'did-not-finish' },
]

const TOP_NAV_OPTIONS = [
  { id: 'shelves', label: 'Rafturi', icon: <BookOpen size={16} strokeWidth={2.2} className="shrink-0" /> },
  { id: 'explore', label: 'Descoperă', icon: <Compass size={16} strokeWidth={2.2} className="shrink-0" /> },
  { id: 'collections', label: 'Colecții', icon: <Library size={16} strokeWidth={2.2} className="shrink-0" /> },
]

const COLLECTION_FILTER_OPTIONS = [
  { id: 'all', label: 'Toate' },
  { id: 'public', label: 'Publice' },
  { id: 'private', label: 'Private' },
]

const getShelfLabel = (shelfId) => {
  const match = SHELF_OPTIONS.find((s) => s.id === shelfId)
  return match ? match.label : 'De citit'
}

const BOOK_SORT_OPTIONS = [
  {
    id: 'recently-added',
    label: 'Recent adăugate',
    getValue: (book) => Date.parse(book.dateAdded || 0) || 0,
  },
  {
    id: 'recently-read',
    label: 'Recent citite',
    getValue: (book) => Date.parse(book.readAt || book.dateAdded || 0) || 0,
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
  if (shelfId === 'to-read' || shelfId === 'currently-reading' || shelfId === 'did-not-finish') {
    return BOOK_SORT_OPTIONS.filter((option) => option.id !== 'recently-read' && option.id !== 'best-rated')
  }

  return BOOK_SORT_OPTIONS
}

const formatEventTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (isNaN(diffSec) || diffSec < 0) return ''
  if (diffSec < 60) return 'chiar acum'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `acum ${diffMin} ${diffMin === 1 ? 'minut' : 'minute'}`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `acum ${diffHr} ${diffHr === 1 ? 'oră' : 'ore'}`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 30) return `acum ${diffDays} ${diffDays === 1 ? 'zi' : 'zile'}`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `acum ${diffMonths} ${diffMonths === 1 ? 'lună' : 'luni'}`
  return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
}

const renderFeedStatement = (event, onVisitUser) => {
  const { eventType, metadata, collection, user } = event || {}
  const userName = user?.displayName || user?.userId || 'Cineva'
  const userId = user?.userId

  const targetShelf = collection ? 'collections' : metadata?.shelf || 'read'

  const userBtn = (
    <button
      type="button"
      className="feed-username-btn"
      onClick={(e) => {
        e.stopPropagation()
        if (userId && onVisitUser) {
          onVisitUser(userId, targetShelf)
        }
      }}
      title={userId ? `Vezi profilul lui ${userName}` : undefined}
    >
      {userName}
    </button>
  )

  if (eventType === 'shelf_add') {
    const shelf = metadata?.shelf
    if (shelf === 'read') {
      return (
        <div className="feed-statement">
          {userBtn}
          <span className="feed-statement-action">a adăugat la</span>
          <span className="feed-statement-highlight">Citite</span>
        </div>
      )
    }
    if (shelf === 'currently-reading') {
      return (
        <div className="feed-statement">
          {userBtn}
          <span className="feed-statement-action">citește în prezent</span>
        </div>
      )
    }
    if (shelf === 'to-read') {
      return (
        <div className="feed-statement">
          {userBtn}
          <span className="feed-statement-action">vrea să citească</span>
        </div>
      )
    }
    return (
      <div className="feed-statement">
        {userBtn}
        <span className="feed-statement-action">a adăugat pe raft</span>
      </div>
    )
  }

  if (eventType === 'book_rated') {
    const rating = metadata?.rating
    const starText = rating ? (Number(rating) === 1 ? '1 stea' : `${rating} stele`) : null
    return (
      <div className="feed-statement">
        {userBtn}
        <span className="feed-statement-action">a acordat</span>
        {starText ? (
          <span className="feed-statement-highlight">{starText}</span>
        ) : (
          <span className="feed-statement-action">o notă</span>
        )}
      </div>
    )
  }

  if (eventType === 'collection_updated') {
    const title = collection?.title
    return (
      <div className="feed-statement">
        {userBtn}
        <span className="feed-statement-action">a actualizat colecția</span>
        {title && <span className="feed-statement-highlight">„{title}”</span>}
      </div>
    )
  }

  if (eventType === 'csv_upload') {
    const count = metadata?.count
    return (
      <div className="feed-statement">
        {userBtn}
        <span className="feed-statement-action">a importat</span>
        <span className="feed-statement-highlight">{count ? `${count} cărți` : 'cărți'}</span>
      </div>
    )
  }

  return (
    <div className="feed-statement">
      {userBtn}
      <span className="feed-statement-action">a actualizat biblioteca</span>
    </div>
  )
}

const fetchBooksFromApi = async (apiUrl, signal) => {
  const response = await fetch(apiUrl, { signal, cache: 'no-cache' })

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  const responseText = await response.text()
  const trimmedText = responseText.trim()

  if (
    contentType.includes('application/json') ||
    trimmedText.startsWith('{') ||
    trimmedText.startsWith('[')
  ) {
    const data = JSON.parse(trimmedText)
    const username = data?.username || data?.displayName || ''
    const description = data?.description || ''

    if (typeof data?.csv === 'string') {
      const csvBooks = parseGoodreadsCsv(data.csv)
      return { username, description, books: csvBooks }
    }

    const rawBooks = Array.isArray(data?.books) ? data.books : Array.isArray(data) ? data : []
    const normalizedBooks = rawBooks.map((book, index) => normalizeCsvBook(book, index))

    return {
      username,
      description,
      books: normalizedBooks,
    }
  }

  const csvBooks = parseGoodreadsCsv(responseText)
  return {
    username: '',
    description: '',
    books: csvBooks,
  }
}

function BookCover3D({ thickness = 24, children }) {
  return (
    <div
      className="book-3d-wrapper"
      style={{ '--book-thickness': `${thickness}px` }}
    >
      <div className="book">
        {children}
      </div>
    </div>
  )
}

function BookCoverCard({
  book,
  isPriority = false,
  onClick,
}) {
  const [isInView, setIsInView] = useState(isPriority)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const containerRef = useRef(null)
  const hasLoadedRef = useRef(false)
  const safeCoverUrl = book?.imageUrl || ''

  useEffect(() => {
    hasLoadedRef.current = false
    setIsLoaded(false)
    setHasError(false)
  }, [safeCoverUrl])

  useEffect(() => {
    if (isPriority) {
      setIsInView(true)
    }
  }, [isPriority])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    if (typeof IntersectionObserver === 'undefined') {
      setIsInView(true)
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry) {
          setIsInView(entry.isIntersecting)
        }
      },
      {
        rootMargin: '350px 450px',
      }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      className="book-cover-surface"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (event?.defaultPrevented || event?.target?.closest('.glide-select, .book-controls')) {
          return
        }
        onClick?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.()
        }
      }}
      aria-label={`Deschide detaliile pentru ${book?.title || 'carte'}`}
    >
      {isInView ? (
        <BookCover3D thickness={book?.thickness}>
          <div className="book-cover-art">
            {safeCoverUrl && !hasError ? (
              <img
                src={safeCoverUrl}
                alt={`${book?.title || 'Carte'} cover`}
                loading="lazy"
                decoding="async"
                onLoad={() => {
                  hasLoadedRef.current = true
                  setIsLoaded(true)
                }}
                onError={() => setHasError(true)}
                ref={(imgNode) => {
                  if (imgNode && imgNode.complete && imgNode.naturalWidth > 0 && !hasLoadedRef.current) {
                    hasLoadedRef.current = true
                    setIsLoaded(true)
                  }
                }}
                className={isLoaded || hasLoadedRef.current ? 'loaded' : ''}
              />
            ) : null}
            {(!isLoaded && !hasLoadedRef.current || !safeCoverUrl || hasError) && (
              <div className="book-cover-placeholder" aria-hidden="true" />
            )}
          </div>
        </BookCover3D>
      ) : (
        <div className="book-cover-placeholder-flat" aria-hidden="true">
          <div className="book-cover-art">
            <div className="book-cover-placeholder" />
          </div>
        </div>
      )}
    </div>
  )
}

function CollectionRow({
  collection,
  isOwner,
  isExplore = false,
  showCreator,
  onSelectCreator,
  onAddBookClick,
  onDeleteCollection,
  onBookClick,
  onEditCollection,
}) {
  const rowContainerRef = useRef(null)
  const rowCarouselRef = useRef(null)
  const rowDragRef = useRef({ isDown: false, active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0 })
  const rowTapMovedRef = useRef(false)
  const [isRowInView, setIsRowInView] = useState(false)

  const [showDeletePopup, setShowDeletePopup] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuContainerRef = useRef(null)

  useEffect(() => {
    if (!isMenuOpen) return undefined

    const handlePointerDownOutside = (event) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target)) {
        setIsMenuOpen(false)
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDownOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!showDeletePopup) return undefined
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowDeletePopup(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showDeletePopup])

  const handleConfirmDelete = async () => {
    setIsDeleting(true)
    try {
      await onDeleteCollection?.(collection)
    } finally {
      setIsDeleting(false)
      setShowDeletePopup(false)
    }
  }

  const normalizedBooks = useMemo(
    () => (Array.isArray(collection.books) ? collection.books.map((b, idx) => normalizeCsvBook(b, idx)) : []),
    [collection.books],
  )
  const bookCount = normalizedBooks.length
  const countLabel = `${bookCount} ${bookCount === 1 ? 'carte' : 'cărți'}`

  useEffect(() => {
    const el = rowContainerRef.current
    if (!el) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setIsRowInView(true)
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry) {
          setIsRowInView(entry.isIntersecting)
        }
      },
      {
        rootMargin: '450px 0px',
      }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const scrollRow = (direction) => {
    if (!rowCarouselRef.current) return
    const firstCard = rowCarouselRef.current.querySelector('.book-card')
    const cardWidth = firstCard ? firstCard.getBoundingClientRect().width : 200
    rowCarouselRef.current.scrollBy({
      left: direction * (cardWidth + 16),
      behavior: 'smooth',
    })
  }

  const handleRowPointerDown = (event) => {
    rowTapMovedRef.current = false
    if (!rowCarouselRef.current || event.pointerType === 'touch') return
    if (event.target.closest('button, a, input')) return
    rowDragRef.current = {
      isDown: true,
      active: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: rowCarouselRef.current.scrollLeft,
    }
  }

  const handleRowPointerMove = (event) => {
    if (!rowDragRef.current.isDown || event.pointerType === 'touch') return
    const dx = event.clientX - rowDragRef.current.startX
    const dy = event.clientY - rowDragRef.current.startY
    if (!rowDragRef.current.active && Math.hypot(dx, dy) > 6) {
      rowDragRef.current.active = true
      rowTapMovedRef.current = true
      if (typeof event.currentTarget?.setPointerCapture === 'function') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
    }
    if (!rowDragRef.current.active || !rowCarouselRef.current) return
    event.preventDefault()
    rowCarouselRef.current.scrollLeft = rowDragRef.current.scrollLeft - dx
  }

  const handleRowPointerUp = (event) => {
    if (rowDragRef.current.active && typeof event.currentTarget?.hasPointerCapture === 'function') {
      if (typeof event.pointerId === 'number' && event.currentTarget.hasPointerCapture(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
    }
    rowDragRef.current = { isDown: false, active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0 }
  }

  return (
    <div ref={rowContainerRef} className="collection-row-card">
      <div className="collection-row-header">
        <div className="collection-row-title-group">
          <div className="collection-row-title-line">
            {!isExplore && (
              collection.isPrivate ? (
                <span
                  className="collection-row-privacy-icon is-private"
                  title="Colecție privată (vizibilă doar pentru tine)"
                  aria-label="Colecție privată"
                >
                  <Lock size={15} />
                </span>
              ) : isOwner ? (
                <span
                  className="collection-row-privacy-icon is-public"
                  title="Colecție publică (vizibilă pe Explorează)"
                  aria-label="Colecție publică"
                >
                  <Globe size={15} />
                </span>
              ) : null
            )}
            <h3 className="collection-row-title">{collection.title}</h3>
          </div>
          <div className="collection-row-meta-line">
            <span className="collection-row-count" title={countLabel}>
              {countLabel}
            </span>
            {showCreator && collection.username ? (
              <button
                type="button"
                className="collection-row-creator-btn"
                onClick={() => onSelectCreator?.(collection.userId)}
                title={`Vezi profilul lui ${collection.username}`}
              >
                de <span>{collection.username}</span>
              </button>
            ) : null}
          </div>
        </div>

        {isOwner && !isExplore ? (
          <div className="collection-row-actions" ref={menuContainerRef}>
            <button
              type="button"
              className={`collection-menu-trigger-btn ${isMenuOpen ? 'open' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setIsMenuOpen((prev) => !prev)
              }}
              title="Opțiuni colecție"
              aria-label="Opțiuni colecție"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <MoreVertical size={18} />
            </button>

            {isMenuOpen && (
              <div
                className="collection-actions-menu"
                role="menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="collection-menu-item"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsMenuOpen(false)
                    onAddBookClick?.(collection)
                  }}
                >
                  <Plus size={16} />
                  <span>Adaugă o carte</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="collection-menu-item"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsMenuOpen(false)
                    onEditCollection?.(collection)
                  }}
                >
                  <Pencil size={15} />
                  <span>Editează colecția</span>
                </button>

                <div className="collection-menu-divider" role="separator" />

                <button
                  type="button"
                  role="menuitem"
                  className="collection-menu-item collection-menu-item-danger"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsMenuOpen(false)
                    setShowDeletePopup(true)
                  }}
                >
                  <Trash2 size={15} />
                  <span>Șterge colecția</span>
                </button>
              </div>
            )}
          </div>
        ) : null}

        {collection.description ? (
          <p className="collection-row-description">{collection.description}</p>
        ) : null}
      </div>

      {showDeletePopup && (
        <div
          className="collection-delete-confirm-overlay"
          onClick={() => !isDeleting && setShowDeletePopup(false)}
          role="presentation"
        >
          <div
            className="collection-delete-confirm-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-title-${collection.id}`}
          >
            <div className="collection-delete-confirm-icon-wrap">
              <Trash2 size={20} />
            </div>
            <p className="collection-delete-confirm-desc">
              Ești sigur că vrei să ștergi colecția <strong>„{collection.title}”</strong>?
            </p>
            <div className="collection-delete-confirm-btns">
              <button
                type="button"
                className="collection-delete-confirm-cancel"
                onClick={() => setShowDeletePopup(false)}
                disabled={isDeleting}
              >
                Anulează
              </button>
              <button
                type="button"
                className="collection-delete-confirm-delete"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 size={14} className="spin" /> : 'Șterge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {normalizedBooks.length === 0 ? (
        <div className="collection-row-empty">
          <span>Nicio carte în această colecție încă.</span>
          {isOwner && !isExplore ? (
            <button
              type="button"
              className="collection-empty-add-btn"
              onClick={() => onAddBookClick?.(collection)}
            >
              <Plus size={14} />
              <span>Adaugă prima carte</span>
            </button>
          ) : null}
        </div>
      ) : (
        <div
          className="carousel-panel collection-carousel-panel"
          onPointerDown={handleRowPointerDown}
          onPointerMove={handleRowPointerMove}
          onPointerUp={handleRowPointerUp}
          onPointerCancel={handleRowPointerUp}
        >
          {normalizedBooks.length > 2 ? (
            <button
              type="button"
              className="nav-button"
              onClick={() => scrollRow(-1)}
              aria-label={`Derulează stânga în ${collection.title}`}
            >
              ←
            </button>
          ) : null}

          <div className="books-carousel collection-row-carousel" ref={rowCarouselRef}>
            {normalizedBooks.map((book, index) => {
              const safeCoverUrl = book.imageUrl || ''

              return (
                <article key={`${collection.id}-${book.bookId || book.id}`} className="book-card">
                  <BookCoverCard
                    book={book}
                    isPriority={isRowInView && index < 4}
                    onClick={() => {
                      if (rowDragRef.current.active || rowTapMovedRef.current) return
                      onBookClick?.(book, { ...collection, books: normalizedBooks })
                    }}
                  />

                  <div className="book-meta">
                    <h2
                      onClick={() => {
                        if (rowDragRef.current.active || rowTapMovedRef.current) return
                        onBookClick?.(book, { ...collection, books: normalizedBooks })
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {book.title}
                    </h2>
                    <p>{book.author}</p>
                  </div>
                </article>
              )
            })}
          </div>

          {normalizedBooks.length > 2 ? (
            <button
              type="button"
              className="nav-button"
              onClick={() => scrollRow(1)}
              aria-label={`Derulează dreapta în ${collection.title}`}
            >
              →
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ShelfSearchInput({ searchQuery, onSearch }) {
  const [isExpanded, setIsExpanded] = useState(Boolean(searchQuery))
  const [localText, setLocalText] = useState(searchQuery || '')
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const timerRef = useRef(null)

  // Sync when parent resets search
  useEffect(() => {
    setLocalText(searchQuery || '')
    if (searchQuery) {
      setIsExpanded(true)
    }
  }, [searchQuery])

  const handleChange = (e) => {
    const nextVal = e.target.value
    setLocalText(nextVal)

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      onSearch(nextVal)
    }, 1000)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      onSearch(localText)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      if (localText || searchQuery) {
        setLocalText('')
        onSearch('')
      } else {
        setIsExpanded(false)
      }
    }
  }

  const handleClearOrClose = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    if (localText || searchQuery) {
      setLocalText('')
      onSearch('')
      inputRef.current?.focus()
    } else {
      setIsExpanded(false)
    }
  }

  const handleToggle = () => {
    if (!isExpanded) {
      setIsExpanded(true)
      setTimeout(() => inputRef.current?.focus(), 50)
    } else if (!localText.trim() && !searchQuery.trim()) {
      setIsExpanded(false)
    } else {
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!isExpanded) return undefined

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        if (!localText.trim() && !searchQuery.trim()) {
          setIsExpanded(false)
        }
      }
    }

    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [isExpanded, localText, searchQuery])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`client-shelf-search ${isExpanded ? 'expanded' : ''}`}
    >
      <button
        type="button"
        className="client-shelf-search-btn"
        onClick={handleToggle}
        aria-label={isExpanded ? 'Căutare cărți' : 'Caută cărți'}
        title={isExpanded ? 'Căutare cărți' : 'Caută cărți'}
      >
        <Search size={isExpanded ? 14 : 16} strokeWidth={2.2} />
      </button>

      {isExpanded && (
        <input
          ref={inputRef}
          type="text"
          className="client-shelf-search-input"
          placeholder="Caută cărți..."
          value={localText}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      )}

      {isExpanded && (
        <button
          type="button"
          className="client-shelf-search-clear"
          onClick={handleClearOrClose}
          aria-label={localText ? 'Șterge căutarea' : 'Închide căutarea'}
          title={localText ? 'Șterge căutarea' : 'Închide căutarea'}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}

function App() {
  const initialRouteState = useMemo(() => getRouteStateFromPath(window.location.pathname), [])
  const [books, setBooks] = useState([])
  const [username, setUsername] = useState('')
  const [activeShelf, setActiveShelf] = useState(() => initialRouteState.shelf || 'read')
  const lastBookShelfRef = useRef(
    initialRouteState.shelf && initialRouteState.shelf !== 'collections'
      ? initialRouteState.shelf
      : 'read'
  )
  if (activeShelf !== 'collections') {
    lastBookShelfRef.current = activeShelf
  }
  const [activeAuthorFilter, setActiveAuthorFilter] = useState('all')
  const [activeBookSort, setActiveBookSort] = useState(() =>
    initialRouteState.shelf && initialRouteState.shelf !== 'read'
      ? 'recently-added'
      : 'recently-read'
  )
  const [bookSearchQuery, setBookSearchQuery] = useState('')
  const [currentUserId, setCurrentUserId] = useState(() => {
    if (initialRouteState.userId) return initialRouteState.userId
    if (!isSupabaseConfigured()) return getUserIdFromCookie() || ''
    return ''
  })
  const [cookieUserId, setCookieUserId] = useState(() => getUserIdFromCookie())
  const [supabaseUser, setSupabaseUser] = useState(null)
  const supabaseUserRef = useRef(supabaseUser)
  useEffect(() => {
    supabaseUserRef.current = supabaseUser
  }, [supabaseUser])
  const [isCheckingAuth, setIsCheckingAuth] = useState(() => isSupabaseConfigured())
  const [isAdminRoute, setIsAdminRoute] = useState(() => isAdminPath(window.location.pathname))
  const [isAdminUser, setIsAdminUser] = useState(false)
  const [isVerifyingAdmin, setIsVerifyingAdmin] = useState(() => isSupabaseConfigured())
  const supabaseAccessTokenRef = useRef('')
  const verifiedAdminAuthIdRef = useRef(null)
  const getSupabaseAccessToken = useCallback(() => supabaseAccessTokenRef.current, [])
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [userDescription, setUserDescription] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [isUploadingCsv, setIsUploadingCsv] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [savedName, setSavedName] = useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [savedDescription, setSavedDescription] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [generatedProfileUrl, setGeneratedProfileUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [sharedUrl, setSharedUrl] = useState(false)
  const [bookQrCodeDataUrl, setBookQrCodeDataUrl] = useState('')
  const [showBookQrModal, setShowBookQrModal] = useState(false)
  const [requestedBookId, setRequestedBookId] = useState(() => initialRouteState.bookId || '')
  const [selectedBook, setSelectedBook] = useState(null)
  const [targetShelf, setTargetShelf] = useState('to-read')
  const [shelfDropdownOpen, setShelfDropdownOpen] = useState(false)
  const [isSavingShelf, setIsSavingShelf] = useState(false)
  const [savedShelf, setSavedShelf] = useState(false)
  const [showRatingPopup, setShowRatingPopup] = useState(false)
  const [isSavingRating, setIsSavingRating] = useState(false)
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [openedFromSearch, setOpenedFromSearch] = useState(false)
  const [userCollections, setUserCollections] = useState([])
  const [exploreCollections, setExploreCollections] = useState([])
  const [activeCollectionFilter, setActiveCollectionFilter] = useState('all')
  const [isLoadingCollections, setIsLoadingCollections] = useState(false)
  const [isExploreMode, setIsExploreMode] = useState(
    () => isRootPath(window.location.pathname) || !initialRouteState.userId,
  )
  const [feedEvents, setFeedEvents] = useState([])
  const [isLoadingFeed, setIsLoadingFeed] = useState(false)
  const [quickAddingBookId, setQuickAddingBookId] = useState(null)
  const hasLoadedFeedRef = useRef(false)
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false)
  const [newCollectionTitle, setNewCollectionTitle] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')
  const [newCollectionIsPrivate, setNewCollectionIsPrivate] = useState(false)
  const [newCollectionError, setNewCollectionError] = useState('')
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [editingCollection, setEditingCollection] = useState(null)
  const [editCollectionTitle, setEditCollectionTitle] = useState('')
  const [editCollectionDescription, setEditCollectionDescription] = useState('')
  const [editCollectionIsPrivate, setEditCollectionIsPrivate] = useState(false)
  const [editCollectionError, setEditCollectionError] = useState('')
  const [isSavingEditCollection, setIsSavingEditCollection] = useState(false)
  const [targetCollectionForSearch, setTargetCollectionForSearch] = useState(null)
  const [activeModalCollection, setActiveModalCollection] = useState(null)
  const [isAddingBookToCollection, setIsAddingBookToCollection] = useState(false)
  const [isRemovingFromCollection, setIsRemovingFromCollection] = useState(false)
  const [collectionsRefreshTrigger, setCollectionsRefreshTrigger] = useState(0)
  const [userCollectionSummaries, setUserCollectionSummaries] = useState([])
  const [selectedBookCollectionIds, setSelectedBookCollectionIds] = useState(new Set())
  const [collectionActionInProgressId, setCollectionActionInProgressId] = useState(null)
  const shelfDropdownRef = useRef(null)
  const enrichingBookIdsRef = useRef(new Set())
  const bookMetadataCacheRef = useRef(new Map())
  const [isDescriptionLoading, setIsDescriptionLoading] = useState(false)

  const getCachedBookMetadata = useCallback((book) => {
    if (!book) return null
    const bId = String(book.bookId || book.id || '').trim()
    const isbn = String(book.isbn || book.isbn13 || '').replace(/[^0-9X]/gi, '').trim()
    if (bId && bookMetadataCacheRef.current.has(bId)) {
      return bookMetadataCacheRef.current.get(bId)
    }
    if (isbn && bookMetadataCacheRef.current.has(isbn)) {
      return bookMetadataCacheRef.current.get(isbn)
    }
    return null
  }, [])

  const setCachedBookMetadata = useCallback((bookId, isbn, data) => {
    if (!data) return
    const bId = String(bookId || '').trim()
    const cleanI = String(isbn || '').replace(/[^0-9X]/gi, '').trim()
    if (bId) {
      const existing = bookMetadataCacheRef.current.get(bId) || {}
      bookMetadataCacheRef.current.set(bId, { ...existing, ...data })
    }
    if (cleanI) {
      const existing = bookMetadataCacheRef.current.get(cleanI) || {}
      bookMetadataCacheRef.current.set(cleanI, { ...existing, ...data })
    }
  }, [])

  const enrichBookWithCache = useCallback((book) => {
    if (!book) return book
    const cached = getCachedBookMetadata(book)
    if (!cached) {
      if (book.description) {
        setCachedBookMetadata(book.bookId || book.id, book.isbn, {
          description: book.description,
          pages: book.pages,
          publishedYear: book.publishedYear,
          mainCategory: book.mainCategory,
          coverUrl: book.imageUrl || book.coverUrl,
        })
      }
      return book
    }
    return {
      ...book,
      description: book.description || cached.description || '',
      pages: book.pages || cached.pages || cached.pageCount || '',
      publishedYear: book.publishedYear || cached.publishedYear || '',
      mainCategory: book.mainCategory || cached.mainCategory || '',
      imageUrl: book.imageUrl || cached.coverUrl || cached.imageUrl || '',
      coverUrl: book.coverUrl || cached.coverUrl || cached.imageUrl || '',
    }
  }, [getCachedBookMetadata, setCachedBookMetadata])
  const [userShelvesByBookId, setUserShelvesByBookId] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isShelfReady, setIsShelfReady] = useState(false)
  const [bookRenderLimit, setBookRenderLimit] = useState(50)
  const [booksFetchTrigger, setBooksFetchTrigger] = useState(0)
  const availableBookSortOptions = useMemo(() => getBookSortOptions(activeShelf), [activeShelf])
  const [error, setError] = useState('')
  const carouselRef = useRef(null)
  const dragState = useRef({ isDown: false, active: false, startX: 0, startY: 0, scrollLeft: 0 })
  const rafIdRef = useRef(null)
  const pointerDragRef = useRef({ startX: 0, startY: 0, hasMoved: false })
  const lastScrollTimeRef = useRef(0)
  const loadedUserIdRef = useRef(null)
  const syncedAuthUserIdRef = useRef(null)
  const nameInputRef = useRef(null)

  // In-memory caches to prevent refetching rafturi (books) and collections across tab switches
  const booksByUserIdCacheRef = useRef(new Map())
  const collectionsByUserIdCacheRef = useRef(new Map())
  const hasLoadedExploreCollectionsRef = useRef(false)
  const lastBooksFetchTriggerRef = useRef(0)
  const lastUserCollectionsRefreshTriggerRef = useRef(0)
  const lastExploreCollectionsRefreshTriggerRef = useRef(0)

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const isInitialRootUrlRef = useRef(
    typeof window !== 'undefined' && isRootPath(window.location.pathname),
  )

  const [modalDragOffset, setModalDragOffset] = useState({ x: 0, y: 0 })
  const [modalSwipeExit, setModalSwipeExit] = useState(null)
  const [isModalEntering, setIsModalEntering] = useState(false)
  const [modalToast, setModalToast] = useState('')
  const modalToastTimeoutRef = useRef(null)
  const ratingCloseTimeoutRef = useRef(null)
  const modalPointerRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    currentDx: 0,
    currentDy: 0,
    rafId: null,
    isDragging: false,
    directionLocked: null,
  })
  const modalCardRef = useRef(null)
  const profileModalBackdropPointerDownRef = useRef(false)

  const isUserLoggedIn = useMemo(() => {
    if (isSupabaseConfigured()) {
      return Boolean(supabaseUser)
    }
    return Boolean(cookieUserId || getUserIdFromCookie())
  }, [supabaseUser, cookieUserId])

  const isOtherUserProfile = useMemo(() => {
    if (!isUserLoggedIn) {
      return true
    }

    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!activeUser) {
      return true
    }
    if (!currentUserId) {
      return false
    }

    return String(activeUser) !== String(currentUserId)
  }, [isUserLoggedIn, currentUserId, cookieUserId])

  const isOwnProfile = useMemo(() => {
    if (!isUserLoggedIn) return false
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!activeUser) return false
    if (!currentUserId) return true
    return String(activeUser) === String(currentUserId)
  }, [isUserLoggedIn, currentUserId, cookieUserId])

  const isVisitingOtherUser = useMemo(() => {
    if (isExploreMode || !currentUserId) return false
    return !isOwnProfile
  }, [isExploreMode, currentUserId, isOwnProfile])

  const visibleTopNavOptions = useMemo(() => {
    if (isVisitingOtherUser) {
      return TOP_NAV_OPTIONS.filter((item) => item.id !== 'explore')
    }
    return TOP_NAV_OPTIONS
  }, [isVisitingOtherUser])

  const isOwnCollectionModal = useMemo(() => {
    if (isExploreMode || !activeModalCollection || !isUserLoggedIn) return false
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!activeUser) return false
    return String(activeModalCollection.userId) === String(activeUser)
  }, [activeModalCollection, isUserLoggedIn, cookieUserId, isExploreMode])

  const isSwipableModal = useMemo(() => {
    if (activeModalCollection) {
      return !isOwnCollectionModal
    }
    return isOtherUserProfile
  }, [activeModalCollection, isOwnCollectionModal, isOtherUserProfile])

  const modalBookList = useMemo(() => {
    if (activeModalCollection && Array.isArray(activeModalCollection.books)) {
      return activeModalCollection.books
    }
    return books
  }, [activeModalCollection, books])

  const collectionCounts = useMemo(() => {
    const publicCount = userCollections.filter((c) => !c.isPrivate).length
    const privateCount = userCollections.filter((c) => Boolean(c.isPrivate)).length
    return {
      all: isOwnProfile ? userCollections.length : publicCount,
      public: publicCount,
      private: privateCount,
    }
  }, [userCollections, isOwnProfile])

  const visibleCollectionFilterOptions = useMemo(() => {
    if (!isOwnProfile) {
      return COLLECTION_FILTER_OPTIONS.filter((opt) => opt.id !== 'private')
    }
    return COLLECTION_FILTER_OPTIONS
  }, [isOwnProfile])

  const filteredUserCollections = useMemo(() => {
    if (activeCollectionFilter === 'public') {
      return userCollections.filter((c) => !c.isPrivate)
    }
    if (activeCollectionFilter === 'private') {
      return isOwnProfile ? userCollections.filter((c) => Boolean(c.isPrivate)) : userCollections
    }
    return userCollections
  }, [userCollections, activeCollectionFilter, isOwnProfile])

  const mergedFeedItems = useMemo(() => {
    const collectionEventsById = new Set()
    for (const ev of feedEvents) {
      if (ev.collection?.collectionId) {
        collectionEventsById.add(String(ev.collection.collectionId))
      }
    }

    const collectionFeedItems = (exploreCollections || [])
      .filter((col) => !col.isPrivate && !collectionEventsById.has(String(col.id)))
      .filter((col) => Array.isArray(col.books) && col.books.length > 0)
      .map((col) => ({
        id: `col-${col.id}`,
        eventType: 'collection_updated',
        createdAt: col.updatedAt || col.createdAt,
        user: {
          userId: col.userId,
          displayName: col.username || col.userId,
        },
        collection: {
          collectionId: String(col.id),
          title: col.title,
          description: col.description,
          isPrivate: false,
          books: col.books || [],
        },
        books: (col.books || []).map((b) => ({
          ...b,
          imageUrl: b.imageUrl || b.coverUrl || '',
          coverUrl: b.coverUrl || b.imageUrl || '',
        })),
        metadata: {},
      }))

    const combined = [...feedEvents, ...collectionFeedItems]
    const withBooks = combined.filter(
      (ev) => ev.book || (Array.isArray(ev.books) && ev.books.length > 0),
    )

    withBooks.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime()
      const timeB = new Date(b.createdAt || 0).getTime()
      return timeB - timeA
    })
    return withBooks
  }, [feedEvents, exploreCollections])

  useEffect(() => {
    if (activeShelf !== 'collections' || !currentUserId) return

    const isTriggerBumped = collectionsRefreshTrigger !== lastUserCollectionsRefreshTriggerRef.current
    if (isTriggerBumped) {
      lastUserCollectionsRefreshTriggerRef.current = collectionsRefreshTrigger
      collectionsByUserIdCacheRef.current.delete(currentUserId)
    }

    if (!isTriggerBumped && collectionsByUserIdCacheRef.current.has(currentUserId)) {
      const cached = collectionsByUserIdCacheRef.current.get(currentUserId)
      if (userCollections !== cached) {
        setUserCollections(cached)
        if (isOwnProfile) {
          setUserCollectionSummaries(
            cached.map((c) => ({ id: String(c.id), title: c.title })),
          )
        }
      }
      setIsLoadingCollections(false)
      return undefined
    }

    let isCancelled = false
    setIsLoadingCollections(true)
    const includePrivateParam = isOwnProfile ? '1' : '0'
    fetch(
      `/api/collections?userId=${encodeURIComponent(currentUserId)}&includePrivate=${includePrivateParam}&_t=${Date.now()}`,
      { cache: 'no-cache' },
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && Array.isArray(data?.collections)) {
          collectionsByUserIdCacheRef.current.set(currentUserId, data.collections)
          setUserCollections(data.collections)
          for (const col of data.collections) {
            for (const b of col.books || []) {
              if (b && (b.description || b.pages || b.mainCategory)) {
                setCachedBookMetadata(b.bookId || b.id, b.isbn, {
                  description: b.description,
                  pages: b.pages,
                  publishedYear: b.publishedYear,
                  mainCategory: b.mainCategory,
                  coverUrl: b.imageUrl || b.coverUrl,
                })
              }
            }
          }
          if (isOwnProfile) {
            setUserCollectionSummaries(
              data.collections.map((c) => ({ id: String(c.id), title: c.title })),
            )
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch user collections:', err)
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingCollections(false)
      })

    return () => {
      isCancelled = true
    }
  }, [activeShelf, currentUserId, isOwnProfile, collectionsRefreshTrigger])

  // Keep collection cache updated when userCollections state changes in memory
  useEffect(() => {
    if (currentUserId && collectionsByUserIdCacheRef.current.has(currentUserId)) {
      const cached = collectionsByUserIdCacheRef.current.get(currentUserId)
      if (cached !== userCollections) {
        collectionsByUserIdCacheRef.current.set(currentUserId, userCollections)
      }
    }
  }, [currentUserId, userCollections])

  useEffect(() => {
    if (!isExploreMode) return

    const isTriggerBumped = collectionsRefreshTrigger !== lastExploreCollectionsRefreshTriggerRef.current
    if (isTriggerBumped) {
      lastExploreCollectionsRefreshTriggerRef.current = collectionsRefreshTrigger
      hasLoadedExploreCollectionsRef.current = false
    }

    if (!isTriggerBumped && hasLoadedExploreCollectionsRef.current) {
      setIsLoadingCollections(false)
      return undefined
    }

    let isCancelled = false
    setIsLoadingCollections(true)
    fetch(`/api/collections?explore=true&_t=${Date.now()}`, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && Array.isArray(data?.collections)) {
          hasLoadedExploreCollectionsRef.current = true
          setExploreCollections(data.collections)
          for (const col of data.collections) {
            for (const b of col.books || []) {
              if (b && (b.description || b.pages || b.mainCategory)) {
                setCachedBookMetadata(b.bookId || b.id, b.isbn, {
                  description: b.description,
                  pages: b.pages,
                  publishedYear: b.publishedYear,
                  mainCategory: b.mainCategory,
                  coverUrl: b.imageUrl || b.coverUrl,
                })
              }
            }
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch explore collections:', err)
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingCollections(false)
      })

    return () => {
      isCancelled = true
    }
  }, [isExploreMode, collectionsRefreshTrigger])

  useEffect(() => {
    if (!isExploreMode) return

    if (hasLoadedFeedRef.current) {
      setIsLoadingFeed(false)
      return undefined
    }

    let isCancelled = false
    setIsLoadingFeed(true)
    fetch('/api/feed?limit=30', { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && Array.isArray(data?.events)) {
          hasLoadedFeedRef.current = true
          setFeedEvents(data.events)
          for (const evt of data.events) {
            const allEvtBooks = Array.isArray(evt.books) ? evt.books : evt.book ? [evt.book] : []
            for (const b of allEvtBooks) {
              if (b && (b.description || b.pages || b.mainCategory)) {
                setCachedBookMetadata(b.bookId || b.id, b.isbn, {
                  description: b.description,
                  pages: b.pages,
                  publishedYear: b.publishedYear,
                  mainCategory: b.mainCategory,
                  coverUrl: b.imageUrl || b.coverUrl,
                })
              }
            }
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch feed events:', err)
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingFeed(false)
      })

    return () => {
      isCancelled = true
    }
  }, [isExploreMode])

  useEffect(() => {
    const handleResize = () => {
      const next = window.innerWidth < 768
      setIsMobile((prev) => (prev === next ? prev : next))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const syncUserProfileWithServer = async (user, { hideModal = false } = {}) => {
    if (!user?.id) return null

    try {
      const activeCookieId = getUserIdFromCookie() || cookieUserId
      const emailPrefix = user.email ? user.email.split('@')[0] : ''

      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authUserId: user.id,
          email: user.email,
          displayName: emailPrefix,
          existingUserId: activeCookieId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Profile sync failed with status ${response.status}`)
      }

      const data = await response.json()
      const nextUserId = data.userId
      const nextUrl =
        data.profileUrl ||
        data.url ||
        `${window.location.origin}/${nextUserId}`

      if (nextUserId) {
        setUserIdCookie(nextUserId)
        setCookieUserId(String(nextUserId))
      }

      const finalName = data.displayName || emailPrefix
      if (finalName) {
        setDisplayNameInput(finalName)
      }
      if (data.description !== undefined) {
        setDescriptionInput(data.description || '')
        setUserDescription(data.description || '')
      }
      if (Array.isArray(data.collections)) {
        setUserCollectionSummaries(data.collections)
      }

      if (nextUrl) {
        setGeneratedProfileUrl(nextUrl)
        QRCode.toDataURL(nextUrl)
          .then((dataUrl) => setQrCodeDataUrl(dataUrl))
          .catch((qrError) => {
            console.error(qrError)
          })
      }

      const currentPathUserId = getRouteStateFromPath(window.location.pathname).userId
      const isVisitingOtherProfile = Boolean(
        currentPathUserId && nextUserId && currentPathUserId !== String(nextUserId),
      )

      if (!isVisitingOtherProfile && nextUserId) {
        const normalizedNextId = String(nextUserId)
        if (normalizedNextId !== String(currentUserId)) {
          setCurrentUserId(normalizedNextId)
        }
        if (finalName) {
          setUsername(finalName)
        }
        if (isInitialRootUrlRef.current) {
          isInitialRootUrlRef.current = false
          setIsExploreMode(true)
        }
      }

      if (hideModal) {
        setShowProfileModal(false)
      }

      return data
    } catch (err) {
      console.error('Failed to sync profile with server:', err)
      if (hideModal) {
        setShowProfileModal(false)
      }
      return null
    }
  }

  const handleSaveDisplayName = async () => {
    const trimmed = displayNameInput.trim()
    if (!trimmed) {
      setUploadError('Introdu numele care va fi afișat.')
      return
    }

    const targetUserId = cookieUserId || currentUserId
    const authId = supabaseUser?.id || ''

    try {
      setIsSavingName(true)
      setUploadError('')

      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: trimmed,
          userId: targetUserId,
          authUserId: authId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save display name: status ${response.status}`)
      }

      const data = await response.json()
      const finalName = data.displayName || trimmed
      setDisplayNameInput(finalName)
      if (!currentUserId || currentUserId === targetUserId) {
        setUsername(finalName)
      }
      setSavedName(true)
      setTimeout(() => setSavedName(false), 2000)
    } catch (err) {
      console.error('Failed to save display name:', err)
      setUploadError('Nu am putut salva numele afișat.')
    } finally {
      setIsSavingName(false)
    }
  }

  const handleSaveDescription = async () => {
    const trimmed = descriptionInput.slice(0, 140).trim()
    const targetUserId = cookieUserId || currentUserId
    const authId = supabaseUser?.id || ''

    try {
      setIsSavingDescription(true)
      setUploadError('')

      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: trimmed,
          userId: targetUserId,
          authUserId: authId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save description: status ${response.status}`)
      }

      const data = await response.json()
      const finalDesc = data.description !== undefined ? data.description : trimmed
      setDescriptionInput(finalDesc)
      setUserDescription(finalDesc)
      setSavedDescription(true)
      setTimeout(() => setSavedDescription(false), 2000)
    } catch (err) {
      console.error('Failed to save description:', err)
      setUploadError('Nu am putut salva descrierea.')
    } finally {
      setIsSavingDescription(false)
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setIsCheckingAuth(false)
      return
    }

    try {
      const supabase = createClient()
      supabase.auth
        .getSession()
        .then(async ({ data: { session } }) => {
          supabaseAccessTokenRef.current = session?.access_token || ''
          const user = session?.user ?? null
          setSupabaseUser((prev) => {
            if (!prev && !user) return prev
            if (prev && user && prev.id === user.id && prev.email === user.email) return prev
            return user
          })
          if (user && syncedAuthUserIdRef.current !== user.id) {
            syncedAuthUserIdRef.current = user.id
            await syncUserProfileWithServer(user)
          }
        })
        .catch((err) => {
          console.warn('Supabase getSession error:', err)
        })
        .finally(() => {
          setIsCheckingAuth(false)
        })

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        supabaseAccessTokenRef.current = session?.access_token || ''
        const user = session?.user ?? null
        setSupabaseUser((prev) => {
          if (!prev && !user) return prev
          if (prev && user && prev.id === user.id && prev.email === user.email) return prev
          return user
        })
        if (!user) {
          syncedAuthUserIdRef.current = null
          verifiedAdminAuthIdRef.current = null
          setIsCheckingAuth(false)
          return
        }
        if (syncedAuthUserIdRef.current !== user.id) {
          syncedAuthUserIdRef.current = user.id
          syncUserProfileWithServer(user, { hideModal: event === 'SIGNED_IN' })
        } else if (event === 'SIGNED_IN') {
          setShowProfileModal(false)
        }
        setIsCheckingAuth(false)
      })

      return () => {
        subscription?.unsubscribe()
      }
    } catch (err) {
      console.warn('Supabase auth listener error:', err)
      setIsCheckingAuth(false)
    }
  }, [])

  const handleSignOut = async () => {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      syncedAuthUserIdRef.current = null
      supabaseAccessTokenRef.current = ''
      verifiedAdminAuthIdRef.current = null
      loadedUserIdRef.current = null
      booksByUserIdCacheRef.current.clear()
      collectionsByUserIdCacheRef.current.clear()
      hasLoadedExploreCollectionsRef.current = false
      if (typeof document !== 'undefined') {
        document.cookie = 'userId=; path=/; max-age=0; SameSite=Lax'
      }
      setSupabaseUser(null)
      setIsAdminUser(false)
      setIsAdminRoute(false)
      setCookieUserId('')
      setCurrentUserId('')
      setUsername('')
      setUserDescription('')
      setDescriptionInput('')
      setBooks([])
      setUserCollections([])
      setUserCollectionSummaries([])
      setSelectedBookCollectionIds(new Set())
      setIsExploreMode(true)
      setSelectedBook(null)
      setActiveModalCollection(null)
      setRequestedBookId('')
      setGeneratedProfileUrl('')
      setQrCodeDataUrl('')
      window.history.pushState({}, '', '/')
    } catch (err) {
      console.error('Sign out error:', err)
    }
  }

  const inAppNavCountRef = useRef(0)

  useEffect(() => {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('agy_app_nav_depth') : null
    const count = raw ? parseInt(raw, 10) : 0
    inAppNavCountRef.current = isNaN(count) ? 0 : count

    const origPushState = window.history.pushState
    window.history.pushState = function (...args) {
      inAppNavCountRef.current += 1
      try {
        sessionStorage.setItem('agy_app_nav_depth', String(inAppNavCountRef.current))
      } catch {
        // ignore
      }
      return origPushState.apply(this, args)
    }

    return () => {
      window.history.pushState = origPushState
    }
  }, [])

  const supabaseUserId = supabaseUser?.id || ''

  useEffect(() => {
    if (isCheckingAuth) return undefined
    if (!supabaseUserId) {
      verifiedAdminAuthIdRef.current = null
      setIsAdminUser(false)
      setIsVerifyingAdmin(false)
      return undefined
    }

    if (verifiedAdminAuthIdRef.current === supabaseUserId) {
      setIsVerifyingAdmin(false)
      return undefined
    }

    let cancelled = false
    setIsVerifyingAdmin(true)

    const resolveToken = supabaseAccessTokenRef.current
      ? Promise.resolve(supabaseAccessTokenRef.current)
      : createClient()
        .auth.getSession()
        .then(({ data }) => {
          const tok = data?.session?.access_token || ''
          supabaseAccessTokenRef.current = tok
          return tok
        })

    resolveToken
      .then((token) => {
        if (!token) return null
        return fetch('/api/admin?check=true', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-cache',
        })
      })
      .then(async (res) => {
        if (!res) return { verified: false, isAdmin: false }
        const json = res.ok ? await res.json().catch(() => null) : null
        return {
          verified: res.status === 200 || res.status === 403,
          isAdmin: Boolean(res.ok && json?.isAdmin),
        }
      })
      .then(({ verified, isAdmin }) => {
        if (!cancelled) {
          if (verified) {
            verifiedAdminAuthIdRef.current = supabaseUserId
          }
          setIsAdminUser(isAdmin)
        }
      })
      .catch(() => {
        if (!cancelled) setIsAdminUser(false)
      })
      .finally(() => {
        if (!cancelled) setIsVerifyingAdmin(false)
      })

    return () => {
      cancelled = true
    }
  }, [supabaseUserId, isCheckingAuth])

  useEffect(() => {
    if (!isAdminRoute || isCheckingAuth || isVerifyingAdmin) return
    if (!supabaseUser || !isAdminUser) {
      window.history.replaceState({}, '', '/')
      setIsAdminRoute(false)
      setIsExploreMode(true)
    }
  }, [isAdminRoute, isCheckingAuth, isVerifyingAdmin, supabaseUser, isAdminUser])

  const handleOpenAdminPage = () => {
    setShowProfileModal(false)
    window.history.pushState({}, '', '/admin')
    setIsAdminRoute(true)
  }

  const handleExitAdminPage = () => {
    hasLoadedFeedRef.current = false
    hasLoadedExploreCollectionsRef.current = false
    setCollectionsRefreshTrigger((prev) => prev + 1)
    window.history.pushState({}, '', '/')
    setIsAdminRoute(false)
    setIsExploreMode(true)
  }

  useEffect(() => {
    const syncRouteState = () => {
      inAppNavCountRef.current = Math.max(0, inAppNavCountRef.current - 1)
      try {
        sessionStorage.setItem('agy_app_nav_depth', String(inAppNavCountRef.current))
      } catch {
        // ignore
      }

      if (isAdminPath(window.location.pathname)) {
        setIsAdminRoute(true)
        return
      }
      setIsAdminRoute(false)

      const { userId, shelf, bookId } = getRouteStateFromPath(window.location.pathname)

      if (isRootPath(window.location.pathname) || !userId) {
        setIsExploreMode(true)
        setRequestedBookId('')
        setSelectedBook(null)
        const ownId = isUserLoggedIn ? (cookieUserId || getUserIdFromCookie() || '') : ''
        setCurrentUserId(ownId)
        if (!ownId) {
          setUsername('')
          setBooks([])
        }
        return
      }

      setIsExploreMode(false)
      setCurrentUserId(userId)
      setActiveShelf(shelf)
      setRequestedBookId(bookId)
      if (shelf !== 'collections') {
        setIsShelfReady(false)
      }
    }

    window.addEventListener('popstate', syncRouteState)
    return () => window.removeEventListener('popstate', syncRouteState)
  }, [cookieUserId, isUserLoggedIn])

  useEffect(() => {
    if (!currentUserId || isExploreMode) {
      if (!currentUserId) {
        loadedUserIdRef.current = null
        setBooks([])
        setIsLoading(false)
        if (!supabaseUserRef.current) {
          setUsername('')
        }
      } else if (isExploreMode) {
        setIsLoading(false)
      }
      return undefined
    }

    const controller = new AbortController()
    const resolvedUserId = currentUserId

    const isTriggerBumped = booksFetchTrigger !== lastBooksFetchTriggerRef.current
    if (isTriggerBumped) {
      lastBooksFetchTriggerRef.current = booksFetchTrigger
      booksByUserIdCacheRef.current.delete(resolvedUserId)
    }

    if (!isTriggerBumped && booksByUserIdCacheRef.current.has(resolvedUserId)) {
      const cached = booksByUserIdCacheRef.current.get(resolvedUserId)
      if (loadedUserIdRef.current !== resolvedUserId || books !== cached.books) {
        setBooks(cached.books)
        if (cached.username) {
          setUsername(cached.username)
          if (!supabaseUserRef.current) {
            setDisplayNameInput((prev) => prev || cached.username)
          }
        }
        if (cached.description !== undefined) {
          setUserDescription(cached.description)
          if (!supabaseUserRef.current) {
            setDescriptionInput((prev) => prev || cached.description)
          }
        }
      }
      loadedUserIdRef.current = resolvedUserId
      setTimeout(() => {
        setIsLoading(false)
        setIsShelfReady(true)
      }, 100)
      return undefined
    }

    const apiUrl = `${buildGoodreadsApiUrl(resolvedUserId)}${booksFetchTrigger ? `?t=${Date.now()}` : ''}`
    const isSwitchingUser = loadedUserIdRef.current !== resolvedUserId

    setIsLoading(true)

    const loadBooks = async () => {
      try {
        if (isSwitchingUser) {
          setUsername('')
        }
        setError('')
        const { books: apiBooks, username: apiUsername, description: apiDescription } = await fetchBooksFromApi(apiUrl, controller.signal)
        loadedUserIdRef.current = resolvedUserId
        booksByUserIdCacheRef.current.set(resolvedUserId, {
          books: apiBooks,
          username: apiUsername,
          description: apiDescription,
        })
        setBooks(apiBooks)
        for (const b of apiBooks) {
          if (b && (b.description || b.pages || b.mainCategory)) {
            setCachedBookMetadata(b.bookId || b.id, b.isbn, {
              description: b.description,
              pages: b.pages,
              publishedYear: b.publishedYear,
              mainCategory: b.mainCategory,
              coverUrl: b.imageUrl || b.coverUrl,
            })
          }
        }
        if (apiUsername) {
          setUsername(apiUsername)
          if (!supabaseUserRef.current) {
            setDisplayNameInput((prev) => prev || apiUsername)
          }
        }
        if (apiDescription !== undefined) {
          setUserDescription(apiDescription)
          if (!supabaseUserRef.current) {
            setDescriptionInput((prev) => prev || apiDescription)
          }
        }
      } catch (loadError) {
        if (controller.signal.aborted) return
        console.error(loadError)
        setError('Ups! Nu am găsit nimic la această adresă.')
      } finally {
        if (!controller.signal.aborted) {
          setTimeout(() => {
            setIsLoading(false)
            setIsShelfReady(true)
          }, 150)
        }
      }
    }

    loadBooks()

    return () => {
      controller.abort()
    }
  }, [currentUserId, isExploreMode, booksFetchTrigger])

  // Prefetch books in background as soon as user ID is available so "Rafturi" opens instantly
  useEffect(() => {
    const activeUser = currentUserId || cookieUserId || getUserIdFromCookie()
    if (!activeUser) return
    const activeUserStr = String(activeUser)
    if (booksByUserIdCacheRef.current.has(activeUserStr)) return

    let isCancelled = false
    const apiUrl = buildGoodreadsApiUrl(activeUserStr)

    fetchBooksFromApi(apiUrl)
      .then(({ books: apiBooks, username: apiUsername, description: apiDescription }) => {
        if (isCancelled) return
        booksByUserIdCacheRef.current.set(activeUserStr, {
          books: apiBooks,
          username: apiUsername,
          description: apiDescription,
        })
        if (!isExploreMode && activeShelf !== 'collections' && String(currentUserId) === activeUserStr) {
          setBooks(apiBooks)
          for (const b of apiBooks) {
            if (b && (b.description || b.pages || b.mainCategory)) {
              setCachedBookMetadata(b.bookId || b.id, b.isbn, {
                description: b.description,
                pages: b.pages,
                publishedYear: b.publishedYear,
                mainCategory: b.mainCategory,
                coverUrl: b.imageUrl || b.coverUrl,
              })
            }
          }
          if (apiUsername) {
            setUsername(apiUsername)
            if (!supabaseUserRef.current) {
              setDisplayNameInput((prev) => prev || apiUsername)
            }
          }
          if (apiDescription !== undefined) {
            setUserDescription(apiDescription)
            if (!supabaseUserRef.current) {
              setDescriptionInput((prev) => prev || apiDescription)
            }
          }
          setTimeout(() => {
            setIsLoading(false)
            setIsShelfReady(true)
          }, 150)
        }
      })
      .catch((err) => {
        console.warn('Background books prefetch notice:', err)
      })

    return () => {
      isCancelled = true
    }
  }, [currentUserId, cookieUserId, isExploreMode, activeShelf])

  // Keep cached books in sync when books state changes in memory
  useEffect(() => {
    if (currentUserId && loadedUserIdRef.current === currentUserId && booksByUserIdCacheRef.current.has(currentUserId)) {
      const cached = booksByUserIdCacheRef.current.get(currentUserId)
      if (cached && cached.books !== books) {
        booksByUserIdCacheRef.current.set(currentUserId, {
          ...cached,
          books,
        })
      }
    }
  }, [currentUserId, books])

  const prevSortShelfRef = useRef(activeShelf)

  useEffect(() => {
    const isShelfChanged = prevSortShelfRef.current !== activeShelf
    prevSortShelfRef.current = activeShelf

    const isCurrentSortAvailable = availableBookSortOptions.some((option) => option.id === activeBookSort)

    if (isShelfChanged) {
      const defaultSort = activeShelf === 'read' ? 'recently-read' : (availableBookSortOptions[0]?.id || 'newest')
      setActiveBookSort(defaultSort)
    } else if (!isCurrentSortAvailable) {
      const fallbackSort = activeShelf === 'read' ? 'recently-read' : (availableBookSortOptions[0]?.id || 'newest')
      setActiveBookSort(fallbackSort)
    }
  }, [activeBookSort, activeShelf, availableBookSortOptions])

  useEffect(() => {
    if (!requestedBookId) {
      return
    }

    if (!books.length) {
      return
    }

    const matchedBook = books.find((book) => String(book.bookId || book.id) === String(requestedBookId))

    if (matchedBook) {
      setSelectedBook((prev) => {
        const target = prev && String(prev.bookId || prev.id) === String(matchedBook.bookId || matchedBook.id)
          ? { ...prev, ...matchedBook }
          : matchedBook
        return enrichBookWithCache(target)
      })
      setError('')
      return
    }

    if (!selectedBook) {
      setError('Cartea nu a fost găsită pe acest raft.')
    }
  }, [books, requestedBookId])

  useEffect(() => {
    if (!selectedBook) {
      setBookQrCodeDataUrl('')
      return
    }

    const userIdToUse = currentUserId || cookieUserId
    const bookId = String(selectedBook.bookId || selectedBook.id || '')
    const qrUrl = userIdToUse && bookId
      ? buildBookShareUrl(userIdToUse, activeShelf, bookId, window.location.origin)
      : (selectedBook.link || window.location.href)

    if (!qrUrl) {
      setBookQrCodeDataUrl('')
      return
    }

    QRCode.toDataURL(qrUrl, { width: 320, margin: 2 })
      .then((dataUrl) => setBookQrCodeDataUrl(dataUrl))
      .catch(() => setBookQrCodeDataUrl(''))
  }, [selectedBook, currentUserId, cookieUserId, activeShelf])

  useEffect(() => {
    if (!selectedBook) {
      setIsDescriptionLoading(false)
      return
    }
    const bookId = String(selectedBook.bookId || selectedBook.id || '')
    if (!bookId) {
      setIsDescriptionLoading(false)
      return
    }

    if (selectedBook.description) {
      setIsDescriptionLoading(false)
      setCachedBookMetadata(bookId, selectedBook.isbn, {
        description: selectedBook.description,
        pages: selectedBook.pages,
        publishedYear: selectedBook.publishedYear,
        mainCategory: selectedBook.mainCategory,
        coverUrl: selectedBook.imageUrl || selectedBook.coverUrl,
      })
      return
    }

    const cached = getCachedBookMetadata(selectedBook)
    if (cached?.description) {
      setSelectedBook((prev) => {
        if (!prev) return prev
        const curId = String(prev.bookId || prev.id || '')
        if (curId === bookId) {
          return {
            ...prev,
            description: cached.description,
            pages: prev.pages || cached.pages || cached.pageCount,
            publishedYear: prev.publishedYear || cached.publishedYear,
            mainCategory: prev.mainCategory || cached.mainCategory,
            imageUrl: prev.imageUrl || cached.coverUrl || cached.imageUrl,
          }
        }
        return prev
      })
      setIsDescriptionLoading(false)
      return
    }

    if (enrichingBookIdsRef.current.has(bookId)) {
      setIsDescriptionLoading(false)
      return
    }

    enrichingBookIdsRef.current.add(bookId)
    setIsDescriptionLoading(true)
    const userIdToUse = currentUserId || cookieUserId || ''
    let isCurrent = true

    fetch('/api/isbn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: selectedBook.title,
        author: selectedBook.author,
        isbn: selectedBook.isbn,
        bookId,
        userId: userIdToUse,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        const meta = {
          description: data.description || '',
          pages: data.pageCount || '',
          publishedYear: data.publishedYear || '',
          mainCategory: data.mainCategory || '',
          coverUrl: data.coverUrl || data.imageUrl || '',
        }
        setCachedBookMetadata(bookId, data.isbn || selectedBook.isbn, meta)

        if (isCurrent) {
          setSelectedBook((prev) => {
            if (!prev) return prev
            const curId = String(prev.bookId || prev.id || '')
            if (curId === bookId) {
              return {
                ...prev,
                description: data.description || prev.description,
                pages: prev.pages || data.pageCount,
                publishedYear: prev.publishedYear || data.publishedYear,
                mainCategory: prev.mainCategory || data.mainCategory,
                imageUrl: prev.imageUrl || data.coverUrl || data.imageUrl,
              }
            }
            return prev
          })
        }

        setBooks((prevBooks) =>
          prevBooks.map((b) => {
            if (String(b.bookId || b.id) === bookId) {
              return {
                ...b,
                description: data.description || b.description,
                pages: b.pages || data.pageCount,
                publishedYear: b.publishedYear || data.publishedYear,
                mainCategory: data.mainCategory || b.mainCategory,
                imageUrl: b.imageUrl || data.coverUrl || data.imageUrl,
              }
            }
            return b
          }),
        )

        setFeedEvents((prevEvents) =>
          prevEvents.map((evt) => {
            let updated = false
            const updatedEvtBook =
              evt.book && String(evt.book.bookId || evt.book.id) === bookId
                ? {
                  ...evt.book,
                  description: data.description || evt.book.description,
                  pages: evt.book.pages || data.pageCount,
                  publishedYear: evt.book.publishedYear || data.publishedYear,
                  imageUrl: evt.book.imageUrl || data.coverUrl || data.imageUrl,
                }
                : evt.book

            const updatedBooks = Array.isArray(evt.books)
              ? evt.books.map((b) => {
                if (String(b.bookId || b.id) === bookId) {
                  updated = true
                  return {
                    ...b,
                    description: data.description || b.description,
                    pages: b.pages || data.pageCount,
                    publishedYear: b.publishedYear || data.publishedYear,
                    imageUrl: b.imageUrl || data.coverUrl || data.imageUrl,
                  }
                }
                return b
              })
              : evt.books

            if (updated || updatedEvtBook !== evt.book) {
              return { ...evt, book: updatedEvtBook, books: updatedBooks }
            }
            return evt
          }),
        )
      })
      .catch(() => {
        // On-demand enrichment is best effort
      })
      .finally(() => {
        if (isCurrent) {
          setIsDescriptionLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [selectedBook?.bookId, selectedBook?.id, selectedBook?.description, currentUserId, cookieUserId, getCachedBookMetadata, setCachedBookMetadata])

  useEffect(() => {
    if (!shelfDropdownOpen) return

    const handleClickOutside = (event) => {
      if (shelfDropdownRef.current && !shelfDropdownRef.current.contains(event.target)) {
        setShelfDropdownOpen(false)
      }
    }

    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [shelfDropdownOpen])

  useEffect(() => {
    const activeUserId = cookieUserId || getUserIdFromCookie()
    if (!activeUserId) {
      setUserShelvesByBookId({})
      return
    }

    let isSubscribed = true
    fetch(`/api/shelves?userId=${encodeURIComponent(activeUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isSubscribed || !data?.shelvesByBookId) return
        setUserShelvesByBookId(data.shelvesByBookId)
      })
      .catch((err) => {
        console.warn('Failed to load user shelves at page load:', err)
      })

    return () => {
      isSubscribed = false
    }
  }, [cookieUserId])

  const loggedInUserBook = useMemo(() => {
    if (!selectedBook) return null
    const bookId = String(selectedBook.bookId || selectedBook.id || '')
    if (userShelvesByBookId[bookId]) {
      return userShelvesByBookId[bookId]
    }
    const cleanBookIsbn = String(selectedBook.isbn || selectedBook.isbn13 || '').replace(/[^0-9X]/gi, '').trim()
    if (cleanBookIsbn) {
      const match = Object.values(userShelvesByBookId).find((b) => {
        const itemIsbn = String(b.isbn || b.isbn13 || '').replace(/[^0-9X]/gi, '').trim()
        return itemIsbn && itemIsbn === cleanBookIsbn
      })
      if (match) return match
    }
    return null
  }, [selectedBook, userShelvesByBookId])

  const currentBookRating = useMemo(() => {
    if (!selectedBook) return 0
    if (loggedInUserBook && loggedInUserBook.myRating !== undefined) {
      return Number(loggedInUserBook.myRating) || 0
    }
    if (isOwnProfile && selectedBook.rating !== undefined) {
      return Number(selectedBook.rating) || 0
    }
    return 0
  }, [selectedBook, loggedInUserBook, isOwnProfile])

  const prevRatingBookIdRef = useRef(null)

  useEffect(() => {
    if (!selectedBook) {
      prevRatingBookIdRef.current = null
      setSavedShelf(false)
      setShelfDropdownOpen(false)
      setShowRatingPopup(false)
      return
    }

    const currentBookId = String(selectedBook.bookId || selectedBook.id || '')
    const isBookChanged = prevRatingBookIdRef.current !== currentBookId
    prevRatingBookIdRef.current = currentBookId

    if (loggedInUserBook?.shelf) {
      setTargetShelf(loggedInUserBook.shelf)
      setSavedShelf(true)
      if (isBookChanged) {
        if (loggedInUserBook.shelf === 'read') {
          const rating = Number(loggedInUserBook.myRating) || 0
          setShowRatingPopup(rating === 0)
        } else {
          setShowRatingPopup(false)
        }
      }
    } else {
      const defaultShelf = SHELF_OPTIONS.some((s) => s.id === activeShelf) ? activeShelf : 'to-read'
      setTargetShelf(defaultShelf)
      setSavedShelf(false)
      if (isBookChanged) {
        setShowRatingPopup(false)
      }
    }
  }, [selectedBook, loggedInUserBook, activeShelf])

  // Ensure user collection summaries are loaded whenever a logged-in user session is active
  useEffect(() => {
    const activeUser = getActiveCollectionUserId()
    if (!activeUser || !supabaseUser || userCollectionSummaries.length > 0) return

    let isSubscribed = true
    fetch(`/api/collections?userId=${encodeURIComponent(activeUser)}&summary=true`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isSubscribed || !Array.isArray(data?.collections)) return
        setUserCollectionSummaries(data.collections)
      })
      .catch(() => { })

    return () => {
      isSubscribed = false
    }
  }, [supabaseUser, cookieUserId, userCollectionSummaries.length])

  // Track which collections contain the currently selected book
  useEffect(() => {
    if (!selectedBook) {
      setSelectedBookCollectionIds(new Set())
      return
    }

    const activeUser = getActiveCollectionUserId()
    if (!activeUser || !supabaseUser) {
      setSelectedBookCollectionIds(new Set())
      return
    }

    const bookId = String(selectedBook.bookId || selectedBook.id || '')
    const isbn = String(selectedBook.isbn || selectedBook.isbn13 || '')
      .replace(/[^0-9X]/gi, '')
      .trim()

    // 1. Initial instant check from collections loaded in memory
    const initialIds = new Set()
    userCollections.forEach((c) => {
      if (
        c.books?.some((b) => {
          const bId = String(b.bookId || b.id || '')
          const bIsbn = String(b.isbn || b.isbn13 || '')
            .replace(/[^0-9X]/gi, '')
            .trim()
          return (bookId && bId === bookId) || (isbn && bIsbn === isbn)
        })
      ) {
        initialIds.add(String(c.id))
      }
    })
    setSelectedBookCollectionIds(initialIds)

    // 2. Fetch authoritative collection IDs from server
    let isCancelled = false
    const queryParams = new URLSearchParams({
      userId: activeUser,
      bookId,
    })
    if (isbn) queryParams.set('isbn', isbn)

    fetch(`/api/collections?${queryParams.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && Array.isArray(data?.collectionIds)) {
          setSelectedBookCollectionIds(new Set(data.collectionIds.map(String)))
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch book collection memberships:', err)
      })

    return () => {
      isCancelled = true
    }
  }, [selectedBook, supabaseUser])

  const shelfCounts = useMemo(() => {
    const counts = {}
    const hasSearch = Boolean(bookSearchQuery.trim())
    SHELF_OPTIONS.forEach((shelf) => {
      counts[shelf.id] = books.filter((book) => {
        if (!matchesShelf(book, shelf.id)) return false
        if (hasSearch && !matchesBookSearch(book, bookSearchQuery)) return false
        return true
      }).length
    })
    return counts
  }, [books, bookSearchQuery])

  const totalShelfBooks = useMemo(() => {
    return books.filter((book) => matchesShelf(book, activeShelf))
  }, [books, activeShelf])

  const shelfBooks = useMemo(() => {
    if (!bookSearchQuery.trim()) {
      return totalShelfBooks
    }
    return totalShelfBooks.filter((book) => matchesBookSearch(book, bookSearchQuery))
  }, [totalShelfBooks, bookSearchQuery])

  useEffect(() => {
    if (isExploreMode || activeShelf === 'collections') {
      setBookSearchQuery('')
    }
  }, [isExploreMode, activeShelf])

  const authorOptions = useMemo(() => {
    const counts = new Map()

    shelfBooks.forEach((book) => {
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
  }, [shelfBooks])

  const glideAuthorOptions = useMemo(() => [
    { value: 'all', label: 'Toti autorii', tag: String(shelfBooks.length) },
    ...authorOptions,
  ], [shelfBooks.length, authorOptions])

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
      return shelfBooks
    }

    return shelfBooks.filter((book) => book.author === activeAuthorFilter)
  }, [activeAuthorFilter, shelfBooks])

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

      const addedDateA = Date.parse(bookA.dateAdded || 0) || 0
      const addedDateB = Date.parse(bookB.dateAdded || 0) || 0
      if (addedDateA !== addedDateB) {
        return addedDateB - addedDateA
      }

      const updatedA = Date.parse(bookA.updatedAt || 0) || 0
      const updatedB = Date.parse(bookB.updatedAt || 0) || 0
      if (updatedA !== updatedB) {
        return updatedB - updatedA
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
    if (!isShelfReady) {
      setBookRenderLimit(50)
      return undefined
    }

    if (bookRenderLimit < visibleBooks.length) {
      const timer = setTimeout(() => {
        setBookRenderLimit((prev) => Math.min(visibleBooks.length, prev + 80))
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isShelfReady, bookRenderLimit, visibleBooks.length])

  useEffect(() => {
    if (!carouselRef.current) {
      return
    }

    carouselRef.current.scrollTo({
      left: 0,
      behavior: 'auto',
    })
  }, [activeShelf, currentUserId, bookSearchQuery, activeAuthorFilter, activeBookSort])

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
    setSelectedBook(enrichBookWithCache(book))
    setError('')
  }

  const shareBookLink = async (book) => {
    if (!book) {
      return
    }

    const userIdToUse = currentUserId || cookieUserId
    const bookId = String(book.bookId || book.id)
    const shareUrl = userIdToUse
      ? buildBookShareUrl(userIdToUse, activeShelf, bookId, window.location.origin)
      : (book.link || window.location.href)

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
        setCopiedUrl(true)
        setTimeout(() => setCopiedUrl(false), 2000)
      }
    } catch (shareError) {
      console.error(shareError)
      try {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl)
          setCopiedUrl(true)
          setTimeout(() => setCopiedUrl(false), 2000)
        }
      } catch (copyError) {
        console.error(copyError)
      }
    }
  }

  const closeBookDetails = () => {
    if (ratingCloseTimeoutRef.current) {
      clearTimeout(ratingCloseTimeoutRef.current)
    }
    setShowRatingPopup(false)
    setShowBookQrModal(false)
    setIsSavingRating(false)

    if (openedFromSearch) {
      setSelectedBook(null)
      setOpenedFromSearch(false)
      setIsSearchModalOpen(true)
      setShelfDropdownOpen(false)
      setSavedShelf(false)
      return
    }

    if (activeModalCollection) {
      setActiveModalCollection(null)
      setSelectedBook(null)
      setRequestedBookId('')
      setShelfDropdownOpen(false)
      setSavedShelf(false)
      return
    }

    const routePath = currentUserId ? `/${currentUserId}/${activeShelf}` : '/'
    window.history.pushState({}, '', routePath)
    setRequestedBookId('')
    setSelectedBook(null)
    setShelfDropdownOpen(false)
    setSavedShelf(false)
    setError('')
  }

  const handleSearchSubmit = async (e) => {
    if (e) e.preventDefault()
    const cleanQuery = searchQuery.trim()
    if (!cleanQuery) return

    setIsSearching(true)
    setSearchError('')
    setHasSearched(true)

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(cleanQuery)}&limit=10`)
      if (!response.ok) {
        throw new Error(`Căutarea a eșuat (status ${response.status})`)
      }
      const data = await response.json()
      if (data?.books) {
        setSearchResults(data.books)
      } else {
        setSearchResults([])
      }
    } catch (err) {
      console.error('Search error:', err)
      setSearchError('A apărut o problemă la căutare. Te rugăm să încerci din nou.')
    } finally {
      setIsSearching(false)
    }
  }

  const getActiveCollectionUserId = () => {
    return (
      cookieUserId ||
      getUserIdFromCookie() ||
      (currentUserId && /^[a-zA-Z0-9]{8}$/.test(currentUserId) ? currentUserId : '')
    )
  }

  const handleCreateCollection = async (e) => {
    if (e) e.preventDefault()
    const title = newCollectionTitle.trim()
    const description = newCollectionDescription.trim().slice(0, 140)
    let activeUser = getActiveCollectionUserId()

    if (!title) {
      setNewCollectionError('Titlul colecției este obligatoriu.')
      return
    }

    if (!activeUser && supabaseUser) {
      try {
        const synced = await syncUserProfileWithServer(supabaseUser)
        if (synced?.userId) {
          activeUser = synced.userId
        }
      } catch (syncErr) {
        console.warn('Failed to sync profile before collection creation:', syncErr)
      }
    }

    if (!activeUser) {
      setNewCollectionError('Trebuie să fii conectat pentru a crea o colecție.')
      setShowProfileModal(true)
      return
    }

    setNewCollectionError('')
    try {
      setIsCreatingCollection(true)
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          userId: activeUser,
          title,
          description,
          isPrivate: newCollectionIsPrivate,
        }),
      })

      if (!response.ok) {
        let errMessage = `Eroare la crearea colecției (status ${response.status})`
        try {
          const errData = await response.json()
          if (errData?.error) errMessage = errData.error
        } catch {
          // ignore
        }
        throw new Error(errMessage)
      }

      const data = await response.json()
      if (data?.collection) {
        const creatorName = username || displayNameInput || ''
        const newCol = { ...data.collection, username: creatorName, books: [] }
        setUserCollections((prev) => [newCol, ...prev])
        const summaryId = String(newCol.id || newCol.collectionId)
        setUserCollectionSummaries((prev) => [
          { id: summaryId, title: newCol.title },
          ...prev.filter((c) => String(c.id) !== summaryId),
        ])
        if (!newCollectionIsPrivate) {
          setExploreCollections((prev) => [newCol, ...prev])
        }
      }
      setNewCollectionTitle('')
      setNewCollectionDescription('')
      setNewCollectionIsPrivate(false)
      setNewCollectionError('')
      setShowNewCollectionInput(false)
      setCollectionsRefreshTrigger((prev) => prev + 1)
    } catch (err) {
      console.error('Error creating collection:', err)
      setNewCollectionError(err?.message || 'Nu am putut crea colecția.')
    } finally {
      setIsCreatingCollection(false)
    }
  }

  const handleDeleteCollection = async (collection) => {
    const activeUser = getActiveCollectionUserId()
    if (!collection?.id || !activeUser) return

    try {
      const response = await fetch('/api/collections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          collectionId: collection.id,
        }),
      })
      if (!response.ok) {
        throw new Error(`Failed to delete collection: status ${response.status}`)
      }
      setUserCollections((prev) => prev.filter((c) => Number(c.id) !== Number(collection.id)))
      setUserCollectionSummaries((prev) => prev.filter((c) => Number(c.id) !== Number(collection.id)))
      setExploreCollections((prev) => prev.filter((c) => Number(c.id) !== Number(collection.id)))
    } catch (err) {
      console.error('Error deleting collection:', err)
    }
  }

  const [togglingPrivacyCollectionId, setTogglingPrivacyCollectionId] = useState(null)

  const handleToggleCollectionPrivacy = async (collection) => {
    const activeUser = getActiveCollectionUserId()
    if (!collection?.id || !activeUser || togglingPrivacyCollectionId) return

    const collectionId = String(collection.id)
    const currentPrivate = Boolean(collection.isPrivate)
    const nextPrivate = !currentPrivate

    setTogglingPrivacyCollectionId(collectionId)

    // Optimistic update
    setUserCollections((prev) =>
      prev.map((c) =>
        String(c.id) === collectionId ? { ...c, isPrivate: nextPrivate } : c,
      ),
    )
    if (nextPrivate) {
      // If made private, remove from explore collections immediately
      setExploreCollections((prev) =>
        prev.filter((c) => String(c.id) !== collectionId),
      )
    }

    try {
      const response = await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          collectionId,
          isPrivate: nextPrivate,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to update collection privacy: status ${response.status}`)
      }

      const data = await response.json()
      if (data?.collection) {
        setUserCollections((prev) =>
          prev.map((c) =>
            String(c.id) === collectionId
              ? { ...c, isPrivate: Boolean(data.collection.isPrivate) }
              : c,
          ),
        )
      }
    } catch (err) {
      console.error('Error toggling collection privacy:', err)
      // Revert optimistic update
      setUserCollections((prev) =>
        prev.map((c) =>
          String(c.id) === collectionId ? { ...c, isPrivate: currentPrivate } : c,
        ),
      )
      if (nextPrivate) {
        setExploreCollections((prev) => {
          const exists = prev.some((c) => String(c.id) === collectionId)
          if (exists) return prev
          return [{ ...collection, isPrivate: false }, ...prev]
        })
      }
    } finally {
      setTogglingPrivacyCollectionId(null)
    }
  }

  const handleOpenEditCollection = (collection) => {
    if (!collection) return
    setEditingCollection(collection)
    setEditCollectionTitle(collection.title || '')
    setEditCollectionDescription(collection.description || '')
    setEditCollectionIsPrivate(Boolean(collection.isPrivate))
    setEditCollectionError('')
  }

  const handleCloseEditCollection = () => {
    setEditingCollection(null)
    setEditCollectionTitle('')
    setEditCollectionDescription('')
    setEditCollectionIsPrivate(false)
    setEditCollectionError('')
    setIsSavingEditCollection(false)
  }

  const handleSaveEditCollection = async (e) => {
    if (e) e.preventDefault()
    if (!editingCollection) return

    const title = editCollectionTitle.trim()
    const description = editCollectionDescription.trim().slice(0, 140)
    const isPrivate = Boolean(editCollectionIsPrivate)
    const collectionId = String(editingCollection.id || editingCollection.collectionId)
    const activeUser = getActiveCollectionUserId()

    if (!title) {
      setEditCollectionError('Titlul colecției este obligatoriu.')
      return
    }

    if (!activeUser) {
      setEditCollectionError('Trebuie să fii conectat.')
      return
    }

    setEditCollectionError('')
    setIsSavingEditCollection(true)

    const previousCollection = editingCollection
    const updatedCollection = {
      ...editingCollection,
      title,
      description,
      isPrivate,
    }

    const updateCollectionInList = (list) =>
      list.map((c) =>
        String(c.id || c.collectionId) === collectionId
          ? { ...c, title, description, isPrivate }
          : c,
      )

    setUserCollections(updateCollectionInList)
    setUserCollectionSummaries((prev) =>
      prev.map((c) =>
        String(c.id) === collectionId ? { ...c, title } : c,
      ),
    )
    if (isPrivate) {
      setExploreCollections((prev) =>
        prev.filter((c) => String(c.id || c.collectionId) !== collectionId),
      )
    } else {
      setExploreCollections((prev) => {
        const exists = prev.some((c) => String(c.id || c.collectionId) === collectionId)
        if (exists) {
          return prev.map((c) =>
            String(c.id || c.collectionId) === collectionId
              ? { ...c, title, description, isPrivate: false }
              : c,
          )
        }
        return [{ ...updatedCollection, isPrivate: false }, ...prev]
      })
    }
    setActiveModalCollection((prev) =>
      prev && String(prev.id || prev.collectionId) === collectionId
        ? { ...prev, title, description, isPrivate }
        : prev,
    )

    try {
      const response = await fetch('/api/collections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          collectionId,
          title,
          description,
          isPrivate,
        }),
      })

      if (!response.ok) {
        let errMessage = `Eroare la salvarea colecției (status ${response.status})`
        try {
          const errData = await response.json()
          if (errData?.error) errMessage = errData.error
        } catch {
          // ignore
        }
        throw new Error(errMessage)
      }

      const data = await response.json()
      if (data?.collection) {
        setUserCollections((prev) =>
          prev.map((c) =>
            String(c.id || c.collectionId) === collectionId
              ? { ...c, ...data.collection, books: c.books || [] }
              : c,
          ),
        )
      }

      handleCloseEditCollection()
      setCollectionsRefreshTrigger((prev) => prev + 1)
    } catch (err) {
      console.error('Error updating collection:', err)
      setEditCollectionError(err?.message || 'Nu am putut actualiza colecția.')
      setUserCollections((prev) =>
        prev.map((c) =>
          String(c.id || c.collectionId) === collectionId ? previousCollection : c,
        ),
      )
      setUserCollectionSummaries((prev) =>
        prev.map((c) =>
          String(c.id) === collectionId
            ? { ...c, title: previousCollection.title }
            : c,
        ),
      )
      setActiveModalCollection((prev) =>
        prev && String(prev.id || prev.collectionId) === collectionId
          ? previousCollection
          : prev,
      )
    } finally {
      setIsSavingEditCollection(false)
    }
  }

  const handleOpenAddBookForCollection = (collection) => {
    setTargetCollectionForSearch(collection)
    setSearchError('')
    setIsSearchModalOpen(true)
  }

  const handleAddBookToCollectionFromSearch = async (book) => {
    const activeUser = getActiveCollectionUserId()
    if (!targetCollectionForSearch?.id || !activeUser || !book || isAddingBookToCollection) return

    const bookId = String(book.bookId || book.id || '')
    if (!bookId) return

    try {
      setIsAddingBookToCollection(true)
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-book',
          userId: activeUser,
          collectionId: targetCollectionForSearch.id,
          bookId,
          book: {
            bookId,
            title: book.title,
            author: book.author,
            isbn: book.isbn,
            pages: book.pages,
            publishedYear: book.publishedYear,
            publisher: book.publisher,
            binding: book.binding,
            description: book.description,
            mainCategory: book.mainCategory,
            coverUrl: book.imageUrl || book.coverUrl,
          },
        }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || `Failed to add book to collection: status ${response.status}`)
      }

      const normalizedAddedBook = normalizeCsvBook(book, 0)
      const targetId = String(targetCollectionForSearch.id)
      const updateCollectionBooks = (list) =>
        list.map((c) => {
          if (String(c.id) !== targetId && Number(c.id) !== Number(targetId)) return c
          const existingBooks = Array.isArray(c.books) ? c.books : []
          if (existingBooks.some((b) => String(b.bookId || b.id) === bookId)) return c
          return {
            ...c,
            books: [...existingBooks, normalizedAddedBook],
          }
        })

      setUserCollections(updateCollectionBooks)
      setExploreCollections(updateCollectionBooks)
      setIsSearchModalOpen(false)
      setTargetCollectionForSearch(null)
    } catch (err) {
      console.error('Error adding book to collection:', err)
      setSearchError(err?.message || 'Nu am putut adăuga cartea în colecție.')
    } finally {
      setIsAddingBookToCollection(false)
    }
  }

  const handleRemoveBookFromActiveCollection = async () => {
    const activeUser = getActiveCollectionUserId()
    if (!activeModalCollection?.id || !selectedBook || !activeUser) return
    const bookId = String(selectedBook.bookId || selectedBook.id || '')
    if (!bookId) return

    try {
      setIsRemovingFromCollection(true)
      const response = await fetch('/api/collections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          collectionId: activeModalCollection.id,
          bookId,
        }),
      })
      if (!response.ok) {
        throw new Error(`Failed to remove book from collection: status ${response.status}`)
      }

      const removeBookFn = (list) =>
        list.map((c) => {
          if (Number(c.id) !== Number(activeModalCollection.id)) return c
          return {
            ...c,
            books: (c.books || []).filter((b) => String(b.bookId || b.id) !== bookId),
          }
        })

      setUserCollections(removeBookFn)
      setExploreCollections(removeBookFn)
      closeBookDetails()
    } catch (err) {
      console.error('Error removing book from collection:', err)
    } finally {
      setIsRemovingFromCollection(false)
    }
  }

  const handleOpenCollectionBook = (book, collection) => {
    if (!book || !collection) return
    setActiveModalCollection(collection)
    setSelectedBook(enrichBookWithCache(book))
    setError('')
  }

  const handleSelectExploreCreator = (creatorUserId) => {
    if (!creatorUserId) return
    setIsExploreMode(false)
    setActiveShelf('collections')
    setCurrentUserId(String(creatorUserId))
    setRequestedBookId('')
    setSelectedBook(null)
    setActiveModalCollection(null)
    window.history.pushState({}, '', `/${creatorUserId}/collections`)
  }

  const handleVisitUserProfile = (targetUserId, targetShelf = 'read') => {
    if (!targetUserId) return
    setIsExploreMode(false)
    setActiveShelf(targetShelf)
    setCurrentUserId(String(targetUserId))
    setRequestedBookId('')
    setSelectedBook(null)
    setActiveModalCollection(null)
    if (targetShelf !== 'collections') {
      setIsShelfReady(false)
    }
    window.history.pushState({}, '', `/${targetUserId}/${targetShelf}`)
  }

  const isFeedBookSaved = (book) => {
    if (!book) return false
    const bookId = String(book.bookId || book.id || '')
    if (bookId && userShelvesByBookId[bookId]) return true
    const cleanIsbn = String(book.isbn || '').replace(/[^0-9X]/gi, '').trim()
    if (cleanIsbn) {
      return Object.values(userShelvesByBookId).some((b) => {
        const itemIsbn = String(b.isbn || b.isbn13 || '').replace(/[^0-9X]/gi, '').trim()
        return itemIsbn && itemIsbn === cleanIsbn
      })
    }
    return false
  }

  const syncSavedBookIntoLibrary = (ownerUserId, sourceBook, savedShelfName, apiData = {}) => {
    const ownerStr = String(ownerUserId || '').trim()
    const bookId = String(sourceBook?.bookId || sourceBook?.id || '').trim()
    if (!ownerStr || !bookId) return

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const finalDateAdded = apiData?.dateAdded || todayStr
    const finalDateRead =
      apiData?.dateRead || (savedShelfName === 'read' ? todayStr : '')
    const finalUpdatedAt = apiData?.updatedAt || new Date().toISOString()

    const applyToBookList = (list = []) => {
      const exists = list.some(
        (b) =>
          String(b.bookId || '') === bookId ||
          String(b.id || '') === bookId ||
          (sourceBook.id && String(b.id) === String(sourceBook.id)),
      )
      if (exists) {
        return list.map((b) => {
          const isMatch =
            String(b.bookId || '') === bookId ||
            String(b.id || '') === bookId ||
            (sourceBook.id && String(b.id) === String(sourceBook.id))
          return isMatch
            ? {
              ...b,
              bookshelves: savedShelfName,
              dateAdded: finalDateAdded,
              'Date Added': finalDateAdded,
              readAt: finalDateRead,
              'Date Read': finalDateRead,
              updatedAt: finalUpdatedAt,
            }
            : b
        })
      }

      const normalized = normalizeCsvBook(
        {
          ...sourceBook,
          'Book Id': bookId,
          Title: sourceBook.title || '',
          Author: sourceBook.author || '',
          ISBN: sourceBook.isbn || '',
          'Number of Pages': sourceBook.pages || '',
          'Original Publication Year': sourceBook.publishedYear || '',
          Publisher: sourceBook.publisher || '',
          Binding: sourceBook.binding || '',
          Bookshelves: savedShelfName,
          'Date Added': finalDateAdded,
          'Date Read': finalDateRead,
          updatedAt: finalUpdatedAt,
          description: sourceBook.description || '',
          mainCategory: sourceBook.mainCategory || '',
          imageUrl: sourceBook.imageUrl || sourceBook.coverUrl || '',
        },
        0,
      )
      return [normalized, ...list]
    }

    if (booksByUserIdCacheRef.current.has(ownerStr)) {
      const cached = booksByUserIdCacheRef.current.get(ownerStr)
      if (cached && Array.isArray(cached.books)) {
        booksByUserIdCacheRef.current.set(ownerStr, {
          ...cached,
          books: applyToBookList(cached.books),
        })
      }
    }

    if (!currentUserId || String(currentUserId) === ownerStr) {
      setBooks((prevBooks) => applyToBookList(prevBooks))
    }

    setBooksFetchTrigger((prev) => prev + 1)
  }

  const handleQuickAddFeedBook = async (book, e) => {
    if (e) {
      e.stopPropagation()
    }
    if (!book) return

    const activeUserId = cookieUserId || getUserIdFromCookie()
    if (!activeUserId || !isUserLoggedIn) {
      setShowProfileModal(true)
      return
    }

    const bookId = String(book.bookId || book.id || '')
    if (!bookId) return

    if (isFeedBookSaved(book)) return

    setQuickAddingBookId(bookId)

    // Optimistic update
    setUserShelvesByBookId((prev) => ({
      ...prev,
      [bookId]: {
        ...(prev[bookId] || {}),
        bookId,
        shelf: 'to-read',
        title: book.title || '',
        author: book.author || '',
        isbn: book.isbn || '',
        imageUrl: book.imageUrl || book.coverUrl || '',
      },
    }))

    try {
      const res = await fetch('/api/shelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUserId,
          bookId,
          shelf: 'to-read',
          book: {
            bookId,
            title: book.title || '',
            author: book.author || '',
            isbn: book.isbn || '',
            coverUrl: book.imageUrl || book.coverUrl || '',
            pages: book.pages,
            publishedYear: book.publishedYear,
            publisher: book.publisher,
          },
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to add book to shelf')
      }

      const data = await res.json()
      const savedShelfName = data?.shelf || 'to-read'
      setUserShelvesByBookId((prev) => ({
        ...prev,
        [bookId]: {
          ...(prev[bookId] || {}),
          bookId,
          shelf: savedShelfName,
          title: book.title || '',
          author: book.author || '',
          isbn: book.isbn || '',
          dateAdded: data?.dateAdded || '',
        },
      }))
      syncSavedBookIntoLibrary(activeUserId, book, savedShelfName, data)
    } catch (err) {
      console.error('Error quick-adding book to to-read:', err)
      setUserShelvesByBookId((prev) => {
        const copy = { ...prev }
        delete copy[bookId]
        return copy
      })
    } finally {
      setQuickAddingBookId(null)
    }
  }

  const normalizeFeedBookItem = (b) =>
    enrichBookWithCache({
      ...b,
      id: b.id || b.bookId,
      bookId: b.bookId || b.id,
      imageUrl: b.imageUrl || b.coverUrl,
      coverUrl: b.coverUrl || b.imageUrl,
    })

  const handleOpenFeedBook = (book, event = null) => {
    if (!book) return
    const normalizedBook = normalizeFeedBookItem(book)

    const eventBooks = Array.isArray(event?.books) && event.books.length > 0
      ? event.books
      : [book]

    if (event && (event.collection || eventBooks.length > 1)) {
      const colId = event.collection?.collectionId || event.collection?.id || `feed-${event.id}`
      setActiveModalCollection({
        id: String(colId),
        collectionId: String(colId),
        userId: event.user?.userId || '',
        title: event.collection?.title || '',
        description: event.collection?.description || '',
        books: eventBooks.map(normalizeFeedBookItem),
      })
    } else {
      setActiveModalCollection(null)
    }

    setSelectedBook(normalizedBook)
    setError('')
  }

  const handleSelectSearchBook = (book) => {
    if (targetCollectionForSearch) {
      handleAddBookToCollectionFromSearch(book)
      return
    }
    setOpenedFromSearch(true)
    setSelectedBook(enrichBookWithCache(book))
  }

  const handleHeaderClick = () => {
    setIsExploreMode(true)
    setActiveModalCollection(null)
    setRequestedBookId('')
    setSelectedBook(null)
    setActiveAuthorFilter('all')

    const ownId = isUserLoggedIn ? (cookieUserId || getUserIdFromCookie() || '') : ''
    setCurrentUserId(ownId)
    if (!ownId) {
      setUsername('')
      setBooks([])
    }
    window.history.pushState({}, '', '/')
  }

  const handleBackNavigation = () => {
    setSelectedBook(null)
    setActiveModalCollection(null)
    setRequestedBookId('')

    const hasInternalReferrer =
      typeof document !== 'undefined' &&
      Boolean(document.referrer && document.referrer.startsWith(window.location.origin))

    const canGoBack = (inAppNavCountRef.current > 0 || hasInternalReferrer) && window.history.length > 1

    if (canGoBack) {
      window.history.back()
    } else {
      handleHeaderClick()
    }
  }

  const handleSaveBookToShelf = async (shelfToSave = targetShelf) => {
    if (!selectedBook) return
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!isUserLoggedIn || !activeUser) {
      closeBookDetails()
      setShowProfileModal(true)
      return
    }

    const bookId = String(selectedBook.bookId || selectedBook.id || loggedInUserBook?.bookId || '')
    if (!bookId) return

    try {
      setIsSavingShelf(true)
      const response = await fetch('/api/shelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          bookId,
          shelf: shelfToSave,
          book: {
            bookId,
            title: selectedBook.title,
            author: selectedBook.author,
            isbn: selectedBook.isbn,
            pages: selectedBook.pages,
            publishedYear: selectedBook.publishedYear,
            publisher: selectedBook.publisher,
            binding: selectedBook.binding,
            description: selectedBook.description,
            mainCategory: selectedBook.mainCategory,
            coverUrl: selectedBook.imageUrl || selectedBook.coverUrl,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save book to shelf: status ${response.status}`)
      }

      const data = await response.json()
      const savedShelfName = data.shelf || shelfToSave
      setTargetShelf(savedShelfName)
      setSavedShelf(true)
      if (savedShelfName === 'read') {
        setShowRatingPopup(true)
      } else {
        setShowRatingPopup(false)
      }
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
      const todayAddedFormatted = data.dateAdded || todayStr
      const todayFormatted =
        data.dateRead ||
        (savedShelfName === 'read' ? todayStr : '')
      setUserShelvesByBookId((prev) => {
        const entry = {
          ...(prev[bookId] || {}),
          bookId,
          shelf: savedShelfName,
          title: selectedBook.title,
          author: selectedBook.author,
          isbn: selectedBook.isbn,
          dateAdded: todayAddedFormatted,
          dateRead: todayFormatted,
        }
        const next = {
          ...prev,
          [bookId]: entry,
        }
        if (selectedBook.id && String(selectedBook.id) !== bookId) {
          next[String(selectedBook.id)] = entry
        }
        return next
      })
      syncSavedBookIntoLibrary(activeUser, selectedBook, savedShelfName, data)
      setSelectedBook((prev) => {
        if (!prev) return prev
        const isMatch =
          String(prev.bookId || '') === bookId ||
          String(prev.id || '') === bookId ||
          (selectedBook.id && String(prev.id) === String(selectedBook.id))
        if (!isMatch) return prev
        return {
          ...prev,
          bookshelves: savedShelfName,
          dateAdded: todayAddedFormatted,
          'Date Added': todayAddedFormatted,
          readAt: todayFormatted,
          'Date Read': todayFormatted,
          updatedAt: data.updatedAt || new Date().toISOString(),
        }
      })
    } catch (err) {
      console.error('Error saving book to shelf:', err)
    } finally {
      setIsSavingShelf(false)
    }
  }

  const handleRateBook = async (newRating) => {
    if (!selectedBook) return
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!isUserLoggedIn || !activeUser) {
      closeBookDetails()
      setShowProfileModal(true)
      return
    }

    const bookId = String(selectedBook.bookId || selectedBook.id || loggedInUserBook?.bookId || '')
    if (!bookId) return

    const previousRating = currentBookRating

    // Close the rating panel after clicking stars, while keeping the whole book modal window open
    if (ratingCloseTimeoutRef.current) {
      clearTimeout(ratingCloseTimeoutRef.current)
    }
    ratingCloseTimeoutRef.current = setTimeout(() => {
      setShowRatingPopup(false)
    }, 250)

    // Optimistic update: update star rating immediately before receiving server confirmation
    setTargetShelf('read')
    setSavedShelf(true)
    setUserShelvesByBookId((prev) => ({
      ...prev,
      [bookId]: {
        ...(prev[bookId] || {}),
        bookId,
        shelf: 'read',
        myRating: newRating,
        title: selectedBook.title,
        author: selectedBook.author,
        isbn: selectedBook.isbn,
      },
    }))

    setSelectedBook((prev) => (prev ? { ...prev, rating: newRating } : prev))
    setBooks((prev) =>
      prev.map((b) =>
        String(b.bookId || b.id) === bookId ? { ...b, rating: newRating } : b
      )
    )

    if (activeModalCollection) {
      setActiveModalCollection((prev) => {
        if (!prev || !Array.isArray(prev.books)) return prev
        return {
          ...prev,
          books: prev.books.map((b) =>
            String(b.bookId || b.id) === bookId ? { ...b, rating: newRating } : b
          ),
        }
      })
    }

    const updateCollectionRating = (ratingVal) => (collections) =>
      collections.map((c) => {
        if (!c.books || !Array.isArray(c.books)) return c
        const hasBook = c.books.some((b) => String(b.bookId || b.id) === bookId)
        if (!hasBook) return c
        return {
          ...c,
          books: c.books.map((b) =>
            String(b.bookId || b.id) === bookId ? { ...b, rating: ratingVal } : b
          ),
        }
      })

    setUserCollections(updateCollectionRating(newRating))
    setExploreCollections(updateCollectionRating(newRating))

    try {
      setIsSavingRating(true)
      const response = await fetch('/api/shelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          bookId,
          action: 'rate',
          rating: newRating,
          shelf: 'read',
          book: {
            bookId,
            title: selectedBook.title,
            author: selectedBook.author,
            isbn: selectedBook.isbn,
            pages: selectedBook.pages,
            publishedYear: selectedBook.publishedYear,
            publisher: selectedBook.publisher,
            binding: selectedBook.binding,
            description: selectedBook.description,
            mainCategory: selectedBook.mainCategory,
            coverUrl: selectedBook.imageUrl || selectedBook.coverUrl,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to save rating: status ${response.status}`)
      }

      const data = await response.json()
      const savedRating = Number(data.myRating ?? newRating)

      // Sync confirmed rating from server if it differs
      if (savedRating !== newRating) {
        setUserShelvesByBookId((prev) => ({
          ...prev,
          [bookId]: {
            ...(prev[bookId] || {}),
            bookId,
            shelf: 'read',
            myRating: savedRating,
            title: selectedBook.title,
            author: selectedBook.author,
            isbn: selectedBook.isbn,
          },
        }))
        setSelectedBook((prev) => (prev ? { ...prev, rating: savedRating } : prev))
        setBooks((prev) =>
          prev.map((b) =>
            String(b.bookId || b.id) === bookId ? { ...b, rating: savedRating } : b
          )
        )
      }
    } catch (err) {
      console.error('Error saving book rating:', err)
      // Rollback on failure
      setUserShelvesByBookId((prev) => ({
        ...prev,
        [bookId]: {
          ...(prev[bookId] || {}),
          bookId,
          myRating: previousRating,
        },
      }))
      setSelectedBook((prev) => (prev ? { ...prev, rating: previousRating } : prev))
      setBooks((prev) =>
        prev.map((b) =>
          String(b.bookId || b.id) === bookId ? { ...b, rating: previousRating } : b
        )
      )
    } finally {
      setIsSavingRating(false)
    }
  }

  const handleRemoveBookFromShelf = async () => {
    if (!selectedBook) return
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!isUserLoggedIn || !activeUser) {
      closeBookDetails()
      setShowProfileModal(true)
      return
    }

    const bookId = String(selectedBook.bookId || selectedBook.id || loggedInUserBook?.bookId || '')
    if (!bookId) return

    try {
      setIsSavingShelf(true)
      const response = await fetch('/api/shelves', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: activeUser,
          bookId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to remove book from shelf: status ${response.status}`)
      }

      setSavedShelf(false)
      setShowRatingPopup(false)
      setUserShelvesByBookId((prev) => {
        const next = { ...prev }
        delete next[bookId]
        if (loggedInUserBook?.bookId) {
          delete next[loggedInUserBook.bookId]
        }
        if (selectedBook.id) {
          delete next[String(selectedBook.id)]
        }
        return next
      })
      setBooks((prevBooks) =>
        prevBooks.filter(
          (b) =>
            String(b.bookId || '') !== bookId &&
            String(b.id || '') !== bookId &&
            !(selectedBook.id && String(b.id) === String(selectedBook.id))
        )
      )
      setSelectedBook((prev) =>
        prev &&
          (String(prev.bookId || '') === bookId ||
            String(prev.id || '') === bookId ||
            (selectedBook.id && String(prev.id) === String(selectedBook.id)))
          ? {
            ...prev,
            bookshelves: '',
            readAt: '',
            'Date Read': '',
          }
          : prev
      )
      if (cookieUserId) {
        setBooksFetchTrigger((prev) => prev + 1)
      }
    } catch (err) {
      console.error('Error removing book from shelf:', err)
    } finally {
      setIsSavingShelf(false)
    }
  }

  const showModalToast = (msg) => {
    if (modalToastTimeoutRef.current) clearTimeout(modalToastTimeoutRef.current)
    setModalToast(msg)
    modalToastTimeoutRef.current = setTimeout(() => setModalToast(''), 2200)
  }

  const handleToggleBookInCollection = async (collectionSummary) => {
    const activeUser = getActiveCollectionUserId()
    if (!activeUser || !supabaseUser || !selectedBook || !collectionSummary?.id) return

    const colId = String(collectionSummary.id)
    const isCurrentlyIn = selectedBookCollectionIds.has(colId)
    const bookId = String(selectedBook.bookId || selectedBook.id || '')
    const cleanIsbn = String(selectedBook.isbn || selectedBook.isbn13 || '')
      .replace(/[^0-9X]/gi, '')
      .trim()

    setCollectionActionInProgressId(colId)

    // Optimistically update membership state
    setSelectedBookCollectionIds((prev) => {
      const next = new Set(prev)
      if (isCurrentlyIn) {
        next.delete(colId)
      } else {
        next.add(colId)
      }
      return next
    })

    try {
      if (isCurrentlyIn) {
        const response = await fetch('/api/collections', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: activeUser,
            collectionId: colId,
            bookId,
            isbn: cleanIsbn,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to remove book: status ${response.status}`)
        }

        const removeBookFn = (list) =>
          list.map((c) => {
            if (String(c.id) !== colId) return c
            return {
              ...c,
              books: (c.books || []).filter(
                (b) =>
                  String(b.bookId || b.id) !== bookId &&
                  (!cleanIsbn ||
                    String(b.isbn || b.isbn13 || '').replace(/[^0-9X]/gi, '') !== cleanIsbn),
              ),
            }
          })

        setUserCollections(removeBookFn)
        setExploreCollections(removeBookFn)
        showModalToast(`Eliminat din „${collectionSummary.title}”`)
      } else {
        const response = await fetch('/api/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add-book',
            userId: activeUser,
            collectionId: colId,
            bookId,
            book: {
              bookId,
              title: selectedBook.title,
              author: selectedBook.author,
              isbn: selectedBook.isbn || selectedBook.isbn13,
              pages: selectedBook.pages,
              publishedYear: selectedBook.publishedYear,
              publisher: selectedBook.publisher,
              binding: selectedBook.binding,
              description: selectedBook.description,
              mainCategory: selectedBook.mainCategory,
              coverUrl: selectedBook.imageUrl || selectedBook.coverUrl,
            },
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to add book: status ${response.status}`)
        }

        const normalizedAddedBook = normalizeCsvBook(selectedBook, 0)
        const addBookFn = (list) =>
          list.map((c) => {
            if (String(c.id) !== colId) return c
            const existingBooks = Array.isArray(c.books) ? c.books : []
            if (existingBooks.some((b) => String(b.bookId || b.id) === bookId)) return c
            return {
              ...c,
              books: [...existingBooks, normalizedAddedBook],
            }
          })

        setUserCollections(addBookFn)
        setExploreCollections(addBookFn)
        showModalToast(`Adăugat în „${collectionSummary.title}”`)
      }
    } catch (err) {
      console.error('Error toggling book in collection:', err)
      // Rollback optimistic update
      setSelectedBookCollectionIds((prev) => {
        const next = new Set(prev)
        if (isCurrentlyIn) {
          next.add(colId)
        } else {
          next.delete(colId)
        }
        return next
      })
      showModalToast('Eroare la actualizarea colecției.')
    } finally {
      setCollectionActionInProgressId(null)
    }
  }

  const handleJumpBook = (delta = 1, { saveToRead = false } = {}) => {
    if (!modalBookList.length || !selectedBook) return
    const curIdx = modalBookList.findIndex(
      (b) => String(b.bookId || b.id) === String(selectedBook.bookId || selectedBook.id),
    )
    if (curIdx === -1) return

    const bookToSave = selectedBook

    if (saveToRead) {
      const activeUser = cookieUserId || getUserIdFromCookie()
      if (!isUserLoggedIn || !activeUser) {
        closeBookDetails()
        setShowProfileModal(true)
        return
      }

      if (isSwipableModal) {
        const bookId = String(bookToSave.bookId || bookToSave.id || '')
        if (bookId) {
          fetch('/api/shelves', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: activeUser,
              bookId,
              shelf: 'to-read',
              book: {
                bookId,
                title: bookToSave.title,
                author: bookToSave.author,
                isbn: bookToSave.isbn,
                pages: bookToSave.pages,
                publishedYear: bookToSave.publishedYear,
                publisher: bookToSave.publisher,
                binding: bookToSave.binding,
                description: bookToSave.description,
                mainCategory: bookToSave.mainCategory,
                coverUrl: bookToSave.imageUrl || bookToSave.coverUrl,
              },
            }),
          })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
              if (data) {
                const savedShelfName = data.shelf || 'to-read'
                setUserShelvesByBookId((prev) => ({
                  ...prev,
                  [bookId]: {
                    ...(prev[bookId] || {}),
                    bookId,
                    shelf: savedShelfName,
                    title: bookToSave.title,
                    author: bookToSave.author,
                    isbn: bookToSave.isbn,
                    dateAdded: data.dateAdded || '',
                  },
                }))
                syncSavedBookIntoLibrary(activeUser, bookToSave, savedShelfName, data)
                showModalToast('Salvat pe raftul De citit!')
              }
            })
            .catch((err) => {
              console.error('Error saving book on swipe right:', err)
            })
        }
      }
    }

    const nextIndex = curIdx + delta
    if (nextIndex >= modalBookList.length || nextIndex < 0) {
      closeBookDetails()
      return
    }

    const nextBook = modalBookList[nextIndex]
    if (!nextBook) {
      closeBookDetails()
      return
    }

    const nextBookId = String(nextBook.bookId || nextBook.id)
    if (!activeModalCollection) {
      const nextShelf = nextBook.bookshelves || activeShelf
      window.history.replaceState({}, '', `/${currentUserId}/${nextShelf}/${encodeURIComponent(nextBookId)}`)
      setRequestedBookId(nextBookId)
    }
    setSelectedBook(enrichBookWithCache(nextBook))
    setShelfDropdownOpen(false)
  }

  // Preload and decode images for upcoming books so swiping feels instant with zero lag
  useEffect(() => {
    if (!selectedBook || !modalBookList || modalBookList.length === 0) return

    const curIdx = modalBookList.findIndex(
      (b) => String(b.bookId || b.id) === String(selectedBook.bookId || selectedBook.id)
    )
    if (curIdx === -1) return

    // Preload next 3 books and previous 1 book
    const indicesToPreload = [curIdx + 1, curIdx + 2, curIdx + 3, curIdx - 1]
    const urls = indicesToPreload
      .map((idx) => modalBookList[idx]?.imageUrl)
      .filter((url) => Boolean(url && typeof url === 'string'))

    urls.forEach((url) => {
      const img = new Image()
      img.src = url
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {
          // Ignore decode errors if unsupported or network fails
        })
      }
    })
  }, [selectedBook, modalBookList])

  const handleTriggerModalSwipe = (direction) => {
    if (modalSwipeExit || !selectedBook) return

    if (direction === 'right') {
      const activeUser = cookieUserId || getUserIdFromCookie()
      if (!isUserLoggedIn || !activeUser) {
        setModalDragOffset({ x: 0, y: 0 })
        setModalSwipeExit(null)
        closeBookDetails()
        setShowProfileModal(true)
        return
      }
    }

    setModalSwipeExit(direction)

    const shouldSave = direction === 'right'

    setTimeout(() => {
      handleJumpBook(1, { saveToRead: shouldSave })
      setModalDragOffset({ x: 0, y: 0 })
      setModalSwipeExit(null)
      setIsModalEntering(true)
      setTimeout(() => setIsModalEntering(false), 160)
    }, 150)
  }

  const handleModalPointerDown = (event) => {
    if (modalSwipeExit) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (event.target.closest('button, select, input, a, .book-shelf-options-menu, .book-detail-qr-box, .book-detail-actions-row, .book-detail-rating-section, .book-rating-popup, .book-rating-popup-wrapper, .qr-modal-overlay, .qr-modal-card, [role="radiogroup"], [role="radio"]')) return

    modalPointerRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
      currentDx: 0,
      currentDy: 0,
      rafId: null,
      isDragging: true,
      directionLocked: null,
    }

    if (modalCardRef.current && typeof modalCardRef.current.setPointerCapture === 'function') {
      try {
        modalCardRef.current.setPointerCapture(event.pointerId)
      } catch {
        // Fallback
      }
    }
  }

  const handleModalPointerMove = (event) => {
    if (!modalPointerRef.current.isDragging || modalSwipeExit) return
    const dx = event.clientX - modalPointerRef.current.startX
    const dy = event.clientY - modalPointerRef.current.startY

    if (!modalPointerRef.current.directionLocked) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        modalPointerRef.current.directionLocked = 'horizontal'
      } else if (Math.abs(dy) > 8) {
        modalPointerRef.current.directionLocked = 'vertical'
      }
    }

    if (modalPointerRef.current.directionLocked === 'horizontal') {
      modalPointerRef.current.currentDx = dx
      modalPointerRef.current.currentDy = dy

      if (!modalPointerRef.current.rafId) {
        modalPointerRef.current.rafId = requestAnimationFrame(() => {
          modalPointerRef.current.rafId = null
          if (modalPointerRef.current.isDragging) {
            setModalDragOffset({
              x: modalPointerRef.current.currentDx,
              y: modalPointerRef.current.currentDy * 0.15,
            })
          }
        })
      }
    }
  }

  const handleModalPointerUp = (event) => {
    if (!modalPointerRef.current.isDragging) return
    modalPointerRef.current.isDragging = false

    if (modalPointerRef.current.rafId) {
      cancelAnimationFrame(modalPointerRef.current.rafId)
      modalPointerRef.current.rafId = null
    }

    if (modalCardRef.current && typeof modalCardRef.current.releasePointerCapture === 'function') {
      try {
        modalCardRef.current.releasePointerCapture(event.pointerId)
      } catch {
        // Fallback
      }
    }

    if (modalPointerRef.current.directionLocked === 'horizontal') {
      const dx = typeof modalPointerRef.current.currentDx === 'number'
        ? modalPointerRef.current.currentDx
        : modalDragOffset.x
      const elapsed = Math.max(1, Date.now() - (modalPointerRef.current.startTime || Date.now()))
      const velocity = Math.abs(dx) / elapsed
      const isFlick = velocity > 0.35 && Math.abs(dx) > 35
      const isLongDrag = Math.abs(dx) > 65

      if ((isFlick && dx > 0) || (isLongDrag && dx > 0)) {
        handleTriggerModalSwipe('right')
      } else if ((isFlick && dx < 0) || (isLongDrag && dx < 0)) {
        handleTriggerModalSwipe('left')
      } else {
        setModalDragOffset({ x: 0, y: 0 })
      }
    }

    modalPointerRef.current.directionLocked = null
  }

  useEffect(() => {
    if (!selectedBook && !isSearchModalOpen && !showNewCollectionInput && !editingCollection && !showBookQrModal && !showProfileModal) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (showBookQrModal) {
          setShowBookQrModal(false)
          return
        }
        if (showProfileModal) {
          setShowProfileModal(false)
          return
        }
        if (editingCollection) {
          handleCloseEditCollection()
          return
        }
        if (selectedBook) {
          closeBookDetails()
        } else if (isSearchModalOpen) {
          setIsSearchModalOpen(false)
          setTargetCollectionForSearch(null)
        } else if (showNewCollectionInput) {
          setShowNewCollectionInput(false)
          setNewCollectionTitle('')
          setNewCollectionDescription('')
          setNewCollectionIsPrivate(false)
          setNewCollectionError('')
        }
        return
      }

      if (!isSwipableModal || !selectedBook) return

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleTriggerModalSwipe('right')
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleTriggerModalSwipe('left')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedBook, isSearchModalOpen, showNewCollectionInput, editingCollection, showBookQrModal, showProfileModal, isSwipableModal, modalBookList, modalSwipeExit, cookieUserId, currentUserId, supabaseUser, openedFromSearch, activeModalCollection])

  const modalRotation = useMemo(() => {
    if (modalSwipeExit === 'right') return 16
    if (modalSwipeExit === 'left') return -16
    return Math.max(-14, Math.min(14, modalDragOffset.x * 0.045))
  }, [modalDragOffset.x, modalSwipeExit])

  const modalRightStampOpacity = useMemo(() => {
    if (modalSwipeExit === 'right') return 1
    if (modalSwipeExit === 'left') return 0
    return Math.max(0, Math.min(1, modalDragOffset.x / 60))
  }, [modalDragOffset.x, modalSwipeExit])

  const modalLeftStampOpacity = useMemo(() => {
    if (modalSwipeExit === 'left') return 1
    if (modalSwipeExit === 'right') return 0
    return Math.max(0, Math.min(1, -modalDragOffset.x / 60))
  }, [modalDragOffset.x, modalSwipeExit])

  const shouldShowCarouselNavigation = Boolean(currentUserId || username)

  const handleCsvFileChange = (event) => {
    const file = event.target.files?.[0] || null
    setCsvFile(file)
    setUploadError('')
  }

  const handleUploadCsvSubmit = async (event) => {
    event.preventDefault()

    if (!csvFile) {
      setUploadError('Selectează fișierul CSV exportat din Goodreads.')
      return
    }

    const trimmedName = displayNameInput.trim()

    try {
      setIsUploadingCsv(true)
      setUploadError('')
      setError('')

      const csvText = await csvFile.text()
      const existingCookieUserId = getUserIdFromCookie() || cookieUserId
      const isExistingUser = Boolean(existingCookieUserId)

      const response = await fetch('/api/uploadcsv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: trimmedName || undefined,
          description: descriptionInput.slice(0, 140).trim(),
          csv: csvText,
          userId: existingCookieUserId || currentUserId,
          authUserId: supabaseUser?.id || null,
        }),
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error(`Upload CSV failed with status ${response.status}`)
      }

      const contentType = response.headers.get('content-type') || ''
      let data = null
      if (contentType.includes('application/json')) {
        data = await response.json()
      } else {
        const text = (await response.text()).trim()
        if (text) {
          try {
            data = JSON.parse(text)
          } catch {
            data = { userId: text }
          }
        }
      }

      const nextUserId = data?.userId || data?.id || data?.slug || ''
      const nextUrl =
        data?.url ||
        (nextUserId
          ? `${window.location.origin}/${nextUserId}`
          : `${window.location.origin}/${encodeURIComponent(trimmedName)}`)

      if (nextUserId) {
        setUserIdCookie(nextUserId)
        setCookieUserId(String(nextUserId))
        const nextPath = `/${nextUserId}`
        window.history.pushState({}, '', nextPath)
        setCurrentUserId(String(nextUserId))
      }

      if (data?.username || trimmedName) {
        setUsername(data?.username || trimmedName)
      }

      if (Array.isArray(data?.books)) {
        setBooks(data.books.map((book, index) => normalizeCsvBook(book, index)))
      }

      setGeneratedProfileUrl(nextUrl)

      QRCode.toDataURL(nextUrl)
        .then((dataUrl) => setQrCodeDataUrl(dataUrl))
        .catch((qrError) => {
          console.error(qrError)
          setQrCodeDataUrl('')
        })

      if (isExistingUser) {
        setShowProfileModal(false)
        setCsvFile(null)
        if (window.location.pathname === '/' || window.location.pathname === '') {
          window.location.href = `/${nextUserId}`
        } else {
          window.location.reload()
        }
        return
      }
    } catch (submitError) {
      console.error(submitError)
      setUploadError('Nu am putut încărca fișierul CSV. Încearcă din nou.')
    } finally {
      setIsUploadingCsv(false)
    }
  }

  const handleCopyGeneratedUrl = async () => {
    if (!generatedProfileUrl) {
      return
    }

    try {
      await navigator.clipboard.writeText(generatedProfileUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch (copyError) {
      console.error(copyError)
    }
  }

  const handleShareGeneratedUrl = async () => {
    if (!generatedProfileUrl) {
      return
    }

    const shareTitle = displayNameInput ? `Librăria lui ${displayNameInput}` : 'Ce mai citim'
    const shareText = displayNameInput
      ? `Vezi cărțile citite de ${displayNameInput} pe Ce mai citim!`
      : 'Vezi librăria pe Ce mai citim!'

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: generatedProfileUrl,
        })
        setSharedUrl(true)
        setTimeout(() => setSharedUrl(false), 2000)
        return
      }

      await navigator.clipboard.writeText(generatedProfileUrl)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch (shareError) {
      if (shareError?.name === 'AbortError') {
        return
      }
      console.error(shareError)
      try {
        await navigator.clipboard.writeText(generatedProfileUrl)
        setCopiedUrl(true)
        setTimeout(() => setCopiedUrl(false), 2000)
      } catch (copyError) {
        console.error(copyError)
      }
    }
  }

  const handleOpenProfileModal = () => {
    const activeCookieId = cookieUserId || getUserIdFromCookie()
    const userFallbackName =
      supabaseUser?.user_metadata?.full_name ||
      supabaseUser?.user_metadata?.display_name ||
      supabaseUser?.email?.split('@')[0] ||
      ''

    if (activeCookieId) {
      if (!cookieUserId) {
        setCookieUserId(activeCookieId)
      }
      const prefillName = displayNameInput || userFallbackName || ''
      if (prefillName) {
        setDisplayNameInput(prefillName)
      }
      const profileUrl = `${window.location.origin}/${activeCookieId}`
      setGeneratedProfileUrl(profileUrl)
      QRCode.toDataURL(profileUrl)
        .then((dataUrl) => setQrCodeDataUrl(dataUrl))
        .catch((qrError) => {
          console.error(qrError)
          setQrCodeDataUrl('')
        })
    } else if (userFallbackName && !displayNameInput) {
      setDisplayNameInput(userFallbackName)
    }
    if (userDescription && !descriptionInput) {
      setDescriptionInput(userDescription)
    }
    setUploadError('')
    setShowProfileModal(true)
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

    if (!carouselRef.current || event.pointerType === 'touch') {
      return
    }

    const interactiveTarget = event.target.closest('button, a, input, textarea, select')
    if (interactiveTarget) {
      return
    }

    dragState.current = {
      isDown: true,
      active: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: carouselRef.current.scrollLeft,
    }
  }

  const handlePointerMove = (event) => {
    if (!dragState.current.isDown || event.pointerType === 'touch') {
      return
    }

    const deltaX = event.clientX - dragState.current.startX
    const deltaY = event.clientY - dragState.current.startY

    if (!dragState.current.active) {
      if (Math.hypot(deltaX, deltaY) > 6) {
        dragState.current.active = true
        pointerDragRef.current.hasMoved = true
        if (typeof event.currentTarget?.setPointerCapture === 'function') {
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // ignore
          }
        }
      }
    }

    if (!dragState.current.active || !carouselRef.current) {
      return
    }

    event.preventDefault()
    carouselRef.current.scrollLeft = dragState.current.scrollLeft - deltaX
    syncBookCoverFocus()
  }

  const handlePointerUp = (event) => {
    if (dragState.current.active && typeof event.currentTarget?.hasPointerCapture === 'function') {
      if (typeof event.pointerId === 'number' && event.currentTarget.hasPointerCapture(event.pointerId)) {
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }
    }

    dragState.current = {
      isDown: false,
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      scrollLeft: 0,
    }
  }

  const handleBookTap = (book, event) => {
    if (dragState.current.active || pointerDragRef.current.hasMoved) {
      return
    }
    if (event?.defaultPrevented || event?.target?.closest('.glide-select, .book-controls')) {
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
      if (carouselRect.width <= 0) {
        return
      }

      const carouselCenter = carouselRect.left + carouselRect.width / 2
      const maxDistance = carouselRect.width * 0.72
      const minBound = carouselRect.left - 200
      const maxBound = carouselRect.right + 200
      const cards = carousel.querySelectorAll('.book-card')

      // Phase 1: Pure reads - calculate transform values using robust viewport coordinates
      const updates = []

      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i]
        const cardRect = card.getBoundingClientRect()

        // If card is outside the active focus zone, clear custom property if it had one
        if (cardRect.right < minBound || cardRect.left > maxBound) {
          if (card.dataset.customized === '1') {
            card.style.removeProperty('--card-scale')
            card.style.removeProperty('--card-translate-y')
            card.style.removeProperty('--card-opacity')
            delete card.dataset.customized
          }
          continue
        }

        const cardCenter = cardRect.left + cardRect.width / 2
        const distanceFromCenter = Math.abs(cardCenter - carouselCenter)
        const ratio = Math.max(0, 1 - distanceFromCenter / maxDistance)
        const scale = (0.85 + ratio * 0.28).toFixed(3)
        const translateY = `${((1 - ratio) * 14).toFixed(1)}px`
        const opacity = (0.75 + ratio * 0.25).toFixed(3)

        updates.push({ card, scale, translateY, opacity })
      }

      // Phase 2: Batch writes
      for (let i = 0; i < updates.length; i += 1) {
        const { card, scale, translateY, opacity } = updates[i]
        card.style.setProperty('--card-scale', scale)
        card.style.setProperty('--card-translate-y', translateY)
        card.style.setProperty('--card-opacity', opacity)
        card.dataset.customized = '1'
      }
    })
  }

  useEffect(() => {
    if (!carouselRef.current || visibleBooks.length === 0 || isExploreMode || activeShelf === 'collections') {
      return undefined
    }

    const carousel = carouselRef.current
    syncBookCoverFocus()

    const handleScroll = () => {
      lastScrollTimeRef.current = Date.now()
      if (dragState.current.active) {
        pointerDragRef.current.hasMoved = true
      }
      syncBookCoverFocus()
    }

    const handleCarouselResize = () => {
      syncBookCoverFocus()
    }

    carousel.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleCarouselResize)

    let resizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        syncBookCoverFocus()
      })
      resizeObserver.observe(carousel)
    }

    return () => {
      carousel.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleCarouselResize)
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [isLoading, isExploreMode, visibleBooks, activeShelf, activeAuthorFilter, activeBookSort])

  const profileUserHeaderName =
    displayNameInput.trim() ||
    username ||
    supabaseUser?.user_metadata?.full_name ||
    supabaseUser?.user_metadata?.name ||
    supabaseUser?.user_metadata?.display_name ||
    supabaseUser?.email?.split('@')[0] ||
    ''

  const loggedInUserName =
    (!isVisitingOtherUser && (displayNameInput.trim() || username)) ||
    (!isVisitingOtherUser && supabaseUser?.user_metadata?.full_name) ||
    (!isVisitingOtherUser && supabaseUser?.user_metadata?.name) ||
    (!isVisitingOtherUser && supabaseUser?.user_metadata?.display_name) ||
    ''

  if (isAdminRoute) {
    if (isCheckingAuth || isVerifyingAdmin) {
      return (
        <div
          style={{
            minHeight: '100vh',
            background: '#0b0a0f',
            color: '#a1a1aa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <Loader2 size={20} className="animate-spin" />
          <span>Se verifică accesul...</span>
        </div>
      )
    }

    if (isAdminUser && supabaseUser) {
      return (
        <Suspense
          fallback={
            <div
              style={{
                minHeight: '100vh',
                background: '#0b0a0f',
                color: '#a1a1aa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <Loader2 size={20} className="animate-spin" />
              <span>Se încarcă panoul de administrare...</span>
            </div>
          }
        >
          <AdminPage
            adminEmail={supabaseUser.email || ''}
            getAccessToken={getSupabaseAccessToken}
            onBackToApp={handleExitAdminPage}
          />
        </Suspense>
      )
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      <main className="app-shell" style={{ position: 'relative', zIndex: 1, maxWidth: '100%' }}>
        <header className="library-header">
          <div
            className="library-header-row"
            onClick={handleHeaderClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleHeaderClick()
              }
            }}
            role="button"
            tabIndex={0}
            title="Mergi la pagina principală"
          >
            {!isCheckingAuth && isVisitingOtherUser && username ? (
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
                Ce mai citim · <span className="text-violet-300">{username}</span>
              </h1>
            ) : !isCheckingAuth && !isVisitingOtherUser && isUserLoggedIn && loggedInUserName ? (
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
                Ce mai citim · <span className="text-violet-300">{loggedInUserName}</span>
              </h1>
            ) : (
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
                Ce mai citim
              </h1>
            )}
          </div>

          {loggedInUserName && yearlySummary.count > 5 && yearlySummary.totalPages > 0 ? (
            <div className="reading-summary book-detail-label" aria-live="polite">
              <span>{yearlySummary.count} cărți citite în 2026</span>
              <span>· {yearlySummary.totalPages.toLocaleString()} pagini</span>
            </div>
          ) : null}

          <div className="shelf-pills" aria-label="Book shelves">
            <RubberSegment
              key="top-nav-segment"
              pad={14}
              items={visibleTopNavOptions.map((item) => {
                const isLocked = !isVisitingOtherUser && !isUserLoggedIn && (item.id === 'shelves' || item.id === 'collections')
                return {
                  value: item.id,
                  label: isLocked ? (
                    <span className="inline-flex items-center gap-1">
                      <span>{item.label}</span>
                      <Lock size={12} strokeWidth={2.2} className="top-nav-lock-icon" />
                    </span>
                  ) : (
                    item.label
                  ),
                  icon: item.icon,
                }
              })}
              value={isExploreMode ? 'explore' : activeShelf === 'collections' ? 'collections' : 'shelves'}
              onChange={(value) => {
                const item = visibleTopNavOptions.find((opt) => opt.id === value)
                if (!item) return
                setSelectedBook(null)
                setActiveModalCollection(null)
                setRequestedBookId('')

                if (item.id === 'explore') {
                  setIsExploreMode(true)
                  const ownId = isUserLoggedIn ? (cookieUserId || getUserIdFromCookie() || '') : ''
                  setCurrentUserId(ownId)
                  if (!ownId) {
                    setUsername('')
                  }
                  window.history.pushState({}, '', '/')
                  return
                }

                if (!isVisitingOtherUser && !isUserLoggedIn) {
                  setTimeout(() => {
                    setShowProfileModal(true)
                  }, 0)
                  return
                }

                // If currently in explore feed, switch to own library if available; otherwise require login
                const targetUser = isVisitingOtherUser
                  ? currentUserId
                  : (getActiveCollectionUserId() || cookieUserId || getUserIdFromCookie() || currentUserId)

                if (!targetUser) {
                  setTimeout(() => {
                    setShowProfileModal(true)
                  }, 0)
                  return
                }

                setIsExploreMode(false)
                if (String(targetUser) !== String(currentUserId)) {
                  setCurrentUserId(String(targetUser))
                }

                if (item.id === 'collections') {
                  setActiveShelf('collections')
                  window.history.pushState({}, '', `/${targetUser}/collections`)
                  return
                }

                const targetShelf =
                  activeShelf === 'collections' ? lastBookShelfRef.current || 'read' : activeShelf
                setActiveShelf(targetShelf)
                window.history.pushState({}, '', `/${targetUser}/${targetShelf}`)

                setIsShelfReady(false)
                if (!booksByUserIdCacheRef.current.has(String(targetUser))) {
                  setIsLoading(true)
                } else {
                  setTimeout(() => {
                    setIsShelfReady(true)
                  }, 80)
                }
              }}
              trackColor="rgba(38, 35, 46, 0.76)"
              thumbColor="#8b5cf6"
              textColor="#f4f4f5"
              activeTextColor="#ffffff"
              size="lg"
              radius={12}
              inset={3}
              stretch={30}
              squash={1}
              speed={1.6}
              glide={30}
              draggable
            />
            {currentUserId && !isExploreMode && activeShelf !== 'collections' ? (
              <JellyRadio
                items={SHELF_OPTIONS.map((shelf) => ({
                  value: shelf.id,
                  label: `${shelf.label} (${shelfCounts[shelf.id] ?? 0})`,
                }))}
                value={activeShelf}
                onChange={(value) => {
                  const shelf = SHELF_OPTIONS.find((s) => s.id === value)
                  if (!shelf) return
                  setIsExploreMode(false)
                  setActiveModalCollection(null)
                  setActiveShelf(shelf.id)
                  const nextPath = currentUserId ? `/${currentUserId}/${shelf.id}` : `/${shelf.id}`
                  window.history.pushState({}, '', nextPath)
                  setRequestedBookId('')
                  setSelectedBook(null)
                }}
                chipColor="rgba(38, 35, 46, 0.76)"
                activeColor="rgba(255, 255, 255, 0.14)"
                textColor="#f4f4f5"
                activeTextColor="#ffffff"
                size="sm"
                gap={0}
                radius={18}
                swell={0.2}
                barge={0}
                shrink={0.05}
                jelly={1}
                bounce={0.25}
                stagger={22}
                stiffness={580}
                ariaLabel="Rafturi de cărți"
              />
            ) : currentUserId && !isExploreMode && activeShelf === 'collections' ? (
              <JellyRadio
                items={visibleCollectionFilterOptions.map((opt) => ({
                  value: opt.id,
                  label: `${opt.label} (${collectionCounts[opt.id] ?? 0})`,
                }))}
                value={!isOwnProfile && activeCollectionFilter === 'private' ? 'all' : activeCollectionFilter}
                onChange={(value) => setActiveCollectionFilter(value)}
                chipColor="rgba(38, 35, 46, 0.76)"
                activeColor="rgba(255, 255, 255, 0.14)"
                textColor="#f4f4f5"
                activeTextColor="#ffffff"
                size="sm"
                gap={8}
                radius={18}
                swell={0.2}
                barge={6}
                shrink={0.05}
                jelly={1}
                bounce={0.25}
                stagger={22}
                stiffness={580}
                ariaLabel="Filtru colecții"
              />
            ) : null}
          </div>

        </header>

        {selectedBook ? (
          <div
            className="book-detail-backdrop"
            onClick={(event) => {
              if (event.target !== event.currentTarget) return
              if (showBookQrModal) {
                setShowBookQrModal(false)
                return
              }
              closeBookDetails()
            }}
          >
            <div
              ref={isSwipableModal ? modalCardRef : undefined}
              className={`book-detail-modal ${showBookQrModal ? 'qr-modal-open' : ''} ${isSwipableModal
                ? `swipable ${modalPointerRef.current?.isDragging ? 'is-dragging' : ''} ${modalSwipeExit ? `modal-fly-out-${modalSwipeExit}` : ''} ${isModalEntering ? 'modal-entering' : ''}`
                : ''
                }`}
              style={
                isSwipableModal
                  ? {
                    transform: modalSwipeExit || isModalEntering
                      ? undefined
                      : `translate3d(${modalDragOffset.x}px, ${modalDragOffset.y}px, 0) rotate(${modalRotation}deg)`,
                    transition: modalPointerRef.current?.isDragging || isModalEntering
                      ? 'none'
                      : 'transform 0.18s cubic-bezier(0.2, 0.9, 0.3, 1)',
                  }
                  : undefined
              }
              onPointerDown={isSwipableModal ? handleModalPointerDown : undefined}
              onPointerMove={isSwipableModal ? handleModalPointerMove : undefined}
              onPointerUp={isSwipableModal ? handleModalPointerUp : undefined}
              onPointerCancel={isSwipableModal ? handleModalPointerUp : undefined}
              onClick={(event) => event.stopPropagation()}
            >
              {/* In-Modal Non-Fullscreen QR Code Overlay */}
              {showBookQrModal && bookQrCodeDataUrl ? (
                <div
                  className="qr-modal-overlay"
                  onClick={() => setShowBookQrModal(false)}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Cod QR"
                >
                  <div
                    className="qr-modal-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img
                      src={bookQrCodeDataUrl}
                      alt={`Cod QR ${selectedBook?.title || ''}`}
                      className="qr-modal-image"
                    />
                  </div>
                </div>
              ) : null}

              {/* Swipe Left & Right Overlay Stamps (Other user's books or collections) */}
              {isSwipableModal && (
                <>
                  <div
                    className="book-modal-stamp book-modal-stamp-right"
                    style={{ opacity: modalRightStampOpacity }}
                    aria-hidden="true"
                  >
                    <Bookmark size={18} strokeWidth={2.8} />
                    <span>SALVEAZĂ</span>
                  </div>

                  <div
                    className="book-modal-stamp book-modal-stamp-left"
                    style={{ opacity: modalLeftStampOpacity }}
                    aria-hidden="true"
                  >
                    <X size={20} strokeWidth={3} />
                    <span>SARI</span>
                  </div>

                  {/* Toast Feedback */}
                  {modalToast && (
                    <div className="book-modal-toast" role="status" aria-live="polite">
                      <Check size={14} />
                      <span>{modalToast}</span>
                    </div>
                  )}
                </>
              )}

              <div className="book-detail-header">
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={closeBookDetails}
                  aria-label="Închide detaliile cărții"
                  title="Închide"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="book-detail-content">
                <div className="book-detail-top-section">
                  <div className="book-detail-cover-col">
                    <div className="book-detail-cover">
                      <BookCover3D
                        thickness={selectedBook.thickness || (selectedBook.pages ? Math.min(Math.max(Math.round(selectedBook.pages / 8), 18), 80) : 24)}
                      >
                        <div className="book-cover-art">
                          {selectedBook.imageUrl ? (
                            <img
                              src={selectedBook.imageUrl}
                              alt={`${selectedBook.title} cover`}
                              loading="eager"
                              decoding="async"
                              className="loaded"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                          ) : null}
                          <div className="book-cover-placeholder" aria-hidden="true" />
                        </div>
                      </BookCover3D>
                    </div>
                  </div>

                  <div className="book-detail-meta-col">
                    <div className="book-detail-meta-metrics">
                      <div className="book-detail-metric">
                        <span className="book-detail-label">Pagini</span>
                        <strong>{selectedBook.pages ? selectedBook.pages.toLocaleString() : 'N/A'}</strong>
                      </div>
                      <div className="book-detail-metric">
                        <span className="book-detail-label">An</span>
                        <strong>{selectedBook.publishedYear || 'N/A'}</strong>
                      </div>
                    </div>

                    <div className="book-detail-actions-row">
                      {bookQrCodeDataUrl ? (
                        <button
                          type="button"
                          className="book-detail-action-button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            setShowBookQrModal(true)
                          }}
                          aria-label="Afișează codul QR"
                          title="Cod QR"
                        >
                          <QrCode size={18} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="book-detail-action-button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          shareBookLink(selectedBook)
                        }}
                        aria-label={copiedUrl ? 'Link copiat!' : `Distribuie ${selectedBook.title}`}
                        title={copiedUrl ? 'Link copiat!' : 'Distribuie'}
                      >
                        {copiedUrl ? <Check size={18} /> : <Share2 size={18} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Row 1 across both columns: Shelf action */}
                <div className="book-detail-shelf-action" ref={shelfDropdownRef}>
                  {!supabaseUser ? (
                    <button
                      type="button"
                      className="book-shelf-login-prompt-btn"
                      onClick={() => {
                        closeBookDetails()
                        setShowProfileModal(true)
                      }}
                    >
                      <Bookmark size={15} />
                      <span>Login to save</span>
                    </button>
                  ) : (
                    <div className="book-detail-shelf-action-row">
                      <div className="book-shelf-dropdown-wrapper">
                        <button
                          type="button"
                          className={`book-shelf-select-btn ${savedShelf ? 'saved' : ''} ${shelfDropdownOpen ? 'open' : ''}`}
                          disabled={isSavingShelf}
                          onClick={(e) => {
                            e.stopPropagation()
                            setShelfDropdownOpen((prev) => !prev)
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={shelfDropdownOpen}
                          title={savedShelf ? `Raft curent: ${getShelfLabel(targetShelf)}. Deschide pentru a schimba raftul` : 'Alege raftul'}
                        >
                          <span className="book-shelf-btn-content">
                            {savedShelf ? <Check size={16} /> : <Bookmark size={16} />}
                            <span>
                              {isSavingShelf
                                ? 'Se salvează...'
                                : (savedShelf ? getShelfLabel(targetShelf) : 'Alege raftul')}
                            </span>
                          </span>
                          <ChevronDown size={16} className={`chevron-icon ${shelfDropdownOpen ? 'open' : ''}`} />
                        </button>

                        {shelfDropdownOpen && (
                          <div className="book-shelf-options-menu" onClick={(e) => e.stopPropagation()}>
                            {SHELF_OPTIONS.map((shelf) => (
                              <button
                                key={shelf.id}
                                type="button"
                                className={`book-shelf-option-item ${targetShelf === shelf.id && savedShelf ? 'active' : ''}`}
                                onClick={() => {
                                  setShelfDropdownOpen(false)
                                  if (!savedShelf || targetShelf !== shelf.id) {
                                    setTargetShelf(shelf.id)
                                    handleSaveBookToShelf(shelf.id)
                                  }
                                }}
                              >
                                <span>{shelf.label}</span>
                                {targetShelf === shelf.id && savedShelf && <Check size={14} />}
                              </button>
                            ))}
                            {savedShelf && (
                              <>
                                <div className="book-shelf-menu-divider" />
                                <button
                                  type="button"
                                  className="book-shelf-option-item book-shelf-option-remove"
                                  onClick={() => {
                                    setShelfDropdownOpen(false)
                                    handleRemoveBookFromShelf()
                                  }}
                                >
                                  <Trash2 size={14} />
                                  <span>Elimină de pe raft</span>
                                </button>
                              </>
                            )}
                            {userCollectionSummaries.length > 0 && (
                              <>
                                <div className="book-shelf-menu-divider" />
                                <div className="book-shelf-menu-section-title">Colecții</div>
                                {userCollectionSummaries.map((col) => {
                                  const colId = String(col.id)
                                  const inCol = selectedBookCollectionIds.has(colId)
                                  const isBusy = collectionActionInProgressId === colId
                                  return (
                                    <button
                                      key={col.id}
                                      type="button"
                                      className={`book-shelf-option-item book-shelf-option-collection ${inCol ? 'active' : ''}`}
                                      disabled={isBusy}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleToggleBookInCollection(col)
                                      }}
                                      title={inCol ? `Elimină din colecția „${col.title}”` : `Adaugă în colecția „${col.title}”`}
                                    >
                                      <span className="book-shelf-option-col-label">
                                        <Library size={13} className="book-shelf-option-col-icon" />
                                        <span className="book-shelf-option-col-name">{col.title}</span>
                                      </span>
                                      {inCol ? (
                                        <Check size={14} className="book-shelf-option-check" />
                                      ) : isBusy ? (
                                        <Loader2 size={13} className="spin" />
                                      ) : null}
                                    </button>
                                  )
                                })}
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {isOwnCollectionModal ? (
                        <button
                          type="button"
                          className="book-collection-remove-btn"
                          disabled={isRemovingFromCollection}
                          onClick={handleRemoveBookFromActiveCollection}
                          title={`Elimină din colecția „${activeModalCollection.title}”`}
                          aria-label={`Elimină din colecția „${activeModalCollection.title}”`}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Row 2 across both columns: Evaluare (rating section) */}
                <div
                  className="book-detail-rating-section"
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="book-detail-rating-inline">
                    <span className="book-detail-rating-text">
                      {currentBookRating > 0
                        ? `Evaluat la: ${currentBookRating}/5`
                        : 'Evaluarea ta:'}
                    </span>
                    <div className="book-detail-rating-stars">
                      <PeekRating
                        value={currentBookRating}
                        defaultValue={currentBookRating || 0}
                        count={5}
                        shape="star"
                        labels={['1 - Slabă', '2 - Acceptabilă', '3 - Bună', '4 - Foarte bună', '5 - Excelentă']}
                        activeColor="#FFB703"
                        idleColor="#52525b"
                        tipColor="#1e293b"
                        tipTextColor="#f8fafc"
                        size={19}
                        gap={3}
                        lift={3}
                        magnify={1.15}
                        riseDuration={180}
                        popScale={1.3}
                        showTip={false}
                        allowClear
                        onChange={handleRateBook}
                      />
                    </div>
                  </div>
                </div>

                <div className="book-detail-body">
                  <h2>{selectedBook.title}</h2>
                  <p className="book-detail-author">{selectedBook.author}</p>

                  {selectedBook.description ? (
                    <p className="book-detail-description-text">{selectedBook.description}</p>
                  ) : isDescriptionLoading ? (
                    <div className="book-detail-description-skeleton" aria-hidden="true">
                      <div className="skeleton-line" />
                      <div className="skeleton-line" />
                      <div className="skeleton-line short" />
                    </div>
                  ) : null}

                  {loggedInUserBook?.myReview ? (
                    <div className="book-detail-review-card">
                      <span className="book-detail-label">Recenzia ta</span>
                      <p className="book-detail-review-text">{loggedInUserBook.myReview}</p>
                    </div>
                  ) : selectedBook.review ? (
                    <div className="book-detail-review-card">
                      <span className="book-detail-label">Recenzie</span>
                      <p className="book-detail-review-text">{selectedBook.review}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null
        }

        {
          showProfileModal ? (
            <div
              className="profile-modal-backdrop"
              onPointerDown={(event) => {
                profileModalBackdropPointerDownRef.current = event.target === event.currentTarget
              }}
              onClick={(event) => {
                if (profileModalBackdropPointerDownRef.current && event.target === event.currentTarget) {
                  setShowProfileModal(false)
                }
                profileModalBackdropPointerDownRef.current = false
              }}
            >
              <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
                <div className="profile-modal-header">
                  {supabaseUser ? (
                    <div className="profile-modal-user-header">
                      <div className="profile-user-badge">
                        {profileUserHeaderName ? (
                          <span className="profile-user-name">{profileUserHeaderName}</span>
                        ) : null}
                        <span className="profile-user-email">{supabaseUser.email}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="profile-modal-header-spacer" />
                  )}
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setShowProfileModal(false)}
                    aria-label="Închide profilul"
                    title="Închide"
                  >
                    <X size={18} />
                  </button>
                </div>

                {!supabaseUser ? (
                  <AuthModalView
                    onSuccess={(user) => {
                      setShowProfileModal(false)
                      if (user) {
                        setSupabaseUser(user)
                        syncUserProfileWithServer(user, { hideModal: true })
                      }
                    }}
                  />
                ) : (
                  <>
                    <form className="profile-modal-form" onSubmit={handleUploadCsvSubmit}>
                      <div className="profile-modal-field">
                        <label htmlFor="profile-display-name-input" className="profile-modal-label">
                          Numele tău
                        </label>
                        <div className="profile-name-input-wrapper">
                          <input
                            ref={nameInputRef}
                            id="profile-display-name-input"
                            type="text"
                            value={displayNameInput}
                            onChange={(event) => {
                              setDisplayNameInput(event.target.value)
                              setUploadError('')
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                handleSaveDisplayName()
                              }
                            }}
                            placeholder="ex: Alin"
                            className="profile-modal-input profile-modal-input-with-action"
                          />
                          <button
                            type="button"
                            className={`profile-name-save-icon-btn ${savedName ? 'saved' : ''}`}
                            onClick={handleSaveDisplayName}
                            disabled={isSavingName || !displayNameInput.trim()}
                            aria-label="Salvează numele"
                            title={savedName ? 'Salvat!' : 'Salvează numele'}
                          >
                            {savedName ? <Check size={16} /> : <Save size={16} />}
                          </button>
                        </div>
                      </div>

                      <div className="profile-modal-field">
                        <div className="profile-field-header-row">
                          <label htmlFor="profile-description-input" className="profile-modal-label">
                            Descriere
                          </label>
                          <span className="profile-char-counter">
                            {descriptionInput.length}/140
                          </span>
                        </div>
                        <div className="profile-name-input-wrapper">
                          <textarea
                            id="profile-description-input"
                            rows={2}
                            maxLength={140}
                            value={descriptionInput}
                            onChange={(event) => {
                              setDescriptionInput(event.target.value)
                              setUploadError('')
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                event.preventDefault()
                                handleSaveDescription()
                              }
                            }}
                            placeholder="ex: Pasionat de cărți SF și literatură clasică"
                            className="profile-modal-input profile-modal-textarea-with-action"
                          />
                          <button
                            type="button"
                            className={`profile-name-save-icon-btn textarea-save-btn ${savedDescription ? 'saved' : ''}`}
                            onClick={handleSaveDescription}
                            disabled={isSavingDescription}
                            aria-label="Salvează descrierea"
                            title={savedDescription ? 'Salvat!' : 'Salvează descrierea'}
                          >
                            {savedDescription ? <Check size={16} /> : <Save size={16} />}
                          </button>
                        </div>
                      </div>

                      <div className="profile-panel profile-csv-panel">
                        <div className="profile-panel-header">
                          <span className="profile-panel-title">Librărie Goodreads</span>
                        </div>
                        <p className="profile-panel-description">
                          Exportă fișierul CSV din contul Goodreads (My Books &rarr; Import and export) și încarcă-l aici pentru a sincroniza cărțile, rafturile și recenziile tale.
                        </p>

                        <div className="profile-csv-center-action">
                          <input
                            id="profile-csv-input"
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleCsvFileChange}
                            className="profile-file-input-hidden"
                          />
                          <label htmlFor="profile-csv-input" className="profile-csv-choose-btn">
                            <Upload size={16} />
                            <span>{csvFile ? 'Schimbă fișierul CSV' : 'Selectează fișierul CSV'}</span>
                          </label>

                          {csvFile ? (
                            <div className="profile-csv-selected-info">
                              <FileText size={15} className="profile-csv-file-icon" />
                              <span className="profile-csv-selected-name" title={csvFile.name}>{csvFile.name}</span>
                            </div>
                          ) : null}

                          {csvFile ? (
                            <button
                              type="submit"
                              className="profile-csv-submit-btn"
                              disabled={isUploadingCsv || !displayNameInput.trim()}
                              title="Actualizează librăria"
                            >
                              {isUploadingCsv ? (
                                <span className="profile-btn-loading">
                                  <Loader2 size={16} className="spin-icon" />
                                  <span>Se încarcă...</span>
                                </span>
                              ) : (
                                <>
                                  <Check size={16} />
                                  <span>Încarcă biblioteca</span>
                                </>
                              )}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {uploadError ? <p className="profile-modal-error">{uploadError}</p> : null}
                    </form>

                    {generatedProfileUrl ? (
                      <div className="profile-panel profile-share-panel">
                        <div className="profile-panel-header">
                          <span className="profile-panel-title">Distribuie profilul tău</span>
                        </div>

                        <div className="profile-url-field">
                          <a
                            href={generatedProfileUrl}
                            className="profile-url-text"
                            onClick={() => setShowProfileModal(false)}
                            title="Mergi la librăria ta"
                          >
                            {generatedProfileUrl}
                          </a>
                          <div className="profile-url-btn-group">
                            <button
                              type="button"
                              className={`profile-url-copy-icon-btn ${copiedUrl ? 'copied' : ''}`}
                              onClick={handleCopyGeneratedUrl}
                              aria-label="Copiază linkul"
                              title={copiedUrl ? 'Copiat!' : 'Copiază linkul'}
                            >
                              {copiedUrl ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                            <button
                              type="button"
                              className={`profile-url-share-icon-btn ${sharedUrl ? 'shared' : ''}`}
                              onClick={handleShareGeneratedUrl}
                              aria-label="Distribuie linkul"
                              title={sharedUrl ? 'Distribuit!' : 'Distribuie linkul'}
                            >
                              {sharedUrl ? <Check size={16} /> : <Share2 size={16} />}
                            </button>
                          </div>
                        </div>

                        {qrCodeDataUrl ? (
                          <div className="profile-qr-section">
                            <div className="profile-qr-wrapper">
                              <img src={qrCodeDataUrl} alt="Cod QR pentru linkul profilului tău" className="profile-qr-image" />
                            </div>
                            <p className="profile-qr-caption">
                              Scanează codul QR pentru a deschide direct biblioteca ta publică de cărți.
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {isAdminUser ? (
                      <button
                        type="button"
                        className="profile-modal-logout-btn-bottom"
                        style={{
                          marginBottom: 8,
                          color: '#a7f3d0',
                          borderColor: 'rgba(16, 185, 129, 0.3)',
                          background: 'rgba(16, 185, 129, 0.08)',
                        }}
                        onClick={handleOpenAdminPage}
                        title="Deschide panoul de administrare"
                      >
                        <Shield size={16} />
                        <span>Administrare utilizatori</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="profile-modal-logout-btn-bottom"
                      onClick={handleSignOut}
                      title="Deconectare din cont"
                    >
                      <LogOut size={16} />
                      <span>Deconectare</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null
        }

        {error ? <div className="status-banner">{error}</div> : null}

        {isExploreMode ? (
          <section className="collections-section" aria-label="Descoperă noutăți și colecții">
            {(isLoadingFeed || isLoadingCollections) && mergedFeedItems.length === 0 ? (
              <div className="feed-container" aria-live="polite" aria-label="Se încarcă noutățile">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={`feed-skeleton-${i}`} className="feed-event-card" style={{ opacity: 0.7 }}>
                    <div className="feed-event-header">
                      <div className="loading-text short" style={{ width: 120, height: 22, borderRadius: 9999 }} />
                      <div className="loading-text short" style={{ width: 60, height: 16 }} />
                    </div>
                    <div className="feed-single-book-card">
                      <div className="loading-cover" style={{ width: 110, height: 165, borderRadius: 8 }} />
                      <div className="feed-single-book-info" style={{ gap: 8, width: '100%' }}>
                        <div className="loading-text" style={{ width: '80%', height: 20 }} />
                        <div className="loading-text short" style={{ width: '50%', height: 16 }} />
                        <div className="loading-text short" style={{ width: 130, height: 32, borderRadius: 9999, marginTop: 12 }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : mergedFeedItems.length === 0 ? (
              <div className="feed-empty-state">
                <Sparkles size={36} className="feed-empty-icon" />
                <h2>Nu există activitate recentă</h2>
                <p>Cărțile adăugate pe rafturi sau în colecții vor apărea aici.</p>
              </div>
            ) : (
              <div className="feed-container">
                {mergedFeedItems.map((event, eventIndex) => {
                  const isMultiBook = Array.isArray(event.books) && event.books.length > 1

                  if (isMultiBook) {
                    return (
                      <article key={event.id} className="feed-event-card">
                        <div className="feed-event-header">
                          {renderFeedStatement(event, handleVisitUserProfile)}
                          <span className="feed-time">{formatEventTime(event.createdAt)}</span>
                        </div>

                        {event.collection?.description && (
                          <p className="feed-collection-description">{event.collection.description}</p>
                        )}

                        <div className="feed-multi-books">
                          <div className="feed-books-carousel">
                            {event.books.map((b, bIdx) => {
                              const isSaved = isFeedBookSaved(b)
                              const isAdding = quickAddingBookId === String(b.bookId || b.id)
                              return (
                                <div key={`${event.id}-${b.bookId || b.id || bIdx}`} className="feed-carousel-card">
                                  <BookCoverCard
                                    book={b}
                                    isPriority={eventIndex < 2 && bIdx < 3}
                                    onClick={() => handleOpenFeedBook(b, event)}
                                  />
                                  <button
                                    type="button"
                                    className={`feed-quick-add-btn-mini ${isSaved ? 'is-saved' : ''}`}
                                    disabled={isSaved || isAdding}
                                    onClick={(e) => handleQuickAddFeedBook(b, e)}
                                    title={isSaved ? 'Pe raft' : 'Adaugă la De citit'}
                                  >
                                    {isAdding ? (
                                      <Loader2 size={11} className="animate-spin" />
                                    ) : isSaved ? (
                                      <Check size={11} strokeWidth={2.5} />
                                    ) : (
                                      <Plus size={11} strokeWidth={2.5} />
                                    )}
                                    <span>{isSaved ? 'Pe raft' : 'Adaugă'}</span>
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </article>
                    )
                  }

                  const singleBook = (event.books && event.books[0]) || event.book
                  if (!singleBook) return null

                  const isSaved = isFeedBookSaved(singleBook)
                  const isAdding = quickAddingBookId === String(singleBook.bookId || singleBook.id)

                  return (
                    <article key={event.id} className="feed-event-card">
                      <div className="feed-event-header">
                        {renderFeedStatement(event, handleVisitUserProfile)}
                        <span className="feed-time">{formatEventTime(event.createdAt)}</span>
                      </div>

                      {event.collection?.description && (
                        <p className="feed-collection-description">{event.collection.description}</p>
                      )}

                      <div className="feed-single-book-card">
                        <div className="feed-single-book-cover">
                          <BookCoverCard
                            book={singleBook}
                            isPriority={eventIndex < 4}
                            onClick={() => handleOpenFeedBook(singleBook, event)}
                          />
                        </div>

                        <div className="feed-single-book-info">
                          <h3
                            className="feed-book-title"
                            onClick={() => handleOpenFeedBook(singleBook, event)}
                            title={singleBook.title}
                          >
                            {singleBook.title || 'Fără titlu'}
                          </h3>
                          {singleBook.author && (
                            <p className="feed-book-author">{singleBook.author}</p>
                          )}

                          {event.eventType === 'book_rated' && event.metadata?.rating && (
                            <div className="feed-book-rating" title={`Rating: ${event.metadata.rating} stele`}>
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  size={15}
                                  className={i < Number(event.metadata.rating) ? 'fill-amber-400 text-amber-400' : 'text-zinc-600'}
                                />
                              ))}
                            </div>
                          )}

                          <div className="feed-single-book-actions">
                            <button
                              type="button"
                              className={`feed-quick-add-btn ${isSaved ? 'is-saved' : ''}`}
                              disabled={isSaved || isAdding}
                              onClick={(e) => handleQuickAddFeedBook(singleBook, e)}
                              title={isSaved ? 'Cartea este deja pe raftul tău' : 'Adaugă pe raftul De citit'}
                            >
                              {isAdding ? (
                                <>
                                  <Loader2 size={14} className="animate-spin" />
                                  <span>Se adaugă...</span>
                                </>
                              ) : isSaved ? (
                                <>
                                  <Check size={14} strokeWidth={2.5} />
                                  <span>Pe raft</span>
                                </>
                              ) : (
                                <>
                                  <Plus size={14} strokeWidth={2.5} />
                                  <span>Vreau să citesc</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ) : activeShelf === 'collections' ? (
          <section className="collections-section" aria-label="Colecții">
            {isLoadingCollections ? (
              <div className="books-carousel loading-carousel" aria-live="polite" aria-label="Loading collections">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`loading-col-${index}`} className="book-card loading-card">
                    <div className="loading-cover" />
                    <div className="loading-text" />
                    <div className="loading-text short" />
                  </div>
                ))}
              </div>
            ) : filteredUserCollections.length === 0 ? (
              <div className="collections-empty-state">
                <Library size={32} className="collections-empty-icon" />
                <h2>
                  {userCollections.length > 0 && activeCollectionFilter === 'private'
                    ? 'Nu există nicio colecție privată.'
                    : userCollections.length > 0 && activeCollectionFilter === 'public'
                      ? 'Nu există nicio colecție publică.'
                      : isOwnProfile
                        ? 'Nu ai creat încă nicio colecție.'
                        : 'Acest utilizator nu are încă nicio colecție.'}
                </h2>
                {isOwnProfile && !showNewCollectionInput ? (
                  <button
                    type="button"
                    className="collections-new-trigger-btn"
                    onClick={() => {
                      setNewCollectionError('')
                      setShowNewCollectionInput(true)
                    }}
                  >
                    <Plus size={16} />
                    <span>Creează prima ta colecție</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="collections-rows-list">
                {
                  filteredUserCollections.map((collection) => {
                    const activeUser = getActiveCollectionUserId()
                    const isCollectionOwner = Boolean(
                      isUserLoggedIn && activeUser && String(collection.userId) === String(activeUser),
                    )
                    return (
                      <CollectionRow
                        key={collection.id}
                        collection={collection}
                        isOwner={isCollectionOwner}
                        isExplore={false}
                        showCreator={false}
                        onSelectCreator={handleSelectExploreCreator}
                        onAddBookClick={handleOpenAddBookForCollection}
                        onDeleteCollection={handleDeleteCollection}
                        onBookClick={handleOpenCollectionBook}
                        onEditCollection={handleOpenEditCollection}
                      />
                    )
                  })
                }
              </div>
            )}
          </section>
        ) : (
          <>
            {isLoading || !isShelfReady ? (
              <div className="book-controls book-controls-placeholder" aria-hidden="true" />
            ) : totalShelfBooks.length > 0 || bookSearchQuery.trim() ? (
              <div
                className="book-controls"
                aria-label="Book controls"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
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
                    align="left"
                    placement='bottom'
                    radius={10}
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
                    align="left"
                    radius={10}
                    menuWidth={160}
                    icon={<ArrowUpDown size={13} strokeWidth={2} />}
                  />
                </div>

                <div className="toolbar-group">
                  <ShelfSearchInput
                    searchQuery={bookSearchQuery}
                    onSearch={setBookSearchQuery}
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
              {shouldShowCarouselNavigation && isShelfReady && !isLoading ? (
                <button
                  type="button"
                  className="nav-button"
                  onClick={() => scrollBooks(-1)}
                  aria-label="Scroll books left"
                >
                  ←
                </button>
              ) : null}

              {isLoading || !isShelfReady ? (
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
                    <h2>{bookSearchQuery.trim() ? 'Nicio carte găsită pentru căutarea ta.' : 'Nu exista nimic pe acest raft.'}</h2>
                    {bookSearchQuery.trim() ? (
                      <button
                        type="button"
                        className="empty-shelf-clear-search-btn"
                        onClick={() => setBookSearchQuery('')}
                      >
                        Resetează căutarea
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="books-carousel" ref={carouselRef}>
                  {visibleBooks.slice(0, bookRenderLimit).map((book, index) => {

                    return (
                      <article key={book.id} className="book-card">
                        <BookCoverCard
                          book={book}
                          isPriority={index < 6}
                          onClick={(event) => handleBookTap(book, event)}
                        />

                        <div className="book-meta">
                          <h2
                            onClick={(event) => handleBookTap(book, event)}
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
                        </div>
                      </article>
                    )
                  })}
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
          </>
        )}

        {isVisitingOtherUser && (
          <button
            type="button"
            className="back-url-trigger-round"
            onClick={handleBackNavigation}
            aria-label="Înapoi"
            title="Înapoi"
          >
            <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
        )}

        {!isCheckingAuth && (
          supabaseUser ? (
            <button
              type="button"
              className="profile-url-trigger-round"
              onClick={handleOpenProfileModal}
              aria-label="Profil și încărcare CSV"
              title="Profil și încărcare CSV"
            >
              <UserRoundPen size={18} strokeWidth={2.2} />
            </button>
          ) : (
            <button
              type="button"
              className="profile-url-trigger"
              onClick={handleOpenProfileModal}
            >
              <WandSparkles size={16} strokeWidth={2} />
              Creează librăria ta
            </button>
          )
        )}

        {!isCheckingAuth && isUserLoggedIn && !isExploreMode && (
          <button
            type="button"
            className="sticky-add-book-btn"
            onClick={() => {
              if (activeShelf === 'collections') {
                const activeUser = getActiveCollectionUserId()
                if (activeUser && String(currentUserId) !== String(activeUser)) {
                  setCurrentUserId(String(activeUser))
                  window.history.pushState({}, '', `/${activeUser}/collections`)
                }
                setNewCollectionError('')
                setShowNewCollectionInput(true)
                window.scrollTo({ top: 0, behavior: 'smooth' })
                return
              }
              const defaultShelf = SHELF_OPTIONS.some((s) => s.id === activeShelf) ? activeShelf : 'to-read'
              setTargetShelf(defaultShelf)
              setTargetCollectionForSearch(null)
              setIsSearchModalOpen(true)
              setSearchError('')
            }}
            aria-label={
              activeShelf === 'collections'
                ? 'Creează o colecție nouă'
                : `Adaugă o carte în ${getShelfLabel(activeShelf)}`
            }
            title={
              activeShelf === 'collections'
                ? 'Creează o colecție nouă'
                : `Adaugă o carte în ${getShelfLabel(activeShelf)}`
            }
          >
            <Plus size={24} strokeWidth={2.4} />
          </button>
        )}

        {showNewCollectionInput && (
          <div
            className="profile-modal-backdrop"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setShowNewCollectionInput(false)
                setNewCollectionTitle('')
                setNewCollectionDescription('')
                setNewCollectionIsPrivate(false)
                setNewCollectionError('')
              }
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowNewCollectionInput(false)
                setNewCollectionTitle('')
                setNewCollectionDescription('')
                setNewCollectionIsPrivate(false)
                setNewCollectionError('')
              }
            }}
          >
            <div
              className="profile-modal collection-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-collection-modal-title"
            >
              <div className="search-modal-header">
                <h2 id="create-collection-modal-title" className="search-modal-title">
                  Colecție nouă
                </h2>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => {
                    setShowNewCollectionInput(false)
                    setNewCollectionTitle('')
                    setNewCollectionDescription('')
                    setNewCollectionIsPrivate(false)
                    setNewCollectionError('')
                  }}
                  aria-label="Închide"
                  title="Închide"
                >
                  <X size={18} />
                </button>
              </div>

              <form className="collections-new-form" onSubmit={handleCreateCollection}>
                {newCollectionError && (
                  <div className="collections-modal-error" role="alert">
                    {newCollectionError}
                  </div>
                )}

                <div className="collections-new-fields">
                  <label className="collections-modal-label">
                    <span>Titlu colecție</span>
                    <input
                      type="text"
                      className="search-input collections-modal-input"
                      placeholder="Ex: Top SF, Cărți de vacanță..."
                      value={newCollectionTitle}
                      onChange={(e) => {
                        setNewCollectionTitle(e.target.value)
                        if (newCollectionError) setNewCollectionError('')
                      }}
                      autoFocus
                      maxLength={80}
                    />
                  </label>

                  <label className="collections-modal-label">
                    <div className="collections-modal-label-row">
                      <span>Descriere scurtă (opțional)</span>
                      <span className="collections-new-desc-counter">
                        {newCollectionDescription.length}/140
                      </span>
                    </div>
                    <textarea
                      className="search-input collections-modal-textarea"
                      placeholder="O scurtă descriere a colecției (max 140 caractere)..."
                      value={newCollectionDescription}
                      onChange={(e) => {
                        setNewCollectionDescription(e.target.value.slice(0, 140))
                        if (newCollectionError) setNewCollectionError('')
                      }}
                      maxLength={140}
                      rows={3}
                    />
                  </label>
                </div>

                <div className="collections-new-footer">
                  <label className="collections-new-private-checkbox">
                    <input
                      type="checkbox"
                      checked={newCollectionIsPrivate}
                      onChange={(e) => setNewCollectionIsPrivate(e.target.checked)}
                    />
                    <Lock size={15} />
                    <span>Colecție privată (vizibilă doar pentru tine)</span>
                  </label>

                  <div className="collections-new-actions">
                    <button
                      type="button"
                      className="collections-new-cancel-btn"
                      onClick={() => {
                        setShowNewCollectionInput(false)
                        setNewCollectionTitle('')
                        setNewCollectionDescription('')
                        setNewCollectionIsPrivate(false)
                        setNewCollectionError('')
                      }}
                    >
                      Anulează
                    </button>
                    <button
                      type="submit"
                      className="search-submit-btn"
                      disabled={isCreatingCollection || !newCollectionTitle.trim()}
                    >
                      {isCreatingCollection ? (
                        <>
                          <Loader2 size={16} className="spin-icon" />
                          <span>Se creează...</span>
                        </>
                      ) : (
                        'Creează colecția'
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {editingCollection && (
          <div
            className="profile-modal-backdrop"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseEditCollection()
              }
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                handleCloseEditCollection()
              }
            }}
          >
            <div
              className="profile-modal collection-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-collection-modal-title"
            >
              <div className="search-modal-header">
                <h2 id="edit-collection-modal-title" className="search-modal-title">
                  Editează colecția
                </h2>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={handleCloseEditCollection}
                  aria-label="Închide"
                  title="Închide"
                >
                  <X size={18} />
                </button>
              </div>

              <form className="collections-new-form" onSubmit={handleSaveEditCollection}>
                {editCollectionError && (
                  <div className="collections-modal-error" role="alert">
                    {editCollectionError}
                  </div>
                )}

                <div className="collections-new-fields">
                  <label className="collections-modal-label">
                    <span>Titlu colecție</span>
                    <input
                      type="text"
                      className="search-input collections-modal-input"
                      placeholder="Ex: Top SF, Cărți de vacanță..."
                      value={editCollectionTitle}
                      onChange={(e) => {
                        setEditCollectionTitle(e.target.value)
                        if (editCollectionError) setEditCollectionError('')
                      }}
                      autoFocus
                      maxLength={80}
                    />
                  </label>

                  <label className="collections-modal-label">
                    <div className="collections-modal-label-row">
                      <span>Descriere scurtă (opțional)</span>
                      <span className="collections-new-desc-counter">
                        {editCollectionDescription.length}/140
                      </span>
                    </div>
                    <textarea
                      className="search-input collections-modal-textarea"
                      placeholder="O scurtă descriere a colecției (max 140 caractere)..."
                      value={editCollectionDescription}
                      onChange={(e) => {
                        setEditCollectionDescription(e.target.value.slice(0, 140))
                        if (editCollectionError) setEditCollectionError('')
                      }}
                      maxLength={140}
                      rows={3}
                    />
                  </label>
                </div>

                <div className="collections-new-footer">
                  <label className="collections-new-private-checkbox">
                    <input
                      type="checkbox"
                      checked={editCollectionIsPrivate}
                      onChange={(e) => setEditCollectionIsPrivate(e.target.checked)}
                    />
                    <Lock size={15} />
                    <span>Colecție privată (vizibilă doar pentru tine)</span>
                  </label>

                  <div className="collections-new-actions">
                    <button
                      type="button"
                      className="collections-new-cancel-btn"
                      onClick={handleCloseEditCollection}
                    >
                      Anulează
                    </button>
                    <button
                      type="submit"
                      className="search-submit-btn"
                      disabled={isSavingEditCollection || !editCollectionTitle.trim()}
                    >
                      {isSavingEditCollection ? (
                        <>
                          <Loader2 size={16} className="spin-icon" />
                          <span>Se salvează...</span>
                        </>
                      ) : (
                        'Save'
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {isSearchModalOpen && !selectedBook && (
          <div
            className="search-modal-backdrop"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setIsSearchModalOpen(false)
                setTargetCollectionForSearch(null)
              }
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsSearchModalOpen(false)
                setTargetCollectionForSearch(null)
              }
            }}
          >
            <div
              className="search-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="search-modal-title"
            >
              <div className="search-modal-header">
                <h2 id="search-modal-title" className="search-modal-title">
                  {targetCollectionForSearch
                    ? `Adaugă în „${targetCollectionForSearch.title}”`
                    : `Adaugă în „${getShelfLabel(activeShelf)}”`}
                </h2>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => {
                    setIsSearchModalOpen(false)
                    setTargetCollectionForSearch(null)
                  }}
                  aria-label="Închide căutarea"
                  title="Închide"
                >
                  <X size={18} />
                </button>
              </div>

              <form className="search-modal-form" onSubmit={handleSearchSubmit}>
                <div className="search-input-wrapper">
                  <Search size={18} className="search-input-icon" />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Caută după titlu, autor sau ISBN..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      className="search-input-clear-btn"
                      onClick={() => setSearchQuery('')}
                      aria-label="Șterge textul"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="search-submit-btn"
                  disabled={isSearching || !searchQuery.trim()}
                >
                  {isSearching ? <Loader2 size={16} className="spin-icon" /> : 'Caută'}
                </button>
              </form>

              {isSearching ? (
                <div className="search-loading-state">
                  <Loader2 size={24} className="spin-icon" />
                  <span>Se caută pe Google Books...</span>
                </div>
              ) : searchError ? (
                <div className="search-error-state">{searchError}</div>
              ) : hasSearched && searchResults.length === 0 ? (
                <div className="search-empty-state">
                  Nu am găsit nicio carte pentru „{searchQuery}”.
                </div>
              ) : searchResults.length > 0 ? (
                <div className="search-results-list">
                  {searchResults.map((book) => (
                    <div
                      key={book.bookId}
                      className="search-result-item"
                      onClick={() => handleSelectSearchBook(book)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleSelectSearchBook(book)
                        }
                      }}
                    >
                      <div className="search-result-cover">
                        {book.imageUrl ? (
                          <img src={book.imageUrl} alt={book.title} />
                        ) : (
                          <div className="search-result-cover-placeholder">📖</div>
                        )}
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-title" title={book.title}>
                          {book.title}
                        </div>
                        <div className="search-result-author" title={book.author}>
                          {book.author}
                        </div>
                        {book.publishedYear ? (
                          <span className="search-result-year">
                            {book.publishedYear}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
