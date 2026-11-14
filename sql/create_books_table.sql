CREATE TABLE IF NOT EXISTS books (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_isbn ON books (isbn);

-- Migration for existing tables:
-- ALTER TABLE books ADD COLUMN IF NOT EXISTS description VARCHAR(500);
-- ALTER TABLE books ALTER COLUMN description TYPE VARCHAR(500);
-- ALTER TABLE books ADD COLUMN IF NOT EXISTS main_category TEXT;
