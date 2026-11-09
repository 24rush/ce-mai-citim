CREATE TABLE IF NOT EXISTS books (
  book_id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  isbn VARCHAR(32),
  publisher TEXT,
  binding VARCHAR(100),
  number_of_pages INTEGER,
  original_publication_year SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_isbn ON books (isbn);
