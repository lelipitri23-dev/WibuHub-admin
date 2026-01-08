const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const NodeCache = require('node-cache');

// Setup Cache (TTL 5 menit)
const cache = new NodeCache({ stdTTL: 60 });

// Import Models
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Bookmark = require('../models/Bookmark');

const JWT_SECRET = 'rahasia_wibu_12345';

// --- HELPER FUNCTIONS ---
const encodeAnimeSlugs = (list) => {
    return list.map(item => ({
        ...item,
        imageUrl: item.imageUrl || 'https://placehold.co/200x300?text=No+Image',
        // Pastikan field penting ada untuk frontend
        rating: item.info ? item.info.Rating : '0',
        type: item.info ? item.info.Type : 'TV'
    }));
};

// --- MIDDLEWARE AUTH ---
const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            next();
        } catch (error) {
            res.status(401).json({ message: 'Token tidak valid' });
        }
    } else {
        res.status(401).json({ message: 'Tidak ada token' });
    }
};

// ==========================================
// 1. AUTH ROUTES
// ==========================================

router.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userExists = await User.findOne({ username });
        if (userExists) return res.status(400).json({ message: 'Username sudah dipakai' });

        const user = await User.create({ 
            username, 
            password,
            avatar: `https://ui-avatars.com/api/?name=${username}&background=random`
        });

        if (user) res.status(201).json({ message: 'User berhasil dibuat' });
        else res.status(400).json({ message: 'Data user tidak valid' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (user && (await user.matchPassword(password))) {
            const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
            res.json({
                token,
                user: { id: user._id, username: user.username, avatar: user.avatar }
            });
        } else {
            res.status(401).json({ message: 'Username atau Password salah' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- TAMBAHKAN DI api_v1.js (Bagian Auth Routes) ---

router.put('/auth/update', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (user) {
            // Update Username
            if (req.body.username) {
                // Cek jika username sudah dipakai orang lain
                const userExists = await User.findOne({ username: req.body.username });
                if (userExists && userExists._id.toString() !== user._id.toString()) {
                    return res.status(400).json({ message: 'Username sudah digunakan' });
                }
                user.username = req.body.username;
                // Update avatar sesuai username baru
                user.avatar = `https://ui-avatars.com/api/?name=${req.body.username}&background=random`;
            }

            // Update Password (Jika diisi)
            if (req.body.password) {
                user.password = req.body.password;
            }

            // Simpan (Mongoose akan otomatis hash password jika ada pre-save hook)
            const updatedUser = await user.save();

            // Return token baru & data user baru
            res.json({
                _id: updatedUser._id,
                username: updatedUser.username,
                avatar: updatedUser.avatar,
                token: req.headers.authorization.split(' ')[1] // Gunakan token lama (masih valid)
            });
        } else {
            res.status(404).json({ message: 'User tidak ditemukan' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Gagal update profile' });
    }
});

// ==========================================
// 2. HOME ROUTES (Optimized & Cached)
// ==========================================

router.get('/home', async (req, res) => {
    try {
        // Cek Cache dulu
        const cachedData = cache.get('home_data');
        if (cachedData) {
            return res.json(cachedData);
        }

        // Field yang perlu diambil saja (Hemat Bandwidth)
        const selectFields = 'title pageSlug imageUrl info.Status info.Rating info.Type';

        const [ongoing, ended, latest, episodes] = await Promise.all([
            // 1. Ongoing
            Anime.find({ "info.Status": "Ongoing" })
                .select(selectFields)
                .sort({ updatedAt: -1 }).limit(10).lean(),
            
            // 2. Ended
            Anime.find({ "info.Status": { $in: ["Completed", "Ended", "Tamat"] } })
                .select(selectFields)
                .sort({ updatedAt: -1 }).limit(10).lean(),
            
            // 3. Latest Series
            Anime.find({})
                .select(selectFields)
                .sort({ createdAt: -1 }).limit(9).lean(),
            
            // 4. Latest Episodes (Perlu join ke Anime untuk dapat gambar poster jika thumbnail kosong)
            Episode.find({})
                .sort({ createdAt: -1 }).limit(12).lean()
        ]);

        const responseData = {
            ongoingSeries: encodeAnimeSlugs(ongoing),
            endedSeries: encodeAnimeSlugs(ended),
            latestSeries: encodeAnimeSlugs(latest),
            episodes: episodes.map(ep => ({
                title: ep.title,
                episodeSlug: ep.episodeSlug,
                watchUrl: `/anime${ep.episodeSlug}`,
                // Prioritaskan Thumbnail, kalau tidak ada pakai Poster Anime (jika ada), kalau tidak ada pakai placeholder
                imageUrl: ep.thumbnailUrl || 'https://placehold.co/300x169?text=EP', 
                duration: ep.duration || '24m',
                animeTitle: ep.animeTitle || 'Episode Baru'
            }))
        };

        // Simpan ke Cache selama 5 menit
        cache.set('home_data', responseData);

        res.json(responseData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Gagal memuat home' });
    }
});

// --- TAMBAHKAN DI api_v1.js ---

// Endpoint Cek Versi Aplikasi
router.get('/version', (req, res) => {
    // Anda bisa load dari file json atau hardcode di sini
    const appVersion = {
        version: "1.0.0", // Ganti manual saat rilis versi baru
        url: "https://dl.dropboxusercontent.com/s/...", // Link download APK langsung
        forceUpdate: false, // Ubah true jika update bersifat wajib (misal ada perubahan API)
        message: "Update baru tersedia! Yuk update sekarang."
    };
    
    res.json(appVersion);
});

// Fitur Search (Belum ada sebelumnya)
// --- TAMBAHKAN DI api_v1.js ---

// Endpoint Search
router.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json([]);

        // Cari anime yang judulnya mengandung kata kunci (case-insensitive)
        const results = await Anime.find({
            title: { $regex: query, $options: 'i' }
        })
        .select('title pageSlug imageUrl info.Rating') // Ambil field seperlunya
        .limit(20) // Batasi hasil biar ringan
        .lean();

        res.json(encodeAnimeSlugs(results));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Gagal mencari anime' });
    }
});

// ==========================================
// 3. ANIME & EPISODE DETAIL (Integrated)
// ==========================================

router.get('/anime/:slug', async (req, res) => {
    try {
        // Ambil Data Anime (Tanpa Episodes Array bawaan, biar ringan)
        const anime = await Anime.findOne({ pageSlug: req.params.slug })
            .select('-episodes') // Exclude array episodes lama yang sering tidak sync
            .lean();
            
        if (!anime) return res.status(404).json({ message: 'Anime tidak ditemukan' });

        // INTEGRASI: Ambil Episode langsung dari Collection Episode
        // Ini memastikan episode yang baru ditambah di Admin langsung muncul
        const episodes = await Episode.find({ animeSlug: req.params.slug })
            .select('title episodeSlug createdAt')
            .sort({ createdAt: -1 }) // Urutkan dari yang terbaru
            .lean();

        // Cek Bookmark
        let isBookmarked = false;
        if (req.headers.authorization) {
            try {
                const token = req.headers.authorization.split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                const check = await Bookmark.findOne({ userId: decoded.id, animeId: anime._id });
                if (check) isBookmarked = true;
            } catch (e) {}
        }

        res.json({ 
            ...anime, 
            imageUrl: anime.imageUrl || '',
            episodes: episodes, // Gunakan list episode yang real-time
            isBookmarked 
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/episode/:animeId/:episodeNum', async (req, res) => {
    try {
        // Construct slug manual untuk kompatibilitas frontend lama
        const episodeSlug = `/${req.params.animeId}/${req.params.episodeNum}`;
        
        // Cari episode
        const episode = await Episode.findOne({ episodeSlug }).lean();
        if (!episode) return res.status(404).json({ message: 'Episode tidak ditemukan' });

        // Ambil Next & Prev Episode Logic (Opsional, tapi bagus untuk UX)
        // Kita cari episode lain dengan animeSlug yang sama
        const allEps = await Episode.find({ animeSlug: req.params.animeId })
            .select('episodeSlug')
            .sort({ createdAt: 1 }) // Urutkan terlama ke terbaru
            .lean();
            
        const currentIndex = allEps.findIndex(e => e.episodeSlug === episodeSlug);
        const prevSlug = currentIndex > 0 ? allEps[currentIndex - 1].episodeSlug : null;
        const nextSlug = currentIndex < allEps.length - 1 ? allEps[currentIndex + 1].episodeSlug : null;

        res.json({
            id: episode._id,
            title: episode.title,
            animeTitle: episode.animeTitle || '',
            imageUrl: episode.thumbnailUrl,
            streams: episode.streaming || [],
            // Support struktur download baru (Nested)
            downloads: episode.downloads || [], 
            nav: {
                prev: prevSlug,
                next: nextSlug
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==========================================
// 4. FITUR USER (Komentar, Bookmark, Library)
// ==========================================

router.get('/comments/:episodeId', async (req, res) => {
    try {
        const comments = await Comment.find({ episodeId: req.params.episodeId })
            .populate('user', 'username avatar')
            .sort({ createdAt: -1 })
            .limit(50); // Batasi 50 komentar agar tidak berat
        res.json(comments);
    } catch (error) {
        res.status(500).json({ message: 'Gagal load komentar' });
    }
});

router.post('/comments', protect, async (req, res) => {
    const { episodeId, content } = req.body;
    try {
        if(!content) return res.status(400).json({message: 'Komentar kosong'});
        
        const newComment = await Comment.create({
            episodeId,
            user: req.user._id,
            content
        });
        
        const fullComment = await Comment.findById(newComment._id).populate('user', 'username avatar');
        res.status(201).json(fullComment);
    } catch (error) {
        res.status(500).json({ message: 'Gagal kirim komentar' });
    }
});

router.post('/bookmark', protect, async (req, res) => {
    const { animeId } = req.body;
    try {
        const exists = await Bookmark.findOne({ userId: req.user._id, animeId });
        if (exists) {
            await Bookmark.findByIdAndDelete(exists._id);
            res.json({ message: 'Dihapus dari Library', status: false });
        } else {
            await Bookmark.create({ userId: req.user._id, animeId });
            res.json({ message: 'Ditambahkan ke Library', status: true });
        }
    } catch (error) {
        res.status(500).json({ message: 'Gagal bookmark' });
    }
});

router.get('/library', protect, async (req, res) => {
    try {
        const bookmarks = await Bookmark.find({ userId: req.user._id })
            .populate({
                path: 'animeId',
                select: 'title pageSlug imageUrl info.Status info.Rating' 
            }) 
            .sort({ createdAt: -1 })
            .lean(); // <--- TAMBAHKAN INI (PENTING!)

        const animeList = bookmarks
            .filter(b => b.animeId != null)
            .map(b => b.animeId);

        res.json(encodeAnimeSlugs(animeList));
    } catch (error) {
        res.status(500).json({ message: 'Gagal load library' });
    }
});

// --- TAMBAHKAN DI api_v1.js ---

router.delete('/library', protect, async (req, res) => {
    try {
        // Hapus semua bookmark yang memiliki userId dari user yang login
        await Bookmark.deleteMany({ userId: req.user._id });
        res.json({ message: 'Library berhasil dikosongkan', status: true });
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengosongkan library' });
    }
});

// --- TAMBAHKAN DI api_v1.js (di bawah route home atau anime) ---

router.get('/episodes', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 24;
        const skip = (page - 1) * limit;

        const episodes = await Episode.find({})
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        // Format data agar sama dengan struktur Episode di Flutter
        const formatted = episodes.map(ep => ({
            title: ep.title,
            episodeSlug: ep.episodeSlug,
            // Prioritaskan thumbnail, fallback ke placeholder
            imageUrl: ep.thumbnailUrl || 'https://placehold.co/300x169?text=EP',
            animeTitle: ep.animeTitle || 'Episode Baru'
        }));

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat episode' });
    }
});

router.get('/schedule', async (req, res) => {
    try {
        // Cache jadwal juga 
        const cachedSchedule = cache.get('schedule');
        if(cachedSchedule) return res.json(cachedSchedule);

        const data = await Anime.find({ "info.Status": "Ongoing" })
            .select('title pageSlug imageUrl info.Released info.status info.Rating info.Type')
            .limit(20).lean();
        
        const result = { data: encodeAnimeSlugs(data) };
        cache.set('schedule', result, 600); // Cache 10 menit
        
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error jadwal' });
    }
});


// --- TAMBAHKAN INI DI api_v1.js ---

router.get('/genres', async (req, res) => {
    try {
        // Cek cache dulu (Genre jarang berubah, cache lama tidak masalah)
        const cachedGenres = cache.get('genres_list');
        if (cachedGenres) return res.json(cachedGenres);

        // Ambil semua genre unik dari database
        // Asumsi field di MongoDB bernama 'genres' dan bertipe Array
        const genres = await Anime.distinct('genres');
        
        // Filter data kosong dan urutkan abjad A-Z
        const cleanGenres = genres
            .filter(g => g && typeof g === 'string' && g.trim() !== '')
            .sort();

        // Simpan ke cache selama 24 jam
        cache.set('genres_list', cleanGenres, 3600 * 24); 

        res.json(cleanGenres);
    } catch (error) {
        console.error("Genre Error:", error);
        res.status(500).json({ message: 'Gagal memuat genre' });
    }
});


// --- TAMBAHKAN DI api_v1.js ---

// Get Anime by Genre
router.get('/anime/genre/:name', async (req, res) => {
    try {
        const { name } = req.params;
        
        // Cari anime yang di dalam array 'genres'-nya mengandung nama genre tersebut
        // Gunakan regex 'i' agar tidak sensitif huruf besar/kecil (Action == action)
        const animes = await Anime.find({ 
            genres: { $regex: new RegExp(`^${name}$`, 'i') } 
        })
        .select('title pageSlug imageUrl info.Rating info.Type')
        .sort({ updatedAt: -1 })
        .limit(50) // Batasi 50 agar tidak berat
        .lean();

        res.json(encodeAnimeSlugs(animes));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Gagal memuat data genre' });
    }
});

module.exports = router;