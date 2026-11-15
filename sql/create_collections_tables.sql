CREATE TABLE IF NOT EXISTS collections (
  collection_id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(8) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description VARCHAR(140) DEFAULT '',
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE collections ADD COLUMN IF NOT EXISTS description VARCHAR(140) DEFAULT '';
ALTER TABLE collections ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections (user_id);

CREATE TABLE IF NOT EXISTS collection_books (
  id BIGSERIAL PRIMARY KEY,
  collection_id BIGINT NOT NULL REFERENCES collections(collection_id) ON DELETE CASCADE,
  book_id VARCHAR(64) NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_collection_books UNIQUE (collection_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_books_collection_id ON collection_books (collection_id);

