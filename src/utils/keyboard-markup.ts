export enum CallbackInfo {
  VELIXG = 3,
  VELIXV = 4,
  CODEM = 5,
  PRM = 6,
}

const commandVelixGen =
  '*LumioGen* - Smart content generator\nCommand: /lg\nInstructions: Type /lg followed by your prompt.\nExample: "`/lg Write a tweet about Web3 design systems.`"\nSmart content generator for fast, polished outputs. just prompt and go.';

const commandVelixVision = `
*VisionLight™* - Understand Any Image  
Command: /vs  
How to use: Upload an image with "/vs" as the caption.  
Get smart insights — layout, hierarchy, roles, and more.
`;
const commandVelixCodeMorph = '*SyntaxGlow™* - Image to Code\n' +
  'Command: /sg\n' +
  'Instructions: Upload a UI screenshot and type "/sg" in the image caption.\n' +
  'Get clean, production-ready code in seconds — HTML, React, Tailwind and more.';

export function textInfoWelcome(username: string) {
  const safeUsername = username.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  return `
    Hello ${safeUsername} 👋\n
*Welcome to Lumio AI 🍏* - Your AI Copilot for Creativity & Code.

Here’s how to get started:

*Choose your tool* - LumioGen™, VisionLight™, or SyntaxGlow™

*Type what you need* - content, code, or creative prompt

*Hit generate* - get results instantly with no fluff

*Tweak or rerun* - refine your outputs with smart iterations

⚡ Built for builders. Powered by Lumio AI.
`;
}

const freeUser =
  '🚀 *Premium Access*\n\n' +
  'Unlock full power with Premium for *0.05 SOL/week* and get:\n\n' +
  '🔹 *Higher daily limits* (10x per feature/day)\n' +
  '🔹 *Priority support*\n' +
  '🔹 *Exclusive early features*\n\n' +
  '💳 *To upgrade:*\n' +
  'Send 0.05 SOL to the address below:\n\n' +
  '`9fcFYsFXTzN1biMZrDBaU521oaztcFfxZDoCBFdAWVTU`\n\n' +
  '*Then submit your payment proof with:*\n' +
  '`/pay https://solscan.io/tx/<your-tx-hash>`\n\n' +
  '⚠️ *Only use the official Lumio AI address above.*\n' +
  '*We are not responsible for payments sent elsewhere.*\n\n' +
  'Thank you for supporting Lumio AI! 🙌';

const premiumUser =
  '🎉 *You are a Premium Member!*\n\n' +
  '✅ You currently enjoy:\n' +
  '🔹 10x daily usage per feature\n' +
  '🔹 Priority support\n' +
  '🔹 Access to exclusive updates\n\n' +
  '*Your Premium access is valid for 1 week.*\n\n' +
  'To extend your Premium status after expiry, simply make another payment of *0.05* SOL and use /pay.\n\n' +
  'Thanks for being a part of Lumio AI Premium! 🚀';

const premiumSoon = '⚡ *Premium access is coming soon!* Get ready for higher limits, faster generation, and exclusive tools.\n' +
    'Stay tuned!'

const startKeyboardMarkup = [
  [
    {
      text: 'LumioGen™ 📝',
      callback_data: JSON.stringify({
        command: CallbackInfo.VELIXG,
      }),
    },
  ],
  [
    {
      text: 'VisionLight™ 🎨',
      callback_data: JSON.stringify({
        command: CallbackInfo.VELIXV,
      }),
    },
  ],
  [
    {
      text: 'SyntaxGlow™ 💻',
      callback_data: JSON.stringify({
        command: CallbackInfo.CODEM,
      }),
    },
  ],
  [
    {
      text: 'Website 🌐',
      url: 'https://www.uselumioai.com/',
    },
    {
      text: 'Twitter / X ',
      url: 'https://x.com/useLumio',
    },
  ],
  [
    // {
    //   text: 'Portal 🌀',
    //   url: 'https://t.me/VelixAIPortal',
    // },

    {
      text: 'Premium Access 🔓',
      callback_data: JSON.stringify({
        command: CallbackInfo.PRM,
      }),
    },
  ],
];

export const textInfo = {
  commandVelixGen,
  commandVelixVision,
  commandVelixCodeMorph,
  premiumUser,
  freeUser,
  premiumSoon
};

export const keyboardMarkup = {
  //cancel: cancelKeyboardMarkup,
  start: startKeyboardMarkup,
  //socials: socialsKeyboardMarkup,
};
