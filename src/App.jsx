import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookCover } from 'book-cover-3d'
import { ArrowLeft, ArrowUpDown, Bookmark, BookOpen, Check, ChevronDown, Compass, Copy, FolderPlus, Library, Loader2, Lock, LogOut, Plus, Save, Search, Share2, Trash2, Upload, UserRoundPen, UserSearch, WandSparkles, X } from 'lucide-react'
import {
  buildBookShareUrl,
  buildGoodreadsApiUrl,
  getFinishedBooksTotals,
  getRouteStateFromPath,
  getUserIdFromCookie,
  isRootPath,
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


const SHELF_OPTIONS = [
  { id: 'read', label: 'Citite', query: 'read' },
  { id: 'to-read', label: 'De citit', query: 'to-read' },
  { id: 'currently-reading', label: 'În curs', query: 'currently-reading' },
  { id: 'did-not-finish', label: 'DNF', query: 'did-not-finish' },
]

const TOP_NAV_OPTIONS = [
  { id: 'shelves', label: 'Rafturi', icon: <BookOpen size={16} strokeWidth={2.2} /> },
  { id: 'explore', label: 'Explorează', icon: <Compass size={16} strokeWidth={2.2} /> },
  { id: 'collections', label: 'Colecții', icon: <Library size={16} strokeWidth={2.2} /> },
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
  if (shelfId === 'to-read' || shelfId === 'currently-reading' || shelfId === 'did-not-finish') {
    return BOOK_SORT_OPTIONS.filter((option) => option.id !== 'recently-read' && option.id !== 'best-rated')
  }

  return BOOK_SORT_OPTIONS
}

const fetchBooksFromApi = async (apiUrl, signal) => {
  const response = await fetch(apiUrl, { signal })

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

    if (typeof data?.csv === 'string') {
      const csvBooks = parseGoodreadsCsv(data.csv)
      return { username, books: csvBooks }
    }

    const rawBooks = Array.isArray(data?.books) ? data.books : Array.isArray(data) ? data : []
    const normalizedBooks = rawBooks.map((book, index) => normalizeCsvBook(book, index))

    return {
      username,
      books: normalizedBooks,
    }
  }

  const csvBooks = parseGoodreadsCsv(responseText)
  return {
    username: '',
    books: csvBooks,
  }
}

function DeferredBookCover({ src, alt, priority = false }) {
  const [isVisible, setIsVisible] = useState(priority)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    setIsLoaded(false)
    setHasError(false)
  }, [src])

  useEffect(() => {
    if (priority) {
      setIsVisible(true)
      return undefined
    }
    if (isVisible) return undefined

    const el = containerRef.current
    if (!el) return undefined

    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return undefined
    }

    const scrollParent = el.closest('.books-carousel')

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry && entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      {
        root: scrollParent || null,
        rootMargin: '350px',
      }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [priority, isVisible])

  return (
    <div ref={containerRef} className="book-cover-art">
      {isVisible && src && !hasError ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
          ref={(imgNode) => {
            if (imgNode && imgNode.complete && imgNode.naturalWidth > 0 && !isLoaded) {
              setIsLoaded(true)
            }
          }}
          className={isLoaded ? 'loaded' : ''}
        />
      ) : null}
      {(!isLoaded || !src || hasError) && (
        <div className="book-cover-placeholder" aria-hidden="true" />
      )}
    </div>
  )
}

