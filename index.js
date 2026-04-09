const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const Groq = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('public'));

// --- DATABASE ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });
const CustomReply = mongoose.model('CustomReply', { userQuestion: String, aiResponse: String });
const TriggerWord = mongoose.model('TriggerWord', { word: String }); // Model mới cho từ khóa gọi tên

// --- API QUẢN LÝ TỪ KHÓA GỌI MINA ---
app.post('/api/triggers', async (req, res) => {
    await TriggerWord.create({ word: req.body.word.toLowerCase().trim() });
    res.json({ success: true });
});

app.get('/api/triggers', async (req, res) => {
    const words = await TriggerWord.find();
    res.json(words);
});

app.delete('/api/triggers/:id', async (req, res) => {
    await TriggerWord.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// Các API cũ giữ nguyên...
app.post('/api/config', async (req, res) => {
    const { key, value } = req.body;
    await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
    res.json({ success: true });
});
app.get('/api/config/:key', async (req, res) => {
    const doc = await Config.findOne({ key: req.params.key });
    res.json({ value: doc ? doc.value : "" });
});
app.post('/api/banned-words', async (req, res) => {
    await BannedWord.create({ word: req.body.word.toLowerCase() });
    res.json({ success: true });
});
app.get('/api/banned-words', async (req, res) => {
    const words = await BannedWord.find();
    res.json(words);
});
app.post('/api/save-reply', async (req, res) => {
    const { question, answer } = req.body;
    const q = question.toLowerCase().trim();
    await CustomReply.deleteMany({ userQuestion: q });
    await CustomReply.create({ userQuestion: q, aiResponse: answer });
    res.json({ success: true });
});

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// --- LOGIC XỬ LÝ CHAT ---
const API_KEYS = [process.env.GROQ_KEY_1, process.env.GROQ_KEY_2, process.env.GROQ_KEY_3, process.env.GROQ_KEY_4, process.env.GROQ_KEY_5].filter(k => k);
let currentKeyIndex = 0;

io.on('connection', (socket) => {
    let tiktok;
    let voiceSpeed = 1.0;

    socket.on('change-speed', (speed) => { voiceSpeed = speed; });

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        tiktok.connect().then(() => socket.emit('status', `✅ Đã kết nối: ${username}`))
              .catch(err => socket.emit('status', `❌ Lỗi: ${err.message}`));

        tiktok.on('chat', async (data) => {
            try {
                const msgLower = data.comment.toLowerCase();

                // 1. Kiểm tra Từ khóa gọi Mina
                const triggers = await TriggerWord.find();
                const isCalled = triggers.some(t => msgLower.includes(t.word));
                if (triggers.length > 0 && !isCalled) return; // Nếu danh sách từ khóa không trống và không được gọi -> Bỏ qua

                // 2. Kiểm tra Từ cấm
                const banned = await BannedWord.find();
                if (banned.some(b => msgLower.includes(b.word))) return;

                const learned = await CustomReply.findOne({ userQuestion: msgLower.trim() });
                let reply = "";

                if (learned) {
                    reply = learned.aiResponse;
                } else {
                    const promptDoc = await Config.findOne({ key: 'prompt' });
                    const sysPrompt = (promptDoc ? promptDoc.value : "") + " QUY TẮC: Trả lời cực ngắn dưới 7 từ.";
                    
                    const callGroq = async (retryCount = 0) => {
                        try {
                            const groq = new Groq({ apiKey: API_KEYS[currentKeyIndex] });
                            const completion = await groq.chat.completions.create({
                                messages: [{ role: "system", content: sysPrompt }, { role: "user", content: `Tên: ${data.nickname}. Chat: ${data.comment}` }],
                                model: "llama-3.1-8b-instant",
                                max_tokens: 35,
                                temperature: 0.7
                            });
                            return completion.choices[0]?.message?.content;
                        } catch (err) {
                            if (err.status === 429 && retryCount < API_KEYS.length - 1) {
                                currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
                                return callGroq(retryCount + 1);
                            }
                            throw err;
                        }
                    };
                    reply = await callGroq();
                }

                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', { user: data.nickname, comment: data.comment, reply, audio, speed: voiceSpeed });
                }
            } catch (err) { console.error(err.message); }
        });
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Mina Online on Port ${PORT}`));
