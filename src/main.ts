import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { takeScreenshotFromHtml } from 'utils/browse-and-screenshot';
//
import axios from 'axios';
import OpenAI from 'openai';
//
import * as fs from 'fs';
import * as path from 'path';
import * as websocket from 'websocket';
import * as TelegramBot from 'node-telegram-bot-api';
//
import 'dotenv/config';
import {
  CallbackInfo,
  keyboardMarkup,
  textInfo,
  textInfoWelcome,
} from 'utils/keyboard-markup';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WS_BACKEND_URL = process.env.WS_BACKEND_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

//
const connectedWs: Record<number, { client: websocket.client }> = {};
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

//
type GenerateCodePayload = {
  generationType: 'create';
  image: string;
  inputMode: 'image';
  openAiApiKey: string;
  openAiBaseURL: string;
  screenshotOneApiKey: string;
  isImageGenerationEnabled: boolean;
  editorTheme: 'espresso';
  generatedCodeConfig: 'html_tailwind';
  codeGenerationModel: 'gpt_4_vision';
  isTermOfServiceAccepted: boolean;
  accessCode: null;
};

const usageLimit = 3;

const userUsage: Record<
  number,
  {
    date: string;
    textToImage: number;
    imageToText: number;
    generateCode: number;
  }
> = {};