function CollectionRow({
  collection,
  isOwner,
  showCreator,
  onSelectCreator,
  onAddBookClick,
  onDeleteCollection,
  onBookClick,
}) {
  const rowContainerRef = useRef(null)
  const rowCarouselRef = useRef(null)
  const rowDragRef = useRef({ isDown: false, active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0 })
  const rowTapMovedRef = useRef(false)
  const [isRowInView, setIsRowInView] = useState(false)

  const normalizedBooks = useMemo(
    () => (Array.isArray(collection.books) ? collection.books.map((b, idx) => normalizeCsvBook(b, idx)) : []),
    [collection.books],
  )

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
        if (entry && entry.isIntersecting) {
          setIsRowInView(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '400px 0px',
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
          <h3 className="collection-row-title">{collection.title}</h3>
          <span className="collection-row-count">
            {normalizedBooks.length} {normalizedBooks.length === 1 ? 'carte' : 'cărți'}
          </span>
          {collection.isPrivate ? (
            <span className="collection-row-private-badge" title="Vizibilă doar pentru tine">
              <Lock size={12} />
              <span>Privată</span>
            </span>
          ) : null}
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

        {isOwner ? (
          <div className="collection-row-actions">
            <button
              type="button"
              className="collection-add-book-btn"
              onClick={() => onAddBookClick?.(collection)}
              title={`Adaugă o carte în „${collection.title}”`}
            >
              <Plus size={15} />
            </button>
            <button
              type="button"
              className="collection-delete-btn"
              onClick={() => onDeleteCollection?.(collection)}
              aria-label={`Șterge colecția ${collection.title}`}
              title="Șterge colecția"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ) : null}
      </div>

      {collection.description ? (
        <p className="collection-row-description">{collection.description}</p>
      ) : null}

      {normalizedBooks.length === 0 ? (
        <div className="collection-row-empty">
          <span>Nicio carte în această colecție încă.</span>
          {isOwner ? (
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
                  <div
                    className="book-cover-surface"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (rowDragRef.current.active || rowTapMovedRef.current) return
                      onBookClick?.(book, { ...collection, books: normalizedBooks })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onBookClick?.(book, { ...collection, books: normalizedBooks })
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
                      <DeferredBookCover
                        src={safeCoverUrl}
                        alt={`${book.title} cover`}
                        priority={isRowInView && index < 4}
                      />
                    </BookCover>
                  </div>

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
  const [activeBookSort, setActiveBookSort] = useState('recently-read')
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
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [isUploadingCsv, setIsUploadingCsv] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [savedName, setSavedName] = useState(false)
  const [isSavingName, setIsSavingName] = useState(false)
  const [generatedProfileUrl, setGeneratedProfileUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [sharedUrl, setSharedUrl] = useState(false)
  const [bookQrCodeDataUrl, setBookQrCodeDataUrl] = useState('')
  const [requestedBookId, setRequestedBookId] = useState(() => initialRouteState.bookId || '')
  const [selectedBook, setSelectedBook] = useState(null)
  const [targetShelf, setTargetShelf] = useState('to-read')
  const [shelfDropdownOpen, setShelfDropdownOpen] = useState(false)
  const [isSavingShelf, setIsSavingShelf] = useState(false)
  const [savedShelf, setSavedShelf] = useState(false)
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
  const [showNewCollectionInput, setShowNewCollectionInput] = useState(false)
  const [newCollectionTitle, setNewCollectionTitle] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')
  const [newCollectionIsPrivate, setNewCollectionIsPrivate] = useState(false)
  const [isCreatingCollection, setIsCreatingCollection] = useState(false)
  const [targetCollectionForSearch, setTargetCollectionForSearch] = useState(null)
  const [activeModalCollection, setActiveModalCollection] = useState(null)
  const [isAddingBookToCollection, setIsAddingBookToCollection] = useState(false)
  const [isRemovingFromCollection, setIsRemovingFromCollection] = useState(false)
  const [collectionsRefreshTrigger, setCollectionsRefreshTrigger] = useState(0)
  const shelfDropdownRef = useRef(null)
  const [userShelvesByBookId, setUserShelvesByBookId] = useState({})
  const [isLoading, setIsLoading] = useState(true)
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

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const isInitialRootUrlRef = useRef(
    typeof window !== 'undefined' && isRootPath(window.location.pathname),
  )

  const [modalDragOffset, setModalDragOffset] = useState({ x: 0, y: 0 })
  const [modalSwipeExit, setModalSwipeExit] = useState(null)
  const [modalToast, setModalToast] = useState('')
  const modalToastTimeoutRef = useRef(null)
  const modalPointerRef = useRef({ startX: 0, startY: 0, isDragging: false, directionLocked: null })
  const modalCardRef = useRef(null)

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
    if (!activeUser || !currentUserId) {
      return true
    }

    return String(activeUser) !== String(currentUserId)
  }, [isUserLoggedIn, currentUserId, cookieUserId])

  const isOwnProfile = useMemo(() => {
    if (!isUserLoggedIn) return false
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!activeUser || !currentUserId) return false
    return String(activeUser) === String(currentUserId)
  }, [isUserLoggedIn, currentUserId, cookieUserId])

  const isOwnCollectionModal = useMemo(() => {
    if (!activeModalCollection || !isUserLoggedIn) return false
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!activeUser) return false
    return String(activeModalCollection.userId) === String(activeUser)
  }, [activeModalCollection, isUserLoggedIn, cookieUserId])

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
      all: userCollections.length,
      public: publicCount,
      private: privateCount,
    }
  }, [userCollections])

  const filteredUserCollections = useMemo(() => {
    if (activeCollectionFilter === 'public') {
      return userCollections.filter((c) => !c.isPrivate)
    }
    if (activeCollectionFilter === 'private') {
      return userCollections.filter((c) => Boolean(c.isPrivate))
    }
    return userCollections
  }, [userCollections, activeCollectionFilter])

  useEffect(() => {
    if (activeShelf !== 'collections' || !currentUserId) return
    let isCancelled = false
    setIsLoadingCollections(true)
    const includePrivateParam = isOwnProfile ? '1' : '0'
    fetch(`/api/collections?userId=${encodeURIComponent(currentUserId)}&includePrivate=${includePrivateParam}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && Array.isArray(data?.collections)) {
          setUserCollections(data.collections)
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

  useEffect(() => {
    if (!isExploreMode) return
    let isCancelled = false
    setIsLoadingCollections(true)
    fetch('/api/collections?explore=true')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && Array.isArray(data?.collections)) {
          setExploreCollections(data.collections)
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

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setIsCheckingAuth(false)
      return
    }

    try {
      const supabase = createClient()
      supabase.auth
        .getSession()
        .then(({ data: { session } }) => {
          const user = session?.user ?? null
          setSupabaseUser(user)
          if (user && syncedAuthUserIdRef.current !== user.id) {
            syncedAuthUserIdRef.current = user.id
            syncUserProfileWithServer(user)
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
        const user = session?.user ?? null
        setSupabaseUser(user)
        setIsCheckingAuth(false)
        if (!user) {
          syncedAuthUserIdRef.current = null
          return
        }
        if (event === 'SIGNED_IN' || syncedAuthUserIdRef.current !== user.id) {
          syncedAuthUserIdRef.current = user.id
          syncUserProfileWithServer(user, { hideModal: event === 'SIGNED_IN' })
        }
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
      loadedUserIdRef.current = null
      if (typeof document !== 'undefined') {
        document.cookie = 'userId=; path=/; max-age=0; SameSite=Lax'
      }
      setSupabaseUser(null)
      setCookieUserId('')
      setCurrentUserId('')
      setUsername('')
      setBooks([])
      setUserCollections([])
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

  useEffect(() => {
    const syncRouteState = () => {
      const { userId, shelf, bookId } = getRouteStateFromPath(window.location.pathname)

      if (isRootPath(window.location.pathname) || !userId) {
        setIsExploreMode(true)
        setRequestedBookId('')
        setSelectedBook(null)
        if (!isUserLoggedIn) {
          setCurrentUserId('')
        }
        return
      }

      setIsExploreMode(false)
      setCurrentUserId(userId)
      setActiveShelf(shelf)
      setRequestedBookId(bookId)
    }

    window.addEventListener('popstate', syncRouteState)
    return () => window.removeEventListener('popstate', syncRouteState)
  }, [cookieUserId, isUserLoggedIn])

  useEffect(() => {
    if (!currentUserId) {
      loadedUserIdRef.current = null
      setBooks([])
      setIsLoading(false)
      if (!supabaseUserRef.current) {
        setUsername('')
      }
      return undefined
    }

    const controller = new AbortController()
    const resolvedUserId = currentUserId
    const apiUrl = buildGoodreadsApiUrl(resolvedUserId)
    const isSwitchingUser = loadedUserIdRef.current !== resolvedUserId

    const loadBooks = async () => {
      try {
        if (isSwitchingUser) {
          setIsLoading(true)
        }
        setError('')
        const { books: apiBooks, username: apiUsername } = await fetchBooksFromApi(apiUrl, controller.signal)
        loadedUserIdRef.current = resolvedUserId
        setBooks(apiBooks)
        if (apiUsername) {
          setUsername(apiUsername)
          if (!supabaseUserRef.current) {
            setDisplayNameInput((prev) => prev || apiUsername)
          }
        }
      } catch (loadError) {
        if (controller.signal.aborted) return
        console.error(loadError)
        setError('Ups! Nu am găsit nimic la această adresă.')
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    loadBooks()

    return () => {
      controller.abort()
    }
  }, [currentUserId, booksFetchTrigger])

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

  useEffect(() => {
    if (!selectedBook) {
      setSavedShelf(false)
      setShelfDropdownOpen(false)
      return
    }

    if (loggedInUserBook?.shelf) {
      setTargetShelf(loggedInUserBook.shelf)
      setSavedShelf(true)
    } else {
      const defaultShelf = SHELF_OPTIONS.some((s) => s.id === activeShelf) ? activeShelf : 'to-read'
      setTargetShelf(defaultShelf)
      setSavedShelf(false)
    }
  }, [selectedBook, loggedInUserBook, activeShelf])

  const shelfCounts = useMemo(() => {
    const counts = {}
    SHELF_OPTIONS.forEach((shelf) => {
      counts[shelf.id] = books.filter((book) => matchesShelf(book, shelf.id)).length
    })
    return counts
  }, [books])

  const shelfBooks = useMemo(() => {
    return books.filter((book) => matchesShelf(book, activeShelf))
  }, [books, activeShelf])

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
  }, [activeShelf, currentUserId])

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

  const handleCreateCollection = async (e) => {
    if (e) e.preventDefault()
    const title = newCollectionTitle.trim()
    const description = newCollectionDescription.trim().slice(0, 140)
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!title || !activeUser) return

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
        throw new Error(`Failed to create collection: status ${response.status}`)
      }
      const data = await response.json()
      if (data?.collection) {
        setUserCollections((prev) => [{ ...data.collection, username, books: [] }, ...prev])
      }
      setNewCollectionTitle('')
      setNewCollectionDescription('')
      setNewCollectionIsPrivate(false)
      setShowNewCollectionInput(false)
      setCollectionsRefreshTrigger((prev) => prev + 1)
    } catch (err) {
      console.error('Error creating collection:', err)
    } finally {
      setIsCreatingCollection(false)
    }
  }

  const handleDeleteCollection = async (collection) => {
    const activeUser = cookieUserId || getUserIdFromCookie()
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
      setExploreCollections((prev) => prev.filter((c) => Number(c.id) !== Number(collection.id)))
    } catch (err) {
      console.error('Error deleting collection:', err)
    }
  }

  const handleOpenAddBookForCollection = (collection) => {
    setTargetCollectionForSearch(collection)
    setSearchError('')
    setIsSearchModalOpen(true)
  }

  const handleAddBookToCollectionFromSearch = async (book) => {
    const activeUser = cookieUserId || getUserIdFromCookie()
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
        throw new Error(`Failed to add book to collection: status ${response.status}`)
      }

      const normalizedAddedBook = normalizeCsvBook(book, 0)
      const updateCollectionBooks = (list) =>
        list.map((c) => {
          if (Number(c.id) !== Number(targetCollectionForSearch.id)) return c
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
      setSearchError('Nu am putut adăuga cartea în colecție.')
    } finally {
      setIsAddingBookToCollection(false)
    }
  }

  const handleRemoveBookFromActiveCollection = async () => {
    const activeUser = cookieUserId || getUserIdFromCookie()
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
    setSelectedBook(book)
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
    setBooksFetchTrigger((prev) => prev + 1)
  }

  const handleSelectSearchBook = (book) => {
    if (targetCollectionForSearch) {
      handleAddBookToCollectionFromSearch(book)
      return
    }
    setOpenedFromSearch(true)
    setSelectedBook(book)
  }

  const handleHeaderClick = () => {
    setIsExploreMode(true)
    setActiveModalCollection(null)
    setRequestedBookId('')
    setSelectedBook(null)
    setActiveAuthorFilter('all')

    if (!isUserLoggedIn) {
      setCurrentUserId('')
      setUsername('')
      setBooks([])
      window.history.pushState({}, '', '/')
      return
    }

    const loggedInId = cookieUserId || getUserIdFromCookie() || currentUserId
    if (loggedInId) {
      setCurrentUserId(String(loggedInId))
    }
    window.history.pushState({}, '', '/')
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
      setUserShelvesByBookId((prev) => ({
        ...prev,
        [bookId]: {
          ...(prev[bookId] || {}),
          bookId,
          shelf: savedShelfName,
          title: selectedBook.title,
          author: selectedBook.author,
          isbn: selectedBook.isbn,
        },
      }))
      if (cookieUserId && currentUserId === cookieUserId) {
        setBooksFetchTrigger((prev) => prev + 1)
      }
    } catch (err) {
      console.error('Error saving book to shelf:', err)
    } finally {
      setIsSavingShelf(false)
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
      setUserShelvesByBookId((prev) => {
        const next = { ...prev }
        delete next[bookId]
        if (loggedInUserBook?.bookId) {
          delete next[loggedInUserBook.bookId]
        }
        return next
      })
      if (cookieUserId && currentUserId === cookieUserId) {
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
                  },
                }))
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
    setSelectedBook(nextBook)
    setShelfDropdownOpen(false)
  }

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
    }, 220)
  }

  const handleModalPointerDown = (event) => {
    if (modalSwipeExit) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    if (event.target.closest('button, select, input, a, .book-shelf-options-menu, .book-detail-qr-box')) return

    modalPointerRef.current = {
      startX: event.clientX,
      startY: event.clientY,
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
      setModalDragOffset({ x: dx, y: dy * 0.15 })
    }
  }

  const handleModalPointerUp = (event) => {
    if (!modalPointerRef.current.isDragging) return
    modalPointerRef.current.isDragging = false

    if (modalCardRef.current && typeof modalCardRef.current.releasePointerCapture === 'function') {
      try {
        modalCardRef.current.releasePointerCapture(event.pointerId)
      } catch {
        // Fallback
      }
    }

    if (modalPointerRef.current.directionLocked === 'horizontal') {
      const dx = modalDragOffset.x
      if (dx > 75) {
        handleTriggerModalSwipe('right')
      } else if (dx < -75) {
        handleTriggerModalSwipe('left')
      } else {
        setModalDragOffset({ x: 0, y: 0 })
      }
    }

    modalPointerRef.current.directionLocked = null
  }

  useEffect(() => {
    if (!selectedBook && !isSearchModalOpen && !showNewCollectionInput) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
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
  }, [selectedBook, isSearchModalOpen, showNewCollectionInput, isSwipableModal, modalBookList, modalSwipeExit, cookieUserId, currentUserId, supabaseUser, openedFromSearch, activeModalCollection])

  const modalRotation = useMemo(() => {
    if (modalSwipeExit === 'right') return 16
    if (modalSwipeExit === 'left') return -16
    return Math.max(-14, Math.min(14, modalDragOffset.x * 0.04))
  }, [modalDragOffset.x, modalSwipeExit])

  const modalRightStampOpacity = useMemo(() => {
    if (modalSwipeExit === 'right') return 1
    if (modalSwipeExit === 'left') return 0
    return Math.max(0, Math.min(1, modalDragOffset.x / 75))
  }, [modalDragOffset.x, modalSwipeExit])

  const modalLeftStampOpacity = useMemo(() => {
    if (modalSwipeExit === 'left') return 1
    if (modalSwipeExit === 'right') return 0
    return Math.max(0, Math.min(1, -modalDragOffset.x / 75))
  }, [modalDragOffset.x, modalSwipeExit])

  const shouldShowCarouselNavigation = Boolean(currentUserId || username)

  const handleCsvFileChange = (event) => {
    const file = event.target.files?.[0] || null
    setCsvFile(file)
    setUploadError('')
  }

  const handleUploadCsvSubmit = async (event) => {
    event.preventDefault()

    const trimmedName = displayNameInput.trim()
    if (!trimmedName) {
      setUploadError('Introdu numele care va fi afișat.')
      return
    }

    if (!csvFile) {
      setUploadError('Selectează fișierul CSV exportat din Goodreads.')
      return
    }

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
          displayName: trimmedName,
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

  const handleBookTap = (book) => {
    if (dragState.current.active || pointerDragRef.current.hasMoved) {
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

      // Phase 1: Pure DOM reads - calculate all transform values without touching styles
      const updates = []
      const minBound = carouselRect.left - 300
      const maxBound = carouselRect.right + 300

      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i]
        const rect = card.getBoundingClientRect()
        if (rect.right < minBound || rect.left > maxBound) {
          continue
        }
        const cardCenter = rect.left + rect.width / 2
        const distanceFromCenter = Math.abs(cardCenter - carouselCenter)
        const ratio = Math.max(0, 1 - distanceFromCenter / maxDistance)
        const scale = (0.85 + ratio * 0.28).toFixed(3)
        const translateY = `${((1 - ratio) * 14).toFixed(1)}px`
        const opacity = (0.75 + ratio * 0.25).toFixed(3)

        updates.push({ card, scale, translateY, opacity })
      }

      // Phase 2: Pure DOM writes - apply styles in a batch (zero layout thrashing)
      for (let i = 0; i < updates.length; i += 1) {
        const { card, scale, translateY, opacity } = updates[i]
        card.style.setProperty('--card-scale', scale)
        card.style.setProperty('--card-translate-y', translateY)
        card.style.setProperty('--card-opacity', opacity)
      }
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

    return () => {
      carousel.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleCarouselResize)
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [isLoading, visibleBooks.length, activeShelf, activeAuthorFilter, activeBookSort])

  return (
    <div style={{ position: 'relative', minHeight: '100vh', width: '100%', overflowX: 'hidden' }}>
      <main className="app-shell" style={{ position: 'relative', zIndex: 1 }}>
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
            title="Mergi la pagina ta principală"
          >
            {isUserLoggedIn && username ? (
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
                Ce mai citește <span className="text-violet-300">{username}</span>
              </h1>
            ) : (
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-50 md:text-6xl">
                Ce mai citim
              </h1>
            )}
          </div>

          {isUserLoggedIn && yearlySummary.count > 5 && yearlySummary.totalPages > 0 ? (
            <div className="reading-summary book-detail-label" aria-live="polite">
              <span>{yearlySummary.count} cărți citite în 2026</span>
              <span>// {yearlySummary.totalPages.toLocaleString()} pagini</span>
            </div>
          ) : null
          }

          <div className="shelf-pills" aria-label="Book shelves">
            <RubberSegment
              items={TOP_NAV_OPTIONS.map((item) => ({
                value: item.id,
                label: item.label,
                icon: item.icon,
              }))}
              value={isExploreMode ? 'explore' : activeShelf === 'collections' ? 'collections' : 'shelves'}
              onChange={(value) => {
                const item = TOP_NAV_OPTIONS.find((opt) => opt.id === value)
                if (!item) return
                if (!isUserLoggedIn && item.id !== 'explore') {
                  setShowProfileModal(true)
                  return
                }
                setSelectedBook(null)
                setActiveModalCollection(null)
                setRequestedBookId('')
                if (item.id === 'explore') {
                  setIsExploreMode(true)
                  window.history.pushState({}, '', '/')
                  return
                }
                setIsExploreMode(false)
                const activeUser = currentUserId || cookieUserId || getUserIdFromCookie()
                if (activeUser && activeUser !== currentUserId) {
                  setCurrentUserId(String(activeUser))
                }
                if (item.id === 'collections') {
                  setActiveShelf('collections')
                  const nextPath = activeUser ? `/${activeUser}/collections` : '/collections'
                  window.history.pushState({}, '', nextPath)
                  return
                }
                const targetShelf =
                  activeShelf === 'collections' ? lastBookShelfRef.current || 'read' : activeShelf
                setActiveShelf(targetShelf)
                const nextPath = activeUser ? `/${activeUser}/${targetShelf}` : `/${targetShelf}`
                window.history.pushState({}, '', nextPath)
              }}
              trackColor="rgba(38, 35, 46, 0.76)"
              thumbColor="#8b5cf6"
              textColor="#f4f4f5"
              activeTextColor="#ffffff"
              size="lg"
              radius={10}
              inset={3}
              equalSlots
              stretch={100}
              squash={3}
              speed={1}
              glide={75}
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
                activeColor="#8b5cf6"
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
                items={COLLECTION_FILTER_OPTIONS.map((opt) => ({
                  value: opt.id,
                  label: `${opt.label} (${collectionCounts[opt.id] ?? 0})`,
                }))}
                value={activeCollectionFilter}
                onChange={(value) => setActiveCollectionFilter(value)}
                chipColor="rgba(38, 35, 46, 0.76)"
                activeColor="#8b5cf6"
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
          <div className="book-detail-backdrop" onClick={closeBookDetails}>
            <div
              ref={isSwipableModal ? modalCardRef : undefined}
              className={`book-detail-modal ${isSwipableModal
                ? `swipable ${modalPointerRef.current?.isDragging ? 'is-dragging' : ''} ${modalSwipeExit ? `modal-fly-out-${modalSwipeExit}` : ''
                }`
                : ''
                }`}
              style={
                isSwipableModal
                  ? {
                    transform: modalSwipeExit
                      ? undefined
                      : `translate3d(${modalDragOffset.x}px, ${modalDragOffset.y}px, 0) rotate(${modalRotation}deg)`,
                    transition: modalPointerRef.current?.isDragging
                      ? 'none'
                      : 'transform 0.28s cubic-bezier(0.18, 0.89, 0.32, 1.15)',
                  }
                  : undefined
              }
              onPointerDown={isSwipableModal ? handleModalPointerDown : undefined}
              onPointerMove={isSwipableModal ? handleModalPointerMove : undefined}
              onPointerUp={isSwipableModal ? handleModalPointerUp : undefined}
              onPointerCancel={isSwipableModal ? handleModalPointerUp : undefined}
              onClick={(event) => event.stopPropagation()}
            >
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
                  className="book-detail-back-button"
                  onClick={closeBookDetails}
                  aria-label="Înapoi"
                  title="Înapoi"
                >
                  <ArrowLeft size={18} />
                </button>
              </div>

              <div className="book-detail-content">
                <div className="book-detail-top-section">
                  <div className="book-detail-cover-col">
                    <div className="book-detail-cover">
                      {selectedBook.imageUrl ? (
                        <img
                          src={selectedBook.imageUrl}
                          alt={`${selectedBook.title} cover`}
                        />
                      ) : (
                        <div className="book-cover-placeholder" aria-hidden="true" />
                      )}
                    </div>

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
                        <>
                          <div className={`book-shelf-dropdown-btn-group ${savedShelf ? 'saved' : ''}`}>
                            <button
                              type="button"
                              className="book-shelf-main-btn"
                              disabled={isSavingShelf}
                              onClick={() => {
                                if (savedShelf) {
                                  handleRemoveBookFromShelf()
                                } else {
                                  handleSaveBookToShelf(targetShelf)
                                }
                              }}
                              title={
                                savedShelf
                                  ? `Elimină de pe raft (${getShelfLabel(targetShelf)})`
                                  : `Salvează pe raft: ${getShelfLabel(targetShelf)}`
                              }
                            >
                              {savedShelf ? <Check size={16} /> : <Bookmark size={16} />}
                              <span>
                                {isSavingShelf
                                  ? (savedShelf ? 'Se elimină...' : 'Se salvează...')
                                  : (savedShelf
                                    ? `Salvat: ${getShelfLabel(targetShelf)}`
                                    : `Salvează: ${getShelfLabel(targetShelf)}`)}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`book-shelf-chevron-toggle-btn ${shelfDropdownOpen ? 'open' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setShelfDropdownOpen((prev) => !prev)
                              }}
                              aria-label="Alege raftul"
                              title="Alege raftul"
                            >
                              <ChevronDown size={16} className={`chevron-icon ${shelfDropdownOpen ? 'open' : ''}`} />
                            </button>
                          </div>

                          {shelfDropdownOpen && (
                            <div className="book-shelf-options-menu" onClick={(e) => e.stopPropagation()}>
                              {SHELF_OPTIONS.map((shelf) => (
                                <button
                                  key={shelf.id}
                                  type="button"
                                  className={`book-shelf-option-item ${targetShelf === shelf.id && savedShelf ? 'active' : ''}`}
                                  onClick={() => {
                                    setShelfDropdownOpen(false)
                                    if (savedShelf && targetShelf === shelf.id) {
                                      handleRemoveBookFromShelf()
                                    } else {
                                      setTargetShelf(shelf.id)
                                      handleSaveBookToShelf(shelf.id)
                                    }
                                  }}
                                >
                                  <span>{shelf.label}</span>
                                  {targetShelf === shelf.id && savedShelf && <Check size={14} />}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {isOwnCollectionModal ? (
                      <button
                        type="button"
                        className="book-collection-remove-btn"
                        disabled={isRemovingFromCollection}
                        onClick={handleRemoveBookFromActiveCollection}
                        title={`Elimină din colecția „${activeModalCollection.title}”`}
                      >
                        <Trash2 size={14} />
                        <span>
                          {isRemovingFromCollection ? 'Se elimină...' : 'Elimină din colecție'}
                        </span>
                      </button>
                    ) : null}
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
                    <div className="book-detail-qr-box">
                      {bookQrCodeDataUrl ? (
                        <img src={bookQrCodeDataUrl} alt={`QR code for ${selectedBook.title}`} className="book-detail-qr-image" />
                      ) : null}
                      <button
                        type="button"
                        className="book-detail-share-button"
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

                <div className="book-detail-body">
                  <h2>{selectedBook.title}</h2>
                  <p className="book-detail-author">{selectedBook.author}</p>

                  {selectedBook.description ? (
                    <p className="book-detail-description-text">{selectedBook.description}</p>
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
            <div className="profile-modal-backdrop" onClick={() => setShowProfileModal(false)}>
              <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
                <div className="profile-modal-header">
                  {supabaseUser ? (
                    <div className="profile-modal-user-header">
                      <div className="profile-user-badge profile-modal-label">
                        <span className="profile-user-email">{supabaseUser.email}</span>
                      </div>

                      <button
                        type="button"
                        className="profile-modal-logout-btn"
                        onClick={handleSignOut}
                        title="Deconectare din cont"
                      >
                        <LogOut size={14} />
                        Deconectare
                      </button>
                    </div>
                  ) : (
                    <div className="profile-modal-header-spacer" />
                  )}
                  <button
                    type="button"
                    className="toolbar-clear-button"
                    onClick={() => setShowProfileModal(false)}
                    aria-label="Close profile URL popup"
                  >
                    ×
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
                            required
                            aria-required="true"
                            pattern=".*\S.*"
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
                        <label htmlFor="profile-csv-input" className="profile-modal-label">
                          Librărie Goodreads
                        </label>
                        <div className="profile-csv-row">
                          <label htmlFor="profile-csv-input" className="profile-file-upload">
                            <span className="profile-file-upload-text">
                              {csvFile ? csvFile.name : 'Încarcă fișier CSV...'}
                            </span>
                          </label>
                          <input
                            id="profile-csv-input"
                            type="file"
                            accept=".csv,text/csv"
                            onChange={handleCsvFileChange}
                            className="profile-file-input-hidden"
                          />
                          <button
                            type="submit"
                            className="profile-modal-submit"
                            disabled={isUploadingCsv || !displayNameInput.trim() || !csvFile}
                            title={
                              !csvFile
                                ? 'Selectează un fișier CSV'
                                : 'Actualizează librăria'
                            }
                          >
                            {isUploadingCsv ? (
                              <span className="profile-btn-loading">
                                <Loader2 size={15} className="spin-icon" />
                                <span>Se încarcă...</span>
                              </span>
                            ) : (
                              'Încarcă'
                            )}
                          </button>
                        </div>
                      </div>

                      {uploadError ? <p className="profile-modal-error">{uploadError}</p> : null}
                    </form>

                    {generatedProfileUrl ? (
                      <div className="profile-url-result">
                        <label className="profile-modal-label">
                          URL-ul tău pe 'Ce mai citim'
                        </label>
                        <div className="profile-url-row">
                          <div className="profile-url-field">
                            <a
                              href={generatedProfileUrl}
                              className="profile-url-text"
                              onClick={() => setShowProfileModal(false)}
                              title="Mergi la librăria ta"
                            >
                              {generatedProfileUrl}
                            </a>
                            <button
                              type="button"
                              className={`profile-url-copy-icon-btn ${copiedUrl ? 'copied' : ''}`}
                              onClick={handleCopyGeneratedUrl}
                              aria-label="Copiază linkul"
                              title={copiedUrl ? 'Copiat!' : 'Copiază linkul'}
                            >
                              {copiedUrl ? <Check size={16} /> : <Copy size={16} />}
                            </button>
                          </div>
                          <button
                            type="button"
                            className={`profile-url-share-btn ${sharedUrl ? 'shared' : ''}`}
                            onClick={handleShareGeneratedUrl}
                            title="Distribuie linkul către librăria ta"
                          >
                            {sharedUrl ? <Check size={15} /> : <Share2 size={15} />}
                            <span>{sharedUrl ? 'Distribuit!' : 'Distribuie'}</span>
                          </button>
                        </div>

                        {qrCodeDataUrl ? (
                          <div className="profile-qr-wrapper">
                            <img src={qrCodeDataUrl} alt="QR code for generated website URL" className="profile-qr-image" />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null
        }

        {error ? <div className="status-banner">{error}</div> : null}

        {isExploreMode || activeShelf === 'collections' ? (
          <section className="collections-section" aria-label={isExploreMode ? 'Explorează colecții publice' : 'Colecții'}>
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
            ) : (isExploreMode ? exploreCollections : filteredUserCollections).length === 0 ? (
              <div className="collections-empty-state">
                <Library size={32} className="collections-empty-icon" />
                <h2>
                  {isExploreMode
                    ? 'Nu există încă nicio colecție publică.'
                    : userCollections.length > 0 && activeCollectionFilter === 'private'
                      ? 'Nu există nicio colecție privată.'
                      : userCollections.length > 0 && activeCollectionFilter === 'public'
                        ? 'Nu există nicio colecție publică.'
                        : isOwnProfile
                          ? 'Nu ai creat încă nicio colecție.'
                          : 'Acest utilizator nu are încă nicio colecție.'}
                </h2>
                {!isExploreMode && isOwnProfile && !showNewCollectionInput ? (
                  <button
                    type="button"
                    className="collections-new-trigger-btn"
                    onClick={() => setShowNewCollectionInput(true)}
                  >
                    <Plus size={16} />
                    <span>Creează prima ta colecție</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="collections-rows-list">
                {
                  (isExploreMode ? exploreCollections : filteredUserCollections).map((collection) => {
                    const activeUser = cookieUserId || getUserIdFromCookie()
                    const isCollectionOwner = Boolean(
                      isUserLoggedIn && activeUser && String(collection.userId) === String(activeUser),
                    )
                    return (
                      <CollectionRow
                        key={collection.id}
                        collection={collection}
                        isOwner={isCollectionOwner}
                        showCreator={isExploreMode}
                        onSelectCreator={handleSelectExploreCreator}
                        onAddBookClick={handleOpenAddBookForCollection}
                        onDeleteCollection={handleDeleteCollection}
                        onBookClick={handleOpenCollectionBook}
                      />
                    )
                  })
                }
              </div>
            )}
          </section>
        ) : (
          <>
            {isLoading ? (
              <div className="book-controls book-controls-placeholder" aria-hidden="true" />
            ) : shelfBooks.length > 0 ? (
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
                  {visibleBooks.map((book, index) => {
                    const safeCoverUrl = book.imageUrl || ''

                    return (
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
                            <DeferredBookCover
                              src={safeCoverUrl}
                              alt={`${book.title} cover`}
                              priority={index < 6}
                            />
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

        {!isCheckingAuth && supabaseUser && (
          <button
            type="button"
            className="sticky-add-book-btn"
            onClick={() => {
              if (!isExploreMode && activeShelf === 'collections') {
                const activeUser = cookieUserId || getUserIdFromCookie()
                if (activeUser && String(currentUserId) !== String(activeUser)) {
                  setCurrentUserId(String(activeUser))
                  window.history.pushState({}, '', `/${activeUser}/collections`)
                  setBooksFetchTrigger((prev) => prev + 1)
                }
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
              !isExploreMode && activeShelf === 'collections'
                ? 'Creează o colecție nouă'
                : `Adaugă o carte în ${getShelfLabel(activeShelf)}`
            }
            title={
              !isExploreMode && activeShelf === 'collections'
                ? 'Creează o colecție nouă'
                : `Adaugă o carte în ${getShelfLabel(activeShelf)}`
            }
          >
            <Plus size={24} strokeWidth={2.4} />
          </button>
        )}

        {showNewCollectionInput && (
          <div
            className="search-modal-backdrop"
            onClick={() => {
              setShowNewCollectionInput(false)
              setNewCollectionTitle('')
              setNewCollectionDescription('')
              setNewCollectionIsPrivate(false)
            }}
          >
            <div
              className="search-modal"
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
                  className="search-modal-close"
                  onClick={() => {
                    setShowNewCollectionInput(false)
                    setNewCollectionTitle('')
                    setNewCollectionDescription('')
                    setNewCollectionIsPrivate(false)
                  }}
                  aria-label="Închide"
                >
                  <X size={18} />
                </button>
              </div>

              <form className="collections-new-form" onSubmit={handleCreateCollection}>
                <div className="collections-new-fields">
                  <label className="collections-modal-label">
                    <span>Titlu colecție</span>
                    <input
                      type="text"
                      className="search-input collections-modal-input"
                      placeholder="Ex: Top SF, Cărți de vacanță..."
                      value={newCollectionTitle}
                      onChange={(e) => setNewCollectionTitle(e.target.value)}
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
                      onChange={(e) => setNewCollectionDescription(e.target.value.slice(0, 140))}
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

        {isSearchModalOpen && !selectedBook && (
          <div
            className="search-modal-backdrop"
            onClick={() => {
              setIsSearchModalOpen(false)
              setTargetCollectionForSearch(null)
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
                  className="search-modal-close"
                  onClick={() => {
                    setIsSearchModalOpen(false)
                    setTargetCollectionForSearch(null)
                  }}
                  aria-label="Închide căutarea"
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
        )
        }
      </main >
    </div >
  )
}

export default App
