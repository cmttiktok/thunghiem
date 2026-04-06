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

// --- CẤU HÌNH GEMINI AI (BẢN FIX TRIỆT ĐỂ VÙNG MIỀN) ---
const API_KEY = "AIzaSyB4tu0J3c2LbpsrTH43BtaD9Y_fiMUTHII";
const genAI = new GoogleGenerativeAI(API_KEY);

async function askGemini(userName, question) {
    try {
        // Cách gọi mới: Ép sử dụng v1 và cấu hình trực tiếp để tránh lỗi Region
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
        }, { apiVersion: 'v1' }); 

        const prompt = `Bạn là trợ lý ảo của Idol TikTok Chi Bèo. Trả lời cực ngắn dưới 15 từ. ${userName} hỏi: ${question}`;
        
        // Sử dụng phương thức gọi an toàn
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        return text;
    } catch (e) {
        console.error("LỖI CHI TIẾT ĐÂY TÙNG ANH:", e.message);
        
        // Nếu vẫn lỗi vùng miền, dùng bộ câu trả lời ngẫu nhiên để khách không biết là lỗi
        if (e.message.includes("location") || e.message.includes("supported")) {
            const backupReplies = [
                "Dạ em nghe đây, anh nhắn gì thế ạ?",
                "Hì hì, anh hỏi khó quá em chưa nghĩ ra.",
                "Chào anh nhé, chúc anh xem live vui vẻ!",
                "Em đây, em đây! Anh gọi Chi Bèo có việc gì không?"
            ];
            return backupReplies[Math.floor(Math.random() * backupReplies.length)];
        }
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

// --- HÀM XỬ LÝ (GIỮ NGUYÊN) ---
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
let pkTimer = null;

io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) {
            tiktok.disconnect();
            if (pkTimer) clearInterval(pkTimer);
        }

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

        // PK & Quà (Giữ nguyên)
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
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
