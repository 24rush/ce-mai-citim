import { createDefaultDbQuery, ensureEnvLoaded } from './_lib/db.js'
import { convertIsbn10To13, convertIsbn13To10 } from '../src/lib/goodreads.js'

export const parseMultipartBuffer = (buffer, contentType = '') => {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || '').trim()

  if (!boundary || !buffer || buffer.length === 0) {
    return { fields: {}, files: {} }
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`)
  const fields = {}
  const files = {}

  let startIndex = buffer.indexOf(boundaryBuffer)
  if (startIndex === -1) {
    return { fields, files }
  }

  while (startIndex !== -1) {
    const nextIndex = buffer.indexOf(boundaryBuffer, startIndex + boundaryBuffer.length)
    if (nextIndex === -1) {
      break
    }

    const partBuffer = buffer.slice(startIndex + boundaryBuffer.length, nextIndex)
    startIndex = nextIndex

    let headerEndIndex = partBuffer.indexOf('\r\n\r\n')
    let headerEndLength = 4
    if (headerEndIndex === -1) {
      headerEndIndex = partBuffer.indexOf('\n\n')
      headerEndLength = 2
    }

    if (headerEndIndex === -1) {
      continue
    }

    const headerText = partBuffer.slice(0, headerEndIndex).toString('utf8')
    let bodyBuffer = partBuffer.slice(headerEndIndex + headerEndLength)

    if (bodyBuffer.length >= 2 && bodyBuffer[bodyBuffer.length - 2] === 13 && bodyBuffer[bodyBuffer.length - 1] === 10) {
      bodyBuffer = bodyBuffer.slice(0, bodyBuffer.length - 2)
    } else if (bodyBuffer.length >= 1 && bodyBuffer[bodyBuffer.length - 1] === 10) {
      bodyBuffer = bodyBuffer.slice(0, bodyBuffer.length - 1)
    }

    const nameMatch = headerText.match(/name=["']([^"']+)["']/i)
    if (!nameMatch) {
      continue
    }
    const fieldName = nameMatch[1]

    const filenameMatch = headerText.match(/filename=["']([^"']+)["']/i)
    const contentTypeMatch = headerText.match(/content-type:\s*([^\r\n;]+)/i)
    const fileContentType = contentTypeMatch?.[1]?.trim() || 'application/octet-stream'

    if (filenameMatch) {
      files[fieldName] = {
        filename: filenameMatch[1],
        contentType: fileContentType,
        data: bodyBuffer,
      }
    } else {
      fields[fieldName] = bodyBuffer.toString('utf8').trim()
    }
  }

  return { fields, files }
}

const readRawStream = async (req) => {
  if (typeof req[Symbol.asyncIterator] === 'function') {
    const chunks = []
    try {
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
      }
      if (chunks.length > 0) {
        return Buffer.concat(chunks)
      }
    } catch {
      // Stream may have already been consumed
    }
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8')
  }

  return Buffer.alloc(0)
}

export const extractCoverPayload = async (req) => {
  const rawContentType = String(req.headers?.['content-type'] || req.headers?.['Content-Type'] || '')
  const contentType = rawContentType.toLowerCase()

  // JSON body passed directly
  if (
    req.body &&
    typeof req.body === 'object' &&
    !Buffer.isBuffer(req.body) &&
    (req.body.isbn || req.body.file || req.body.image || req.body.imageBase64 || req.body.dataUrl)
  ) {
    const rawIsbn = String(req.body.isbn || req.query?.isbn || '').trim()
    const rawData = String(req.body.image || req.body.file || req.body.dataUrl || req.body.imageBase64 || '')
    const mimeMatch = rawData.match(/^data:([^;]+);base64,(.*)$/)
    const detectedContentType = mimeMatch ? mimeMatch[1] : (req.body.contentType || 'image/jpeg')
    const base64Data = mimeMatch ? mimeMatch[2] : rawData
    const buffer = Buffer.from(base64Data, 'base64')

    return {
      isbn: rawIsbn,
      contentType: detectedContentType,
      buffer,
    }
  }

  const rawBuffer = await readRawStream(req)

  if (contentType.includes('multipart/form-data')) {
    const { fields, files } = parseMultipartBuffer(rawBuffer, rawContentType)
    const rawIsbn = String(fields.isbn || req.query?.isbn || '').trim()
    const fileObj = files.file || files.image || Object.values(files)[0]

    return {
      isbn: rawIsbn,
      contentType: fileObj?.contentType || 'image/jpeg',
      buffer: fileObj?.data || Buffer.alloc(0),
    }
  }

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(rawBuffer.toString('utf8') || '{}')
    const rawIsbn = String(parsed.isbn || req.query?.isbn || '').trim()
    const rawData = String(parsed.image || parsed.file || parsed.dataUrl || parsed.imageBase64 || '')
    const mimeMatch = rawData.match(/^data:([^;]+);base64,(.*)$/)
    const detectedContentType = mimeMatch ? mimeMatch[1] : (parsed.contentType || 'image/jpeg')
    const base64Data = mimeMatch ? mimeMatch[2] : rawData
    const buffer = Buffer.from(base64Data, 'base64')

    return {
      isbn: rawIsbn,
      contentType: detectedContentType,
      buffer,
    }
  }

  return {
    isbn: String(req.query?.isbn || '').trim(),
    contentType: 'image/jpeg',
    buffer: rawBuffer,
  }
}

export const UPSERT_COVER_SQL = `
  INSERT INTO covers (isbn, url)
  VALUES ($1, $2)
  ON CONFLICT (isbn)
  DO UPDATE SET
    url = EXCLUDED.url
  RETURNING isbn, url;
`.trim()

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(204).end ? res.status(204).end() : res.status(204).json({})
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  ensureEnvLoaded()

  try {
    const { isbn, contentType, buffer } = await extractCoverPayload(req)
    const cleanIsbn = String(isbn || req.query?.isbn || '').replace(/[^0-9X]/gi, '').trim()

    if (!cleanIsbn) {
      return res.status(400).json({ error: 'A valid ISBN is required.' })
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'An image file is required.' })
    }

    const putFn = req.blobPut || (async (path, data, options) => {
      const { put } = await import('@vercel/blob')
      return put(path, data, options)
    })

    const blobOptions = {
      access: 'public',
      contentType: contentType || 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
      ...(process.env.BLOB_READ_WRITE_TOKEN ? { token: process.env.BLOB_READ_WRITE_TOKEN } : {}),
    }

    const blobResult = await putFn(`covers/${cleanIsbn}.jpg`, buffer, blobOptions)

    const coverUrl = blobResult?.url || `https://blob.vercel-storage.com/covers/${cleanIsbn}.jpg`

    const executeQuery = req.dbQuery || (await createDefaultDbQuery())

    await executeQuery(UPSERT_COVER_SQL, [cleanIsbn, coverUrl])

    const altIsbn =
      cleanIsbn.length === 13 ? convertIsbn13To10(cleanIsbn) : convertIsbn10To13(cleanIsbn)
    if (altIsbn && altIsbn !== cleanIsbn) {
      try {
        await executeQuery(UPSERT_COVER_SQL, [altIsbn, coverUrl])
      } catch {
        // Alt ISBN caching is best-effort
      }
    }

    return res.status(200).json({
      success: true,
      isbn: cleanIsbn,
      url: coverUrl
    })
  } catch (error) {
    console.error('Failed to save book cover:', error)
    return res.status(500).json({ error: error?.message || 'Failed to save cover.' })
  }
}

