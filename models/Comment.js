const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  episodeId: {
    type: String, // Bisa String ID atau ObjectId, sesuaikan logic API
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Relasi ke tabel User
    required: true
  },
  content: {
    type: String,
    required: [true, 'Komentar tidak boleh kosong'],
    trim: true,
    maxlength: 500
  }
}, { timestamps: true });

module.exports = mongoose.model('Comment', commentSchema);
