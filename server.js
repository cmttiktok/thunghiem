const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// --- CẤU HÌNH API GOOGLE (DÙNG V1BETA CHO GEMINI 1.5 FLASH) ---
const API_KEY = "AIzaSyBmx-XHU_fBySeZw74O2BLFT_UBPWRJHk8";
// LƯU Ý: Phải dùng v1beta thì model gemini-1.5-flash mới hoạt động
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

async function askGemini(userName, question) {
    try {
        const payload = {
            contents: [{
                parts: [{ text: `Bạn là trợ lý ảo hài hước của TikToker Chi Bèo. Trả lời ngắn dưới 15 từ. ${userName} hỏi: ${question}` }]
            }]
        };

        const response = await axios.post(GEMINI_URL, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.candidates && response.data.candidates[0].content) {
            return response.data.candidates[0].content.parts[0].text;
        }
    } catch (e) {
        console.error("LỖI API GOOGLE:", e.response ? JSON.stringify(e.response.data) : e.message);
        return "Dạ máy chủ AI đang bảo trì vùng miền, anh hỏi lại sau nhé!";
    }
    return "Dạ em nghe, anh nhắn gì thế ạ?";
}

// --- KẾT NỐI DATABASE ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- XỬ LÝ TEXT ---
async function isBanned(text) {
    if (!text) return false;
    const banned = await BannedWord.find();
    return banned.some(b => text.toLowerCase().includes(b.word));
}

async function processText(text) {
    if (!text || await isBanned(text)) return null;
    let processed = text;
    const emojis = await EmojiMap.find();
    for (const e of emojis) { processed = processed.split(e.icon).join(" " + e.text + " "); }
    const acronyms = await Acronym.find();
    for (const a of acronyms) {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    }
    return processed;
}

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let tiktok = null;

io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect()
            .then(() => socket.emit('status', `✅ Đã nối: ${username}`))
            .catch(err => socket.emit('status', `❌ Lỗi: ${err.message}`));

        tiktok.on('chat', async (data) => {
            if (await isBanned(data.nickname)) return;
            const commentLower = data.comment.toLowerCase();

            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword));

            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askGemini(data.nickname, data.comment);
                const audio = await getGoogleAudio(aiReply);
                socket.emit('audio-data', { type: 'bot', user: "GEMINI AI", comment: aiReply, audio });
            }
            else {
                const final = await processText(data.comment);
                if (final) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${final}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Chào anh ${data.nickname} vào xem live`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
