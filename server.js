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

// --- CẤU HÌNH AI (MODEL ỔN ĐỊNH NHẤT) ---
const HF_TOKEN = process.env.HF_TOKEN; 
// Đổi sang model chuyên chat, cực kỳ ổn định
const AI_MODEL = "HuggingFaceH4/zephyr-7b-beta"; 

async function askAI(userName, question) {
    if (!HF_TOKEN) return `Chào ${userName}, em nghe đây ạ!`;
    
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${AI_MODEL}`,
            { 
                inputs: `<|system|>\nBạn là trợ lý ảo của Chi Bèo. Trả lời cực ngắn dưới 15 từ.</s>\n<|user|>\n${userName} hỏi: ${question}</s>\n<|assistant|>\n`,
                parameters: { max_new_tokens: 50, temperature: 0.7 }
            },
            { headers: { Authorization: `Bearer ${HF_TOKEN}` }, timeout: 8000 }
        );
        
        let reply = response.data[0].generated_text.split("<|assistant|>\n")[1] || "Em nghe đây ạ!";
        return reply.trim();
    } catch (e) {
        console.error("LỖI AI:", e.message);
        // Trả về câu khác để bạn biết là đang bị lỗi kết nối
        return `Dạ ${userName}, em đang suy nghĩ một chút, anh đợi em tí nhé!`;
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
server.listen(PORT, () => console.log(`🚀 Sẵn sàng tại port ${PORT}`));
