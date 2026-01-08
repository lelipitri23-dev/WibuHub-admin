const express = require('express');
const router = express.Router();
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

// --- KONFIGURASI UPLOAD ---
// Gunakan memoryStorage agar file masuk ke Buffer RAM dulu sebelum ke R2
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Batas file 5MB
});

// --- KONFIGURASI R2 CLIENT ---
const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// Helper Function: Upload ke R2
async function uploadToR2(file) {
    const fileExtension = path.extname(file.originalname);
    const fileName = `posters/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExtension}`;

    const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read'
    });

    await s3Client.send(command);
    
    // Kembalikan URL Publik
    return `${process.env.R2_PUBLIC_DOMAIN}/${fileName}`;
}

const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Report = require('../models/Report');
const User = require('../models/User');
const Bookmark = require('../models/Bookmark');

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

const requireAuth = (req, res, next) => {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/admin/login');
};

// --- AUTH ROUTES ---
router.get('/login', (req, res) => res.render('admin/login', { pageTitle: 'Login', error: null }));
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('admin/login', { pageTitle: 'Login', error: 'Salah bos!' });
    }
});
router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// --- DASHBOARD ---
router.get('/', requireAuth, async (req, res) => {
    res.render('admin/dashboard', {
        page: 'dashboard',
        totalAnime: await Anime.countDocuments(),
        totalEpisodes: await Episode.countDocuments(),
        totalUsers: await User.countDocuments()
    });
});

// --- ANIME ROUTES ---
router.get('/anime', requireAuth, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    let query = search ? { title: { $regex: search, $options: 'i' } } : {};
    const animes = await Anime.find(query).sort({ updatedAt: -1 }).skip((page - 1) * 20).limit(20);
    const count = await Anime.countDocuments(query);
    res.render('admin/anime-list', { page: 'anime', animes, currentPage: page, totalPages: Math.ceil(count / 20), baseUrl: '/admin/anime', searchQuery: search });
});

router.get('/anime/add', requireAuth, (req, res) => res.render('admin/add-anime', { page: 'anime' }));

// POST ADD ANIME (Dengan Upload)
router.post('/anime/add', requireAuth, upload.single('imageUpload'), async (req, res) => {
    try {
        let finalImageUrl = req.body.imageUrl; // Default ambil dari text input

        // Jika ada file yang diupload, upload ke R2 dan timpa finalImageUrl
        if (req.file) {
            console.log("Mengupload gambar ke R2...");
            finalImageUrl = await uploadToR2(req.file);
        }

        const data = {
            title: req.body.title, 
            pageSlug: req.body.pageSlug, 
            imageUrl: finalImageUrl, 
            synopsis: req.body.synopsis,
            info: { 
                Alternatif: req.body['info.Alternatif'], 
                Type: req.body['info.Type'], 
                Status: req.body['info.Status'], 
                Studios: req.body['info.Studios'], 
                Produser: req.body['info.Produser'], 
                Released: req.body['info.Released'],
                Studio: req.body['info.Studio'],
                Rating: req.body['info.Rating']
            },
            genres: req.body.genres ? req.body.genres.split(',') : []
        };
        await Anime.create(data);
        res.redirect('/admin/anime');
    } catch (error) {
        console.error("Gagal menambah anime:", error);
        res.status(500).send("Terjadi kesalahan saat upload atau save: " + error.message);
    }
});

router.get('/anime/:slug/edit', requireAuth, async (req, res) => {
    const anime = await Anime.findOne({ pageSlug: req.params.slug });
    
    // --- GANTI LOGIKA PENGAMBILAN EPISODE MENJADI SEPERTI INI ---
    // Kita selalu ambil dari collection Episode agar data selalu fresh & slug-nya benar
    const eps = await Episode.find({ animeSlug: req.params.slug }).sort({ createdAt: -1 });
    
    // Timpa properti episodes di object anime (hanya untuk render, tidak save ke DB)
    anime.episodes = eps; 
    
    res.render('admin/edit-anime', { page: 'anime', anime });
});

// POST EDIT ANIME (Dengan Upload)
router.post('/anime/:slug/edit', requireAuth, upload.single('imageUpload'), async (req, res) => {
    try {
        let updateData = {
            title: req.body.title, 
            // imageUrl: req.body.imageUrl, // Kita set logikanya di bawah
            synopsis: req.body.synopsis,
            'info.Status': req.body['info.Status'], 
            'info.Type': req.body['info.Type'], 
            'info.Alternatif': req.body['info.Alternatif'],
            'info.Released': req.body['info.Released'],
            'info.Produser': req.body['info.Produser'], 
            'info.Studio': req.body['info.Studio'], 
            'info.Rating': req.body['info.Rating'],
            genres: req.body.genres ? req.body.genres.split(',') : []
        };
        
        if (req.file) {
            console.log("Mengupload gambar baru ke R2...");
            updateData.imageUrl = await uploadToR2(req.file);
        } else if (req.body.imageUrl && req.body.imageUrl.trim() !== "") {
            updateData.imageUrl = req.body.imageUrl;
        }

        await Anime.findOneAndUpdate({ pageSlug: req.params.slug }, updateData);
        res.redirect('back');
    } catch (error) {
        console.error("Gagal edit anime:", error);
        res.status(500).send("Terjadi kesalahan saat upload atau update: " + error.message);
    }
});

router.post('/anime/:slug/delete', requireAuth, async (req, res) => {
    await Anime.findOneAndDelete({ pageSlug: req.params.slug });
    await Episode.deleteMany({ animeSlug: req.params.slug });
    res.redirect('/admin/anime');
});

