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

// --- KẾT NỐI DATABASE (Dùng link MongoDB của bạn) ---
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ Đã kết nối MongoDB"))
    .catch(err => console.error("❌ Lỗi kết nối DB:", err));

// Định nghĩa các bảng dữ liệu (Schemas)
const Config = mongoose.model('Config', { key: String, value: String });
const BannedWord = mongoose.model('BannedWord', { word: String });

// Cấu hình AI Groq (Lấy key từ Environment Variable trên Render)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
let tiktokConn = null;

// --- CÁC ĐƯỜNG DẪN API (Dùng cho giao diện điều khiển) ---

// Lấy/Lưu cấu hình xưng hô (Prompt)
app.get('/api/config', async (req, res) => {
    const data = await Config.findOne({ key: 'prompt' });
    res.json(data || { value: "Bạn là chị Google hài hước. Trả lời dưới 10 từ." });
});

app.post('/api/config', async (req, res) => {
    await Config.findOneAndUpdate({ key: 'prompt' }, { value: req.body.value }, { upsert: true });
    res.sendStatus(200);
});

// Quản lý từ cấm
app.get('/api/words', async (req, res) => {
    const words = await BannedWord.find();
    res.json(words);
});

app.post('/api/words', async (req, res) => {
    if (req.body.word) {
        await BannedWord.create({ word: req.body.word.toLowerCase().trim() });
    }
    res.sendStatus(200);
});

app.delete('/api/words/:id', async (req, res) => {
    await BannedWord.findByIdAndDelete(req.params.id);
    res.sendStatus(200);
});

// --- HÀM LẤY GIỌNG ĐỌC GOOGLE TẠI SERVER (Fix lỗi âm thanh) ---
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        // Chuyển dữ liệu âm thanh sang chuỗi Base64 để gửi về trình duyệt
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) {
        console.error("❌ Lỗi tải Audio Google:", e.message);
        return null;
    }
}

// --- XỬ LÝ KẾT NỐI TIKTOK VÀ SOCKET.IO ---
io.on('connection', (socket) => {
    console.log("🔌 Có người vừa mở trang điều khiển");

    socket.on('set-username', (username) => {
        if (tiktokConn) {
            tiktokConn.disconnect();
            console.log("🔄 Đang ngắt kết nối cũ để đổi ID mới...");
        }

        tiktokConn = new WebcastPushConnection(username, { processInitialData: false });

        tiktokConn.connect().then(state => {
            socket.emit('status', `✅ Đã kết nối Live: ${username}`);
            console.log(`✅ Kết nối thành công tới: ${username}`);
        }).catch(err => {
            socket.emit('status', `❌ Lỗi kết nối: ${err.message}`);
            console.error(err);
        });

        // Khi có bình luận mới
        tiktokConn.on('chat', async (data) => {
            try {
                // 1. Kiểm tra từ cấm trong Database
                const bannedWords = await BannedWord.find();
                const hasBanned = bannedWords.some(b => data.comment.toLowerCase().includes(b.word));
                if (hasBanned) return; // Nếu chứa từ cấm thì im lặng

                // 2. Lấy cách xưng hô bạn đã dạy AI
                const promptData = await Config.findOne({ key: 'prompt' });
                const systemPrompt = promptData ? promptData.value : "Bạn là chị Google hài hước. Trả lời dưới 10 từ.";

                // 3. Gửi cho AI Groq để lấy câu trả lời
                const completion = await groq.chat.completions.create({
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Người dùng ${data.nickname} nói: ${data.comment}` }
                    ],
                    model: "llama-3.3-70b-versatile",
                    temperature: 0.7
                });

                const aiReply = completion.choices[0]?.message?.content;

                if (aiReply) {
                    // 4. Server tự tải giọng chị Google cho câu trả lời này
                    const audioBase64 = await getGoogleAudio(aiReply);

                    // 5. Gửi dữ liệu về cho giao diện (Frontend)
                    socket.emit('audio-data', {
                        user: data.nickname,
                        comment: data.comment,
                        reply: aiReply,
                        audio: audioBase64
                    });
                }
            } catch (error) {
                console.error("❌ Lỗi xử lý bình luận:", error.message);
            }
        });
    });

    socket.on('disconnect', () => {
        console.log("🔌 Một người dùng đã thoát trang điều khiển");
    });
});

// Khởi chạy Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Hệ thống đang chạy tại: http://localhost:${PORT}`);
});
