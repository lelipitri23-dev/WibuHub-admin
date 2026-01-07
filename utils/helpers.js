// utils/helpers.js
const encodeAnimeSlugs = (list) => {
    if (!list) return [];
    return list.map(item => {
        // Pastikan imageUrl ada, jika tidak pakai placeholder
        let img = item.imageUrl;
        if (!img || img.trim() === '') {
             img = 'https://placehold.co/200x300?text=No+Image';
        }
        return { ...item, imageUrl: img };
    });
};

module.exports = { encodeAnimeSlugs };
