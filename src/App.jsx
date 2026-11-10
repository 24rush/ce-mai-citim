import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookCover } from 'book-cover-3d'
import { ArrowUpDown, Bookmark, Check, ChevronDown, Copy, LogOut, Save, Upload, UserRoundPen, UserSearch, WandSparkles, X } from 'lucide-react'
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
import GradientASCII from './components/GradientASCII'
import GooeyNav from './components/GooeyNav'
import GlideSelect from './components/GlideSelect'
import AuthModalView from './components/AuthModalView'
import { createClient, isSupabaseConfigured } from './lib/client'
import './App.css'

const INITIAL_PULLED_IMAGES_COUNT = 10
const IMAGES_PULL_AHEAD = 10

const SHELF_OPTIONS = [
  { id: 'read', label: 'Citite', query: 'read' },
  { id: 'to-read', label: 'De citit', query: 'to-read' },
  { id: 'currently-reading', label: 'În curs', query: 'currently-reading' },
  { id: 'did-not-finish', label: 'Abandonate', query: 'did-not-finish' },
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

const DEFAULT_USER_ID = '18354013'

function App() {
  const initialRouteState = useMemo(() => getRouteStateFromPath(window.location.pathname), [])
  const [books, setBooks] = useState([])
  const [username, setUsername] = useState('')
  const [activeShelf, setActiveShelf] = useState(() => initialRouteState.shelf || 'read')
  const [activeAuthorFilter, setActiveAuthorFilter] = useState('all')
  const [activeBookSort, setActiveBookSort] = useState('recently-read')
  const [currentUserId, setCurrentUserId] = useState(
    () => initialRouteState.userId || getUserIdFromCookie() || DEFAULT_USER_ID,
  )
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
  const [bookQrCodeDataUrl, setBookQrCodeDataUrl] = useState('')
  const [requestedBookId, setRequestedBookId] = useState(() => initialRouteState.bookId || '')
  const [selectedBook, setSelectedBook] = useState(null)
  const [targetShelf, setTargetShelf] = useState('to-read')
  const [shelfDropdownOpen, setShelfDropdownOpen] = useState(false)
  const [isSavingShelf, setIsSavingShelf] = useState(false)
  const [savedShelf, setSavedShelf] = useState(false)
  const shelfDropdownRef = useRef(null)
  const [userShelvesByBookId, setUserShelvesByBookId] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [booksFetchTrigger, setBooksFetchTrigger] = useState(0)
  const availableBookSortOptions = useMemo(() => getBookSortOptions(activeShelf), [activeShelf])
  const [error, setError] = useState('')
  const [pulledImagesCount, setPulledImagesCount] = useState(INITIAL_PULLED_IMAGES_COUNT)
  const carouselRef = useRef(null)
  const dragState = useRef({ isDown: false, active: false, startX: 0, startY: 0, scrollLeft: 0 })
  const rafIdRef = useRef(null)
  const pointerDragRef = useRef({ startX: 0, startY: 0, hasMoved: false })
  const lastScrollTimeRef = useRef(0)
  const syncedCoversRef = useRef(new Set())
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

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
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

      // Only redirect when going from root url not when on another profile page
      const shouldRedirect = isInitialRootUrlRef.current && !isVisitingOtherProfile

      if (shouldRedirect && nextUserId) {
        isInitialRootUrlRef.current = false
        setCurrentUserId(String(nextUserId))
        setRequestedBookId('')
        setSelectedBook(null)
        window.history.replaceState({}, '', `/${nextUserId}`)
        setBooksFetchTrigger((prev) => prev + 1)
        if (finalName) {
          setUsername(finalName)
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
          if (user) {
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
        if (user) {
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
      setSupabaseUser(null)
      setGeneratedProfileUrl('')
      setQrCodeDataUrl('')
    } catch (err) {
      console.error('Sign out error:', err)
    }
  }

  useEffect(() => {
    if (isRootPath(window.location.pathname)) {
      const initialId = getUserIdFromCookie() || DEFAULT_USER_ID
      window.history.replaceState({}, '', `/${initialId}`)
    }
  }, [])

  useEffect(() => {
    const syncRouteState = () => {
      const { userId, shelf, bookId } = getRouteStateFromPath(window.location.pathname)

      if (isRootPath(window.location.pathname)) {
        const fallbackId = cookieUserId || getUserIdFromCookie() || DEFAULT_USER_ID
        window.history.replaceState({}, '', `/${fallbackId}`)
        setCurrentUserId(fallbackId)
      } else if (userId) {
        setCurrentUserId(userId)
      } else {
        setCurrentUserId(DEFAULT_USER_ID)
      }

      setActiveShelf(shelf)
      setRequestedBookId(bookId)
    }

    window.addEventListener('popstate', syncRouteState)
    return () => window.removeEventListener('popstate', syncRouteState)
  }, [cookieUserId])

  useEffect(() => {
    const controller = new AbortController()
    const resolvedUserId = currentUserId || DEFAULT_USER_ID
    const apiUrl = buildGoodreadsApiUrl(resolvedUserId)

    const loadBooks = async () => {
      try {
        setIsLoading(true)
        setError('')
        const { books: apiBooks, username: apiUsername } = await fetchBooksFromApi(apiUrl, controller.signal)
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
    return userShelvesByBookId[bookId] || null
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
      setTargetShelf('to-read')
      setSavedShelf(false)
    }
  }, [selectedBook, loggedInUserBook])

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
  }, [activeShelf, visibleBooks.length])

  useEffect(() => {
    setPulledImagesCount(INITIAL_PULLED_IMAGES_COUNT)
  }, [activeShelf, activeAuthorFilter, activeBookSort])

  useEffect(() => {
    if (!visibleBooks.length) return

    const candidateBooks = visibleBooks.slice(0, pulledImagesCount)

    const booksToSync = candidateBooks.filter((b) => {
      const cleanIsbn13 = String(b.isbn13 || (b.isbn?.length === 13 ? b.isbn : '') || '').replace(/[^0-9X]/gi, '').trim()
      const cleanIsbn10 = String(b.isbn10 || (b.isbn?.length === 10 ? b.isbn : '') || '').replace(/[^0-9X]/gi, '').trim()
      const syncKey = cleanIsbn13 || cleanIsbn10 || String(b.isbn || '').replace(/[^0-9X]/gi, '').trim()
      return (
        syncKey.length >= 8 &&
        b.imageUrl &&
        b.imageUrl.includes('openlibrary.org') &&
        !syncedCoversRef.current.has(syncKey)
      )
    })

    if (!booksToSync.length) return

    let isCancelled = false

    const syncCovers = async () => {
      for (const book of booksToSync) {
        if (isCancelled) break
        const cleanIsbn13 = String(book.isbn13 || (book.isbn?.length === 13 ? book.isbn : '') || '').replace(/[^0-9X]/gi, '').trim()
        const cleanIsbn10 = String(book.isbn10 || (book.isbn?.length === 10 ? book.isbn : '') || '').replace(/[^0-9X]/gi, '').trim()
        const primaryIsbn = cleanIsbn13 || cleanIsbn10 || String(book.isbn || '').replace(/[^0-9X]/gi, '').trim()

        if (primaryIsbn) syncedCoversRef.current.add(primaryIsbn)
        if (cleanIsbn13) syncedCoversRef.current.add(cleanIsbn13)
        if (cleanIsbn10) syncedCoversRef.current.add(cleanIsbn10)

        // Try OpenLibrary with ISBN-13 first, then ISBN-10, then existing image URL
        const candidateUrls = [
          cleanIsbn13 ? `https://covers.openlibrary.org/b/isbn/${cleanIsbn13}-L.jpg` : null,
          cleanIsbn10 && cleanIsbn10 !== cleanIsbn13 ? `https://covers.openlibrary.org/b/isbn/${cleanIsbn10}-L.jpg` : null,
          book.imageUrl && !book.imageUrl.includes('goodreads.com') && !book.imageUrl.includes('ssl-images-amazon.com')
            ? book.imageUrl
            : null,
        ].filter(Boolean)

        let loadedBlob = null

        for (const testUrl of candidateUrls) {
          try {
            const imgRes = await fetch(testUrl)
            if (!imgRes.ok) continue

            const blob = await imgRes.blob()
            // OpenLibrary returns 1x1 gif (< 1000 bytes) if image is missing
            if (blob.size < 1000 && blob.type.includes('gif')) continue
            if (blob.size === 0 || blob.type.includes('html')) continue

            loadedBlob = blob
            break
          } catch {
            // Try next candidate url
          }
        }

        // Fallback: If OpenLibrary didn't have the cover (for either ISBN13 or ISBN10), query Google Books API via /api/isbn
        if (!loadedBlob && (book.title || primaryIsbn)) {
          try {
            const searchParams = new URLSearchParams()
            if (book.title) searchParams.set('title', book.title)
            if (book.author) searchParams.set('author', book.author)
            if (primaryIsbn) searchParams.set('isbn', primaryIsbn)
            const googleRes = await fetch(`/api/isbn?${searchParams.toString()}`)
            if (googleRes.ok) {
              const googleData = await googleRes.json()
              if (googleData?.coverUrl) {
                const imgRes = await fetch(googleData.coverUrl)
                if (imgRes.ok) {
                  const blob = await imgRes.blob()
                  if (blob.size >= 1000 && !blob.type.includes('html')) {
                    loadedBlob = blob
                  }
                }
              }
            }
          } catch (googleErr) {
            console.warn('Google Books fallback failed for:', book.title, googleErr)
          }
        }

        if (!loadedBlob) continue

        // Immediately display the loaded cover on the book
        const localCoverUrl = URL.createObjectURL(loadedBlob)
        if (!isCancelled) {
          setBooks((prev) =>
            prev.map((b) => (b.id === book.id || b.isbn === book.isbn ? { ...b, imageUrl: localCoverUrl } : b)),
          )
          setSelectedBook((prev) =>
            prev && (prev.id === book.id || prev.isbn === book.isbn) ? { ...prev, imageUrl: localCoverUrl } : prev,
          )
        }

        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(loadedBlob)
          })

          const uploadRes = await fetch(`/api/cover?isbn=${encodeURIComponent(primaryIsbn)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              isbn: primaryIsbn,
              dataUrl,
            }),
          })

          if (uploadRes.ok) {
            const data = await uploadRes.json()
            if (data?.url && !isCancelled) {
              setBooks((prev) =>
                prev.map((b) => (b.id === book.id || b.isbn === book.isbn ? { ...b, imageUrl: data.url } : b)),
              )
              setSelectedBook((prev) =>
                prev && (prev.id === book.id || prev.isbn === book.isbn) ? { ...prev, imageUrl: data.url } : prev,
              )
              URL.revokeObjectURL(localCoverUrl)
            }
          } else {
            const errorText = await uploadRes.text()
            console.warn('Cover upload failed:', errorText)
          }
        } catch (err) {
          console.warn('Failed to persist cover to server:', book.title, err)
        }

        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }

    syncCovers()

    return () => {
      isCancelled = true
    }
  }, [visibleBooks, pulledImagesCount])

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
    setShelfDropdownOpen(false)
    setSavedShelf(false)
    setError('')
  }

  const handleHeaderClick = () => {
    const loggedInId = cookieUserId || getUserIdFromCookie() || DEFAULT_USER_ID
    if (!loggedInId) return

    if (
      currentUserId === loggedInId &&
      !selectedBook &&
      activeShelf === 'read' &&
      activeAuthorFilter === 'all'
    ) {
      return
    }

    const nextPath = `/${loggedInId}`
    window.history.pushState({}, '', nextPath)
    setCurrentUserId(String(loggedInId))
    setRequestedBookId('')
    setSelectedBook(null)
    setActiveShelf('read')
    setActiveAuthorFilter('all')
    setBooksFetchTrigger((prev) => prev + 1)
  }

  const handleSaveBookToShelf = async (shelfToSave = targetShelf) => {
    if (!selectedBook) return
    const activeUser = cookieUserId || getUserIdFromCookie()
    if (!isUserLoggedIn || !activeUser) {
      closeBookDetails()
      setShowProfileModal(true)
      return
    }

    const bookId = String(selectedBook.bookId || selectedBook.id || '')
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

    const bookId = String(selectedBook.bookId || selectedBook.id || '')
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
        return next
      })
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
    if (!books.length || !selectedBook) return
    const curIdx = books.findIndex(
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

      if (!cookieUserId || cookieUserId !== currentUserId) {
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
    if (nextIndex >= books.length || nextIndex < 0) {
      closeBookDetails()
      return
    }

    const nextBook = books[nextIndex]
    if (!nextBook) {
      closeBookDetails()
      return
    }

    const nextBookId = String(nextBook.bookId || nextBook.id)
    const nextShelf = nextBook.bookshelves || activeShelf
    window.history.replaceState({}, '', `/${currentUserId}/${nextShelf}/${encodeURIComponent(nextBookId)}`)
    setRequestedBookId(nextBookId)
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
    if (!selectedBook) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeBookDetails()
        return
      }

      if (!isOtherUserProfile) return

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
  }, [selectedBook, isOtherUserProfile, books, modalSwipeExit, cookieUserId, currentUserId, supabaseUser])

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

    const updatePulledCount = () => {
      if (!carouselRef.current) return
      const carouselEl = carouselRef.current
      const carouselRect = carouselEl.getBoundingClientRect()
      const cards = carouselEl.querySelectorAll('.book-card')
      let lastVisibleIndex = 0

      for (let i = 0; i < cards.length; i += 1) {
        const rect = cards[i].getBoundingClientRect()
        if (rect.left < carouselRect.right) {
          lastVisibleIndex = i
        } else {
          break
        }
      }

      const neededCount = Math.max(INITIAL_PULLED_IMAGES_COUNT, lastVisibleIndex + 1 + IMAGES_PULL_AHEAD)
      setPulledImagesCount((prev) => (neededCount > prev ? neededCount : prev))
    }

    updatePulledCount()

    const handleScroll = () => {
      lastScrollTimeRef.current = Date.now()
      if (dragState.current.active) {
        pointerDragRef.current.hasMoved = true
      }
      syncBookCoverFocus()
      updatePulledCount()
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
            <div
              ref={isOtherUserProfile ? modalCardRef : undefined}
              className={`book-detail-modal ${
                isOtherUserProfile
                  ? `swipable ${modalPointerRef.current?.isDragging ? 'is-dragging' : ''} ${
                      modalSwipeExit ? `modal-fly-out-${modalSwipeExit}` : ''
                    }`
                  : ''
              }`}
              style={
                isOtherUserProfile
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
              onPointerDown={isOtherUserProfile ? handleModalPointerDown : undefined}
              onPointerMove={isOtherUserProfile ? handleModalPointerMove : undefined}
              onPointerUp={isOtherUserProfile ? handleModalPointerUp : undefined}
              onPointerCancel={isOtherUserProfile ? handleModalPointerUp : undefined}
              onClick={(event) => event.stopPropagation()}
            >
              {/* Swipe Left & Right Overlay Stamps (Other user's books only) */}
              {isOtherUserProfile && (
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
                <div className="profile-modal-header-spacer" />
                <button
                  type="button"
                  className="book-detail-share-button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    shareBookLink(selectedBook)
                  }}
                  aria-label={`Share link for ${selectedBook.title}`}
                >
                  Share
                </button>
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
                <div className="book-detail-cover-col">
                  <div className="book-detail-cover">
                    <img
                      src={
                        selectedBook.imageUrl && !selectedBook.imageUrl.includes('goodreads.com') && !selectedBook.imageUrl.includes('ssl-images-amazon.com')
                          ? selectedBook.imageUrl
                          : (selectedBook.isbn13 || selectedBook.isbn)
                            ? `https://covers.openlibrary.org/b/isbn/${String(selectedBook.isbn13 || selectedBook.isbn).replace(/[^0-9X]/gi, '').trim()}-L.jpg`
                            : ''
                      }
                      alt={`${selectedBook.title} cover`}
                    />
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
                    ) : (!cookieUserId || cookieUserId !== currentUserId) ? (
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
                    ) : null}
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
                      <label htmlFor="profile-csv-input" className="profile-file-upload">
                        <Upload size={16} strokeWidth={2} aria-hidden="true" />
                        <span className="profile-file-upload-text">
                          {csvFile ? csvFile.name : 'Încarcă fișierul CSV exportat...'}
                        </span>
                      </label>
                      <input
                        id="profile-csv-input"
                        type="file"
                        accept=".csv,text/csv"
                        onChange={handleCsvFileChange}
                        className="profile-file-input-hidden"
                      />
                    </div>

                    {uploadError ? <p className="profile-modal-error">{uploadError}</p> : null}

                    <button
                      type="submit"
                      className="profile-modal-submit"
                      disabled={isUploadingCsv || !displayNameInput.trim() || !csvFile}
                    >
                      {isUploadingCsv
                        ? 'Se încarcă...'
                        : (cookieUserId ? 'Actualizează librăria' : 'Generează URL')}
                    </button>
                  </form>

                  {generatedProfileUrl ? (
                    <div className="profile-url-result">
                      <label className="profile-modal-label">
                        URL-ul tău pe 'Ce mai citim'
                      </label>
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
              {visibleBooks.map((book, index) => {
                const isCoverPulled =
                  index < pulledImagesCount ||
                  (!book.imageUrl?.includes('openlibrary.org') &&
                    !book.imageUrl?.includes('goodreads.com') &&
                    !book.imageUrl?.includes('ssl-images-amazon.com'))

                const cleanIsbn13 = String(book.isbn13 || (book.isbn?.length === 13 ? book.isbn : '') || '').replace(/[^0-9X]/gi, '').trim()
                const cleanIsbn10 = String(book.isbn10 || (book.isbn?.length === 10 ? book.isbn : '') || '').replace(/[^0-9X]/gi, '').trim()
                const effectiveIsbn = cleanIsbn13 || cleanIsbn10 || String(book.isbn || '').replace(/[^0-9X]/gi, '').trim()

                const safeCoverUrl =
                  book.imageUrl && !book.imageUrl.includes('goodreads.com') && !book.imageUrl.includes('ssl-images-amazon.com')
                    ? book.imageUrl
                    : effectiveIsbn
                      ? `https://covers.openlibrary.org/b/isbn/${effectiveIsbn}-L.jpg`
                      : ''

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
                        <div className="book-cover-art">
                          {isCoverPulled && safeCoverUrl ? (
                            <img src={safeCoverUrl} alt={`${book.title} cover`} loading="lazy" />
                          ) : (
                            <div className="book-cover-placeholder" aria-hidden="true" />
                          )}
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
      </main>
    </div >
  )
}

export default App
