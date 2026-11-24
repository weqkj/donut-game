# 🍩 Donut Game

Telegram Mini App: кейсы, лидерборд, профиль, ракета (provably fair, SHA-256), апгрейдер, промокоды/чеки, задания, вывод.
Валюта donut — виртуальная. Пополнение только Telegram Stars: **1 ⭐ = 18 donut**.

```
docs/     сайт для GitHub Pages (фронтенд, без секретов)
worker/   бэкенд на Cloudflare Workers + D1 (бот, Stars, баланс, ракета, админка)
```

Без сервера сайт работает в **демо-режиме** (локально, без Telegram) — удобно смотреть дизайн.

## Запуск
1. **BotFather** → создай бота, получи токен. `/newapp` или Menu Button → URL сайта.
2. **GitHub Pages**: Settings → Pages → Deploy from branch → `main` / `/docs`.
3. **Cloudflare** (бесплатно):
   ```bash
   cd worker && npm i -g wrangler && wrangler login
   wrangler d1 create donut                 # скопируй database_id
   cp wrangler.toml.example wrangler.toml   # впиши database_id и BOT_USERNAME
   wrangler d1 execute donut --remote --file=schema.sql
   wrangler secret put BOT_TOKEN            # токен бота ТОЛЬКО сюда, не в код
   wrangler secret put WEBHOOK_SECRET       # любая длинная случайная строка
   wrangler deploy
   ```
4. Webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<worker-url>/webhook&secret_token=<WEBHOOK_SECRET>`
5. В `docs/js/config.js` впиши `API_URL` (адрес воркера) и `BOT_USERNAME`, закоммить.
6. Для обязательных подписок бот должен быть админом канала.

## Важно
- **Токен бота нельзя хранить в репозитории и на GitHub Pages** — только как секрет Worker.
- Баланс, кейсы, ракета считаются на сервере; сайт ничего не решает сам.
- Ракета: перед раундом публикуется `sha256(seed)`, после — `seed`; формула в `docs/js/fair.js` (идентична `worker/src/fair.js`). Возврат ≈95%, максимум 100x.
- Цены подарков — `docs/data/gifts.json` (звёзды ×18), кейсы и шансы — `docs/data/cases.json`.
- Вывод — заявка, админ подтверждает в админке и отправляет вручную. Проверь правила Telegram для Stars/Mini Apps.

## Ассеты
`docs/assets/{dog,gifts,rockets}/*.webp` — анимации. Пёс/подарки играют один раз (тап — снова), ракета — бесконечно.
Нет: `heart`, NFT-подарки (заглушки), иконки звезды/монеты.
