import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Globe,
  Library,
  Loader2,
  Lock,
  Plus,
  Save,
  Search,
  Shield,
  Star,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react'
import { createClient } from '../lib/client'
import './AdminPage.css'

const SHELF_CHOICES = [
  { id: 'read', label: 'Citite' },
  { id: 'to-read', label: 'De citit' },
  { id: 'currently-reading', label: 'În curs' },
  { id: 'did-not-finish', label: 'DNF' },
]

export default function AdminPage({ adminEmail, getAccessToken, onBackToApp }) {
  const [users, setUsers] = useState([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [userFilter, setUserFilter] = useState('')

  // New user form
  const [newName, setNewName] = useState('')
  const [newBio, setNewBio] = useState('')
  const [isCreatingUser, setIsCreatingUser] = useState(false)

  // Selected user details
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [editName, setEditName] = useState('')
  const [editBio, setEditBio] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(false)
  const [userBooks, setUserBooks] = useState([])
  const [userCollections, setUserCollections] = useState([])

  // Active workspace tab: 'shelves' | 'collections' | 'csv'
  const [activeTab, setActiveTab] = useState('shelves')
  const [shelfFilter, setShelfFilter] = useState('all')

  // Book search for shelves
  const [bookQuery, setBookQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearchingBooks, setIsSearchingBooks] = useState(false)
  const [busyBookActionId, setBusyBookActionId] = useState('')

  // Collections management
  const [colTitle, setColTitle] = useState('')
  const [colDesc, setColDesc] = useState('')
  const [colPrivate, setColPrivate] = useState(false)
  const [isCreatingCol, setIsCreatingCol] = useState(false)
  const [expandedColId, setExpandedColId] = useState('')
  const [colBookQuery, setColBookQuery] = useState('')
  const [colSearchResults, setColSearchResults] = useState([])
  const [isSearchingColBooks, setIsSearchingColBooks] = useState(false)

  // CSV upload
  const [csvFile, setCsvFile] = useState(null)
  const [replaceExistingCsv, setReplaceExistingCsv] = useState(false)
  const [isImportingCsv, setIsImportingCsv] = useState(false)

  // Feedback banner
  const [toast, setToast] = useState(null)

  const showToast = useCallback((type, message) => {
    setToast({ type, message })
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const adminFetch = useCallback(
    async (path, options = {}) => {
      let token = typeof getAccessToken === 'function' ? getAccessToken() : ''
      if (!token) {
        const supabase = createClient()
        const { data: sessionData } = await supabase.auth.getSession()
        token = sessionData?.session?.access_token || ''
      }
      const headers = {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      }
      const res = await fetch(path, { ...options, headers })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`)
      }
      return json
    },
    [getAccessToken],
  )

  const loadUsers = useCallback(
    async (keepSelection = true) => {
      setIsLoadingUsers(true)
      try {
        const data = await adminFetch('/api/admin')
        const loaded = Array.isArray(data?.users) ? data.users : []
        setUsers(loaded)
        if (loaded.length > 0) {
          setSelectedUserId((prev) => {
            if (keepSelection && prev && loaded.some((u) => u.userId === prev)) {
              return prev
            }
            return loaded[0].userId
          })
        } else {
          setSelectedUserId('')
        }
      } catch (err) {
        showToast('error', err.message || 'Nu s-au putut încărca utilizatorii.')
      } finally {
        setIsLoadingUsers(false)
      }
    },
    [adminFetch, showToast],
  )

  const loadSelectedUserDetails = useCallback(
    async (targetId) => {
      if (!targetId) {
        setUserBooks([])
        setUserCollections([])
        return
      }
      setIsLoadingDetails(true)
      setConfirmDeleteUser(false)
      try {
        const data = await adminFetch(`/api/admin?userId=${encodeURIComponent(targetId)}`)
        setEditName(data?.user?.displayName || '')
        setEditBio(data?.user?.description || '')
        setUserBooks(Array.isArray(data?.books) ? data.books : [])
        const cols = Array.isArray(data?.collections) ? data.collections : []
        setUserCollections(cols)
        setExpandedColId((prev) => (cols.some((c) => String(c.id) === String(prev)) ? prev : cols[0]?.id || ''))
      } catch (err) {
        showToast('error', err.message || 'Nu s-au putut încărca detaliile utilizatorului.')
      } finally {
        setIsLoadingDetails(false)
      }
    },
    [adminFetch, showToast],
  )

  useEffect(() => {
    loadUsers(false)
  }, [loadUsers])

  useEffect(() => {
    if (selectedUserId) {
      loadSelectedUserDetails(selectedUserId)
    }
  }, [selectedUserId, loadSelectedUserDetails])

  // Debounced search for shelves tab
  useEffect(() => {
    const clean = bookQuery.trim()
    if (clean.length < 2) {
      setSearchResults([])
      setIsSearchingBooks(false)
      return undefined
    }

    let cancelled = false
    setIsSearchingBooks(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(clean)}&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled) {
            setSearchResults(Array.isArray(data?.books) ? data.books : [])
          }
        })
        .catch(() => {
          if (!cancelled) setSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setIsSearchingBooks(false)
        })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [bookQuery])

  // Debounced search for collections tab
  useEffect(() => {
    const clean = colBookQuery.trim()
    if (clean.length < 2) {
      setColSearchResults([])
      setIsSearchingColBooks(false)
      return undefined
    }

    let cancelled = false
    setIsSearchingColBooks(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(clean)}&limit=6`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled) {
            setColSearchResults(Array.isArray(data?.books) ? data.books : [])
          }
        })
        .catch(() => {
          if (!cancelled) setColSearchResults([])
        })
        .finally(() => {
          if (!cancelled) setIsSearchingColBooks(false)
        })
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [colBookQuery])

  const filteredUsers = useMemo(() => {
    const q = userFilter.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.userId.toLowerCase().includes(q) ||
        (u.description || '').toLowerCase().includes(q),
    )
  }, [users, userFilter])

  const booksByIdMap = useMemo(() => {
    const map = new Map()
    for (const b of userBooks) {
      map.set(String(b.bookId), b)
    }
    return map
  }, [userBooks])

  const filteredShelfBooks = useMemo(() => {
    if (shelfFilter === 'all') return userBooks
    return userBooks.filter((b) => b.shelf === shelfFilter)
  }, [userBooks, shelfFilter])

  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (!newName.trim() || isCreatingUser) return
    setIsCreatingUser(true)
    try {
      const data = await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_user',
          displayName: newName.trim(),
          description: newBio.trim(),
        }),
      })
      if (data?.user) {
        setUsers((prev) => [data.user, ...prev])
        setSelectedUserId(data.user.userId)
        setNewName('')
        setNewBio('')
        showToast('success', `Utilizatorul "${data.user.displayName}" a fost creat.`)
      }
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setIsCreatingUser(false)
    }
  }

  const handleSaveUserProfile = async (e) => {
    e.preventDefault()
    if (!selectedUserId || !editName.trim() || isSavingProfile) return
    setIsSavingProfile(true)
    try {
      const data = await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_user',
          userId: selectedUserId,
          displayName: editName.trim(),
          description: editBio.trim(),
        }),
      })
      if (data?.user) {
        setUsers((prev) =>
          prev.map((u) =>
            u.userId === selectedUserId
              ? { ...u, displayName: data.user.displayName, description: data.user.description }
              : u,
          ),
        )
        showToast('success', 'Profilul a fost actualizat.')
      }
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!selectedUserId) return
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete_user',
          userId: selectedUserId,
        }),
      })
      showToast('success', 'Utilizatorul și toate datele asociate au fost șterse.')
      setConfirmDeleteUser(false)
      await loadUsers(false)
    } catch (err) {
      showToast('error', err.message)
    }
  }

  const handleSaveBookToShelf = async (book, shelf, rating = undefined) => {
    if (!selectedUserId || !book) return
    const bookId = String(book.bookId || book.id || '')
    if (!bookId) return
    setBusyBookActionId(`${bookId}:${shelf}`)
    try {
      const payload = {
        action: 'save_book',
        userId: selectedUserId,
        bookId,
        shelf,
        ...(rating !== undefined ? { rating } : {}),
        book: {
          bookId,
          title: book.title,
          author: book.author,
          isbn: book.isbn,
          pages: book.pages || book.pageCount,
          publishedYear: book.publishedYear,
          description: book.description,
          mainCategory: book.mainCategory,
          coverUrl: book.coverUrl || book.imageUrl,
        },
      }
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      await Promise.all([loadSelectedUserDetails(selectedUserId), loadUsers(true)])
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setBusyBookActionId('')
    }
  }

  const handleRateBook = async (book, rating) => {
    if (!selectedUserId || !book) return
    const bookId = String(book.bookId || book.id || '')
    if (!bookId) return
    const nextRating = Number(book.myRating) === rating ? 0 : rating
    setBusyBookActionId(`${bookId}:rate`)
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'rate_book',
          userId: selectedUserId,
          bookId,
          rating: nextRating,
          shelf: book.shelf || 'read',
          book,
        }),
      })
      setUserBooks((prev) =>
        prev.map((b) => (String(b.bookId) === bookId ? { ...b, myRating: nextRating } : b)),
      )
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setBusyBookActionId('')
    }
  }

  const handleRemoveBookFromShelf = async (bookId) => {
    if (!selectedUserId || !bookId) return
    setBusyBookActionId(`${bookId}:remove`)
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'remove_book',
          userId: selectedUserId,
          bookId,
        }),
      })
      setUserBooks((prev) => prev.filter((b) => String(b.bookId) !== String(bookId)))
      await loadUsers(true)
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setBusyBookActionId('')
    }
  }

  const handleCreateCollection = async (e) => {
    e.preventDefault()
    if (!selectedUserId || !colTitle.trim() || isCreatingCol) return
    setIsCreatingCol(true)
    try {
      const data = await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_collection',
          userId: selectedUserId,
          title: colTitle.trim(),
          description: colDesc.trim(),
          isPrivate: colPrivate,
        }),
      })
      setColTitle('')
      setColDesc('')
      setColPrivate(false)
      if (data?.collection?.id) {
        setExpandedColId(String(data.collection.id))
      }
      await Promise.all([loadSelectedUserDetails(selectedUserId), loadUsers(true)])
      showToast('success', 'Colecția a fost creată.')
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setIsCreatingCol(false)
    }
  }

  const handleToggleCollectionPrivacy = async (collection) => {
    if (!selectedUserId || !collection) return
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_collection',
          userId: selectedUserId,
          collectionId: collection.id,
          isPrivate: !collection.isPrivate,
        }),
      })
      await loadSelectedUserDetails(selectedUserId)
    } catch (err) {
      showToast('error', err.message)
    }
  }

  const handleDeleteCollection = async (collectionId) => {
    if (!selectedUserId || !collectionId) return
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'delete_collection',
          userId: selectedUserId,
          collectionId,
        }),
      })
      await Promise.all([loadSelectedUserDetails(selectedUserId), loadUsers(true)])
      showToast('success', 'Colecția a fost ștearsă.')
    } catch (err) {
      showToast('error', err.message)
    }
  }

  const handleAddBookToCollection = async (collectionId, book) => {
    if (!selectedUserId || !collectionId || !book) return
    const bookId = String(book.bookId || book.id || '')
    setBusyBookActionId(`col:${collectionId}:${bookId}`)
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add_book_to_collection',
          userId: selectedUserId,
          collectionId,
          bookId,
          book: {
            bookId,
            title: book.title,
            author: book.author,
            isbn: book.isbn,
            pages: book.pages || book.pageCount,
            publishedYear: book.publishedYear,
            description: book.description,
            mainCategory: book.mainCategory,
            coverUrl: book.coverUrl || book.imageUrl,
          },
        }),
      })
      await loadSelectedUserDetails(selectedUserId)
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setBusyBookActionId('')
    }
  }

  const handleRemoveBookFromCollection = async (collectionId, book) => {
    if (!selectedUserId || !collectionId || !book) return
    const bookId = String(book.bookId || book.id || '')
    try {
      await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'remove_book_from_collection',
          userId: selectedUserId,
          collectionId,
          bookId,
          isbn: book.isbn || '',
        }),
      })
      await loadSelectedUserDetails(selectedUserId)
    } catch (err) {
      showToast('error', err.message)
    }
  }

  const handleImportCsv = async (e) => {
    e.preventDefault()
    if (!selectedUserId || !csvFile || isImportingCsv) return
    setIsImportingCsv(true)
    try {
      const csvText = await csvFile.text()
      const data = await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({
          action: 'upload_csv',
          userId: selectedUserId,
          csvText,
          replaceExisting: replaceExistingCsv,
        }),
      })
      setCsvFile(null)
      await Promise.all([loadSelectedUserDetails(selectedUserId), loadUsers(true)])
      showToast('success', `Au fost importate ${data?.count || 0} cărți din CSV.`)
      setActiveTab('shelves')
    } catch (err) {
      showToast('error', err.message)
    } finally {
      setIsImportingCsv(false)
    }
  }

  return (
    <div className="admin-page-shell">
      <header className="admin-topbar">
        <div className="admin-topbar-left">
          <button type="button" className="admin-back-btn" onClick={onBackToApp}>
            <ArrowLeft size={16} />
            <span>Înapoi la aplicație</span>
          </button>
          <div className="admin-title-group">
            <h1>Administrare Utilizatori (Seed)</h1>
            <p>Creează cititori virtuali și populează-le rafturile și colecțiile pentru pagina Descoperă.</p>
          </div>
        </div>
        <div className="admin-badge">
          <Shield size={14} />
          <span>{adminEmail || 'Administrator'}</span>
        </div>
      </header>

      {toast ? (
        <div className={`admin-toast ${toast.type}`} role="status">
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}

      <div className="admin-layout">
        {/* LEFT SIDEBAR: CREATE & SELECT SEED USER */}
        <aside className="admin-sidebar">
          <div className="admin-card">
            <h2 className="admin-card-title">
              <span>Utilizator nou</span>
              <UserPlus size={16} />
            </h2>
            <form className="admin-form-stack" onSubmit={handleCreateUser}>
              <input
                type="text"
                className="admin-input"
                placeholder="Nume afișat (ex. Elena V.)"
                value={newName}
                maxLength={80}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <textarea
                className="admin-textarea"
                placeholder="Descriere scurtă / bio (opțional, max 140 caractere)"
                value={newBio}
                maxLength={140}
                rows={2}
                onChange={(e) => setNewBio(e.target.value)}
              />
              <button
                type="submit"
                className="admin-primary-btn"
                disabled={isCreatingUser || !newName.trim()}
              >
                {isCreatingUser ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                <span>Creează utilizator</span>
              </button>
            </form>
          </div>

          <div className="admin-card">
            <h2 className="admin-card-title">
              <span>Utilizatori creați ({users.length})</span>
            </h2>
            {users.length > 4 ? (
              <div style={{ marginBottom: 10 }}>
                <input
                  type="text"
                  className="admin-input"
                  placeholder="Filtrează utilizatori..."
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
              </div>
            ) : null}

            {isLoadingUsers ? (
              <div className="admin-empty-state">
                <Loader2 size={20} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                <div>Se încarcă...</div>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="admin-empty-state">Niciun utilizator virtual creat încă.</div>
            ) : (
              <div className="admin-users-list">
                {filteredUsers.map((u) => (
                  <div
                    key={u.userId}
                    role="button"
                    tabIndex={0}
                    className={`admin-user-item ${selectedUserId === u.userId ? 'active' : ''}`}
                    onClick={() => setSelectedUserId(u.userId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedUserId(u.userId)
                      }
                    }}
                  >
                    <div className="admin-user-item-main">
                      <div className="admin-user-item-name">{u.displayName}</div>
                      <div className="admin-user-item-meta">
                        <span>/{u.userId}</span>
                        <span>•</span>
                        <span>{u.totalBooks} cărți</span>
                        <span>•</span>
                        <span>{u.collectionCount} colecții</span>
                      </div>
                    </div>
                    <a
                      href={`/${u.userId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="admin-secondary-btn"
                      title="Deschide profilul public în tab nou"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* RIGHT WORKSPACE: MANAGE SELECTED SEED USER */}
        <main className="admin-workspace">
          {!selectedUserId ? (
            <div className="admin-card admin-empty-state">
              Creează sau selectează un utilizator din stânga pentru a-i gestiona rafturile și colecțiile.
            </div>
          ) : (
            <>
              {/* Profile Header */}
              <div className="admin-card admin-profile-header">
                <div className="admin-profile-header-top">
                  <div>
                    <strong style={{ fontSize: '1.05rem' }}>{editName || selectedUserId}</strong>
                    <span style={{ marginLeft: 10, fontSize: '0.8rem', color: '#a1a1aa' }}>
                      ID: {selectedUserId} (fără autentificare)
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      href={`/${selectedUserId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="admin-secondary-btn"
                    >
                      <ExternalLink size={14} />
                      <span>Profil public</span>
                    </a>
                    {!confirmDeleteUser ? (
                      <button
                        type="button"
                        className="admin-danger-btn"
                        onClick={() => setConfirmDeleteUser(true)}
                      >
                        <Trash2 size={14} />
                        <span>Șterge utilizator</span>
                      </button>
                    ) : (
                      <>
                        <button type="button" className="admin-danger-btn" onClick={handleDeleteUser}>
                          Confirmă ștergerea
                        </button>
                        <button
                          type="button"
                          className="admin-secondary-btn"
                          onClick={() => setConfirmDeleteUser(false)}
                        >
                          Anulează
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <form className="admin-profile-fields" onSubmit={handleSaveUserProfile}>
                  <input
                    type="text"
                    className="admin-input"
                    placeholder="Nume afișat"
                    value={editName}
                    maxLength={80}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    className="admin-input"
                    placeholder="Descriere profil (max 140 caractere)"
                    value={editBio}
                    maxLength={140}
                    onChange={(e) => setEditBio(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="admin-secondary-btn"
                    disabled={isSavingProfile || !editName.trim()}
                  >
                    {isSavingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    <span>Salvează</span>
                  </button>
                </form>
              </div>

              {/* Workspace Tabs */}
              <div className="admin-tabs">
                <button
                  type="button"
                  className={`admin-tab-btn ${activeTab === 'shelves' ? 'active' : ''}`}
                  onClick={() => setActiveTab('shelves')}
                >
                  <BookOpen size={15} />
                  <span>Rafturi ({userBooks.length})</span>
                </button>
                <button
                  type="button"
                  className={`admin-tab-btn ${activeTab === 'collections' ? 'active' : ''}`}
                  onClick={() => setActiveTab('collections')}
                >
                  <Library size={15} />
                  <span>Colecții ({userCollections.length})</span>
                </button>
                <button
                  type="button"
                  className={`admin-tab-btn ${activeTab === 'csv' ? 'active' : ''}`}
                  onClick={() => setActiveTab('csv')}
                >
                  <Upload size={15} />
                  <span>Import CSV</span>
                </button>
              </div>

              {isLoadingDetails ? (
                <div className="admin-card admin-empty-state">
                  <Loader2 size={22} className="animate-spin" style={{ margin: '0 auto 8px' }} />
                  <div>Se încarcă datele utilizatorului...</div>
                </div>
              ) : activeTab === 'shelves' ? (
                <>
                  {/* Search & Add Books to Shelf */}
                  <div className="admin-card">
                    <h3 className="admin-card-title">Adaugă cărți pe rafturi</h3>
                    <div className="admin-search-box">
                      <Search size={16} />
                      <input
                        type="text"
                        className="admin-input"
                        placeholder="Caută pe Google Books după titlu, autor sau ISBN..."
                        value={bookQuery}
                        onChange={(e) => setBookQuery(e.target.value)}
                      />
                    </div>

                    {isSearchingBooks ? (
                      <div className="admin-empty-state" style={{ padding: '18px 0' }}>
                        <Loader2 size={18} className="animate-spin" style={{ margin: '0 auto' }} />
                      </div>
                    ) : searchResults.length > 0 ? (
                      <div className="admin-search-results">
                        {searchResults.map((book) => {
                          const bId = String(book.bookId || book.id)
                          const existing = booksByIdMap.get(bId)
                          return (
                            <div key={bId} className="admin-book-row">
                              <div className="admin-book-info">
                                {book.coverUrl || book.imageUrl ? (
                                  <img
                                    src={book.coverUrl || book.imageUrl}
                                    alt={book.title}
                                    className="admin-book-cover"
                                  />
                                ) : (
                                  <div className="admin-book-cover-placeholder">
                                    <BookOpen size={16} />
                                  </div>
                                )}
                                <div className="admin-book-text">
                                  <div className="admin-book-title">{book.title}</div>
                                  <div className="admin-book-author">
                                    {book.author}
                                    {book.publishedYear ? ` • ${book.publishedYear}` : ''}
                                  </div>
                                </div>
                              </div>

                              <div className="admin-book-actions">
                                {SHELF_CHOICES.map((sc) => {
                                  const isCurrent = existing?.shelf === sc.id
                                  const isBusy = busyBookActionId === `${bId}:${sc.id}`
                                  return (
                                    <button
                                      key={sc.id}
                                      type="button"
                                      className={`admin-shelf-chip ${isCurrent ? 'active' : ''}`}
                                      disabled={Boolean(busyBookActionId)}
                                      onClick={() => handleSaveBookToShelf(book, sc.id)}
                                    >
                                      {isBusy ? '...' : isCurrent ? `✓ ${sc.label}` : `+ ${sc.label}`}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* User's Current Shelf Books */}
                  <div className="admin-card">
                    <h3 className="admin-card-title">Cărțile utilizatorului ({filteredShelfBooks.length})</h3>
                    <div className="admin-filter-pills">
                      <button
                        type="button"
                        className={`admin-shelf-chip ${shelfFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setShelfFilter('all')}
                      >
                        Toate ({userBooks.length})
                      </button>
                      {SHELF_CHOICES.map((sc) => {
                        const count = userBooks.filter((b) => b.shelf === sc.id).length
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            className={`admin-shelf-chip ${shelfFilter === sc.id ? 'active' : ''}`}
                            onClick={() => setShelfFilter(sc.id)}
                          >
                            {sc.label} ({count})
                          </button>
                        )
                      })}
                    </div>

                    {filteredShelfBooks.length === 0 ? (
                      <div className="admin-empty-state">Nicio carte pe acest raft.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filteredShelfBooks.map((book) => (
                          <div key={book.bookId} className="admin-book-row">
                            <div className="admin-book-info">
                              {book.coverUrl || book.imageUrl ? (
                                <img
                                  src={book.coverUrl || book.imageUrl}
                                  alt={book.title}
                                  className="admin-book-cover"
                                />
                              ) : (
                                <div className="admin-book-cover-placeholder">
                                  <BookOpen size={16} />
                                </div>
                              )}
                              <div className="admin-book-text">
                                <div className="admin-book-title">{book.title}</div>
                                <div className="admin-book-author">{book.author}</div>
                              </div>
                            </div>

                            <div className="admin-book-actions">
                              <div className="admin-stars-inline" title="Acordă stele (emite eveniment în feed)">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <button
                                    key={star}
                                    type="button"
                                    className={`admin-star-btn ${Number(book.myRating) >= star ? 'filled' : ''}`}
                                    onClick={() => handleRateBook(book, star)}
                                  >
                                    <Star
                                      size={15}
                                      fill={Number(book.myRating) >= star ? 'currentColor' : 'none'}
                                    />
                                  </button>
                                ))}
                              </div>

                              <select
                                className="admin-select"
                                style={{ width: 'auto', padding: '5px 10px', fontSize: '0.8rem' }}
                                value={book.shelf}
                                onChange={(e) => handleSaveBookToShelf(book, e.target.value, book.myRating)}
                              >
                                {SHELF_CHOICES.map((sc) => (
                                  <option key={sc.id} value={sc.id}>
                                    {sc.label}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                className="admin-danger-btn"
                                title="Elimină de pe raft"
                                onClick={() => handleRemoveBookFromShelf(book.bookId)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : activeTab === 'collections' ? (
                <>
                  {/* Create Collection */}
                  <div className="admin-card">
                    <h3 className="admin-card-title">Creează colecție nouă</h3>
                    <form className="admin-form-stack" onSubmit={handleCreateCollection}>
                      <input
                        type="text"
                        className="admin-input"
                        placeholder="Titlu colecție (ex. Sci-Fi esențiale)"
                        value={colTitle}
                        maxLength={100}
                        onChange={(e) => setColTitle(e.target.value)}
                        required
                      />
                      <input
                        type="text"
                        className="admin-input"
                        placeholder="Descriere colecție (opțional, max 140 caractere)"
                        value={colDesc}
                        maxLength={140}
                        onChange={(e) => setColDesc(e.target.value)}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <label className="admin-checkbox-row">
                          <input
                            type="checkbox"
                            checked={colPrivate}
                            onChange={(e) => setColPrivate(e.target.checked)}
                          />
                          <span>Colecție privată (ascunsă din Descoperă)</span>
                        </label>
                        <button
                          type="submit"
                          className="admin-primary-btn"
                          disabled={isCreatingCol || !colTitle.trim()}
                        >
                          {isCreatingCol ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                          <span>Creează colecție</span>
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Existing Collections */}
                  <div className="admin-card">
                    <h3 className="admin-card-title">Colecțiile utilizatorului ({userCollections.length})</h3>
                    {userCollections.length === 0 ? (
                      <div className="admin-empty-state">Nicio colecție creată încă.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {userCollections.map((col) => {
                          const isExpanded = String(expandedColId) === String(col.id)
                          const colBookIds = new Set(
                            (col.books || []).map((b) => String(b.bookId || b.id)),
                          )
                          const availableFromShelves = userBooks.filter(
                            (b) => !colBookIds.has(String(b.bookId)),
                          )

                          return (
                            <div key={col.id} className="admin-collection-card">
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                <div
                                  style={{ cursor: 'pointer', flex: 1 }}
                                  onClick={() => setExpandedColId(isExpanded ? '' : String(col.id))}
                                >
                                  <div style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span>{col.title}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>
                                      ({(col.books || []).length} cărți)
                                    </span>
                                  </div>
                                  {col.description ? (
                                    <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginTop: 2 }}>
                                      {col.description}
                                    </div>
                                  ) : null}
                                </div>

                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    className="admin-secondary-btn"
                                    onClick={() => handleToggleCollectionPrivacy(col)}
                                    title="Comută vizibilitatea"
                                  >
                                    {col.isPrivate ? <Lock size={13} /> : <Globe size={13} />}
                                    <span>{col.isPrivate ? 'Privată' : 'Publică'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="admin-secondary-btn"
                                    onClick={() => setExpandedColId(isExpanded ? '' : String(col.id))}
                                  >
                                    {isExpanded ? 'Restrânge' : 'Editează cărți'}
                                  </button>
                                  <button
                                    type="button"
                                    className="admin-danger-btn"
                                    onClick={() => handleDeleteCollection(col.id)}
                                    title="Șterge colecția"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>

                              {/* Current books in collection */}
                              {(col.books || []).length > 0 ? (
                                <div className="admin-collection-books-grid">
                                  {(col.books || []).map((b) => (
                                    <div key={b.bookId || b.id} className="admin-collection-book-pill">
                                      {b.imageUrl ? <img src={b.imageUrl} alt="" /> : null}
                                      <span>{b.title}</span>
                                      <button
                                        type="button"
                                        title="Elimină din colecție"
                                        onClick={() => handleRemoveBookFromCollection(col.id, b)}
                                      >
                                        <X size={13} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ fontSize: '0.8rem', color: '#71717a' }}>
                                  Nicio carte în această colecție încă.
                                </div>
                              )}

                              {isExpanded ? (
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {/* Search Google Books directly for collection */}
                                  <div className="admin-search-box">
                                    <Search size={15} />
                                    <input
                                      type="text"
                                      className="admin-input"
                                      placeholder="Caută o carte nouă pentru a o adăuga în această colecție..."
                                      value={colBookQuery}
                                      onChange={(e) => setColBookQuery(e.target.value)}
                                    />
                                  </div>

                                  {isSearchingColBooks ? (
                                    <div style={{ fontSize: '0.8rem', color: '#a1a1aa' }}>Se caută...</div>
                                  ) : colSearchResults.length > 0 ? (
                                    <div className="admin-search-results" style={{ maxHeight: 220 }}>
                                      {colSearchResults.map((b) => {
                                        const bId = String(b.bookId || b.id)
                                        const inCol = colBookIds.has(bId)
                                        return (
                                          <div key={bId} className="admin-book-row">
                                            <div className="admin-book-info">
                                              {b.coverUrl || b.imageUrl ? (
                                                <img
                                                  src={b.coverUrl || b.imageUrl}
                                                  alt={b.title}
                                                  className="admin-book-cover"
                                                />
                                              ) : null}
                                              <div className="admin-book-text">
                                                <div className="admin-book-title">{b.title}</div>
                                                <div className="admin-book-author">{b.author}</div>
                                              </div>
                                            </div>
                                            <button
                                              type="button"
                                              className={`admin-shelf-chip ${inCol ? 'active' : ''}`}
                                              disabled={inCol || Boolean(busyBookActionId)}
                                              onClick={() => handleAddBookToCollection(col.id, b)}
                                            >
                                              {inCol ? '✓ În colecție' : '+ Adaugă'}
                                            </button>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  ) : null}

                                  {/* Quick add from user's own shelves */}
                                  {availableFromShelves.length > 0 ? (
                                    <div>
                                      <div style={{ fontSize: '0.78rem', color: '#a1a1aa', marginBottom: 6 }}>
                                        Adaugă rapid de pe rafturile acestui utilizator:
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {availableFromShelves.slice(0, 16).map((b) => (
                                          <button
                                            key={b.bookId}
                                            type="button"
                                            className="admin-shelf-chip"
                                            disabled={Boolean(busyBookActionId)}
                                            onClick={() => handleAddBookToCollection(col.id, b)}
                                          >
                                            + {b.title}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* CSV Import Tab */
                <div className="admin-card">
                  <h3 className="admin-card-title">Importă bibliotecă Goodreads CSV</h3>
                  <p style={{ margin: '0 0 14px', fontSize: '0.84rem', color: '#a1a1aa', lineHeight: 1.45 }}>
                    Încarcă un fișier CSV exportat din Goodreads pentru a popula rapid rafturile utilizatorului{' '}
                    <strong>{editName || selectedUserId}</strong>. Sesiunea ta de administrator rămâne neschimbată.
                  </p>
                  <form className="admin-form-stack" onSubmit={handleImportCsv}>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="admin-input"
                      onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                    />
                    <label className="admin-checkbox-row">
                      <input
                        type="checkbox"
                        checked={replaceExistingCsv}
                        onChange={(e) => setReplaceExistingCsv(e.target.checked)}
                      />
                      <span>Șterge cărțile existente de pe rafturile acestui utilizator înainte de import</span>
                    </label>
                    <div>
                      <button
                        type="submit"
                        className="admin-primary-btn"
                        disabled={!csvFile || isImportingCsv}
                      >
                        {isImportingCsv ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Upload size={15} />
                        )}
                        <span>{isImportingCsv ? 'Se importă și se caută coperți...' : 'Importă CSV'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

