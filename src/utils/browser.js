// utils/browser.js

const puppeteer = require("puppeteer-core");

let browserInstance = null;

const getBrowser = async () => {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
  }

  return browserInstance;
};

module.exports = getBrowser;