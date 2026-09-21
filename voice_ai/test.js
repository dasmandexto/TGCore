const { chromium } = require('playwright');
(async () => {
    try {
        const browser = await chromium.launch({ headless: false });
        console.log('Launch successful');
        await browser.close();
    } catch(e) {
        console.error('Launch failed:', e.message);
    }
})();