function checkAndIncrementUsage(chatId: number, type: 'textToImage' | 'imageToText' | 'generateCode'): boolean {
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

//
function getWsClient(chatId: number) {
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

//
async function getBase64FromTelegramFile(fileUrl: string): Promise<string> {
  try {
    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileUrl}`;
    console.log('Fetching file from URL:', url);
    // download image and format into base64
    const image = await axios.get(url, { responseType: 'arraybuffer' });
    const fileType = fileUrl.split('.').pop();
    const base64 = `data:image/${fileType};base64,${Buffer.from(
      image.data,
    ).toString('base64')}`;

    return base64;
  } catch (e) {
    console.log('Error fetching file from Telegram:', e);
    throw new Error('Failed to get base64 file');
  }
}

// Function to ensure the directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}
//
async function handleOnTextToImage(
  prompt: string,
  resolution: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024',
): Promise<string> {
  try {
    //
    const image = await openai.images.generate({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: resolution,
      quality: 'hd',
    });
    console.log({ log: image.data[0].url });
    return image.data[0].url;
  } catch (error) {
    console.error(
      '⚠️ Velix Engine rejected this prompt due to safety restrictions.\n\nPlease try a different prompt.',
      error,
    );
    throw error;
  }
}

async function handleOnImageToText(msg: TelegramBot.Message) {
  if (!checkAndIncrementUsage(msg.chat.id, 'imageToText')) {
  return bot.sendMessage(msg.chat.id, '⚠️ You have reached your daily limit for VelixVision. Try again tomorrow.');
}
  let waittingMessageId: number = null;
  const fileId =
    msg.photo?.[msg.photo.length - 1]?.file_id || msg.document?.file_id;

  if (!fileId) {
    bot.sendMessage(msg.chat.id, '👁️ Please send an image to analyze');
    return;
  }

  bot
    .sendMessage(
      msg.chat.id,
      `⏳*Please wait and avoid any input*⏳\n\nVelixVision is generating your analyze...`,
      { parse_mode: 'Markdown' },
    )
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

    const result =
      response.choices?.[0]?.message?.content || 'No analysis result.';
    if (waittingMessageId && result) {
      bot.deleteMessage(msg.chat.id, waittingMessageId);
    }
    bot.sendMessage(msg.chat.id, `👁️*VelixVision Result:*\n\n${result}`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Image-to-text error:', error);
    if (waittingMessageId) {
      bot.deleteMessage(msg.chat.id, waittingMessageId);
    }
    bot.sendMessage(
      msg.chat.id,
      '❌ Velix Engine failed to analyze this image. Try again with a clearer one.',
    );
  }
}

//
async function handleOnGenerateCode(msg: TelegramBot.Message) {
  if (!checkAndIncrementUsage(msg.chat.id, 'generateCode')) {
  return bot.sendMessage(msg.chat.id, '⚠️ You have reached your daily limit for CodeMorph. Try again tomorrow.');
}
  //
  let fileId: string;

  if (
    (msg.photo || msg.document?.mime_type?.startsWith('image')) &&
    (!msg.caption || !msg.caption.startsWith('/vcm'))
  ) {
    bot.sendMessage(msg.chat.id, 'Image must be with caption /vcm');
    return;
  }

  //
  if (msg.document) {
    if (!msg.document.mime_type.startsWith('image')) {
      bot.sendMessage(
        msg.chat.id,
        'Invalid format file type, file type must be image',
      );
    }
  }

  if (msg.photo && msg.photo.length > 0) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.document) {
    fileId = msg.document.file_id;
  } else {
    bot.sendMessage(
      msg.chat.id,
      '💻 /Please send a photo of your UI / Design to generate into a code',
    );
    return;
  }

  const file = await bot.getFile(fileId);
  const base64 = await getBase64FromTelegramFile(file.file_path);

  let generatedCodeConfig: GenerateCodePayload['generatedCodeConfig'] =
    undefined; // set default to html_tailwind

  //gcht = generate-code-html-tailwind
  if (msg.caption.startsWith('/vcm')) {
    generatedCodeConfig = 'html_tailwind';
  }

  if (!generatedCodeConfig) {
    bot.sendMessage(
      msg.chat.id,
      'Invalid Generate Code Type. type must be /vcm',
    );
  }

  const payload: GenerateCodePayload = {
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

  // find connected ws using msg.id
  const client = getWsClient(msg.chat.id);

  const wsUrl = `${WS_BACKEND_URL}/generate-code`;

  client.client.on('connect', (connection) => {
    //
    let waittingMessageId: number = null;

    connection.on('error', (error) => {
      console.log('Connection Error: ' + error.toString());
    });

    connection.on('close', () => {
      console.log('echo-protocol Connection Closed');

      // remove client from connectedWs
      delete connectedWs[msg.chat.id];
    });

    connection.on('message', async (message) => {
      if (message.type === 'utf8') {
        const response = JSON.parse(message.utf8Data);
        console.log({ response });

        if (
          response.type === 'status' &&
          response.value === 'Generating code...'
        ) {
          const sentMsg = await bot.sendMessage(
            msg.chat.id,
            'We got your request. CodeMorph is generating your code,\n\n⏳*please wait and avoid making any input during this process.*⏳',
            { parse_mode: 'Markdown' },
          );
          waittingMessageId = sentMsg.message_id;
        }

        if (
          response.type === 'status' &&
          response.value === 'Code generation complete.' &&
          response.html
        ) {
          const sourceType = 'html';

          if (sourceType.length > 1024) {
            bot.sendMessage(msg.chat.id, response.html, {
              parse_mode: 'Markdown',
            });
          }

          const generatedCodeFilePath = `${__dirname}/generated/`;
          ensureDirectoryExists(generatedCodeFilePath);
          const newGeneratedCodeFilePath = path.join(
            generatedCodeFilePath,
            `${msg.chat.id}.${sourceType}`,
          );
          // sometimes the response.html start with ```html
          // and end with ```
          // we need to remove that
          if (response.html.startsWith('```html')) {
            response.html = response.html.replace('```html', '');
          }
          if (response.html.endsWith('```')) {
            response.html = response.html.replace('```', '');
          }
          fs.writeFileSync(newGeneratedCodeFilePath, response.html);
          // const fileToSend = `generated/${msg.message_id}.${sourceType}`;
          if (waittingMessageId) {
            bot.deleteMessage(msg.chat.id, waittingMessageId);
          }

          bot.sendDocument(msg.chat.id, newGeneratedCodeFilePath);
          bot.sendMessage(msg.chat.id, 'Code ready, Click to open in browser.');
          // console.log('HTML file generated successfully');

          // const screenshotPath = `${__dirname}/generated/`;
          // ensureDirectoryExists(screenshotPath);
          // const newScreenshowPath = path.join(
          //   screenshotPath,
          //   `${msg.chat.id}-preview.png`,
          // );
          //await takeScreenshotFromHtml(response.html, newScreenshowPath);

          //bot.sendPhoto(msg.chat.id, newScreenshowPath);
          // const codeScreenshotPath = `generated/${msg.message_id}-code-screenshot`;
          // await convertCodeToImage(response.html, codeScreenshotPath);
          // bot.sendPhoto(msg.chat.id, codeScreenshotPath);
        }
      }
    });

    connection.send(JSON.stringify(payload));
  });

  client.client.connect(wsUrl);
  return;
}

