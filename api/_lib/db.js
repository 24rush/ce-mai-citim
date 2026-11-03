import fs from 'node:fs'
import path from 'node:path'

const loadEnvFileIfPresent = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return
    }
    const content = fs.readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) {
        continue
      }
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !process.env[key]) {
        process.env[key] = val
      }
    }
  } catch {
    // Ignore file read errors in serverless environments
  }
}

export const ensureEnvLoaded = () => {
  loadEnvFileIfPresent(path.resolve(process.cwd(), '.env.local'))
  loadEnvFileIfPresent(path.resolve(process.cwd(), '.env'))
}

export const getDatabaseConnectionString = () => {
  const findUrl = () =>
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    ''

  let url = findUrl()
  if (!url) {
    ensureEnvLoaded()
    url = findUrl()
  }

  return url
}

export const createDefaultDbQuery = async () => {
  const connectionString = getDatabaseConnectionString()
  if (!connectionString) {
    throw new Error(
      'Missing DATABASE_URL or POSTGRES_URL environment variable. Add your PostgreSQL connection string to .env.local (or link your database in Vercel and run `vercel env pull .env.local`).',
    )
  }

  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(connectionString)
  return (queryText, values) => sql.query(queryText, values)
}

