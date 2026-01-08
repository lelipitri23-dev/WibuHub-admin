const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const NodeCache = require('node-cache');

// Import Helpers & Models
const { encodeAnimeSlugs, generateShortUrl } = require('../utils/helpers');
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const User = require('../models/User');
const Comment = require('../models/Comment');
const Bookmark = require('../models/Bookmark');

// Konfigurasi
const cache = new NodeCache({ stdTTL: 60 }); // Default Cache 1 Menit
const JWT_SECRET = 'rahasia_wibu_12345';

// ==========================================
// MIDDLEWARE
// ==========================================
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

router.put('/auth/update', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User tidak ditemukan' });

        if (req.body.username) {
            const userExists = await User.findOne({ username: req.body.username });
            if (userExists && userExists._id.toString() !== user._id.toString()) {
                return res.status(400).json({ message: 'Username sudah digunakan' });
            }
            user.username = req.body.username;
            user.avatar = `https://ui-avatars.com/api/?name=${req.body.username}&background=random`;
        }

        if (req.body.password) user.password = req.body.password;

        const updatedUser = await user.save();
        res.json({
            _id: updatedUser._id,
            username: updatedUser.username,
            avatar: updatedUser.avatar,
            token: req.headers.authorization.split(' ')[1]
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal update profile' });
    }
});

// ==========================================
// 2. EXPLORE & SEARCH ROUTES
// ==========================================

router.get('/home', async (req, res) => {
    try {
        const cachedData = cache.get('home_data');
        if (cachedData) return res.json(cachedData);

        const selectFields = 'title pageSlug imageUrl info.Status info.Rating info.Type';

        const [ongoing, ended, latest, episodes] = await Promise.all([
            Anime.find({ "info.Status": "Ongoing" }).select(selectFields).sort({ updatedAt: -1 }).limit(10).lean(),
            Anime.find({ "info.Status": { $in: ["Completed", "Ended", "Tamat"] } }).select(selectFields).sort({ updatedAt: -1 }).limit(10).lean(),
            Anime.find({}).select(selectFields).sort({ createdAt: -1 }).limit(9).lean(),
            Episode.find({}).sort({ createdAt: -1 }).limit(12).lean()
        ]);

        const responseData = {
            ongoingSeries: encodeAnimeSlugs(ongoing),
            endedSeries: encodeAnimeSlugs(ended),
            latestSeries: encodeAnimeSlugs(latest),
            episodes: episodes.map(ep => ({
                title: ep.title,
                episodeSlug: ep.episodeSlug,
                watchUrl: `/anime${ep.episodeSlug}`,
                imageUrl: ep.thumbnailUrl || 'https://placehold.co/300x169?text=EP',
                duration: ep.duration || '24m',
                animeTitle: ep.animeTitle || 'Episode Baru'
            }))
        };

        cache.set('home_data', responseData);
        res.json(responseData);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat home' });
    }
});

router.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json([]);

        const results = await Anime.find({ title: { $regex: query, $options: 'i' } })
            .select('title pageSlug imageUrl info.Rating')
            .limit(20).lean();

        res.json(encodeAnimeSlugs(results));
    } catch (error) {
        res.status(500).json({ message: 'Gagal mencari anime' });
    }
});

// ==========================================
// 3. ANIME & EPISODE ROUTES
// ==========================================

