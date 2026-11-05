import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookCover } from 'book-cover-3d'
import { ArrowUpDown, Share2, SquareArrowOutUpRight, Upload, UserRoundPen, UserSearch, WandSparkles } from 'lucide-react'
import {
  buildBookShareUrl,
  buildGoodreadsApiUrl,
  extractGoodreadsUserId,
  getFinishedBooksTotals,
  getUserIdFromCookie,
  matchesShelf,
  normalizeCsvBook,
  parseGoodreadsCsv,
  setUserIdCookie,
} from './lib/goodreads'
import GradientASCII from './components/GradientASCII'
import GooeyNav from './components/GooeyNav'
import GlideSelect from './components/GlideSelect'
import './App.css'

const INITIAL_PULLED_IMAGES_COUNT = 10
const IMAGES_PULL_AHEAD = 10

const SHELF_OPTIONS = [
  { id: 'read', label: 'Citite', query: 'read' },
  { id: 'to-read', label: 'De citit', query: 'to-read' },
  { id: 'currently-reading', label: 'În curs', query: 'currently-reading' },
  { id: 'did-not-finish', label: 'Abandonate', query: 'did-not-finish' },
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
  if (shelfId === 'to-read' || shelfId === 'currently-reading' || shelfId === 'did-not-finish') {
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
  const [generateNewUser, setGenerateNewUser] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [csvFile, setCsvFile] = useState(null)
  const [isUploadingCsv, setIsUploadingCsv] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [generatedProfileUrl, setGeneratedProfileUrl] = useState('')
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [bookQrCodeDataUrl, setBookQrCodeDataUrl] = useState('')
  const [requestedBookId, setRequestedBookId] = useState(() => initialRouteState.bookId || '')
  const [selectedBook, setSelectedBook] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const availableBookSortOptions = useMemo(() => getBookSortOptions(activeShelf), [activeShelf])
  const [error, setError] = useState('')
  const [pulledImagesCount, setPulledImagesCount] = useState(INITIAL_PULLED_IMAGES_COUNT)
  const carouselRef = useRef(null)
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0 })
  const rafIdRef = useRef(null)
  const pointerDragRef = useRef({ startX: 0, startY: 0, hasMoved: false })
  const lastScrollTimeRef = useRef(0)
  const syncedCoversRef = useRef(new Set())
  const nameInputRef = useRef(null)

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      const initialId = getUserIdFromCookie() || DEFAULT_USER_ID
      window.history.replaceState({}, '', `/${initialId}`)
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
          setDisplayNameInput((prev) => prev || apiUsername)
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
  }, [currentUserId])

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
      const cleanIsbn = String(b.isbn || '').replace(/[^0-9X]/gi, '').trim()
      return (
        cleanIsbn.length >= 8 &&
        b.imageUrl &&
        b.imageUrl.includes('openlibrary.org') &&
        !syncedCoversRef.current.has(cleanIsbn)
      )
    })

    if (!booksToSync.length) return

    let isCancelled = false

    const syncCovers = async () => {
      for (const book of booksToSync) {
        if (isCancelled) break
        const cleanIsbn = String(book.isbn || '').replace(/[^0-9X]/gi, '').trim()
        syncedCoversRef.current.add(cleanIsbn)

        const candidateUrls = [
          cleanIsbn ? `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-L.jpg` : null,
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

        if (!loadedBlob) continue

        // Immediately display the loaded cover on the book
        const localCoverUrl = URL.createObjectURL(loadedBlob)
        if (!isCancelled) {
          setBooks((prev) =>
            prev.map((b) => (b.isbn === book.isbn ? { ...b, imageUrl: localCoverUrl } : b)),
          )
          setSelectedBook((prev) =>
            prev && prev.isbn === book.isbn ? { ...prev, imageUrl: localCoverUrl } : prev,
          )
        }

        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(loadedBlob)
          })

          const uploadRes = await fetch(`/api/cover?isbn=${encodeURIComponent(cleanIsbn)}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              isbn: cleanIsbn,
              dataUrl,
            }),
          })

          if (uploadRes.ok) {
            const data = await uploadRes.json()
            if (data?.url && !isCancelled) {
              setBooks((prev) =>
                prev.map((b) => (b.isbn === book.isbn ? { ...b, imageUrl: data.url } : b)),
              )
              setSelectedBook((prev) =>
                prev && prev.isbn === book.isbn ? { ...prev, imageUrl: data.url } : prev,
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
    setError('')
  }

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
      const existingCookieUserId = generateNewUser ? undefined : (getUserIdFromCookie() || cookieUserId)
      const isExistingUser = Boolean(existingCookieUserId && !generateNewUser)

      const response = await fetch('/api/uploadcsv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: trimmedName,
          csv: csvText,
          userId: existingCookieUserId || undefined,
          isNewUser: generateNewUser,
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

      setGenerateNewUser(false)

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
    const activeCookieId = getUserIdFromCookie() || cookieUserId
    setGenerateNewUser(false)
    if (activeCookieId) {
      if (!cookieUserId) {
        setCookieUserId(activeCookieId)
      }
      const prefillName = displayNameInput || username || ''
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
    }
    setUploadError('')
    setShowProfileModal(true)
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
      pointerDragRef.current.hasMoved = true
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
                    <img
                      src={
                        selectedBook.imageUrl && !selectedBook.imageUrl.includes('goodreads.com') && !selectedBook.imageUrl.includes('ssl-images-amazon.com')
                          ? selectedBook.imageUrl
                          : selectedBook.isbn
                            ? `https://covers.openlibrary.org/b/isbn/${String(selectedBook.isbn).replace(/[^0-9X]/gi, '').trim()}-L.jpg`
                            : ''
                      }
                      alt={`${selectedBook.title} cover`}
                    />
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

              <form className="profile-modal-form" onSubmit={handleUploadCsvSubmit}>
                <div className="profile-modal-field">
                  <label htmlFor="profile-display-name-input" className="profile-modal-label">
                    Numele afișat *
                  </label>
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
                    placeholder="ex: Alin"
                    className="profile-modal-input"
                  />
                </div>

                <div className="profile-modal-field">
                  <label htmlFor="profile-csv-input" className="profile-modal-label">
                    Fișier CSV Goodreads
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

                {cookieUserId ? (
                  <div className="profile-modal-checkbox-row">
                    <label className="profile-modal-checkbox-label">
                      <input
                        type="checkbox"
                        checked={generateNewUser}
                        onChange={(event) => {
                          const isChecked = event.target.checked
                          setGenerateNewUser(isChecked)
                          if (isChecked) {
                            setDisplayNameInput('')
                            setTimeout(() => nameInputRef.current?.focus(), 50)
                          } else {
                            setDisplayNameInput(username || '')
                          }
                          setUploadError('')
                        }}
                        className="profile-modal-checkbox"
                      />
                      <span>Generează utilizator / URL nou</span>
                    </label>
                  </div>
                ) : null}

                {uploadError ? <p className="profile-modal-error">{uploadError}</p> : null}

                <button
                  type="submit"
                  className="profile-modal-submit"
                  disabled={isUploadingCsv || !displayNameInput.trim() || !csvFile}
                >
                  {isUploadingCsv
                    ? 'Se încarcă...'
                    : (cookieUserId && !generateNewUser ? 'Actualizează librăria' : 'Generează URL')}
                </button>
              </form>

              {!generateNewUser && generatedProfileUrl ? (
                <div className="profile-url-result">
                  <label className="profile-modal-label">
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
                      {copiedUrl ? 'Copiat!' : 'Copiaza'}
                    </button>
                    <button type="button" className="profile-url-go" onClick={handleGoToGeneratedUrl}>
                      Mergi la profilul tau
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
              {visibleBooks.map((book, index) => {
                const isCoverPulled =
                  index < pulledImagesCount ||
                  (!book.imageUrl?.includes('openlibrary.org') &&
                    !book.imageUrl?.includes('goodreads.com') &&
                    !book.imageUrl?.includes('ssl-images-amazon.com'))

                const safeCoverUrl =
                  book.imageUrl && !book.imageUrl.includes('goodreads.com') && !book.imageUrl.includes('ssl-images-amazon.com')
                    ? book.imageUrl
                    : book.isbn
                      ? `https://covers.openlibrary.org/b/isbn/${String(book.isbn).replace(/[^0-9X]/gi, '').trim()}-L.jpg`
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

        {cookieUserId ? (
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
            Generează URL-ul tău
          </button>
        )}
      </main>
    </div>
  )
}

export default App
