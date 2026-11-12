const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v2: cloudinary } = require('cloudinary');

if (!process.env.CLOUDINARY_URL && !process.env.CLOUDINARY_CLOUD_NAME) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

let isConfigured = false;

function configureCloudinary() {
  if (isConfigured) return cloudinary;

  let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  let apiKey = process.env.CLOUDINARY_API_KEY;
  let apiSecret = process.env.CLOUDINARY_API_SECRET;

  if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
    try {
      const parsed = new URL(process.env.CLOUDINARY_URL);
      cloudName = cloudName || parsed.hostname;
      apiKey = apiKey || decodeURIComponent(parsed.username);
      apiSecret = apiSecret || decodeURIComponent(parsed.password);
    } catch (err) {
      throw new Error('Invalid CLOUDINARY_URL format.');
    }
  }

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary credentials are not configured. Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  isConfigured = true;
  return cloudinary;
}

const ALLOWED_MIME_MAP = {
  // Images
  'image/jpeg': { ext: 'jpg', category: 'image', resourceType: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/jpg': { ext: 'jpg', category: 'image', resourceType: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/png': { ext: 'png', category: 'image', resourceType: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/webp': { ext: 'webp', category: 'image', resourceType: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/gif': { ext: 'gif', category: 'image', resourceType: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/avif': { ext: 'avif', category: 'image', resourceType: 'image', maxSizeBytes: 15 * 1024 * 1024 },
  'image/svg+xml': { ext: 'svg', category: 'image', resourceType: 'image', maxSizeBytes: 5 * 1024 * 1024 },

  // Videos
  'video/mp4': { ext: 'mp4', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },
  'video/quicktime': { ext: 'mov', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },
  'video/x-msvideo': { ext: 'avi', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },
  'video/x-matroska': { ext: 'mkv', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },
  'video/x-m4v': { ext: 'm4v', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },
  'video/3gpp': { ext: '3gp', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },
  'video/webm': { ext: 'webm', category: 'video', resourceType: 'video', maxSizeBytes: 100 * 1024 * 1024 },

  // Audio
  'audio/webm': { ext: 'webm', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/mpeg': { ext: 'mp3', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/mp3': { ext: 'mp3', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/wav': { ext: 'wav', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/x-wav': { ext: 'wav', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/wave': { ext: 'wav', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/m4a': { ext: 'm4a', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/x-m4a': { ext: 'm4a', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/mp4': { ext: 'm4a', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/ogg': { ext: 'ogg', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'application/ogg': { ext: 'ogg', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },
  'audio/aac': { ext: 'aac', category: 'audio', resourceType: 'video', maxSizeBytes: 25 * 1024 * 1024 },

  // Documents
  'application/pdf': { ext: 'pdf', category: 'document', resourceType: 'raw', maxSizeBytes: 25 * 1024 * 1024 },
  'application/msword': { ext: 'doc', category: 'document', resourceType: 'raw', maxSizeBytes: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', category: 'document', resourceType: 'raw', maxSizeBytes: 25 * 1024 * 1024 },
  'application/vnd.ms-excel': { ext: 'xls', category: 'document', resourceType: 'raw', maxSizeBytes: 25 * 1024 * 1024 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', category: 'document', resourceType: 'raw', maxSizeBytes: 25 * 1024 * 1024 },
  'text/csv': { ext: 'csv', category: 'document', resourceType: 'raw', maxSizeBytes: 10 * 1024 * 1024 },
  'text/plain': { ext: 'txt', category: 'document', resourceType: 'raw', maxSizeBytes: 10 * 1024 * 1024 }
};

const EXTENSION_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/m4a',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain'
};

function detectMagicBytes(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video/webm';
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).trim();
    if (brand === 'qt') return 'video/quicktime';
    if (brand === 'M4A') return 'audio/m4a';
    return 'video/mp4';
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.length >= 12) {
    const sub = buf.toString('ascii', 8, 12);
    if (sub === 'WEBP') return 'image/webp';
    if (sub === 'WAVE') return 'audio/wav';
    if (sub === 'AVI ') return 'video/x-msvideo';
  }
  if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';
  return null;
}

function getUploadPublicUrl(objectKey) {
  if (!objectKey) return '';
  if (objectKey.startsWith('http://') || objectKey.startsWith('https://')) return objectKey;
  const cleanKey = objectKey.replace(/^\/+/, '');
  const backendBase = process.env.BACKEND_URL || 'https://sub-admin-4pkg.onrender.com';
  return `${backendBase.replace(/\/+$/, '')}/uploads/${cleanKey}`;
}

function uploadBufferToCloudinary(client, buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

async function uploadFile(fileBufferOrPath, folder = 'subadmin_docs', filenameHint = 'document.pdf') {
  try {
    let buffer;
    let hint = filenameHint;
    let explicitMime = null;

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
          explicitMime = match[1].toLowerCase().trim();
          buffer = Buffer.from(match[2], 'base64');
          const extFromMime = ALLOWED_MIME_MAP[explicitMime]?.ext || 'pdf';
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
    let mimeType = explicitMime && ALLOWED_MIME_MAP[explicitMime]
      ? explicitMime
      : (EXTENSION_TO_MIME[ext] || 'application/octet-stream');

    const magicMime = detectMagicBytes(buffer);
    if (magicMime && ALLOWED_MIME_MAP[magicMime]) {
      // Preserve explicit audio/webm if container magic bytes report webm
      if (!(explicitMime === 'audio/webm' && magicMime === 'video/webm')) {
        mimeType = magicMime;
        ext = ALLOWED_MIME_MAP[magicMime].ext;
      }
    }

    const mimeConfig = ALLOWED_MIME_MAP[mimeType];
    if (!mimeConfig) {
      throw new Error(`File format '${mimeType}' is not supported.`);
    }

    if (buffer.length > mimeConfig.maxSizeBytes) {
      const maxMb = Math.round(mimeConfig.maxSizeBytes / (1024 * 1024));
      throw new Error(`Payload size exceeds maximum limit of ${maxMb} MB for ${mimeConfig.category}s.`);
    }

    const client = configureCloudinary();
    const rootFolder = (process.env.CLOUDINARY_UPLOAD_FOLDER || 'connect-backoffice').replace(/^\/+|\/+$/g, '');
    const safeSubfolder = String(folder || 'subadmin_docs')
      .split('/')
      .map(seg => seg.replace(/[^a-zA-Z0-9_-]/g, '_'))
      .filter(Boolean)
      .join('/');
    const cloudinaryFolder = safeSubfolder ? `${rootFolder}/${safeSubfolder}` : rootFolder;

    const randSuffix = crypto.randomBytes(8).toString('hex');
    const basePublicId = `${Date.now()}-${randSuffix}`;
    const publicId = mimeConfig.resourceType === 'raw' ? `${basePublicId}.${ext}` : basePublicId;

    const result = await uploadBufferToCloudinary(client, buffer, {
      folder: cloudinaryFolder,
      public_id: publicId,
      resource_type: mimeConfig.resourceType,
      overwrite: false
    });

    const secureUrl = result.secure_url || result.url;
    const objectKey = result.public_id;

    return {
      success: true,
      url: secureUrl,
      secure_url: secureUrl,
      key: objectKey,
      publicId: objectKey,
      resourceType: result.resource_type || mimeConfig.resourceType,
      category: mimeConfig.category,
      mimeType,
      extension: ext,
      size: result.bytes || buffer.length,
      toString() { return secureUrl; },
      [Symbol.toPrimitive]() { return secureUrl; }
    };
  } catch (err) {
    console.error('[Cloudinary Upload Error]:', err.message);
    throw new Error(`Failed to upload file to Cloudinary: ${err.message}`);
  }
}

module.exports = {
  uploadFile,
  getUploadPublicUrl,
  configureCloudinary
};
