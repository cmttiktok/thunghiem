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

// --- KẾT NỐI DATABASE (MongoDB của Tùng Anh) ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB đã sẵn sàng"))
    .catch(err => console.error("❌ Lỗi DB:", err));

const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// --- AI GROQ (Lấy từ Environment Variables trên Render) ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

// --- CÁC API QUẢN LÝ ---
app.get('/api/config', async (req, res) => {
    const data = await Config.findOne({ key: 'prompt' });
    res.json(data || { value: "Bạn là chị Google hài hước. Trả lời dưới 10 từ." });
});

app.post('/api/config', async (req, res) => {
    await Config.findOneAndUpdate({ key: 'prompt' }, { value: req.body.value }, { upsert: true });
    res.sendStatus(200);
});

app.get('/api/words', async (req, res) => res.json(await BannedWord.find()));
app.post('/api/words', async (req, res) => {
    if (req.body.word) await BannedWord.create({ word: req.body.word.toLowerCase().trim() });
    res.sendStatus(200);
});
app.delete('/api/words/:id', async (req, res) => {
    await BannedWord.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
});

// --- HÀM TẢI GIỌNG ĐỌC TẠI SERVER (BASE64) ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) {
        console.error("❌ Lỗi lấy Audio:", e.message);
        return null;
    }
}

// --- XỬ LÝ KẾT NỐI TIKTOK ---
io.on('connection', (socket) => {
    socket.on('set-username', (username) => {
        if (tiktokConn) tiktokConn.disconnect();
        tiktokConn = new WebcastPushConnection(username, { processInitialData: false });

        tiktokConn.connect().then(() => {
            socket.emit('status', `✅ Đã kết nối Live: ${username}`);
        }).catch(err => {
            socket.emit('status', `❌ Lỗi: ${err.message}`);
        });

        tiktokConn.on('chat', async (data) => {
            try {
                // 1. Kiểm tra từ cấm
                const banned = await BannedWord.find();
                if (banned.some(b => data.comment.toLowerCase().includes(b.word))) return;

                // 2. Lấy Prompt xưng hô (Mina trợ lý ảo)
                const promptDoc = await Config.findOne({ key: 'prompt' });
                const sysPrompt = promptDoc ? promptDoc.value : "Bạn là chị Google. Trả lời dưới 10 từ.";

                // 3. Gọi AI Groq - PHẦN QUAN TRỌNG NHẤT ĐỂ AI GỌI TÊN NGƯỜI DÙNG
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: sysPrompt },
                        { 
                            role: "user", 
                            // Ép AI biết tên người chat bằng cách gửi kèm nickname của họ
                            content: `Người dùng có tên là "${data.nickname}" vừa bình luận: ${data.comment}. Hãy trả lời họ.` 
                        }
                    ],
                    model: "llama-3.3-70b-versatile",
                    temperature: 0.7
                });

                const reply = completion.choices[0]?.message?.content;
                if (reply) {
                    const audio = await getGoogleAudio(reply);
                    socket.emit('audio-data', {
                        user: data.nickname,
                        comment: data.comment,
                        reply: reply,
                        audio: audio
                    });
                }
            } catch (err) {
                console.error("❌ Lỗi xử lý Chat AI:", err.message);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server đang chạy trên port ${PORT}`));
