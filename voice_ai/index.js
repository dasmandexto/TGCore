const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class TelegramVoiceBot extends EventEmitter {
    constructor(config = {}) {
        super();
        this.audio1 = config.audio1 || './1.wav';
        this.audio2 = config.audio2 || './2.wav';
        this.aiServer = config.aiServer || 'http://localhost:8000/analyze_call';
        this.sessionsDir = config.sessionsDir || './sessions';
        this.helperBot = config.helperBot || '@reeeeveerbot';
        this.headless = config.headless !== undefined ? config.headless : false;
        this.callsPerAccount = config.callsPerAccount || 5;
        this.listenTimeoutMs = config.listenTimeoutMs || 5000;
    }

    async call(phones, proxies = []) {
        if (!fs.existsSync(this.audio1)) throw new Error(`Файл ${this.audio1} не найден!`);
        if (!fs.existsSync(this.audio2)) throw new Error(`Файл ${this.audio2} не найден!`);
        if (!fs.existsSync(this.sessionsDir)) throw new Error(`Папка ${this.sessionsDir} не найдена!`);

        const audio1Base64 = fs.readFileSync(this.audio1).toString('base64');
        const audio2Base64 = fs.readFileSync(this.audio2).toString('base64');
        
        const sessionDirs = fs.readdirSync(this.sessionsDir).filter(d => fs.statSync(path.join(this.sessionsDir, d)).isDirectory());
        if (sessionDirs.length === 0) throw new Error("Нет сессий в папке sessions/");
        
        const callResults = [];
        let currentSessionIndex = 0;

        for (let i = 0; i < phones.length; i += this.callsPerAccount) {
            const batch = phones.slice(i, i + this.callsPerAccount);
            if (batch.length === 0) break;
            
            const sessionName = sessionDirs[currentSessionIndex % sessionDirs.length];
            const sessionPath = path.join(this.sessionsDir, sessionName, 'browser_profile');
            const proxy = proxies.length > 0 ? proxies[currentSessionIndex % proxies.length] : undefined;
            
            this.emit('log', `\n======================================================`);
            this.emit('log', `🔄 Запускаємо акаунт: ${sessionName} для ${batch.length} дзвінків`);
            if (proxy) this.emit('log', `🌐 Проксі: ${proxy.server}`);
            this.emit('log', `======================================================\n`);

            const launchOptions = {
                headless: this.headless,
                viewport: { width: 1280, height: 720 },
                args: ['--use-fake-ui-for-media-stream', '--disable-web-security']
            };
            if (proxy) launchOptions.proxy = proxy;

            const context = await chromium.launchPersistentContext(sessionPath, launchOptions);
            const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

            await page.addInitScript(() => {
                const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = async (constraints) => {
                    if (constraints && constraints.audio) {
                        window.botAudioContext = new (window.AudioContext || window.webkitAudioContext)();
                        window.botAudioDest = window.botAudioContext.createMediaStreamDestination();
                        return window.botAudioDest.stream;
                    }
                    return originalGetUserMedia(constraints);
                };

                window.playBotAudio = async (base64) => {
                    const arrayBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
                    const audioBuffer = await window.botAudioContext.decodeAudioData(arrayBuffer);
                    const source = window.botAudioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(window.botAudioDest);
                    source.start(0);
                    return new Promise(resolve => source.onended = resolve);
                };

                window.recordedChunks = [];
                window.mediaRecorder = null;
                
                const originalPlay = window.HTMLAudioElement.prototype.play;
                window.HTMLAudioElement.prototype.play = function() {
                    if (this.srcObject && this.srcObject.getAudioTracks().length > 0 && !window.mediaRecorder) {
                        window.mediaRecorder = new MediaRecorder(this.srcObject, { mimeType: 'audio/webm' });
                        window.mediaRecorder.ondataavailable = e => window.recordedChunks.push(e.data);
                        window.mediaRecorder.start();
                    }
                    return originalPlay.apply(this, arguments);
                };

                window.stopAndGetRecording = async () => {
                    if(!window.mediaRecorder) return null;
                    return new Promise(resolve => {
                        window.mediaRecorder.onstop = () => {
                            const blob = new Blob(window.recordedChunks, { type: 'audio/webm' });
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                window.recordedChunks = [];
                                resolve(reader.result);
                            };
                            reader.readAsDataURL(blob);
                        };
                        window.mediaRecorder.stop();
                        window.mediaRecorder = null;
                    });
                };
            });

            await page.goto('https://web.telegram.org/k/');
            await page.waitForLoadState('domcontentloaded'); 
            await page.waitForTimeout(5000);

            try {
                this.emit('log', `Открываем бота-помощника ${this.helperBot}...`);
                await page.locator('.input-search input').fill(this.helperBot);
                await page.waitForTimeout(2000);
                await page.locator('.search-super-group .chatlist-chat, .chat-list .chatlist-chat').first().click();
                await page.waitForTimeout(2000);
            } catch(e) {
                this.emit('log', "❌ Не удалось найти бота-помощника.");
            }

            for (const phone of batch) {
                this.emit('log', `\n📞 Звоним на: ${phone}`);
                const cleanedPhone = phone.replace('+', '');
                
                try {
                    await page.locator('.input-message-input').click(); 
                    await page.keyboard.type(`t.me/+${cleanedPhone}`);
                    await page.waitForTimeout(500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000);
                    
                    const links = page.locator('.message-content a');
                    await links.last().click({ timeout: 5000 });
                } catch(e) {
                    this.emit('log', `❌ Ошибка отправки ссылки для ${phone}`);
                    await page.keyboard.press('Escape');
                    continue;
                }

                await page.waitForTimeout(3000);
                
                try {
                    await page.click('.chat-utils .btn-icon[title="Call"], .chat-info-actions .btn-icon[title="Call"], .chat-info-actions .btn-icon:has(i.icon-phone)', { timeout: 5000 });
                } catch(e) {
                    this.emit('log', `❌ Ошибка: нет кнопки звонка у ${phone}.`);
                    await page.keyboard.press('Escape');
                    await page.locator('.input-search input').fill(this.helperBot);
                    await page.waitForTimeout(1000);
                    await page.locator('.search-super-group .chatlist-chat, .chat-list .chatlist-chat').first().click();
                    await page.waitForTimeout(1000);
                    
                    const res = { phone, status: 'failed', response: 'No call button', time: new Date().toISOString() };
                    callResults.push(res);
                    this.emit('result', res);
                    continue;
                }

                await page.waitForTimeout(2000);
                this.emit('log', "📞 Ждем ответа...");
                
                let answered = false;
                for(let i=0; i<30; i++) {
                    const text = await page.textContent('body');
                    if(text.includes('00:0')) { answered = true; break; }
                    await page.waitForTimeout(1000);
                }

                let aiText = "";
                let aiEmotion = "";

                if (answered) {
                    this.emit('log', "✅ Ответили. Проигрываем 1.wav...");
                    await page.evaluate(async (base64) => await window.playBotAudio(base64), audio1Base64);
                    
                    this.emit('log', `Слушаем ответ собеседника (${this.listenTimeoutMs / 1000} сек)...`);
                    await page.waitForTimeout(this.listenTimeoutMs);
                    
                    const base64Audio = await page.evaluate(async () => await window.stopAndGetRecording());
                    
                    this.emit('log', "🧠 Отправляем аудио в AI-мозг...");
                    const aiResponse = await fetch(this.aiServer, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ audio: base64Audio })
                    }).then(r => r.json()).catch(e => ({ error: e.message }));
                    
                    this.emit('log', `🤖 Ответ AI: ${JSON.stringify(aiResponse)}`);
                    aiText = (aiResponse.transcription || "").toLowerCase();
                    aiEmotion = aiResponse.intonation || "neutral";
                    
                    if (aiText.includes("заверши") || aiText.includes("отмена") || aiText.includes("не звони") || aiEmotion === "negative") {
                        this.emit('log', "🛑 ИИ решил сбросить звонок (негатив/отказ)!");
                    } else {
                        this.emit('log', "🗣️ Проигрываем 2.wav...");
                        await page.evaluate(async (base64) => await window.playBotAudio(base64), audio2Base64);
                        await page.waitForTimeout(3000);
                    }
                    
                    const res = { phone, status: 'answered', response: aiText, emotion: aiEmotion, time: new Date().toISOString() };
                    callResults.push(res);
                    this.emit('result', res);
                } else {
                    this.emit('log', "❌ Не ответили.");
                    const res = { phone, status: 'no_answer', response: '', emotion: '', time: new Date().toISOString() };
                    callResults.push(res);
                    this.emit('result', res);
                }
                
                this.emit('log', "Кладём трубку...");
                try {
                    await page.click('.call-container .btn-icon.rp[title="Decline"], .call-container .btn-icon:has(i.icon-phone-decline)');
                } catch(e) {}
                await page.waitForTimeout(3000);
                
                try {
                    await page.keyboard.press('Escape'); 
                    await page.locator('.input-search input').fill(this.helperBot);
                    await page.waitForTimeout(1000);
                    await page.locator('.search-super-group .chatlist-chat, .chat-list .chatlist-chat').first().click();
                    await page.waitForTimeout(1000);
                } catch (e) {}
            }

            await context.close();
            currentSessionIndex++;
        }
        this.emit('log', "\n✅ ОБЗВОН ЗАВЕРШЕН.");
        return callResults;
    }
}

module.exports = { TelegramVoiceBot };