router.get('/anime/:slug', async (req, res) => {
    try {
        const anime = await Anime.findOne({ pageSlug: req.params.slug }).select('-episodes').lean();
        if (!anime) return res.status(404).json({ message: 'Anime tidak ditemukan' });

        const episodes = await Episode.find({ animeSlug: req.params.slug })
            .select('title episodeSlug createdAt').sort({ createdAt: -1 }).lean();

        let isBookmarked = false;
        if (req.headers.authorization) {
            try {
                const token = req.headers.authorization.split(' ')[1];
                const decoded = jwt.verify(token, JWT_SECRET);
                const check = await Bookmark.findOne({ userId: decoded.id, animeId: anime._id });
                if (check) isBookmarked = true;
            } catch (e) { }
        }

        res.json({
            ...anime,
            imageUrl: anime.imageUrl || '',
            episodes: episodes,
            isBookmarked
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get('/episode/:animeId/:episodeNum', async (req, res) => {
    try {
        const episodeSlug = `/${req.params.animeId}/${req.params.episodeNum}`;
        const episode = await Episode.findOne({ episodeSlug }).lean();

        if (!episode) return res.status(404).json({ message: 'Episode tidak ditemukan' });

        const allEps = await Episode.find({ animeSlug: req.params.animeId })
            .select('episodeSlug')
            .sort({ createdAt: 1 })
            .lean();

        const currentIndex = allEps.findIndex(e => e.episodeSlug === episodeSlug);
        const prevSlug = currentIndex > 0 ? allEps[currentIndex - 1].episodeSlug : null;
        const nextSlug = currentIndex < allEps.length - 1 ? allEps[currentIndex + 1].episodeSlug : null;

        // --- LOGIKA OTOMATISASI STREAMS ---
        const rawStreams = episode.streaming || episode.streams || [];

        const shortStreams = rawStreams.map(s => ({
            name: s.name,
            // Mengubah URL asli menjadi Short URL Embed
            // Kita gunakan ID episode agar route /embed/:id bisa memprosesnya
            url: generateShortUrl(episode._id),
            quality: s.quality || "720p",
            _id: s._id
        }));

        res.json({
            id: episode._id,
            title: episode.title,
            animeTitle: episode.animeTitle || '',
            imageUrl: episode.thumbnailUrl,
            streams: shortStreams, // Sekarang berisi URL pendek
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

router.get('/embed/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const episode = await Episode.findById(id).lean();

        if (!episode) {
            return res.status(404).send('Video tidak ditemukan');
        }

        // Mengambil URL video dari database
        const streams = episode.streaming || episode.streams || [];
        const videoUrl = streams.length > 0 ? streams[0].url : null;
        const animeTitle = episode.animeTitle || 'Nekoplayer';
        const posterImage = episode.thumbnailUrl || '/logo.jpg';

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${animeTitle}</title>
    <script src="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js"></script>
    <link rel="stylesheet" href="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.css" />
    <style>
        body {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background-color: #000;
            margin: 0;
            overflow: hidden;
        }
        .video-content {
            width: 100%;
            height: 100%;
        }
        video {
            width: 100%;
            height: 100%;
        }
    </style>
</head>
<body>
    <div class="video-content">
        <video id="video-player" controls preload="auto"></video>
    </div>

    <script>
        document.addEventListener("DOMContentLoaded", function() {
            const videoUrl = "${videoUrl}";
            
            if (!videoUrl || videoUrl === "null") {
                document.querySelector(".video-content").innerHTML = 
                    "<p style='color:white;text-align:center;padding-top:20%;'>No video source available.</p>";
                return;
            }

            const videoElement = document.getElementById("video-player");
            const source = document.createElement("source");
            source.src = videoUrl;
            source.type = "video/mp4";
            videoElement.appendChild(source);
            videoElement.load();

            fluidPlayer("video-player", {
                layoutControls: {
                    fillToContainer: true,
                    primaryColor: "#FF3366",
                    posterImage: "${posterImage}",
                    autoPlay: true,
                    mute: false,
                    allowTheatre: true,
                    playPauseAnimation: true,
                    playbackRateEnabled: true,
                    allowDownload: false,
                    controlBar: {
                        autoHide: true,
                        autoHideTimeout: 3,
                        animated: true
                    }
                },
                vastOptions: {
                    adList: [
                        {
                            roll: "preRoll",
                            vastTag: "https://vast.yomeno.xyz/vast?spot_id=1450907",
                            adText: "Advertisement",
                            adTextPosition: "top right",
                            skipButtonCaption: "Skip Ad",
                            skipButtonClickCaption: "You can skip in [countdown]",
                            countdownMessage: "Ad - [countdown]",
                            showSkipButton: true,
                            skipOffset: 5,
                        },
                    ],
                    adCTAText: "Visit sponsor",
                    adCTATextPosition: "bottom right",
                    vastTimeout: 5000,
                    showPlayPauseButton: true,
                },
            });
        });
    </script>
</body>
</html>
        `);
    } catch (error) {
        res.status(500).send('Server Error');
    }
});

// ==========================================
// 4. USER FEATURES (Comments, Bookmarks)
// ==========================================

router.get('/comments/:episodeId', async (req, res) => {
    try {
        const comments = await Comment.find({ episodeId: req.params.episodeId })
            .populate('user', 'username avatar').sort({ createdAt: -1 }).limit(50);
        res.json(comments);
    } catch (error) {
        res.status(500).json({ message: 'Gagal load komentar' });
    }
});

router.post('/comments', protect, async (req, res) => {
    const { episodeId, content } = req.body;
    try {
        if (!content) return res.status(400).json({ message: 'Komentar kosong' });
        const newComment = await Comment.create({ episodeId, user: req.user._id, content });
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
            .populate({ path: 'animeId', select: 'title pageSlug imageUrl info.Status info.Rating' })
            .sort({ createdAt: -1 }).lean();

        const animeList = bookmarks.filter(b => b.animeId != null).map(b => b.animeId);
        res.json(encodeAnimeSlugs(animeList));
    } catch (error) {
        res.status(500).json({ message: 'Gagal load library' });
    }
});

router.delete('/library', protect, async (req, res) => {
    try {
        await Bookmark.deleteMany({ userId: req.user._id });
        res.json({ message: 'Library berhasil dikosongkan', status: true });
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengosongkan library' });
    }
});

// ==========================================
// 5. META DATA & SETTINGS
// ==========================================

router.get('/genres', async (req, res) => {
    try {
        const cachedGenres = cache.get('genres_list');
        if (cachedGenres) return res.json(cachedGenres);

        const genres = await Anime.distinct('genres');
        const cleanGenres = genres.filter(g => g && g.trim() !== '').sort();

        cache.set('genres_list', cleanGenres, 3600 * 24);
        res.json(cleanGenres);
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat genre' });
    }
});

router.get('/anime/genre/:name', async (req, res) => {
    try {
        const animes = await Anime.find({ genres: { $regex: new RegExp(`^${req.params.name}$`, 'i') } })
            .select('title pageSlug imageUrl info.Rating info.Type').sort({ updatedAt: -1 }).limit(50).lean();
        res.json(encodeAnimeSlugs(animes));
    } catch (error) {
        res.status(500).json({ message: 'Gagal memuat data genre' });
    }
});

router.get('/schedule', async (req, res) => {
    try {
        const cachedSchedule = cache.get('schedule');
        if (cachedSchedule) return res.json(cachedSchedule);

        const data = await Anime.find({ "info.Status": "Ongoing" })
            .select('title pageSlug imageUrl info.Released info.status info.Rating info.Type')
            .limit(20).lean();

        const result = { data: encodeAnimeSlugs(data) };
        cache.set('schedule', result, 600);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Error jadwal' });
    }
});

router.get('/version', (req, res) => {
    res.json({
        version: "1.0.0",
        url: "https://dl.dropboxusercontent.com/s/...",
        forceUpdate: false,
        message: "Update baru tersedia! Yuk update sekarang."
    });
});

module.exports = router;