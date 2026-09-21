const { chromium } = require('playwright');
(async () => {
    const context = await chromium.launchPersistentContext(
        '/home/admin/telegram-voice-ai-main/sessions/acc233507302956/browser_profile', 
        { headless: true, args: ['--disable-web-security'] }
    );
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    
    console.log('Navigating to Web K with tgaddr...');
    await page.goto('https://web.telegram.org/k/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3DBotFather');
    await page.waitForTimeout(5000);
    
    const html = await page.content();
    if (html.includes('BotFather')) {
        console.log('SUCCESS: Navigated to BotFather directly!');
    } else {
        console.log('FAILED to navigate via tgaddr');
    }
    await context.close();
})();