// --- EPISODE ROUTES ---
router.get('/episodes', requireAuth, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const eps = await Episode.find().sort({ updatedAt: -1 }).skip((page - 1) * 20).limit(20);
    const count = await Episode.countDocuments();
    res.render('admin/episode-list', { page: 'episodes', episodes: eps, currentPage: page, totalPages: Math.ceil(count / 20), baseUrl: '/admin/episodes' });
});

router.post('/anime/:slug/episodes/add', requireAuth, async (req, res) => {
    try {
        const anime = await Anime.findOne({ pageSlug: req.params.slug });
        if (!anime) return res.status(404).send('Anime tidak ditemukan');

        const fullSlug = `/${req.params.slug}/${req.body.episodeSlug}`;
        
        // Simpan Episode ke Collection 'Episodes'
        await Episode.create({
            title: req.body.episodeTitle, 
            episodeSlug: fullSlug, 
            
            // --- DATA ANIME INDUK (PENTING) ---
            animeId: anime._id,       // ID untuk relasi database
            animeTitle: anime.title,  // Judul untuk ditampilkan di list
            animeSlug: req.params.slug, // Slug untuk link kembali
            // ----------------------------------
            
            thumbnailUrl: anime.imageUrl
        });

        // Update juga di Array Episodes milik Anime (untuk cache)
        await Anime.findOneAndUpdate(
            { pageSlug: req.params.slug }, 
            { $push: { episodes: { title: req.body.episodeTitle, episodeSlug: fullSlug } } }
        );
        
        res.redirect('back');
    } catch (error) {
        console.error(error);
        res.status(500).send('Gagal menambah episode: ' + error.message);
    }
});

router.get('/episode/:slugA/:slugB/edit', requireAuth, async (req, res) => {
    const ep = await Episode.findOne({ episodeSlug: `/${req.params.slugA}/${req.params.slugB}` });
    res.render('admin/edit-episode', { page: 'episodes', episode: ep });
});

router.post('/episode/:slugA/:slugB/edit', requireAuth, async (req, res) => {
    await Episode.findOneAndUpdate({ episodeSlug: `/${req.params.slugA}/${req.params.slugB}` }, {
        title: req.body.title, streaming: req.body.streams || [], downloads: req.body.downloads || []
    });
    res.redirect('back');
});

router.post('/episode/:slugA/:slugB/delete', requireAuth, async (req, res) => {
    await Episode.findOneAndDelete({ episodeSlug: `/${req.params.slugA}/${req.params.slugB}` });
    res.redirect('/admin/episodes');
});

// --- OTHER ROUTES ---
router.get('/reports', requireAuth, async (req, res) => {
    const reports = await Report.find().populate('user').sort({ createdAt: -1 });
    res.render('admin/reports', { page: 'reports', reports, SITE_URL: '' });
});

router.post('/report/delete/:id', requireAuth, async (req, res) => {
    await Report.findByIdAndDelete(req.params.id);
    res.redirect('/admin/reports');
});

// Pastikan Model User di-import jika belum
// const User = require('../models/User'); 

router.get('/backup', requireAuth, (req, res) => res.render('admin/backup', { page: 'backup' }));

router.get('/backup/export', requireAuth, async (req, res) => {
    try {
        // Mengambil semua data dari database
        // Menambahkan User karena terlihat ada di file backup Anda
        const collections = {
            users: await User.find(),
            animes: await Anime.find(),
            episodes: await Episode.find(),
            bookmarks: await Bookmark.find()
        };

        // Membungkus dengan metadata tanggal export agar sesuai format file
        const data = {
            exportedAt: new Date().toISOString(),
            collections: collections
        };

        const fileName = `backup_nekopoi_${new Date().toISOString().split('T')[0]}.json`;
        res.attachment(fileName);
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Export Error:", error);
        res.status(500).send("Gagal Export: " + error.message);
    }
});

router.post('/backup/import', requireAuth, upload.single('backupFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send("Tidak ada file yang diupload.");
        }

        const fileContent = req.file.buffer.toString('utf-8');
        let parsedData;
        
        try {
            parsedData = JSON.parse(fileContent);
        } catch (e) {
            return res.status(400).send("File rusak atau bukan JSON yang valid.");
        }

        // MENANGANI STRUKTUR FILE:
        // Cek apakah data ada di dalam properti 'collections' (format baru) atau langsung di root (format lama)
        const data = parsedData.collections || parsedData;

        // Validasi kelengkapan data sebelum menghapus database
        if (!data.animes && !data.episodes && !data.users) {
            return res.status(400).send("Format file backup tidak valid atau data kosong.");
        }

        // PROSES RESTORE:
        // Hapus data lama dan masukkan data baru.
        // Urutan delete -> insert penting untuk menghindari duplikasi key error.
        
        // 1. Users
        if (data.users && data.users.length > 0) {
            await User.deleteMany({});
            await User.insertMany(data.users);
        }

        // 2. Animes
        if (data.animes && data.animes.length > 0) {
            await Anime.deleteMany({});
            await Anime.insertMany(data.animes);
        }

        // 3. Episodes
        if (data.episodes && data.episodes.length > 0) {
            await Episode.deleteMany({});
            await Episode.insertMany(data.episodes);
        }

        // 4. Bookmarks
        if (data.bookmarks && data.bookmarks.length > 0) {
            await Bookmark.deleteMany({});
            await Bookmark.insertMany(data.bookmarks);
        }
        
        res.send("Restore Success! Data berhasil dipulihkan. <br><a href='/admin'>Kembali ke Admin</a>");

    } catch (error) {
        console.error("Import Error:", error);
        res.status(500).send("Gagal Restore: " + error.message);
    }
});

router.get('/batch-upload', requireAuth, (req, res) => {
    res.render('admin/batch-upload', { page: 'batch' });
});

module.exports = router;