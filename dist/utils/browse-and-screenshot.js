"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.takeScreenshotFromHtml = takeScreenshotFromHtml;
const puppeteer_1 = require("puppeteer");
async function takeScreenshotFromHtml(html, outputPath) {
    try {
        const browser = await puppeteer_1.default.launch({
            executablePath: '/usr/bin/chromium',
            args: [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-sandbox',
            ],
        });
        const page = await browser.newPage();
        page.setViewport({
            width: 1920,
            height: 1080,
        });
        await page.setContent(html, {
            timeout: 0,
        });
        await page.screenshot({ path: outputPath });
        await browser.close();
    }
    catch (error) {
        console.log({ log: error });
        return;
    }
}
//# sourceMappingURL=browse-and-screenshot.js.map