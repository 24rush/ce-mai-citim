CREATE TABLE IF NOT EXISTS books (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  book_id VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  isbn VARCHAR(32),
  my_rating SMALLINT NOT NULL DEFAULT 0 CHECK (my_rating BETWEEN 0 AND 5),
  publisher TEXT,
  binding VARCHAR(100),
  number_of_pages INTEGER,
  original_publication_year SMALLINT,
  date_read DATE,
  date_added DATE,
  bookshelves TEXT,
  my_review TEXT,
  spoiler BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_book UNIQUE (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_books_user_id ON books (user_id);
CREATE INDEX IF NOT EXISTS idx_books_bookshelves ON books (user_id, bookshelves);
