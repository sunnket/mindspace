const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Listen to console logs
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  await page.goto('http://localhost:3000');
  
  // Wait for the "Create Your First Space" button and click it
  await page.waitForSelector('text/Create Your First Space');
  await page.click('text/Create Your First Space');
  
  // Wait for canvas to be ready
  await new Promise(r => setTimeout(r, 2000));
  
  // Click in the middle of the screen
  const width = await page.evaluate(() => window.innerWidth);
  const height = await page.evaluate(() => window.innerHeight);
  
  console.log(`Clicking at ${width/2}, ${height/2}`);
  await page.mouse.click(width / 2, height / 2);
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Type something
  await page.keyboard.type('Hello World from Puppeteer');
  
  await new Promise(r => setTimeout(r, 1000));
  
  // Take screenshot
  await page.screenshot({ path: 'canvas-test.png' });
  
  // Check if text block exists
  const textBlocks = await page.$$eval('.text-block-editable', nodes => nodes.map(n => n.innerText));
  console.log('Text blocks:', textBlocks);
  
  await browser.close();
})();
