const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext(
        '/home/admin/telegram-voice-ai-main/sessions/acc233507302956/browser_profile', 
        { headless: true, args: ['--disable-web-security'] }
    );
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    console.log('Navigating to Web K with phone resolve URL...');
    await page.goto('https://web.telegram.org/k/#?tgaddr=tg%3A%2F%2Fresolve%3Fphone%3D380991234567');
    await page.waitForTimeout(5000);
    
    const html = await page.content();
    if (html.includes('Phone number not on Telegram') || html.includes('Call')) {
        console.log('SUCCESS: The URL successfully opened a profile or showed the error!');
    } else if (html.includes('chat-info')) {
        console.log('SUCCESS: It seems to have opened a chat or profile info!');
    } else {
        console.log('FAILED: URL routing might not work as expected.');
        // Let's dump a little bit of the DOM to see what happened
        const titles = await page.eval('.chat-title, .popup-title, h4', els => els.map(e => e.textContent));
        console.log('Titles found:', titles);
    }
    await context.close();
})();