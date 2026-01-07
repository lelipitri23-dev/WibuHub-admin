require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const path = require('path');

// Import Routes
const apiRoutes = require('./routes/api_v1');
const adminRoutes = require('./routes/admin');

const app = express();

// --- MIDDLEWARE ---
app.use(cors()); // Izinkan akses dari Flutter/Web lain
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Wajib true untuk form EJS
app.use(express.static(path.join(__dirname, 'public')));

// Setup View Engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Setup Session (Untuk Admin Login)
app.use(session({
  secret: process.env.SESSION_SECRET || 'rahasia_admin_ganteng',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 hari
}));

// --- DATABASE ---
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
      .then(() => console.log("✅ MongoDB Connected"))
      .catch(err => console.error("❌ MongoDB Error:", err));
} else {
    console.warn("⚠️ Peringatan: MONGODB_URI belum diset.");
}

// --- ROUTING ---
app.use('/api/v1', apiRoutes); // API Mobile
app.use('/admin', adminRoutes); // Admin Panel

// Redirect root ke admin
app.get('/', (req, res) => res.redirect('/admin'));

// --- SERVER LISTENER (Vercel Compatible) ---
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running locally on port ${PORT}`));
}

module.exports = app;
