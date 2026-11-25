import { createDefaultDbQuery } from './_lib/db.js'
import { generateUserId } from './uploadcsv.js'
import { USER_ID_COOKIE_NAME } from '../src/lib/goodreads.js'

export const resolveBaseUrl = (req) => {
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host || ''
  const proto =
    req.headers?.['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https')
  return host ? `${proto}://${host}` : ''
}

export const ensureAuthUserIdColumn = async (queryFn) => {
  try {
    await queryFn('ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id TEXT;')
    await queryFn('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON users (auth_user_id);')
  } catch {
    // Ignore schema update errors if table doesn't exist or already configured
  }
}

export const ensureUserProfileColumns = async (queryFn) => {
  await ensureAuthUserIdColumn(queryFn)
  try {
    await queryFn('ALTER TABLE users ADD COLUMN IF NOT EXISTS description VARCHAR(140) DEFAULT \'\';')
  } catch {
    // Ignore schema update errors
  }
}

const withAutoMigrateProfile = async (executeQuery, fn) => {
  try {
    return await fn()
  } catch (err) {
    const msg = String(err?.message || '')
    if (
      err?.code === '42P01' ||
      err?.code === '42703' ||
      (msg.includes('relation') && msg.includes('does not exist')) ||
      (msg.includes('column') && msg.includes('does not exist'))
    ) {
      await ensureUserProfileColumns(executeQuery)
      return await fn()
    }
    throw err
  }
}

export const updateUserProfile = async ({ userId, authUserId, displayName, description, queryFn }) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())

  const cleanUserId = String(userId || '').trim()
  const cleanAuthId = String(authUserId || '').trim()
  if (!cleanUserId && !cleanAuthId) {
    throw new Error('userId or authUserId is required.')
  }

  const updates = []
  const values = []
  let paramIdx = 1

  let cleanName = null
  if (displayName !== undefined) {
    cleanName = String(displayName || '').trim()
    if (!cleanName) {
      throw new Error('Display name cannot be empty.')
    }
    updates.push(`display_name = $${paramIdx++}`)
    values.push(cleanName)
  }

  let cleanDesc = null
  if (description !== undefined) {
    cleanDesc = String(description || '').slice(0, 140).trim()
    updates.push(`description = $${paramIdx++}`)
    values.push(cleanDesc)
  }

  if (updates.length === 0) {
    throw new Error('No fields provided to update.')
  }

  updates.push('last_access = NOW()')
  values.push(cleanUserId)
  const userIdParam = paramIdx++
  values.push(cleanAuthId)
  const authIdParam = paramIdx++

  await withAutoMigrateProfile(executeQuery, () =>
    executeQuery(
      `UPDATE users
       SET ${updates.join(', ')}
       WHERE ((user_id = $${userIdParam} AND $${userIdParam} <> '') OR (auth_user_id = $${authIdParam} AND $${authIdParam} <> ''))
         AND COALESCE(auth_user_id, '') NOT LIKE 'seed:%';`,
      values,
    ),
  )

  const result = { success: true }
  if (cleanName !== null) result.displayName = cleanName
  if (cleanDesc !== null) result.description = cleanDesc
  return result
}

export const updateDisplayName = async ({ userId, authUserId, displayName, queryFn }) => {
  return updateUserProfile({ userId, authUserId, displayName, queryFn })
}

export const updateDescription = async ({ userId, authUserId, description, queryFn }) => {
  return updateUserProfile({ userId, authUserId, description, queryFn })
}

