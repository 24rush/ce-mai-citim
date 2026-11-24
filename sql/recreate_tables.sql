-- Drop existing tables in reverse dependency order
DROP TABLE IF EXISTS feed_events CASCADE;
DROP TABLE IF EXISTS collection_books CASCADE;
DROP TABLE IF EXISTS collections CASCADE;
DROP TABLE IF EXISTS user_shelves CASCADE;
DROP TABLE IF EXISTS books CASCADE;
DROP TABLE IF EXISTS covers CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users table
CREATE TABLE users (
  user_id VARCHAR(8) PRIMARY KEY,
  display_name TEXT NOT NULL,
  description VARCHAR(140) DEFAULT '',
  auth_user_id TEXT,
  last_access TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_last_access ON users (last_access);
CREATE UNIQUE INDEX idx_users_auth_user_id ON users (auth_user_id);

-- 2. Books table (canonical book metadata without user_id)
CREATE TABLE books (
  book_id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn VARCHAR(32),
  publisher TEXT,
  binding VARCHAR(100),
  number_of_pages INTEGER,
  original_publication_year SMALLINT,
  description VARCHAR(500),
  main_category TEXT,
  google_books_queried BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_books_isbn ON books (isbn);

-- 3. User shelves table (user-specific shelf entries linking user and book)
CREATE TABLE user_shelves (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  book_id VARCHAR(64) NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  bookshelves TEXT NOT NULL,
  my_rating SMALLINT NOT NULL DEFAULT 0 CHECK (my_rating BETWEEN 0 AND 5),
  date_read DATE,
  date_added DATE,
  my_review TEXT,
  spoiler BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_shelves_user_book UNIQUE (user_id, book_id)
);

CREATE INDEX idx_user_shelves_user_id ON user_shelves (user_id);
CREATE INDEX idx_user_shelves_book_id ON user_shelves (book_id);
CREATE INDEX idx_user_shelves_bookshelves ON user_shelves (user_id, bookshelves);

-- 4. Covers table (cached covers by ISBN)
CREATE TABLE covers (
  isbn VARCHAR(32) PRIMARY KEY,
  url TEXT NOT NULL
);

-- 5. Collections table (user book collections)
CREATE TABLE collections (
  collection_id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description VARCHAR(140) DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collections_user_id ON collections (user_id);

-- 6. Collection books table (books inside a collection)
CREATE TABLE collection_books (
  id BIGSERIAL PRIMARY KEY,
  collection_id BIGINT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
  book_id VARCHAR(64) NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_collection_books UNIQUE (collection_id, book_id)
);

CREATE INDEX idx_collection_books_collection_id ON collection_books (collection_id);

-- 7. Feed events table (activity stream)
CREATE TABLE feed_events (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL,
  book_id VARCHAR(64) REFERENCES books(book_id) ON DELETE CASCADE,
  collection_id BIGINT REFERENCES collections(collection_id) ON DELETE CASCADE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feed_events_created_at ON feed_events (created_at DESC);
CREATE INDEX idx_feed_events_user_id ON feed_events (user_id);


