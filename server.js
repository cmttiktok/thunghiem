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

// --- KẾT NỐI QUA PROXY VERCEL ---
const API_KEY = "AIzaSyBmx-XHU_fBySeZw74O2BLFT_UBPWRJHk8";
const PROXY_URL = `https://thunghiem-cmttiktoks-projects.vercel.app/api?key=${API_KEY}`;

async function askGemini(userName, question) {
    try {
        // Sau khi tắt Vercel Auth, link này sẽ trả về data AI thay vì trang đăng nhập
        const response = await axios.post(PROXY_URL, {
            contents: [{ parts: [{ text: `Bạn là trợ lý ảo của Chi Bèo. Trả lời dưới 15 từ. ${userName} hỏi: ${question}` }] }]
        }, { timeout: 10000 });

        if (response.data?.candidates?.[0]?.content) {
            return response.data.candidates[0].content.parts[0].text;
        }
    } catch (e) {
        console.error("LỖI PROXY:");
        // Nếu Proxy lỗi, bot vẫn trả lời để live stream không bị "chết"
        return `Chào ${userName}, em nghe đây! Anh nhắn gì em chưa rõ ạ.`;
    }
    return "Em đây!";
}

// --- DATABASE MONGODB ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- XỬ LÝ ÂM THANH ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data).toString('base64')}`;
    } catch (e) { return null; }
}

// --- TIKTOK LOGIC ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let tiktok = null;
io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `✅ Đã nối: ${username}`));

        tiktok.on('chat', async (data) => {
            const commentLower = data.comment.toLowerCase();
            // Ưu tiên kịch bản cứng trong DB trước
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword));

            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askGemini(data.nickname, data.comment);
                socket.emit('audio-data', { type: 'bot', user: "GEMINI AI", comment: aiReply, audio: await getGoogleAudio(aiReply) });
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Port: ${PORT}`));
