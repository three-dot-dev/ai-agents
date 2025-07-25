import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { takeScreenshotFromHtml } from 'src/utils/browse-and-screenshot';
import { createClient } from '@supabase/supabase-js';
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
} from 'src/utils/keyboard-markup';
import {
  decodeTopicToAddress,
  getTodayRangeUTC,
  parseUsdtAmount,
} from './utils';

//
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WS_BACKEND_URL = process.env.WS_BACKEND_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
// const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

//
const connectedWs: Record<number, { client: websocket.client }> = {};
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
//
const MORALIS_API_URL = 'https://deep-index.moralis.io/api/v2.2';
const VELIX_ADDRESS =
  '9fcFYsFXTzN1biMZrDBaU521oaztcFfxZDoCBFdAWVTU'.toLowerCase();
const PREMIUM_AMOUNT = 12.5;

//create cache
const userCache = new Map<number, any>();

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

async function getTransactionDetailsFromMoralis(txHash: string) {
  try {
    const response = await axios.get(
      `${MORALIS_API_URL}/transaction/${txHash}`,
      {
        headers: {
          'X-API-Key': MORALIS_API_KEY!,
        },
      },
    );

    const tx = response.data;

    const log = tx.logs?.[0];

    if (!log || !log.topic2 || !log.data) {
      console.warn('Missing log, topic2, or data');
      return null;
    }

    //
    const from_address = '0x' + log.topic1.slice(-40);
    const to_address = '0x' + log.topic2.slice(-40);
    const data_usd = BigInt(log.data);
    const value_usd = (Number(data_usd) / 1e6).toFixed(6);

    //
    return {
      from_address,
      to_address,
      value_usd: value_usd ?? '0',
      receipt_status: tx.receipt_status?.toString() ?? '0',
    };
  } catch (err) {
    console.error(
      'Error fetching Moralis tx:',
      err.response?.data || err.message,
    );
    return null;
  }
}

