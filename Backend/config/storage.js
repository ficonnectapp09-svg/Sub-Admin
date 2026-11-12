const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

const ALLOWED_MIME_MAP = {
  // Images
  'image/jpeg': { ext: 'jpg', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/jpg': { ext: 'jpg', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/png': { ext: 'png', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/webp': { ext: 'webp', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/gif': { ext: 'gif', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/avif': { ext: 'avif', category: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/svg+xml': { ext: 'svg', category: 'image', maxSizeBytes: 5 * 1024 * 1024 },

  // Documents
  'application/pdf': { ext: 'pdf', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
  'application/msword': { ext: 'doc', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
  'application/vnd.ms-excel': { ext: 'xls', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', category: 'document', maxSizeBytes: 25 * 1024 * 1024 },
  'text/csv': { ext: 'csv', category: 'document', maxSizeBytes: 10 * 1024 * 1024 },
  'text/plain': { ext: 'txt', category: 'document', maxSizeBytes: 10 * 1024 * 1024 },

  // Audio
  'audio/webm': { ext: 'webm', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'video/webm': { ext: 'webm', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/mpeg': { ext: 'mp3', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/mp3': { ext: 'mp3', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/wav': { ext: 'wav', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/x-wav': { ext: 'wav', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/wave': { ext: 'wav', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/m4a': { ext: 'm4a', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/x-m4a': { ext: 'm4a', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/mp4': { ext: 'm4a', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/ogg': { ext: 'ogg', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'application/ogg': { ext: 'ogg', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 },
  'audio/aac': { ext: 'aac', category: 'audio', maxSizeBytes: 20 * 1024 * 1024 }
};

const EXTENSION_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/m4a',
  ogg: 'audio/ogg',
  aac: 'audio/aac'
};

function detectMagicBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'audio/webm';
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 12) {
    const sub = buf.toString('ascii', 8, 12);
    if (sub === 'WEBP') return 'image/webp';
    if (sub === 'WAVE') return 'audio/wav';
  }
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) return 'application/zip';
  return null;
}

function getUploadPublicUrl(objectKey) {
  if (!objectKey) return '';
  const cleanKey = objectKey.replace(/^\/+/, '');
  const backendBase = process.env.BACKEND_URL || 'https://sub-admin-4pkg.onrender.com';
  return `${backendBase.replace(/\/+$/, '')}/uploads/${cleanKey}`;
}

async function uploadFile(fileBufferOrPath, folder = 'subadmin_docs', filenameHint = 'document.pdf') {
  try {
    let buffer;
    let hint = filenameHint;

    if (Buffer.isBuffer(fileBufferOrPath)) {
      buffer = fileBufferOrPath;
    } else if (typeof fileBufferOrPath === 'string') {
      const trimmed = fileBufferOrPath.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return { success: true, url: trimmed, secure_url: trimmed, key: trimmed };
      }
      if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
        const cleanKey = trimmed.replace(/^\/?uploads\//, '');
        const publicUrl = getUploadPublicUrl(cleanKey);
        return { success: true, url: publicUrl, secure_url: publicUrl, key: cleanKey };
      }
      if (fs.existsSync(trimmed)) {
        buffer = fs.readFileSync(trimmed);
        hint = path.basename(trimmed);
      } else if (trimmed.startsWith('data:')) {
        const match = trimmed.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          buffer = Buffer.from(match[2], 'base64');
          const extFromMime = ALLOWED_MIME_MAP[match[1].toLowerCase()]?.ext || 'pdf';
          hint = `upload.${extFromMime}`;
        } else {
          throw new Error('Malformed base64 data string');
        }
      } else {
        throw new Error('Invalid file path or data provided for upload');
      }
    } else {
      throw new Error('File payload must be a Buffer or file path string');
    }

    let ext = path.extname(hint || '').replace('.', '').toLowerCase() || 'pdf';
    let mimeType = EXTENSION_TO_MIME[ext] || 'application/octet-stream';

    const magicMime = detectMagicBytes(buffer);
    if (magicMime && ALLOWED_MIME_MAP[magicMime]) {
      mimeType = magicMime;
      ext = ALLOWED_MIME_MAP[magicMime].ext;
    }

    const mimeConfig = ALLOWED_MIME_MAP[mimeType];
    if (!mimeConfig) {
      throw new Error(`File format '${mimeType}' is not supported.`);
    }

    if (buffer.length > mimeConfig.maxSizeBytes) {
      const maxMb = Math.round(mimeConfig.maxSizeBytes / (1024 * 1024));
      throw new Error(`Payload size exceeds maximum limit of ${maxMb} MB for ${mimeConfig.category}s.`);
    }

    const safeFolder = String(folder || 'subadmin_docs').replace(/[^a-zA-Z0-9_-]/g, '_');
    const randSuffix = crypto.randomBytes(8).toString('hex');
    const filename = `${Date.now()}-${randSuffix}.${ext}`;
    const objectKey = `${safeFolder}/${filename}`;

    const targetDir = path.join(UPLOADS_ROOT, safeFolder);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, filename), buffer);

    const publicUrl = getUploadPublicUrl(objectKey);

    return {
      success: true,
      url: publicUrl,
      secure_url: publicUrl,
      key: objectKey,
      publicId: objectKey,
      category: mimeConfig.category,
      mimeType,
      extension: ext,
      size: buffer.length,
      toString() { return publicUrl; },
      [Symbol.toPrimitive]() { return publicUrl; }
    };
  } catch (err) {
    console.error('[Storage Upload Error]:', err.message);
    throw new Error(`Failed to store uploaded file: ${err.message}`);
  }
}

module.exports = {
  uploadFile,
  getUploadPublicUrl
};

