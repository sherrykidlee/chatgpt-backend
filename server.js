require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const fs = require("fs");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const CHAT_HISTORY_FILE = "chatHistory.json";
const CSV_FILE = "chatLogs.csv";

// 🔹 Create CSV Writer (now includes user_id column)
const csvWriter = createCsvWriter({
    path: CSV_FILE,
    header: [
        { id: "sessionId", title: "Survey Session ID" },
        { id: "user_id", title: "User ID (First Message)" },
        { id: "user_message", title: "User Message" },
        { id: "bot_response", title: "Bot Response" },
        { id: "timestamp", title: "Timestamp" }
    ],
    append: true
});

// 🔹 Load chat history
function loadChatHistory() {
    try {
        const data = fs.readFileSync(CHAT_HISTORY_FILE, "utf8");
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// 🔹 Save chat history
function saveChatHistory(history) {
    fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(history, null, 2));
}

// 🔹 Save to CSV with user_id tracking
function saveChatToCSV(sessionId, user_id, user_message, bot_response) {
    const logEntry = [{
        sessionId,
        user_id,
        user_message,
        bot_response,
        timestamp: new Date().toISOString()
    }];

    csvWriter.writeRecords(logEntry).catch(err => console.error("CSV Write Error:", err));
}

// 🔹 Handle chat
app.post("/chat", async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        let chatHistory = loadChatHistory();

        if (!chatHistory[sessionId]) {
            chatHistory[sessionId] = [
                { role: "user_id", content: message }
            ];

            const confirmation = "Thanks! I've recorded your ID. You can now start asking questions.";
            chatHistory[sessionId].push({ role: "assistant", content: confirmation });

            saveChatHistory(chatHistory);
            saveChatToCSV(sessionId, message, message, confirmation); // Use ID as both user_id and message for logging

            return res.json({ reply: confirmation });
        }

        // 🔹 Extract previous messages (ignore ID line)
        const pastMessages = chatHistory[sessionId]
            .filter(entry => entry.role === "user" || entry.role === "assistant")
            .slice(-10);
        pastMessages.push({ role: "user", content: message });

        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4",
                messages: pastMessages
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const bot_reply = response.data.choices[0].message.content;

        chatHistory[sessionId].push({ role: "user", content: message });
        chatHistory[sessionId].push({ role: "assistant", content: bot_reply });
        saveChatHistory(chatHistory);

        // 🔹 Use stored user_id for logging
        const userID = chatHistory[sessionId].find(m => m.role === "user_id")?.content || "N/A";
        saveChatToCSV(sessionId, userID, message, bot_reply);

        res.json({ reply: bot_reply });

    } catch (error) {
        console.error("Error:", error.response ? error.response.data : error);
        res.status(500).json({ error: "Something went wrong." });
    }
});

// 🔹 Download chat history
app.get("/chat-history", (req, res) => {
    try {
        const chatHistory = loadChatHistory();
        res.json(chatHistory);
    } catch (error) {
        res.status(500).json({ error: "Could not retrieve chat history." });
    }
});

// 🔹 Download CSV
app.get("/download-chat-logs", (req, res) => {
    const filePath = "./chatLogs.csv";
    res.download(filePath, "chatLogs.csv", (err) => {
        if (err) {
            console.error("File Download Error:", err);
            res.status(500).send("Error downloading file.");
        }
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
