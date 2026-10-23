# Android

Приложение `me.quiby.galinka` работает на Android 7+ (API 24), целевая версия — Android 16 / API 36. Интерфейс включён в APK; сервер сообщений — `https://api.quiby.me/messenger`. Локальный HTTPS-origin совпадает с `APP_ORIGIN=https://mess.quiby.me`, поэтому HttpOnly/SameSite-сессии и проверка источника сохраняются.

## Сборка

Нужны Node.js 24+, JDK 21 и Android SDK (platform 36; Gradle установит недостающие build tools). Укажите `ANDROID_HOME` или `android/local.properties`.

```sh
npm ci
npm run android:build
```

Результат — `release/Galinka-0.3.0-android-debug.apk`. Для распространения используйте подписанную release-сборку:

```sh
export GALINKA_KEYSTORE=/absolute/path/galinka-release.jks
export GALINKA_STORE_PASSWORD='your-keystore-password'
export GALINKA_KEY_ALIAS=galinka
npm run android:release
```

`GALINKA_KEY_PASSWORD` нужен, если пароль ключа отличается от пароля хранилища. На Windows используйте переменные PowerShell `$env:...`. Скрипт также читает локальный `.secrets/android-signing.json` с теми же именами полей. Ключ и пароли исключены из Git и Docker context. Сохраните резервную копию: следующие APK должны быть подписаны тем же ключом. Debug и release подписаны разными ключами; Android не установит один поверх другого.

## Подключение пушей

Без Firebase APK работает, а настройки показывают «Пуши пока не подключены». Доставка в этой сборке не включена и на устройстве не проверена.

1. Создайте Firebase-проект, включите Cloud Messaging API и зарегистрируйте Android-приложение с package name `me.quiby.galinka`.
2. Сохраните клиентский `google-services.json` в `android/app/google-services.json`. Пересоберите APK. Флаг пушей включается автоматически только при наличии этого файла.
3. Сохраните ключ сервисного аккаунта Firebase на сервере в `.secrets/firebase-admin.json`. В APK этот ключ попадать не должен.
4. Запустите сервер с `PUSH_ENABLED=true` и `GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-admin.json`. Для Docker предусмотрен override:

```sh
docker compose -f compose.yml -f compose.edge.yml -f compose.push.yml up -d --build
```

5. Войдите в APK → Настройки → Уведомления и разрешите уведомления Android. Закройте приложение и отправьте сообщение из другого аккаунта. Нажатие на уведомление должно открыть нужный чат. После выхода из аккаунта уведомления этого сеанса должны прекратиться.

Приложение создаёт канал «Сообщения». Отправитель не получает уведомление о собственном сообщении. Сервер проверяет членство в чате, прочтение и срок сессии. Устройства отвязываются при выходе; истёкшие сеансы не получают пуши. В Firebase передаются только идентификаторы чата/сообщения и текст «Новое сообщение», без содержимого переписки. Очередь в PostgreSQL сохраняется при перезапуске; временные ошибки повторяются до пяти попыток. Доставка как минимум один раз: при частичном сбое возможен повтор, Android группирует уведомления по чату.

Пуши требуют Google Play Services; принудительная остановка приложения в Android блокирует доставку до следующего запуска. Пуши веб-версии и закрытого настольного приложения в этот выпуск не входят.

GitHub Actions → Android APK собирает APK вручную. Без signing secrets создаётся debug-артефакт. Для release задайте `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`; необязательный `GOOGLE_SERVICES_JSON` содержит клиентскую конфигурацию Firebase. Ключ сервисного аккаунта хранится только на сервере.

Документация: [Capacitor / Firebase](https://capacitorjs.com/docs/guides/push-notifications-firebase), [Firebase Admin](https://firebase.google.com/docs/admin/setup).
