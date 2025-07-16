import puppeteer from 'puppeteer';

export async function takeScreenshotFromHtml(html: string, outputPath: string) {
  try {
    const browser = await puppeteer.launch({
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

    // Set the page content to the provided HTML string
    await page.setContent(html, {
      timeout: 0,
    });

    // Take a screenshot of the loaded page
    await page.screenshot({ path: outputPath as any  });

    // Close the browser
    await browser.close();
  } catch (error) {
    console.log({ log: error });
    return;
  }
}
