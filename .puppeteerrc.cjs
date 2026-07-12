/**
 * On Vercel the API route runs as a Lambda, and it launches @sparticuz/chromium
 * — a Chromium built for that environment. The desktop Chrome that Puppeteer
 * normally downloads at install time would be dead weight there: it lands in the
 * build machine's ~/.cache and never ships in the function bundle (which is
 * exactly why `launch()` used to fail with "Could not find Chrome"). Skip it.
 *
 * Locally the download still happens, because that Chrome is the one the browser
 * block actually drives during development.
 */
module.exports = {
  skipDownload: !!process.env.VERCEL,
};
