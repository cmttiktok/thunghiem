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

// --- CẤU HÌNH API GOOGLE (FIX CỨNG TÊN MODEL) ---
const API_KEY = "AIzaSyBmx-XHU_fBySeZw74O2BLFT_UBPWRJHk8";
// Tuyệt đối không thêm -latest hay bất kỳ gì khác
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

async function askGemini(userName, question) {
    try {
        const response = await axios.post(GEMINI_URL, {
            contents: [{ parts: [{ text: `Bạn là trợ lý ảo của Chi Bèo. Trả lời cực ngắn dưới 15 từ. ${userName} hỏi: ${question}` }] }]
        }, { timeout: 8000 });

        if (response.data?.candidates?.[0]?.content) {
            return response.data.candidates[0].content.parts[0].text;
        }
    } catch (e) {
        console.error("LỖI GOOGLE API:", e.response ? JSON.stringify(e.response.data) : e.message);
        return `Chào ${userName}, em nghe đây ạ!`;
    }
    return "Em đây!";
}

// --- GIỮ NGUYÊN CÁC PHẦN DATABASE VÀ TIKTOK CONNECTOR BÊN DƯỚI ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI);

const BannedWord = mongoose.model('BannedWord', { word: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let tiktok = null;
io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `✅ Đã nối: ${username}`));
        tiktok.on('chat', async (data) => {
            const commentLower = data.comment.toLowerCase();
            if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askGemini(data.nickname, data.comment);
                socket.emit('audio-data', { type: 'bot', user: "GEMINI AI", comment: aiReply, audio: await getGoogleAudio(aiReply) });
            }
        });
    });
});

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data).toString('base64')}`;
    } catch (e) { return null; }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại port ${PORT}`));