async function handlePayCommand(message: TelegramBot.Message, txInput: string) {
  const chatId = message.chat.id;
  const telegramId = message.from?.id;

  let waitingMsgVerifyId: number = null;

  await bot
    .sendMessage(
      chatId,
      `
    ⏳ Verifying your payment...

Please wait while we confirm your transaction on the blockchain.  
This may take a few seconds.`,
      { parse_mode: 'Markdown' },
    )
    .then((m) => (waitingMsgVerifyId = m.message_id));

  if (!txInput || !txInput.includes('0x')) {
    if (waitingMsgVerifyId) {
      bot.deleteMessage(chatId, waitingMsgVerifyId);
    }
    return bot.sendMessage(
      chatId,
      `❌ Please provide a valid Etherscan transaction URL or hash.\n\nExample:\n/pay https://etherscan.io/tx/<your-tx-hash>`,
    );
  }

  try {
    // Ambil txHash dari URL atau langsung dari input
    const txHashMatch = txInput.match(/0x[a-fA-F0-9]{64}/);
    if (!txHashMatch) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      return bot.sendMessage(
        chatId,
        `❌ Could not extract a valid transaction hash.`,
      );
    }

    const txHash = txHashMatch[0].toLowerCase();

    // Cek apakah txHash sudah pernah dipakai
    const { data: existingTx } = await supabase
      .from('PaymentTransaction')
      .select('id')
      .eq('txHash', txHash)
      .single();

    if (existingTx) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      return bot.sendMessage(
        chatId,
        `⚠️ This transaction has already been used for premium upgrade.`,
      );
    }

    // Ambil detail transaksi dari Moralis
    const tx = await getTransactionDetailsFromMoralis(txHash);

    if (!tx) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      return bot.sendMessage(
        chatId,
        `❌ Could not fetch transaction details. Please try again later.`,
      );
    }

    const { to_address, value_usd, from_address, receipt_status } = tx;

    if (receipt_status !== '1') {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      return bot.sendMessage(
        chatId,
        `❌ This transaction failed. Only successful transactions are accepted.`,
      );
    }

    if (to_address.toLowerCase() !== VELIX_ADDRESS) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      return bot.sendMessage(
        chatId,
        `❌ This transaction was not sent to Lumio AI's official address.\n\n✅ Address:\n${VELIX_ADDRESS}`,
      );
    }

    if (parseFloat(value_usd) < PREMIUM_AMOUNT) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      return bot.sendMessage(
        chatId,
        `❌ Payment insufficient.\nYou must send at least **$${PREMIUM_AMOUNT} USDT**.`,
      );
    }

    // Simpan transaksi ke database
    const { error: insertErr } = await supabase
      .from('PaymentTransaction')
      .insert([
        {
          txHash,
          telegramId,
          amount: parseFloat(value_usd),
        },
      ]);

    if (insertErr) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      console.error('Insert TX Error:', insertErr);
      return bot.sendMessage(
        chatId,
        `❌ Failed to record payment. Please try again or contact support.`,
      );
    }

    // Update user ke premium (dailyLimit = 10)
    const { error: updateErr, data: updatedUser } = await supabase
      .from('User')
      .update({
        isPremium: true,
        plan: 'premium',
        dailyLimit: 10,
      })
      .eq('telegramId', telegramId)
      .select()
      .single();

    if (updateErr) {
      if (waitingMsgVerifyId) {
        bot.deleteMessage(chatId, waitingMsgVerifyId);
      }
      console.error('Update user error:', updateErr);
      return bot.sendMessage(
        chatId,
        `❌ Payment verified but failed to upgrade your account. Please contact support.`,
      );
    }

    // Update userCache
    userCache.set(telegramId, updatedUser);

    if (waitingMsgVerifyId) {
      bot.deleteMessage(chatId, waitingMsgVerifyId);
    }

    return bot.sendMessage(
      chatId,
      `✅ Payment verified!\n\n🎉 Your Lumio AI account is now Premium.\nYou can now use features up to *10x per day* for the next 7 days.\n\nThanks for supporting us! 🚀`,
      {
        parse_mode: 'Markdown',
      },
    );
  } catch (err) {
    console.error('handlePayCommand error:', err);
    return bot.sendMessage(
      chatId,
      `❌ Something went wrong while verifying your transaction. Please try again later.`,
    );
  }
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

