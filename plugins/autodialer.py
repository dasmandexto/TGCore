"""Модуль: Автообдзвон (Voice AI).

Запускає зовнішній Node.js модуль обдзвону.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from pathlib import Path

from core import PluginProtocol, PluginDeps

log = logging.getLogger(__name__)

class AutoDialerPlugin(PluginProtocol):
    name = "autodialer"
    description = "Голосовий AI-бот для дзвінків клієнтам."

    def __init__(self, deps: PluginDeps):
        super().__init__(deps)

    async def run(self, args: list[str]) -> None:
        cfg = self.deps.storage.get_module_config("autodialer") or {}
        
        phones = cfg.get("phones", "").strip().split("\n")
        phones = [p.strip() for p in phones if p.strip()]
        
        if not phones:
            log.warning("Список номерів порожній!")
            return

        calls_per_acc = int(cfg.get("callsPerAccount", 5))
        listen_timeout = int(cfg.get("listenTimeoutMs", 5000))
        headless = bool(cfg.get("headless", True))
        helper_bot = cfg.get("helperBot", "@reeeeveerbot")

        base_dir = Path(__file__).parent.parent / "voice_ai"
        
        # Створюємо тимчасовий скрипт для запуску
        runner_js = base_dir / "tgcore_runner.js"
        
        js_code = f"""
const fs = require('fs');
const {{ TelegramVoiceBot }} = require('./index.js');

const bot = new TelegramVoiceBot({{
    audio1: './1.wav',
    audio2: './2.wav',
    aiServer: 'http://localhost:8000/analyze_call',
    sessionsDir: './sessions',
    helperBot: '{helper_bot}',
    headless: {str(headless).lower()},
    callsPerAccount: {calls_per_acc},
    listenTimeoutMs: {listen_timeout}
}});

bot.on('log', msg => console.log(msg));
bot.on('result', res => console.log(`[РЕЗУЛЬТАТ] ${{res.phone}} -> ${{res.status}} (Емоція: ${{res.emotion || 'N/A'}})`));

const phones = {json.dumps(phones)};
const proxies = []; // Тут можна підтягнути проксі з deps.proxies, якщо потрібно

bot.call(phones, proxies)
    .then(results => {{
        fs.writeFileSync('./call_results.json', JSON.stringify(results, null, 2));
        console.log('✅ Всі завдання виконано успішно!');
    }})
    .catch(err => {{
        console.error('❌ Помилка обдзвону:', err.message);
        process.exit(1);
    }});
"""
        runner_js.write_text(js_code, encoding="utf-8")
        
        log.info("Запускаю Node.js процес автообдзвону (Voice AI)...")
        
        # Виконуємо через підпроцес, збираючи лог
        process = await asyncio.create_subprocess_exec(
            "node", str(runner_js),
            cwd=str(base_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )

        while True:
            line = await process.stdout.readline()
            if not line:
                break
            text = line.decode('utf-8').strip()
            if text:
                log.info(f"[Voice AI] {text}")
                self.deps.storage.log_event("autodialer", "info", text)

        await process.wait()
        
        if process.returncode == 0:
            log.info("Автообдзвон успішно завершено.")
        else:
            log.error(f"Node.js процес завершився з помилкою (код {process.returncode}).")