const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg',
    '.mp4', '.mov', '.avi', '.mkv', '.m4v', '.3gp', '.webm',
    '.wav', '.mp3', '.m4a', '.ogg', '.aac',
    '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type: ' + ext));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for image, video, audio & doc uploads
  fileFilter
});

module.exports = upload;
