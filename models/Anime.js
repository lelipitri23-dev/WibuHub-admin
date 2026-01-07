const mongoose = require('mongoose');

const animeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    index: true
  },
  pageSlug: {
    type: String,
    required: true,
    unique: true
  },
  imageUrl: {
    type: String,
    default: 'https://placehold.co/200x300?text=No+Image'
  },
  synopsis: {
    type: String,
    default: 'Belum ada sinopsis.'
  },
  
  // Object Info Detail
  info: {
    Status: { type: String, default: 'Unknown' },
    Type: { type: String, default: 'TV' },
    Rating: { type: String, default: '0' },
    Released: { type: String, default: '' },
    Studio: { type: String, default: '' },
    Produser: { type: String, default: '' }, // <-- TAMBAHKAN INI
    Alternatif: { type: String, default: '' } // <-- TAMBAHKAN INI JUGA BIAR AMAN
  },

  genres: [String],

  episodes: [{
    title: String,
    episodeSlug: String,
    date: String
  }]
}, { timestamps: true });

animeSchema.index({ title: 'text' });

module.exports = mongoose.model('Anime', animeSchema);