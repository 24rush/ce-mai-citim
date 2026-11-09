CREATE TABLE IF NOT EXISTS user_shelves (
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

CREATE INDEX IF NOT EXISTS idx_user_shelves_user_id ON user_shelves (user_id);
CREATE INDEX IF NOT EXISTS idx_user_shelves_book_id ON user_shelves (book_id);
CREATE INDEX IF NOT EXISTS idx_user_shelves_bookshelves ON user_shelves (user_id, bookshelves);