export const syncUserProfile = async ({
  authUserId,
  email = '',
  displayName = '',
  description = '',
  existingUserId = '',
  baseUrl = '',
  queryFn,
}) => {
  const executeQuery = queryFn || (await createDefaultDbQuery())

  const cleanAuthId = String(authUserId || '').trim()
  if (!cleanAuthId) {
    throw new Error('authUserId is required.')
  }

  const cleanExistingId = String(existingUserId || '').trim()
  const isValidExistingId = /^[a-zA-Z0-9]{8}$/.test(cleanExistingId)

  return withAutoMigrateProfile(executeQuery, async () => {
    // 1. Check if user already exists for this auth_user_id
    const existingUserRows = await executeQuery(
      'SELECT user_id, display_name, auth_user_id, COALESCE(description, \'\') AS description FROM users WHERE auth_user_id = $1 LIMIT 1;',
      [cleanAuthId],
    )

    if (existingUserRows && existingUserRows.length > 0) {
      const row = existingUserRows[0]
      await executeQuery('UPDATE users SET last_access = NOW() WHERE user_id = $1;', [row.user_id])
      const profileUrl = baseUrl ? `${baseUrl}/${row.user_id}` : `/${row.user_id}`

      let collections = []
      try {
        const colRows = await executeQuery(
          'SELECT collection_id, title FROM collections WHERE user_id = $1 ORDER BY created_at DESC;',
          [row.user_id],
        )
        collections = (colRows || []).map((r) => ({
          id: String(r.collection_id),
          title: r.title,
        }))
      } catch {
        collections = []
      }

      return {
        userId: row.user_id,
        displayName: row.display_name,
        description: row.description || '',
        profileUrl,
        url: profileUrl,
        isNew: false,
        collections,
      }
    }

    // 2. Initial name after login will be user's mail without the domain
    const emailPrefix = String(email || '').split('@')[0].trim()
    const fallbackDisplayName =
      emailPrefix ||
      String(displayName || '').trim() ||
      'Cititor'

    let targetUserId = ''

    if (isValidExistingId) {
      const existingByIdRows = await executeQuery(
        'SELECT user_id, auth_user_id, display_name, COALESCE(description, \'\') AS description FROM users WHERE user_id = $1 LIMIT 1;',
        [cleanExistingId],
      )

      if (existingByIdRows && existingByIdRows.length > 0) {
        const candidateRow = existingByIdRows[0]
        // Only claim if not claimed by another auth account
        if (!candidateRow.auth_user_id) {
          targetUserId = candidateRow.user_id
          await executeQuery(
            `UPDATE users
           SET auth_user_id = $1,
               display_name = COALESCE(NULLIF(display_name, ''), $2),
               last_access = NOW()
           WHERE user_id = $3;`,
            [cleanAuthId, fallbackDisplayName, targetUserId],
          )
        }
      }
    }

    // 3. Otherwise generate a brand new user_id
    if (!targetUserId) {
      targetUserId = generateUserId()
      await executeQuery(
        `INSERT INTO users (user_id, display_name, auth_user_id, description, last_access)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           auth_user_id = COALESCE(users.auth_user_id, EXCLUDED.auth_user_id),
           display_name = COALESCE(NULLIF(users.display_name, ''), EXCLUDED.display_name),
           last_access = NOW();`,
        [targetUserId, fallbackDisplayName, cleanAuthId, String(description || '').slice(0, 140).trim()],
      )
    }

    let collections = []
    try {
      const colRows = await executeQuery(
        'SELECT collection_id, title FROM collections WHERE user_id = $1 ORDER BY created_at DESC;',
        [targetUserId],
      )
      collections = (colRows || []).map((r) => ({
        id: String(r.collection_id),
        title: r.title,
      }))
    } catch {
      collections = []
    }

    const profileUrl = baseUrl ? `${baseUrl}/${targetUserId}` : `/${targetUserId}`
    return {
      userId: targetUserId,
      displayName: fallbackDisplayName,
      description: String(description || '').slice(0, 140).trim(),
      profileUrl,
      url: profileUrl,
      isNew: true,
      collections,
    }
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'PUT') {
    res.setHeader('Allow', 'POST, GET, PATCH, PUT')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  let body = req.body || {}
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = {}
    }
  }

  // Handle display name or description update
  if (req.method === 'PATCH' || req.method === 'PUT' || body.action === 'update_name' || body.action === 'update_description' || body.action === 'update_profile') {
    const newName = body.displayName ?? req.query?.displayName
    const newDescription = body.description ?? req.query?.description
    const userId = body.userId || req.query?.userId
    const authUserId = body.authUserId || req.query?.authUserId

    if (newName === undefined && newDescription === undefined) {
      return res.status(400).json({ error: 'displayName or description is required.' })
    }

    if (newName !== undefined && !String(newName).trim()) {
      return res.status(400).json({ error: 'Display name cannot be empty.' })
    }

    try {
      const executeQuery = req.dbQuery || (await createDefaultDbQuery())
      const result = await updateUserProfile({
        userId,
        authUserId,
        displayName: newName,
        description: newDescription,
        queryFn: executeQuery,
      })
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json(result)
    } catch (err) {
      console.error('Failed to update profile:', err)
      return res.status(500).json({ error: err?.message || 'Failed to update profile.' })
    }
  }

  const authUserId = body.authUserId || req.query?.authUserId || ''
  const email = body.email || req.query?.email || ''
  const displayName = body.displayName || req.query?.displayName || ''
  const existingUserId = body.existingUserId || req.query?.existingUserId || ''

  if (!authUserId) {
    return res.status(400).json({ error: 'authUserId is required.' })
  }

  const baseUrl = resolveBaseUrl(req)

  try {
    const executeQuery = req.dbQuery || (await createDefaultDbQuery())
    const profile = await syncUserProfile({
      authUserId,
      email,
      displayName,
      existingUserId,
      baseUrl,
      queryFn: executeQuery,
    })

    const maxAgeSeconds = 60 * 60 * 24 * 365 * 10
    res.setHeader(
      'Set-Cookie',
      `${USER_ID_COOKIE_NAME}=${encodeURIComponent(profile.userId)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`,
    )

    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json(profile)
  } catch (error) {
    console.error('Failed to sync profile:', error)
    return res.status(500).json({ error: error?.message || 'Failed to sync profile.' })
  }
}
