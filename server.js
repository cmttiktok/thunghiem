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

// --- CẤU HÌNH AI HUGGING FACE ---
const HF_TOKEN = "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"; 
const AI_MODEL = "HuggingFaceH4/zephyr-7b-beta"; 

async function askAI(userName, question) {
    try {
        const response = await axios.post(
            `https://api-inference.huggingface.co/models/${AI_MODEL}`,
            { 
                inputs: `<|system|>\nBạn là trợ lý ảo của TikToker Chi Bèo. Trả lời cực ngắn dưới 15 từ, xưng em gọi anh/chị.</s>\n<|user|>\n${userName} hỏi: ${question}</s>\n<|assistant|>\n`,
                parameters: { 
                    max_new_tokens: 40,
                    temperature: 0.7,
                    return_full_text: false
                }
            },
            { 
                headers: { Authorization: `Bearer ${HF_TOKEN}` }, 
                timeout: 10000 
            }
        );

        // Xử lý lấy văn bản thuần túy từ kết quả trả về
        let reply = "";
        if (Array.isArray(response.data)) {
            reply = response.data[0].generated_text;
        } else {
            reply = response.data.generated_text;
        }
        
        return reply.split("<|assistant|>")[1]?.trim() || reply.trim() || "Em nghe đây ạ!";
    } catch (e) {
        console.error("LỖI AI:", e.message);
        return `Chào ${userName}, em đây, anh nhắn gì thế?`;
    }
}

// --- KẾT NỐI MONGODB ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ Lỗi MongoDB:", err));

const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- XỬ LÝ ÂM THANH GOOGLE ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data).toString('base64')}`;
    } catch (e) { return null; }
}

// --- GIAO DIỆN & TIKTOK LOGIC ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

let tiktok = null;

io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktok) {
            tiktok.disconnect();
            console.log("Ngắt kết nối phiên cũ");
        }
        
        tiktok = new WebcastPushConnection(username);
        
        tiktok.connect()
            .then(() => socket.emit('status', `✅ Đã nối: ${username}`))
            .catch(err => socket.emit('status', `❌ Lỗi kết nối: ${err.message}`));

        tiktok.on('chat', async (data) => {
            const commentLower = data.comment.toLowerCase();

            // 1. Kiểm tra kịch bản cứng trong Database (Ưu tiên số 1)
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => commentLower.includes(r.keyword.toLowerCase()));

            if (match) {
                const audio = await getGoogleAudio(`${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } 
            // 2. Nếu gọi Bot hoặc Bèo thì dùng AI
            else if (commentLower.includes("bot ơi") || commentLower.includes("bèo ơi")) {
                const aiReply = await askAI(data.nickname, data.comment);
                const audio = await getGoogleAudio(aiReply);
                socket.emit('audio-data', { type: 'bot', user: "AI", comment: aiReply, audio });
            }
        });

        // Tự động chào khách vào xem live
        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Chào ${data.nickname} vào xem live nhé`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào`, audio });
        });

        // Cảm ơn quà tặng
        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 Hệ thống của Tùng Anh đã chạy tại port ${PORT}`);
});
