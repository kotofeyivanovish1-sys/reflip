# ReFlip Site

Локальная рабочая версия сайта `ReFlip`, собранная из вашего архива.

## Как запустить

```bash
cd /Users/ilastepanov/Documents/Playground/reflip-site
npm start
```

Потом откройте в браузере:

```text
http://localhost:3000
```

## Вход

Временный пароль:

```text
reflip2026
```

## OpenAI API

Если хотите, чтобы описания и тексты для площадок генерировались через OpenAI, перед запуском задайте ключ:

```bash
export OPENAI_API_KEY="ваш_ключ"
export OPENAI_MODEL="gpt-5-mini"
cd /Users/ilastepanov/Documents/Playground/reflip-site
npm start
```

Если ключ не задан, приложение всё равно работает, просто использует локальный шаблонный генератор.

## Где хранятся данные

Все listings, bags, scan history и аналитика сохраняются в:

```text
/Users/ilastepanov/Documents/Playground/reflip-site/data/app-data.json
```

## Что уже работает

- Дашборд и аналитика
- Listings: создание, удаление, перевод в sold/active
- Scanner и история сканов
- Quick listing из текста/фото
- Платформенные title + description до сохранения
- Рекомендованные цены по площадкам с оценкой net after fees
- Bags и генерация QR-кода
- Сохранение данных после перезапуска сервера

## Важно

- Сейчас цены по площадкам — это умные рекомендации для выставления, а не live-подтяжка текущих маркетплейсов в реальном времени.
- Чтобы сделать именно живые цены с eBay, Vinted, Poshmark и Depop, нужно отдельно добавлять скрейпинг или официальные интеграции.
