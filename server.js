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

// --- CẤU HÌNH GOOGLE AI (GỌI TRỰC TIẾP QUA AXIOS) ---
const API_KEY = "AIzaSyBmx-XHU_fBySeZw74O2BLFT_UBPWRJHk8";
// Endpoint v1beta với model-latest là địa chỉ chuẩn nhất hiện nay
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${API_KEY}`;

async function askGemini(userName, question) {
    try {
        const response = await axios.post(GEMINI_URL, {
            contents: [{
                parts: [{ text: `Bạn là trợ lý ảo hài hước của TikToker Chi Bèo. Trả lời cực ngắn dưới 15 từ. Đang nói chuyện với ${userName}. Câu hỏi: ${question}` }]
            }]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000 // Không để live bị đợi quá lâu
        });

        if (response.data && response.data.candidates && response.data.candidates[0].content) {
            return response.data.candidates[0].content.parts[0].text;
        }
    } catch (e) {
        // Log lỗi thật chi tiết để Tùng Anh nhìn thấy trong Render Log
        console.error("LỖI GOOGLE API:", e.response ? JSON.stringify(e.response.data) : e.message);
        
        // Nếu lỗi, trả về một câu để bớt trống trải trên live
        const backUp = ["Dạ em nghe đây!", "Hì hì, anh nhắn gì em chưa rõ ạ.", "Chào anh nhé, chúc anh xem live vui vẻ!"];
        return backUp[Math.floor(Math.random() * backUp.length)];
    }
    return "Em đây ạ!";
}

// --- KẾT NỐI MONGODB ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- XỬ LÝ VĂN BẢN ---
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

// --- ROUTE & TIKTOK CONNECTOR ---
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

            // 1. Check database kịch bản cứng
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword));

            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            // 2. Check gọi AI
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askGemini(data.nickname, data.comment);
                const audio = await getGoogleAudio(aiReply);
                socket.emit('audio-data', { type: 'bot', user: "GEMINI AI", comment: aiReply, audio });
            }
            // 3. Đọc chat bình thường
            else {
                const final = await processText(data.comment);
                if (final) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${final}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        // Chào khách & Tặng quà
        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Chào mừng anh ${data.nickname} ghé xem live`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
