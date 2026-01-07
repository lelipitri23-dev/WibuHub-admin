const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema({
  animeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Anime'
  },
  
  // Field tambahan agar nama Anime Induk muncul di list
  animeTitle: { type: String },
  animeSlug: { type: String },

  episodeSlug: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  title: { type: String, required: true },
  thumbnailUrl: { type: String },
  duration: { type: String, default: '24m' },

  // Array Server Streaming
  streaming: [{
    name: { type: String, required: true },
    url: { type: String, required: true },
    quality: { type: String, default: '720p' }
  }],

  // PERBAIKAN DI SINI: Ubah struktur downloads menjadi Nested (Quality -> Links)
  downloads: [{
    quality: { type: String, required: true }, // Misal: 720p, 480p
    links: [{
        host: { type: String, required: true }, // Misal: GDrive, Mega
        url: { type: String, required: true }
    }]
  }]
}, { timestamps: true });

module.exports = mongoose.model('Episode', episodeSchema);