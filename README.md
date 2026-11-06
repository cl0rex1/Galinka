# Galinka

Мессенджер для своего круга: личные чаты, группы до 100 человек, голосовые, фото и файлы. Сервер ваш, регистрация — по приглашению. Клиенты для Android, Windows, macOS, Linux и Arch Linux; на iPhone — веб-приложение.

[Сайт](https://mess.quiby.me) · [Веб-приложение](https://mess.quiby.me/app) · [История изменений](CHANGELOG.md) · [Задачи](TASKS.md) · [Релизы](https://github.com/cl0rex1/Galinka/releases)

![Переписка](docs/screenshots/desktop.png)

## Установка

Установщики — в [GitHub Releases](https://github.com/cl0rex1/Galinka/releases/latest):

- **Android 7+:** `Galinka-X.Y.Z-android-release.apk`.
- **Windows x64:** `Galinka-X.Y.Z-win-x64.exe` (NSIS, без сертификата Microsoft).
- **macOS:** DMG для Apple Silicon и Intel.
- **Linux x64:** AppImage или DEB.
- **Arch Linux x64:** `sudo pacman -U ./Galinka-X.Y.Z-arch-x64.pkg.tar.zst` (использует `electron44` из репозитория; рецепт — [packaging/arch/PKGBUILD](packaging/arch/PKGBUILD)).
- **iPhone и iPad:** Safari → «Поделиться» → «На экран Домой».

Уведомления включаются в «Настройки → Уведомления» на каждом устройстве. Android использует Firebase ([настройка](docs/ANDROID.md)), браузеры и iPhone с iOS 16.4+ — Web Push ([настройка](docs/WEB-PUSH.md)). Настольное приложение получает сообщения, пока запущено, в том числе в трее.

## Сервер

React 19 · TypeScript · Vite · Node.js 24 · Express 5 · PostgreSQL · Docker Compose. Установка на CasaOS, HTTPS, резервные копии и обновление — [docs/DEPLOY.md](docs/DEPLOY.md).

- Сообщения хранятся в PostgreSQL; LISTEN/NOTIFY и SSE обновляют открытые клиенты.
- Сеанс — HttpOnly cookie на 30 дней, продлевается при использовании. Пользователь видит свои устройства и может завершить любой сеанс.
- Регистрация: одноразовые ссылки из «Администрирование → Приглашения» или общий `INVITE_CODE` (необязателен).
- Файлы до 20 МБ, квота 500 МБ на аккаунт. Удалённые вложения удаляются с диска; неотправленные загрузки — через сутки.
- Голосовые переводятся в AAC/M4A с помощью FFmpeg и FFprobe (в Docker-образе уже есть; вне Docker укажите `FFMPEG_PATH` и `FFPROBE_PATH`).
- Сквозного шифрования, звонков и восстановления пароля по email нет. Администратор сервера имеет доступ к данным.
- Ограничения масштаба: rate limiter и файловое хранилище локальные для одного экземпляра.

Настольные приложения и APK содержат интерфейс и обращаются к `https://mess.quiby.me/messenger`. Демо без сервера: `/app?demo=1`.

## Разработка

```sh
npm ci
npm run setup
docker compose -f compose.yml -f compose.dev.yml up -d db
npm run dev
```

Веб: `http://localhost:5173`.

Проверки:

```sh
npm run check
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

API-тесты и браузерные сценарии с реальными аккаунтами запускаются только с `TEST_DATABASE_URL`, указывающим на отдельную тестовую базу; без неё они пропускаются. Перед браузерными тестами выполните `npm run build`. Для проверки голосовых нужен FFmpeg. WebKit на компьютере не заменяет проверку микрофона на физическом iPhone.

Сборки:

```sh
npm run desktop:build -- --win
npm run arch:build
npm run android:build
npm run android:release
```

Для Android нужны JDK 21, Android SDK и `ANDROID_HOME`; release требует ключ подписи ([docs/ANDROID.md](docs/ANDROID.md)). В PowerShell флаги передаются так: `npm.cmd run desktop:build -- --win`.

## Выпуск версии

1. Перенесите выполненное из [TASKS.md](TASKS.md) в новый раздел [CHANGELOG.md](CHANGELOG.md) (`## X.Y.Z — ГГГГ-ММ-ДД`) и поднимите `version` в `package.json`.
2. Тег `vX.Y.Z` запускает настольные и Android-сборки. Публикация берёт описание релиза из раздела CHANGELOG.md этой версии; без раздела публикация остановится.
3. Сервер обновляется отдельно ([docs/DEPLOY.md](docs/DEPLOY.md)). Страница `/changelog` на сайте строится из того же файла при сборке.
