const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// --- CẤU HÌNH GEMINI AI (ĐÃ SỬA LỖI V1BETA) ---
const genAI = new GoogleGenerativeAI("AIzaSyB4tu0J3c2LbpsrTH43BtaD9Y_fiMUTHII", { apiVersion: 'v1' });
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Bạn là trợ lý ảo của Idol TikTok tên là Chi Bèo. Tính cách: hài hước, lễ phép, gọi người nghe là 'anh/chị' và xưng là 'em'. Nhiệm vụ: Trả lời thật ngắn gọn (dưới 20 từ). Không nói bậy."
});

async function askGemini(userName, question) {
    try {
        const prompt = `Người dùng ${userName} hỏi: ${question}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (e) {
        console.error("LỖI GEMINI CHI TIẾT:", e.message);
        return "Em đang bận xíu, anh hỏi lại sau nha!";
    }
}

// --- DATABASE ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- HÀM XỬ LÝ TEXT ---
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
    acronyms.forEach(a => {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    });
    return processed;
}

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// --- ROUTING ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    let pkTimer = null;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`));

        tiktok.on('chat', async (data) => {
            if (await isBanned(data.nickname)) return;
            const commentLower = data.comment.toLowerCase();

            // 1. Ưu tiên kịch bản cứng trong Database
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword));

            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            // 2. Nếu gọi "Bot ơi" hoặc "Bèo ơi" -> Dùng Gemini AI
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askGemini(data.nickname, data.comment);
                const audio = await getGoogleAudio(aiReply);
                socket.emit('audio-data', { type: 'bot', user: "GEMINI AI", comment: aiReply, audio });
            }
            // 3. Đọc comment bình thường
            else {
                const final = await processText(data.comment);
                if (final) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${final}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        // Các sự kiện khác (PK, Chào khách, Tặng quà)
        tiktok.on('linkMicBattle', () => {
            if (pkTimer) clearInterval(pkTimer);
            let timeLeft = 300; 
            pkTimer = setInterval(async () => {
                timeLeft--;
                if (timeLeft === 20) {
                    const audio = await getGoogleAudio("thả bông 20 giây cuối bèo ơi");
                    socket.emit('audio-data', { type: 'pk', user: "HỆ THỐNG", comment: "NHẮC PK 20S", audio });
                }
                if (timeLeft <= 0) clearInterval(pkTimer);
            }, 1000);
        });

        tiktok.on('member', async (data) => {
            if (!(await isBanned(data.nickname))) {
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Bèo ơi, anh ${safeName} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
            }
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd && !(await isBanned(data.nickname))) {
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safeName} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server đang chạy trên port ${PORT}`));
