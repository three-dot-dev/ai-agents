"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const axios_1 = require("axios");
const openai_1 = require("openai");
const fs = require("fs");
const path = require("path");
const websocket = require("websocket");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv/config");
const keyboard_markup_1 = require("../utils/keyboard-markup");
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WS_BACKEND_URL = process.env.WS_BACKEND_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const connectedWs = {};
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const usageLimit = 3;
const userUsage = {};
function checkAndIncrementUsage(chatId, type) {
    const today = new Date().toISOString().split('T')[0];
    if (!userUsage[chatId] || userUsage[chatId].date !== today) {
        userUsage[chatId] = {
            date: today,
            textToImage: 0,
            imageToText: 0,
            generateCode: 0,
        };
    }
    if (userUsage[chatId][type] >= usageLimit) {
        return false;
    }
    userUsage[chatId][type]++;
    return true;
}
function getWsClient(chatId) {
    const wsUrl = `${WS_BACKEND_URL}/generate-code`;
    const client = connectedWs[chatId];
    if (client && client?.client) {
        return client;
    }
    connectedWs[chatId] = {
        client: new websocket.client(),
    };
    connectedWs[chatId].client.connect(wsUrl);
    return connectedWs[chatId];
}
async function getBase64FromTelegramFile(fileUrl) {
    try {
        const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileUrl}`;
        console.log('Fetching file from URL:', url);
        const image = await axios_1.default.get(url, { responseType: 'arraybuffer' });
        const fileType = fileUrl.split('.').pop();
        const base64 = `data:image/${fileType};base64,${Buffer.from(image.data).toString('base64')}`;
        return base64;
    }
    catch (e) {
        console.log('Error fetching file from Telegram:', e);
        throw new Error('Failed to get base64 file');
    }
}
function ensureDirectoryExists(directory) {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
}
async function handleOnTextToImage(prompt, resolution = '1024x1024') {
    try {
        const image = await openai.images.generate({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: resolution,
            quality: 'hd',
        });
        console.log({ log: image.data[0].url });
        return image.data[0].url;
    }
    catch (error) {
        console.error('⚠️ Velix Engine rejected this prompt due to safety restrictions.\n\nPlease try a different prompt.', error);
        throw error;
    }
}
async function handleOnImageToText(msg) {
    if (!checkAndIncrementUsage(msg.chat.id, 'imageToText')) {
        return bot.sendMessage(msg.chat.id, '⚠️ You have reached your daily limit for VelixVision. Try again tomorrow.');
    }
    let waittingMessageId = null;
    const fileId = msg.photo?.[msg.photo.length - 1]?.file_id || msg.document?.file_id;
    if (!fileId) {
        bot.sendMessage(msg.chat.id, '👁️ Please send an image to analyze');
        return;
    }
    bot
        .sendMessage(msg.chat.id, `⏳*Please wait and avoid any input*⏳\n\nVelixVision is generating your analyze...`, { parse_mode: 'Markdown' })
        .then((m) => (waittingMessageId = m.message_id));
    try {
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: `Analyze this image in detail. Describe the objects, people, setting, colors, actions, emotions, and any contextual meaning. Provide insights like a professional visual analyst.`,
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: fileUrl,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 1000,
        });
        const result = response.choices?.[0]?.message?.content || 'No analysis result.';
        if (waittingMessageId && result) {
            bot.deleteMessage(msg.chat.id, waittingMessageId);
        }
        bot.sendMessage(msg.chat.id, `👁️*VelixVision Result:*\n\n${result}`, {
            parse_mode: 'Markdown',
        });
    }
    catch (error) {
        console.error('Image-to-text error:', error);
        if (waittingMessageId) {
            bot.deleteMessage(msg.chat.id, waittingMessageId);
        }
        bot.sendMessage(msg.chat.id, '❌ Velix Engine failed to analyze this image. Try again with a clearer one.');
    }
}
async function handleOnGenerateCode(msg) {
    if (!checkAndIncrementUsage(msg.chat.id, 'generateCode')) {
        return bot.sendMessage(msg.chat.id, '⚠️ You have reached your daily limit for CodeMorph. Try again tomorrow.');
    }
    let fileId;
    if ((msg.photo || msg.document?.mime_type?.startsWith('image')) &&
        (!msg.caption || !msg.caption.startsWith('/vcm'))) {
        bot.sendMessage(msg.chat.id, 'Image must be with caption /vcm');
        return;
    }
    if (msg.document) {
        if (!msg.document.mime_type.startsWith('image')) {
            bot.sendMessage(msg.chat.id, 'Invalid format file type, file type must be image');
        }
    }
    if (msg.photo && msg.photo.length > 0) {
        fileId = msg.photo[msg.photo.length - 1].file_id;
    }
    else if (msg.document) {
        fileId = msg.document.file_id;
    }
    else {
        bot.sendMessage(msg.chat.id, '💻 /Please send a photo of your UI / Design to generate into a code');
        return;
    }
    const file = await bot.getFile(fileId);
    const base64 = await getBase64FromTelegramFile(file.file_path);
    let generatedCodeConfig = undefined;
    if (msg.caption.startsWith('/vcm')) {
        generatedCodeConfig = 'html_tailwind';
    }
    if (!generatedCodeConfig) {
        bot.sendMessage(msg.chat.id, 'Invalid Generate Code Type. type must be /vcm');
    }
    const payload = {
        generationType: 'create',
        accessCode: null,
        codeGenerationModel: 'gpt_4_vision',
        editorTheme: 'espresso',
        generatedCodeConfig,
        image: base64,
        inputMode: 'image',
        isImageGenerationEnabled: false,
        isTermOfServiceAccepted: true,
        openAiApiKey: OPENAI_API_KEY,
        openAiBaseURL: null,
        screenshotOneApiKey: null,
    };
    console.log({ payload });
    const client = getWsClient(msg.chat.id);
    const wsUrl = `${WS_BACKEND_URL}/generate-code`;
    client.client.on('connect', (connection) => {
        let waittingMessageId = null;
        connection.on('error', (error) => {
            console.log('Connection Error: ' + error.toString());
        });
        connection.on('close', () => {
            console.log('echo-protocol Connection Closed');
            delete connectedWs[msg.chat.id];
        });
        connection.on('message', async (message) => {
            if (message.type === 'utf8') {
                const response = JSON.parse(message.utf8Data);
                console.log({ response });
                if (response.type === 'status' &&
                    response.value === 'Generating code...') {
                    const sentMsg = await bot.sendMessage(msg.chat.id, 'We got your request. CodeMorph is generating your code,\n\n⏳*please wait and avoid making any input during this process.*⏳', { parse_mode: 'Markdown' });
                    waittingMessageId = sentMsg.message_id;
                }
                if (response.type === 'status' &&
                    response.value === 'Code generation complete.' &&
                    response.html) {
                    const sourceType = 'html';
                    if (sourceType.length > 1024) {
                        bot.sendMessage(msg.chat.id, response.html, {
                            parse_mode: 'Markdown',
                        });
                    }
                    const generatedCodeFilePath = `${__dirname}/generated/`;
                    ensureDirectoryExists(generatedCodeFilePath);
                    const newGeneratedCodeFilePath = path.join(generatedCodeFilePath, `${msg.chat.id}.${sourceType}`);
                    if (response.html.startsWith('```html')) {
                        response.html = response.html.replace('```html', '');
                    }
                    if (response.html.endsWith('```')) {
                        response.html = response.html.replace('```', '');
                    }
                    fs.writeFileSync(newGeneratedCodeFilePath, response.html);
                    if (waittingMessageId) {
                        bot.deleteMessage(msg.chat.id, waittingMessageId);
                    }
                    bot.sendDocument(msg.chat.id, newGeneratedCodeFilePath);
                    bot.sendMessage(msg.chat.id, 'Code ready, Click to open in browser.');
                }
            }
        });
        connection.send(JSON.stringify(payload));
    });
    client.client.connect(wsUrl);
    return;
}
async function main() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    bot.on('message', async (message) => {
        if (message.text === '/velix') {
            const path = 'https://res.cloudinary.com/drmwcjsgc/video/upload/v1752598235/welcome-velix-ai_y6wajd.mp4';
            await bot.sendVideo(message.chat.id, path, {
                parse_mode: 'Markdown',
                caption: (0, keyboard_markup_1.textInfoWelcome)(message.chat.first_name),
                reply_markup: {
                    inline_keyboard: keyboard_markup_1.keyboardMarkup.start,
                },
            });
            return;
        }
        if (message.text?.startsWith('/vg')) {
            if (!checkAndIncrementUsage(message.chat.id, 'textToImage')) {
                return bot.sendMessage(message.chat.id, '⚠️ You have reached your daily limit for VelixGen. Try again tomorrow.');
            }
            const prompt = message.text.slice(3).trim();
            if (!prompt) {
                bot.sendMessage(message.chat.id, '*Please add your prompt after /vg*\n\nExample: `/vg astronaut riding a horse`', { parse_mode: 'Markdown' });
            }
            else {
                let waittingMessageId = null;
                bot
                    .sendMessage(message.chat.id, `⏳*Please wait and avoid any input*⏳\n\nVelixGen is generating your image...`, { parse_mode: 'Markdown' })
                    .then((m) => (waittingMessageId = m.message_id));
                try {
                    const image = await handleOnTextToImage(prompt);
                    await bot.sendPhoto(message.chat.id, image, {
                        caption: `🖼️ *VelixGen Result*`,
                        parse_mode: 'Markdown',
                    });
                    if (waittingMessageId && image) {
                        bot.deleteMessage(message.chat.id, waittingMessageId);
                    }
                }
                catch (error) {
                    console.log({ t: error });
                    if (waittingMessageId) {
                        bot.deleteMessage(message.chat.id, waittingMessageId);
                    }
                    bot.sendMessage(message.chat.id, `⚠️ *Velix Engine rejected this prompt due to safety restrictions, Please try a different prompt.*`, { parse_mode: 'Markdown' });
                }
            }
            return;
        }
        if ((message.caption && message.caption.startsWith('/vs')) ||
            (message.text && message.text.startsWith('/vs'))) {
            handleOnImageToText(message);
            return;
        }
        if ((message.caption && message.caption.startsWith('/vcm')) ||
            (message.text && message.text.startsWith('/vcm'))) {
            handleOnGenerateCode(message);
            return;
        }
        const isImageOnly = message.photo || message.document?.mime_type?.startsWith('image');
        const isKnownCommand = message.text?.startsWith('/velix') ||
            message.text?.startsWith('/vg') ||
            message.text?.startsWith('/vs') ||
            message.text?.startsWith('/vcm') ||
            message.caption?.startsWith('/vg') ||
            message.caption?.startsWith('/vs') ||
            message.caption?.startsWith('/vcm');
        if (!isImageOnly || !isKnownCommand) {
            bot.sendMessage(message.chat.id, `⚠️*Velix AI didn't recognize that input⚠️\n\nPlease try using one of the available features in the bot.*`, { parse_mode: 'Markdown' });
        }
    });
    bot.on('callback_query', async (query) => {
        const data = JSON.parse(query.data);
        switch (data.command) {
            case keyboard_markup_1.CallbackInfo.VELIXG:
                bot.sendMessage(query.message.chat.id, keyboard_markup_1.textInfo.commandVelixGen, {
                    parse_mode: 'Markdown',
                });
                break;
            case keyboard_markup_1.CallbackInfo.VELIXV:
                bot.sendMessage(query.message.chat.id, keyboard_markup_1.textInfo.commandVelixVision, {
                    parse_mode: 'Markdown',
                });
                break;
            case keyboard_markup_1.CallbackInfo.CODEM:
                bot.sendMessage(query.message.chat.id, keyboard_markup_1.textInfo.commandVelixCodeMorph, {
                    parse_mode: 'Markdown',
                });
                break;
        }
    });
    await app.listen(process.env.PORT ?? 3001);
    console.log(`velix engine bot is running on: ${await app.getUrl()}`);
}
main();
//# sourceMappingURL=main.js.map