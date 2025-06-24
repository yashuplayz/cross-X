// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cloudinary = require('./cloudinary');
const multer = require('multer');
const streamifier = require('streamifier');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on('error', err => {
  console.error('MongoDB connection error:', err);
});
// log of successful connection
mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB successfully');
    });

// Utility to generate a random 4-5 digit room code
function generateRoomId() {
  return Math.floor(1000 + Math.random() * 90000).toString();
}

// Add expiresAt and roomId to schemas
const FIVE_MINUTES = 5 * 60 * 1000;

const TextSchema = new mongoose.Schema({
  text: String,
  roomId: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + FIVE_MINUTES) }
});
const Text = mongoose.model('Text', TextSchema);

const ImageSchema = new mongoose.Schema({
  filename: String,
  url: String,
  roomId: String,
  uploadedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + FIVE_MINUTES) }
});
const Image = mongoose.model('Image', ImageSchema);

// Room schema
const RoomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + FIVE_MINUTES) }
});
const Room = mongoose.model('Room', RoomSchema);

// Cleanup expired data every minute
setInterval(async () => {
  const now = new Date();
  // Remove expired text and images
  const expiredTexts = await Text.find({ expiresAt: { $lte: now } });
  const expiredImages = await Image.find({ expiresAt: { $lte: now } });
  const expiredRooms = await Room.find({ expiresAt: { $lte: now } });

  // Remove images from Cloudinary for expired images
  for (const img of expiredImages) {
    if (img.url && img.url.includes('cloudinary.com')) {
      // Extract public_id from URL
      const parts = img.url.split('/');
      const publicIdWithExt = parts[parts.length - 1];
      const publicId = publicIdWithExt.split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (e) { /* ignore */ }
    }
  }

  await Text.deleteMany({ expiresAt: { $lte: now } });
  await Image.deleteMany({ expiresAt: { $lte: now } });
  await Room.deleteMany({ expiresAt: { $lte: now } });
}, 60 * 1000);

// Remove disk storage, use memory storage for multer
const upload = multer({ storage: multer.memoryStorage() });

// Create a new room and return its unique ID
app.post('/api/create-room', async (req, res) => {
  let roomId;
  let exists = true;
  // Generate a truly unique roomId
  while (exists) {
    roomId = Math.random().toString(36).substring(2, 8);
    exists = await Room.exists({ roomId, expiresAt: { $gt: new Date() } });
  }
  const expiresAt = new Date(Date.now() + FIVE_MINUTES);
  await Room.create({ roomId, expiresAt });
  res.json({ roomId, url: `/room/${roomId}` });
});

// Validate room (check if exists and not expired)
app.get('/api/validate-room/:roomId', async (req, res) => {
  const { roomId } = req.params;
  const now = new Date();
  const room = await Room.findOne({ roomId, expiresAt: { $gt: now } });
  res.json({ valid: !!room, expiresAt: room ? room.expiresAt : null });
});

// Close room and delete all data (including Cloudinary images)
app.post('/api/close-room', async (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  await Room.deleteOne({ roomId });
  await Text.deleteMany({ roomId });
  const images = await Image.find({ roomId });
  for (const img of images) {
    if (img.url && img.url.includes('cloudinary.com')) {
      const parts = img.url.split('/');
      const publicIdWithExt = parts[parts.length - 1];
      const publicId = publicIdWithExt.split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (e) { /* ignore */ }
    }
  }
  await Image.deleteMany({ roomId });
  res.json({ success: true });
});

// Upload image (roomId required, Cloudinary)
app.post('/api/upload', upload.single('image'), requireActiveRoom(async (req, res) => {
  const { roomId } = req.body;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Upload to Cloudinary
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'cross-x', resource_type: 'image' },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
    });
  } catch (err) {
    return res.status(500).json({ error: 'Cloudinary upload failed' });
  }
  const url = result.secure_url;
  await Image.create({ filename: result.public_id, url, roomId });
  res.json({ url });
}));

// coudinary connection test endpoint
app.get('/api/test-cloudinary', async (req, res) => {
    try {
        const result = await cloudinary.api.ping();
       console.log('Cloudinary connection successful:', result);
        res.json({ success: true, message: 'Cloudinary connection successful' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Cloudinary connection failed', details: err.message });
    }
    });

// Get all images for a room
app.get('/api/images', requireActiveRoom(async (req, res) => {
  const { roomId } = req.query;
  const now = new Date();
  const images = await Image.find({ roomId, expiresAt: { $gt: now } }).sort({ uploadedAt: -1 });
  res.json(images.map(img => img.url));
}));

// Share text (roomId required)
app.post('/api/text', requireActiveRoom(async (req, res) => {
  const { text, roomId } = req.body;
  await Text.create({ text: text || '', roomId });
  res.json({ success: true });
}));

// Get latest shared text for a room
app.get('/api/text', requireActiveRoom(async (req, res) => {
  const { roomId } = req.query;
  const now = new Date();
  const latest = await Text.findOne({ roomId, expiresAt: { $gt: now } }).sort({ createdAt: -1 });
  res.json({ text: latest ? latest.text : '' });
}));

// Endpoint to force-delete all data for a room (used when creating a new room)
app.post('/api/clear-room', async (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  await Text.deleteMany({ roomId });
  const images = await Image.find({ roomId });
  for (const img of images) {
    if (img.url && img.url.includes('cloudinary.com')) {
      const parts = img.url.split('/');
      const publicIdWithExt = parts[parts.length - 1];
      const publicId = publicIdWithExt.split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (e) { /* ignore */ }
    }
  }
  await Image.deleteMany({ roomId });
  const now = new Date();
  await Text.deleteMany({ roomId, expiresAt: { $lte: now } });
  await Image.deleteMany({ roomId, expiresAt: { $lte: now } });
  res.json({ success: true });
});

// All endpoints that use roomId must check if the room is valid and not expired
function requireActiveRoom(handler) {
  return async (req, res) => {
    const roomId = req.body.roomId || req.query.roomId;
    const now = new Date();
    const room = await Room.findOne({ roomId, expiresAt: { $gt: now } });
    if (!room) return res.status(403).json({ error: 'Room not found or expired' });
    return handler(req, res);
  };
}

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