async function main() {
  //
  const app = await NestFactory.create(AppModule);

  //
  bot.on('message', async (message) => {
    //
    if (message.text === '/velix') {
      const path =
        'https://res.cloudinary.com/drmwcjsgc/video/upload/v1752598235/welcome-velix-ai_y6wajd.mp4';

      await bot.sendVideo(message.chat.id, path, {
        parse_mode: 'Markdown',
        caption: textInfoWelcome(message.chat.first_name),
        reply_markup: {
          inline_keyboard: keyboardMarkup.start,
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
        bot.sendMessage(
          message.chat.id,
          '*Please add your prompt after /vg*\n\nExample: `/vg astronaut riding a horse`',
          { parse_mode: 'Markdown' },
        );
      } else {
        let waittingMessageId: number = null;
        bot
          .sendMessage(
            message.chat.id,
            `⏳*Please wait and avoid any input*⏳\n\nVelixGen is generating your image...`,
            { parse_mode: 'Markdown' },
          )
          .then((m) => (waittingMessageId = m.message_id));

        try {
          //
          const image = await handleOnTextToImage(prompt);
          // bot.sendPhoto(message.chat.id, image);
          await bot.sendPhoto(message.chat.id, image, {
            caption: `🖼️ *VelixGen Result*`,
            parse_mode: 'Markdown',
          });
          if (waittingMessageId && image) {
            bot.deleteMessage(message.chat.id, waittingMessageId);
          }
        } catch (error) {
          console.log({ t: error });
          if (waittingMessageId) {
            bot.deleteMessage(message.chat.id, waittingMessageId);
          }
          bot.sendMessage(
            message.chat.id,
            `⚠️ *Velix Engine rejected this prompt due to safety restrictions, Please try a different prompt.*`,
            { parse_mode: 'Markdown' },
          );
        }
      }

      return;
    }

    if (
      (message.caption && message.caption.startsWith('/vs')) ||
      (message.text && message.text.startsWith('/vs'))
    ) {
      handleOnImageToText(message);
      return;
    }

    if (
      (message.caption && message.caption.startsWith('/vcm')) ||
      (message.text && message.text.startsWith('/vcm'))
    ) {
      handleOnGenerateCode(message);
      return;
    }

    const isImageOnly =
      message.photo || message.document?.mime_type?.startsWith('image');

    const isKnownCommand =
      message.text?.startsWith('/velix') ||
      message.text?.startsWith('/vg') ||
      message.text?.startsWith('/vs') ||
      message.text?.startsWith('/vcm') ||
      message.caption?.startsWith('/vg') ||
      message.caption?.startsWith('/vs') ||
      message.caption?.startsWith('/vcm');

    if (!isImageOnly || !isKnownCommand) {
      bot.sendMessage(
        message.chat.id,
        `⚠️*Velix AI didn't recognize that input⚠️\n\nPlease try using one of the available features in the bot.*`,
        { parse_mode: 'Markdown'}
      );
    }
  });

  //
  bot.on('callback_query', async (query) => {
    const data = JSON.parse(query.data);

    switch (data.command) {
      case CallbackInfo.VELIXG:
        bot.sendMessage(query.message.chat.id, textInfo.commandVelixGen, {
          parse_mode: 'Markdown',
        });
        break;

      case CallbackInfo.VELIXV:
        bot.sendMessage(query.message.chat.id, textInfo.commandVelixVision, {
          parse_mode: 'Markdown',
        });
        break;
      case CallbackInfo.CODEM:
        bot.sendMessage(query.message.chat.id, textInfo.commandVelixCodeMorph, {
          parse_mode: 'Markdown',
        });
        break;
    }
  });

  //
  await app.listen(process.env.PORT ?? 3001);
  console.log(`velix engine bot is running on: ${await app.getUrl()}`);
}

main();
