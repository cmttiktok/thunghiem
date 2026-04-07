async function askGemini(userName, question) {
    try {
        // ÉP BUỘC SỬ DỤNG API VERSION 1 ĐỂ TRÁNH LỖI 404
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash" 
        }, { apiVersion: 'v1' }); // Dòng này cực kỳ quan trọng

        const prompt = `Bạn là trợ lý ảo hài hước của TikToker Chi Bèo. Trả lời cực ngắn dưới 15 từ. ${userName} hỏi: ${question}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Nếu lấy được text thật từ AI thì trả về luôn
        if (text) return text;
        
    } catch (e) {
        console.error("LỖI AI CHI TIẾT:", e.message);
        
        // Nếu vẫn lỗi vùng miền hoặc 404, bot sẽ nói câu này để bạn biết
        if (e.message.includes("location")) {
            return "Dạ mạng chỗ em hơi lag, anh gọi lại sau nhé!";
        }
    }
    
    // Câu trả lời mặc định khi tất cả đều thất bại
    return "Em đây, em đây! Anh gọi Chi Bèo có việc gì không?";
}