async function checkAndLogUsage(
  telegramId: number,
  feature: string,
): Promise<boolean> {
  try {
    const user = userCache.get(telegramId);
    if (!user) return false;

    const { start, end } = getTodayRangeUTC();

    // Hitung penggunaan hari ini
    const { data: usageToday, error: usageError } = await supabase
      .from('UsageLog')
      .select('*')
      .eq('telegramId', telegramId)
      .eq('feature', feature)
      .gte('usedAt', start)
      .lte('usedAt', end);

    if (usageError) {
      console.error(
        `❌ Error checking usage for ${telegramId} - ${feature}:`,
        usageError.message,
      );
      return false;
    }

    const usageCount = usageToday?.length ?? 0;

    if (usageCount >= user.dailyLimit) {
      return false;
    }

    // Simpan log baru
    const { error: insertError } = await supabase.from('UsageLog').insert([
      {
        telegramId,
        feature,
      },
    ]);

    if (insertError) {
      console.error(
        `❌ Error logging usage for ${telegramId} - ${feature}:`,
        insertError.message,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error({ log: error });
    throw error;
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
    return image.data[0].url;
  } catch (error) {
    console.error(
      '⚠️ Lumio Engine rejected this prompt due to safety restrictions.\n\nPlease try a different prompt.',
      error,
    );
    throw error;
  }
}

async function handleOnImageToText(msg: TelegramBot.Message) {
  let waittingMessageId: number = null;
  const fileId =
    msg.photo?.[msg.photo.length - 1]?.file_id || msg.document?.file_id;

  if (!fileId) {
    bot.sendMessage(msg.chat.id, '👁️ Please send an image to analyze');
    return;
  }

  console.log({ log: msg })
  const isAllowed = await checkAndLogUsage(msg.from.id, 'vs');
  if (!isAllowed) {
    bot.sendMessage(
      msg.chat.id,
      `⚠️ *You have reached the daily limit for this feature.*\n\nUpgrade to premium to get more usage.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  bot
    .sendMessage(
      msg.chat.id,
      `⏳*Please wait and avoid any input*⏳\n\nVisionLight is generating your analyze...`,
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
    bot.sendMessage(msg.chat.id, `👁️*VisionLight Result:*\n\n${result}`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    console.error('Image-to-text error:', error);
    if (waittingMessageId) {
      bot.deleteMessage(msg.chat.id, waittingMessageId);
    }
    bot.sendMessage(
      msg.chat.id,
      '❌ Lumio Engine failed to analyze this image. Try again with a clearer one.',
      { parse_mode: 'Markdown' },
    );
  }
}

//
async function handleOnGenerateCode(msg: TelegramBot.Message) {
  //
  let fileId: string;

  if (
    (msg.photo || msg.document?.mime_type?.startsWith('image')) &&
    (!msg.caption || !msg.caption.startsWith('/sg'))
  ) {
    bot.sendMessage(msg.chat.id, 'Image must be with caption /sg');
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
      '💻 Please send a photo of your UI / Design to generate into a code',
    );
    return;
  }

  const file = await bot.getFile(fileId);
  const base64 = await getBase64FromTelegramFile(file.file_path);

  let generatedCodeConfig: GenerateCodePayload['generatedCodeConfig'] =
    undefined; // set default to html_tailwind

  //gcht = generate-code-html-tailwind
  if (msg.caption.startsWith('/sg')) {
    generatedCodeConfig = 'html_tailwind';
  }

  if (!generatedCodeConfig) {
    bot.sendMessage(
      msg.chat.id,
      'Invalid Generate Code Type. type must be /sg',
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
        //console.log({ response });

        if (
          response.type === 'status' &&
          response.value === 'Generating code...'
        ) {
          //

          const isAllowed = await checkAndLogUsage(msg.from.id, 'sg');
          if (!isAllowed) {
            bot.sendMessage(
              message.chat.id,
              `⚠️ *You have reached the daily limit for this feature.*\n\nUpgrade to premium to get more usage.`,
              { parse_mode: 'Markdown' },
            );
            return;
          }

          const sentMsg = await bot.sendMessage(
            msg.chat.id,
            'We got your request. SyntaxGlow is generating your code,\n\n⏳*please wait and avoid making any input during this process.*⏳',
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
    const telegramId = message.from.id;
    const plan = userCache.get(telegramId)?.plan ?? 'free';
    // cek user
    if (!userCache.has(telegramId)) {
      try {
        const { data: existingUser, error } = await supabase
          .from('User')
          .select('*')
          .eq('telegramId', telegramId)
          .single();

        if (!existingUser) {
          const { data, error: insertError } = await supabase
            .from('User')
            .insert([
              {
                telegramId,
                isPremium: false,
                plan: 'free',
              },
            ])
            .select()
            .single();

          if (insertError) {
            console.error('Failed to insert new user:', insertError);
          } else {
            userCache.set(telegramId, data); // save new user to cache
          }
        } else {
          userCache.set(telegramId, existingUser); // save old user to cache
        }
      } catch (error) {
        console.error('User fetch/insert error:', error);
      }
    }

    //
    if (message.text === '/start') {
      // const path =
      //   'https://res.cloudinary.com/drmwcjsgc/video/upload/v1752665787/new-intro-velix_mtkj8m.mp4';
      const path =
        'https://res.cloudinary.com/drmwcjsgc/image/upload/v1753429621/lumio-logo_fb4gtf.jpg';

      // await bot.sendVideo(message.chat.id, path, {
      //   caption: textInfoWelcome(message.chat.first_name),
      //   parse_mode: 'Markdown',
      //   reply_markup: {
      //     inline_keyboard: keyboardMarkup.start,
      //   },
      // });
      await bot.sendPhoto(message.chat.id, path, {
        caption: textInfoWelcome(message.chat.first_name),
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboardMarkup.start,
        },
      });

      return;
    }

    if (message.text === '/tutorial') {
      const tutorialMsg = `📘 *Lumio AI Tutorial*\n\n
📝 */lg your prompt*  
*LumioGen™* — Turn text into images: logos, UIs, scenes, and more.

🎨 */vs (with image)*  
*VisionLight™* — Analyze images to detect layout, structure, and roles.

💻 */sg (with UI image)*  
*SyntaxGlow™* — Convert UI screenshots into clean HTML/React/Tailwind code.

Type a command to try it out.`;

      bot.sendMessage(message.chat.id, tutorialMsg, { parse_mode: 'Markdown' });
      return;
    }

    // if (message.text === '/premium') {
    //   //
    //   const premiumMessage =
    //     plan === 'free' ? textInfo.freeUser : textInfo.premiumUser;

    //   bot.sendMessage(message.chat.id, textInfo.premiumSoon, {
    //     parse_mode: 'Markdown',
    //   });
    //   return;
    // }

    if (message.text === '/points') {
  const freeUserPointsMessage =
    '🔢 *Usage Limits - Free Member*\n\n' +
    'As a free user, you can use each feature *up to 3 times/day*:\n\n' +
    '📝 LumioGen: *3x per day*\n' +
    '🎨 VisionLight: *3x per day*\n' +
    '💻 SyntaxGlow: *3x per day*\n\n';
    // +
    // 'Want more?\n' +
    // 'Upgrade to *Premium* for higher limits and weekly access.\n' +
    // 'Type /premium to learn more.';

  const premiumUserPointsMessage =
    '🌟 *Usage Limits - Premium Member*\n\n' +
    'You currently enjoy upgraded limits:\n\n' +
    '📝 LumioGen: *10x per day*\n' +
    '🎨 VisionLight: *10x per day*\n' +
    '💻 SyntaxGlow: *10x per day*\n\n' +
    '*Premium access is valid for 1 week.*\n' +
    'To renew, simply make another payment after it expires.\n\n' +
    'Thanks for supporting Lumio AI! ⚡️';

  const pointsMsg =
    plan === 'free' ? freeUserPointsMessage : premiumUserPointsMessage;

  bot.sendMessage(message.chat.id, pointsMsg, { parse_mode: 'Markdown' });
  return;
}


    if (message.text?.startsWith('/lg')) {
      //
      const prompt = message.text.slice(3).trim();

      if (!prompt) {
        bot.sendMessage(
          message.chat.id,
          '*Please add your prompt after /lg*\n\nExample: `/lg Write a tweet about Web3 design systems.`',
          { parse_mode: 'Markdown' },
        );
      } else {
        const isAllowed = await checkAndLogUsage(message.from.id, 'lg');
        if (!isAllowed) {
          bot.sendMessage(
            message.chat.id,
            `⚠️ *You have reached the daily limit for this feature.*\n\nUpgrade to premium to get more usage.`,
            { parse_mode: 'Markdown' },
          );
          return;
        }
        let waittingMessageId: number = null;
        bot
          .sendMessage(
            message.chat.id,
            `⏳*Please wait and avoid any input*⏳\n\nLumioGen is generating your image...`,
            { parse_mode: 'Markdown' },
          )
          .then((m) => (waittingMessageId = m.message_id));

        try {
          //
          const image = await handleOnTextToImage(prompt);
          // bot.sendPhoto(message.chat.id, image);
          await bot.sendPhoto(message.chat.id, image, {
            caption: `🖼️ *LumioGen Result*`,
            parse_mode: 'Markdown',
          });

          if (waittingMessageId && image) {
            bot.deleteMessage(message.chat.id, waittingMessageId);
          }
        } catch (error) {
          if (waittingMessageId) {
            bot.deleteMessage(message.chat.id, waittingMessageId);
          }
          bot.sendMessage(
            message.chat.id,
            `⚠️ *Lumio Engine rejected this prompt due to safety restrictions, Please try a different prompt.*`,
            { parse_mode: 'Markdown' },
          );
        }
      }

      return;
    }

    // Handle /pay command
    if (message.text?.startsWith('/pay')) {
      const parts = message.text.split(/\s+/);
      const txInput = parts[1]; // akan undefined kalau cuma "/pay"

      if (!txInput) {
        return bot.sendMessage(
          message.chat.id,
          `💳 *Upgrade to Premium*

To upgrade, please send your payment proof:

📍 *Official Lumio AI Address:*  
\`9fcFYsFXTzN1biMZrDBaU521oaztcFfxZDoCBFdAWVTU\`

⚠️ *Only payments to this address are accepted.*  
Minimum payment: *0.05 SOL*  
Premium is valid for 7 days and gives you *10x/day usage per feature*.

✅ Example:
\`/pay https://solscan.io/tx/<your-tx-hash>\``,
          { parse_mode: 'Markdown' },
        );
      }

      try {
        await handlePayCommand(message, txInput);
      } catch (error) {
        console.error('Failed to handle /pay:', error);
        await bot.sendMessage(
          message.chat.id,
          '❌ Something went wrong while processing your payment. Please try again later.',
        );
      }
    }

    if (
      (message.caption && message.caption.startsWith('/vs')) ||
      (message.text && message.text.startsWith('/vs'))
    ) {
      //
      handleOnImageToText(message);
      return;
    }

    if (
      (message.caption && message.caption.startsWith('/sg')) ||
      (message.text && message.text.startsWith('/sg'))
    ) {
      //
      handleOnGenerateCode(message);
      return;
    }

    const isImageOnly =
      message.photo || message.document?.mime_type?.startsWith('image');

    const isKnownCommand =
      message.text?.startsWith('/start') ||
      message.text?.startsWith('/tutorial') ||
      message.text?.startsWith('/premium') ||
      message.text?.startsWith('/points') ||
      message.text?.startsWith('/pay') ||
      message.text?.startsWith('/lg') ||
      message.text?.startsWith('/vs') ||
      message.text?.startsWith('/sg') ||
      message.caption?.startsWith('/lg') ||
      message.caption?.startsWith('/vs') ||
      message.caption?.startsWith('/sg');

    if (!isImageOnly && !isKnownCommand) {
      bot.sendMessage(
        message.chat.id,
        `⚠️*Lumio AI didn't recognize that input⚠️\n\nPlease try using one of the available features in the bot.*`,
        { parse_mode: 'Markdown' },
      );
    }
  });

  //
  bot.on('callback_query', async (query) => {
    const data = JSON.parse(query.data);
    const telegramId = query.from.id;
    const plan = userCache.get(telegramId)?.plan ?? 'free';

    switch (data.command) {
      case CallbackInfo.VELIXG:
        bot.sendMessage(query.message.chat.id, textInfo.commandVelixGen, {
          parse_mode: 'Markdown',
        });
        // bot.sendMessage(
        //   query.message.chat.id,
        //   `🖼️ *VelixGen is currently locked and will be released soon.*\n\nStay tuned for updates!`,
        //   {
        //     parse_mode: 'Markdown',
        //   },
        // );
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
      // bot.sendMessage(
      //   query.message.chat.id,
      //   `💻 *CodeMorph is currently locked and will be released soon.*\n\nStay tuned!`,
      //   { parse_mode: 'Markdown' },
      // );
      case CallbackInfo.PRM:
        const premiumMessage =
          plan === 'free' ? textInfo.freeUser : textInfo.premiumUser;

        bot.sendMessage(query.message.chat.id, textInfo.premiumSoon, {
          parse_mode: 'Markdown',
        });
        break;
    }
  });

  //
  await app.listen(process.env.PORT ?? 3001);
  console.log(`lumio engine bot is running on: ${await app.getUrl()}`);
}

main();
