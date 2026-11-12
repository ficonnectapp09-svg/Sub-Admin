const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadFile } = require('../config/storage');

// Configure memory storage for validated Cloudinary uploads (images, videos, audio, docs)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

router.use(authMiddleware);

async function handleUpload(req, res, folder) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const uploadResult = await uploadFile(req.file.buffer, folder, req.file.originalname);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: {
        name: req.file.originalname,
        key: uploadResult.key,
        url: uploadResult.url,
        secure_url: uploadResult.secure_url,
        resourceType: uploadResult.resourceType,
        category: uploadResult.category,
        size: req.file.size,
        type: req.file.mimetype
      }
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'File upload failed' });
  }
}

// POST /api/uploads/document — Upload document, image, audio, or video to Cloudinary
router.post('/document', memoryUpload.single('document'), (req, res) =>
  handleUpload(req, res, 'subadmin_docs')
);

// POST /api/uploads/media — Generic media upload endpoint (supports field name "file" or "media")
router.post('/media', memoryUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'media', maxCount: 1 }, { name: 'document', maxCount: 1 }]), (req, res) => {
  req.file = req.files?.file?.[0] || req.files?.media?.[0] || req.files?.document?.[0] || null;
  return handleUpload(req, res, 'media');
});

// POST /api/uploads/video — Video upload endpoint (supports field name "video" or "file")
router.post('/video', memoryUpload.fields([{ name: 'video', maxCount: 1 }, { name: 'file', maxCount: 1 }]), (req, res) => {
  req.file = req.files?.video?.[0] || req.files?.file?.[0] || null;
  return handleUpload(req, res, 'videos');
});

module.exports = router;
