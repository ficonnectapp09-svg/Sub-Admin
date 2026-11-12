const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const { uploadFile } = require('../config/storage');

// Configure memory storage for validated file uploads
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

router.use(authMiddleware);

// POST /api/uploads/document — Upload document to local storage
router.post('/document', memoryUpload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const uploadResult = await uploadFile(req.file.buffer, 'subadmin_docs', req.file.originalname);

    res.json({
      success: true,
      message: 'File uploaded successfully',
      file: {
        name: req.file.originalname,
        key: uploadResult.key,
        url: uploadResult.url,
        secure_url: uploadResult.secure_url,
        size: req.file.size,
        type: req.file.mimetype
      }
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'File upload failed' });
  }
});

module.exports = router;
