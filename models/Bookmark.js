const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  animeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Anime',
    required: true
  }
}, { timestamps: true });

// Mencegah user mem-bookmark anime yang sama berkali-kali
bookmarkSchema.index({ userId: 1, animeId: 1 }, { unique: true });

module.exports = mongoose.model('Bookmark', bookmarkSchema);
