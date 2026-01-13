import TelegramBot from 'node-telegram-bot-api';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import express from 'express';

// --- CONFIGURATION ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;

// Exact Model from your original code
const MODEL_NAME = 'gemini-3-flash-preview';

// Exact System Instruction from your original code
const SYSTEM_INSTRUCTION = `You are an expert medical AI assistant specializing in radiology. You have to extract transcript / raw text from one or more uploaded pictures. Your task is to analyze that text to create a concise and comprehensive "Clinical Profile".

IMPORTANT INSTRUCTION - IF THE HANDWRITTEN TEXT IS NOT LEGIBLE, FEEL FREE TO USE CODE INTERPRETATION AND LOGIC IN THE CONTEXT OF OTHER TEXTS TO DECIPHER THE ILLEGIBLE TEXT

YOUR RESPONSE MUST BE BASED SOLELY ON THE PROVIDED TRANSCRIPTIONS.

Follow these strict instructions:

Analyze All Transcriptions: Meticulously examine all provided text. This may include prior medical scan reports (like USG, CT, MRI), clinical notes, or other relevant documents.

Extract Key Information: From the text, identify and extract all pertinent information, such as:

Scan types (e.g., USG, CT Brain).

Dates of scans or documents.

Key findings, measurements, or impressions from reports.

Relevant clinical history mentioned in notes.

Synthesize into a Clinical Profile:

Combine all extracted information into a single, cohesive paragraph. This represents a 100% recreation of the relevant clinical details from the provided text.

If there are repeated or vague findings across multiple documents, synthesize them into a single, concise statement.

Frame sentences properly to be concise, but you MUST NOT omit any important clinical details. Prioritize completeness of clinical information over extreme brevity.

You MUST strictly exclude any mention of the patient's name, age, or gender.

If multiple dated scan reports are present, you MUST arrange their summaries chronologically in ascending order based on their dates.

If a date is not available for a scan, refer to it as "Previous [Scan Type]...".

Formatting:

The final output MUST be a single paragraph.

This paragraph MUST start with "Clinical Profile:" and the entire content (including the prefix) must be wrapped in single asterisks. For example: "*Clinical Profile: Previous USG dated 01/01/2023 showed mild hepatomegaly. Patient also has a H/o hypertension as noted in the clinical sheet.*"

Output:

Do not output the raw transcribed text.

Do not output JSON or Markdown code blocks.

Return ONLY the single formatted paragraph described above.

IMPORTANT INSTRUCTION - IF THE HANDWRITTEN TEXT IS NOT LEGIBLE, FEEL FREE TO USE CODE INTERPRETATION AND LOGIC IN THE CONTEXT OF OTHER TEXTS TO DECIPHER THE ILLEGIBLE TEXT`;

// Initialize Bot (Polling mode)
const bot = new TelegramBot(token, { polling: true });

// Initialize Gemini
const genAI = new GoogleGenerativeAI(geminiKey);
const model = genAI.getGenerativeModel({ 
    model: MODEL_NAME,
    systemInstruction: SYSTEM_INSTRUCTION
});

// Store user images: { chatId: [Buffer, Buffer...] }
const userBuffers = new Map();

// --- WEB SERVER (To keep Render happy) ---
const app = express();
app.get('/', (req, res) => res.send('Medical Bot is running!'));
app.listen(process.env.PORT || 3000, () => console.log('Web server running'));

// --- BOT LOGIC ---

// 1. Handle Text Messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return; 

    // START COMMAND
    if (text === '/start') {
        bot.sendMessage(chatId, 
            "🏥 *Radiology Clinical Profile Bot*\n\n1. Send medical report images.\n2. Send *.* (dot) to process.\n3. Send /clear to reset.", 
            { parse_mode: 'Markdown' }
        );
        return;
    }

    // CLEAR COMMAND
    if (text === '/clear') {
        userBuffers.delete(chatId);
        bot.sendMessage(chatId, "🗑️ Memory cleared.");
        return;
    }

    // TRIGGER COMMAND (.)
    if (text.trim() === '.') {
        const buffers = userBuffers.get(chatId);

        if (!buffers || buffers.length === 0) {
            return bot.sendMessage(chatId, "❌ No images found. Send images first, then send . (dot) to process.");
        }

        bot.sendMessage(chatId, `⏳ Processing ${buffers.length} image(s)... generating Clinical Profile.`);

        try {
            // Prepare for Gemini
            const imageParts = buffers.map(buf => ({
                inlineData: { data: buf.toString('base64'), mimeType: "image/jpeg" }
            }));

            const result = await model.generateContent([
                "Analyze these medical document image(s) and generate the Clinical Profile as per your instructions.", 
                ...imageParts
            ]);
            const response = await result.response;
            const output = response.text();

            // Send back to Telegram
            await bot.sendMessage(chatId, output);
            
            // Auto-clear memory after processing
            userBuffers.delete(chatId);

        } catch (error) {
            console.error("Gemini Error:", error);
            bot.sendMessage(chatId, `❌ Error generating profile: ${error.message}`);
        }
    }
});

// 2. Handle Images
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    
    // Telegram sends multiple sizes; take the last one (highest quality)
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    try {
        // Get the direct link to the image
        const fileLink = await bot.getFileLink(fileId);
        
        // Download the image as a buffer
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Store in memory
        if (!userBuffers.has(chatId)) {
            userBuffers.set(chatId, []);
        }
        userBuffers.get(chatId).push(buffer);

        // Reply with count
        const count = userBuffers.get(chatId).length;
        if (count === 1) {
            bot.sendMessage(chatId, `📷 Image received!\n\n_Send more if needed, then send_ *.* _(dot) to process._`, { parse_mode: 'Markdown' });
        } else {
            // Just a subtle log for subsequent images
            console.log(`Chat ${chatId}: ${count} images buffered`);
        }

    } catch (error) {
        console.error("Error downloading image:", error);
        bot.sendMessage(chatId, "❌ Failed to download image.");
    }
});

console.log("🤖 Telegram Bot started with Gemini 3 Flash Preview...");
