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

// --- CẤU HÌNH AI (DÙNG MODEL FACEBOOK - CỰC NHẸ) ---
const HF_TOKEN = process.env.HF_TOKEN; 
const AI_MODEL = "facebook/blenderbot-400M-distill"; 

async function askAI(userName, question) {
    if (!HF_TOKEN) return `Chào ${userName}, em nghe đây!`;
    
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${AI_MODEL}`,
            { inputs: question },
            { headers: { Authorization: `Bearer ${HF_TOKEN}` }, timeout: 5000 }
        );
        
        // Trả về kết quả từ AI
        let reply = response.data.generated_text || response.data[0]?.generated_text || "Em nghe đây ạ!";
        return reply.replace("BlenderBot", "Trợ lý").trim();
    } catch (e) {
        // Nếu AI lỗi, tự động trả lời theo phong cách vui vẻ
        const backupReplies = [
            `Dạ em nghe đây ${userName} ơi!`,
            `Anh ${userName} gọi em có việc gì thế?`,
            `Em đây, chúc anh ${userName} xem live vui vẻ nha!`,
            `Đợi em tí nhé, em đang bận ăn bánh bèo rồi hihi`
        ];
        return backupReplies[Math.floor(Math.random() * backupReplies.length)];
    }
}

// --- KẾT NỐI MONGODB ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- XỬ LÝ ÂM THANH ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data).toString('base64')}`;
    } catch (e) { return null; }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let tiktok = null;
io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `✅ Đã nối: ${username}`));

        tiktok.on('chat', async (data) => {
            socket.emit('chat-message', data); 

            const commentLower = data.comment.toLowerCase();
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword.toLowerCase()));

            if (match) {
                const audio = await getGoogleAudio(`${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askAI(data.nickname, data.comment);
                const audio = await getGoogleAudio(aiReply);
                socket.emit('audio-data', { type: 'bot', user: "AI", comment: aiReply, audio });
            }
        });

        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Chào ${data.nickname} vào xem live`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Hệ thống đã sẵn sàng!`));
