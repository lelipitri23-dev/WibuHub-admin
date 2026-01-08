// utils/helpers.js
const encodeAnimeSlugs = (list) => {
    if (!list) return [];
    return list.map(item => {
        let img = item.imageUrl;
        if (!img || img.trim() === '') {
             img = 'https://placehold.co/200x300?text=No+Image';
        }
        return { 
            ...item, 
            imageUrl: img,
            rating: item.info ? item.info.Rating : (item.rating || '0'),
            type: item.info ? item.info.Type : (item.type || 'TV')
        };
    });
};

const generateShortUrl = (id) => {
    return `https://app.wibuhub.qzz.io/api/v1/embed/${id}`;
};

module.exports = { encodeAnimeSlugs, generateShortUrl };