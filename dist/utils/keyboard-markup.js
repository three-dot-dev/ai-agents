"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keyboardMarkup = exports.textInfo = exports.CallbackInfo = void 0;
exports.textInfoWelcome = textInfoWelcome;
var CallbackInfo;
(function (CallbackInfo) {
    CallbackInfo[CallbackInfo["VELIXG"] = 3] = "VELIXG";
    CallbackInfo[CallbackInfo["VELIXV"] = 4] = "VELIXV";
    CallbackInfo[CallbackInfo["CODEM"] = 5] = "CODEM";
})(CallbackInfo || (exports.CallbackInfo = CallbackInfo = {}));
const commandVelixGen = '*VelixGen* - Text to Image\nCommand: /vg\nInstructions: Type /vg followed by your prompt.\nExample: "`/vg astronaut riding a horse`"\nVelixGen turns your text into visuals - mockups, icons, or whatever you imagine.';
const commandVelixVision = `
*VelixVision* - Image to Text Analysis
Command: /vs
Instructions: Upload any Image/UI layout & type "/vs" in the image caption.\nVelixVision will analyze the structure & generate smart metadata for your workflows.
`;
const commandVelixCodeMorph = `
*CodeMorph* - Image to Code
Command: /vcm
Instructions: Upload your image or design screenshot and type "/vcm" on image caption.\nSit back and relax while our bot generates the code for you.
`;
function textInfoWelcome(username) {
    return `
    Hello ${username} 👋
*Welcome to Velix AI 🌟* - The Visual Intelligence Layer for Builders.

Here’s what I can do for you:

*VelixGen™*
Turn prompts into stunning visuals - logos, UI mockups, diagrams & more.

*VelixVision™*
Understand layouts and elements from images - detect structure, roles, and visual metadata.

*CodeMorph™*
Drop in a UI screenshot. Get back clean, production ready HTML/React/Tailwind code instantly.

📩 More info? Contact us: [build@velixlabs.dev](mailto:build@velixlabs.dev)
`;
}
const startKeyboardMarkup = [
    [
        {
            text: 'CodeMorph 💻',
            callback_data: JSON.stringify({
                command: CallbackInfo.CODEM,
            }),
        },
    ],
    [
        {
            text: 'VelixVision 👁️',
            callback_data: JSON.stringify({
                command: CallbackInfo.VELIXV,
            }),
        },
        {
            text: 'VelixGen 🖼️',
            callback_data: JSON.stringify({
                command: CallbackInfo.VELIXG,
            }),
        },
    ],
    [
        {
            text: 'Website 🌐',
            url: 'https://www.velixlabs.dev/',
        },
    ],
    [
        {
            text: 'Portal 🌀',
            url: 'https://t.me/VelixAIPortal',
        },
        {
            text: 'Twitter / X ',
            url: 'https://x.com/VelixLabs',
        },
        {
            text: 'GitBook 🗒',
            url: 'https://documentation.velixlabs.dev/',
        },
    ],
];
exports.textInfo = {
    commandVelixGen,
    commandVelixVision,
    commandVelixCodeMorph,
};
exports.keyboardMarkup = {
    start: startKeyboardMarkup,
};
//# sourceMappingURL=keyboard-markup.js.map