// Cloudinary configuration for image uploads
// 1. Sign up at https://cloudinary.com/ (free tier is enough)
// 2. Get your CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// 3. Add these to your .env file (do NOT commit .env to git)
//
// CLOUDINARY_CLOUD_NAME=your_cloud_name
// CLOUDINARY_API_KEY=your_api_key
// CLOUDINARY_API_SECRET=your_api_secret
//
// This file exports a configured cloudinary instance for use in your backend.

const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Check if the configuration is correct

module.exports = cloudinary;
