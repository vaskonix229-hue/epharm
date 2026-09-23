# Бэклог

Актуальный список технических рисков и работ до полноценного промышленного запуска.
Обновлено: 2026-09-22.

## Текущее состояние

| Слой                           | Проверка                                           | Production                                             |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------ |
| Backend (Kotlin)               | clean build, 424/424 теста                         | Daribar OTP, exact receipt, fulfillment; Flyway V047   |
| Админ-фронт (React)            | 411/411, lint и production build успешны           | обучение, эфир и управление заказами                   |
| Мобильное приложение (Flutter) | analyze: 0 issues, 109/109 тестов                  | iOS 0.1.2+4 подписан и установлен на iPhone            |
| POSM (C#)                      | 37/37 core tests, Windows build без предупреждений | exact-only consumer и очередь заказов готовы к пилоту  |
| Витрина (Next.js)              | 171/171, lint и production build успешны           | durable outbox/worker заказов готовы к dark-launch     |
| OTP                            | Daribar provider + error/rollback tests            | 4-значный реальный SMS-код; `5445` только для dev/test |

Существующие production-данные после релиза сохранены: кампании, правила, плейлисты,
слайды и администратор не изменены. На 2026-08-04 в базе есть один фармацевт в статусе
`pending`, но ещё нет учебных программ и назначений; это ожидает активации и бизнес-настройки
через админку.

## P0 — до подключения реальных пользователей

- [x] **Вернуть безопасный OTP.** Daribar генерирует, отправляет и проверяет код через backend;
      `OTP_DEV_MODE=false`, `devCode` отсутствует в production-ответе, ключи не попадают в приложение.
- [ ] **Настроить промышленный Apple signing.** Тестовая сборка `kz.pharmacy.app` подписана
      Personal Team и истекла 2026-08-24. Репозиторий отвязан от Personal Team, удалён небезопасный
      `--no-strict`, добавлены fail-closed export config и `tools/build-ios-release.sh`. Для выпуска
      всё ещё нужен платный Apple Developer team, владеющий App ID, и первый TestFlight smoke-test.
- [x] **Восстановить Medusa-каталог.** Действующий legacy origin снова включён как точечно
      разрешённый IP:port, произвольный удалённый HTTP остаётся запрещён. Листинг и detail облегчены,
      таймаут измерен по live API, добавлены пяти минутное обновление, stale-on-error и почасовой
      рефреш связанных акций/POSM-товаров. Переезд Medusa на HTTPS остаётся отдельным P1 hardening.
- [x] **Закрыть frontend dependency vulnerabilities.** Зависимости админки и витрины обновлены;
      полный `npm audit --audit-level=low` сообщает 0 уязвимостей, regression-тесты и build зелёные.
- [x] **Проверить GitHub Actions после billing lock.** После pre-job failures 2026-09-03 полный CI-run
      `33877476994` успешно завершился 2026-09-04, поэтому прежний lock больше не подтверждается.
- [x] **Получить первый зелёный `P0 / merge gate`.** Расширенный workflow покрывает
      backend/admin/storefront/mobile/POSM/ops/security, а `main` защищён этим required check.
      PR #57 прошёл gate на точном head и влит без обхода защиты 2026-09-22.
- [x] **Запретить debug-signing production Android.** `assembleRelease` теперь fail-closed без полного
      `android/key.properties` и private release keystore; автоматический fallback на debug key удалён.

## P1 — эксплуатационная готовность

- [x] **Довести frontend lint до нуля.** ESLint админки и витрины проходит без ошибок.
- [x] **Обновить Node runtime сборок.** Админка и витрина закреплены на Node 24.15.0;
      контейнерные сборки проверяются вместе с lockfile и больше не дают `EBADENGINE`.
- [ ] **Провести production acceptance обучения.** Активировать pending-фармацевта, создать программу,
      этапы и назначение; пройти маршрут в мобильном приложении, тест, награду, сертификат,
      повторное назначение и проверку RBAC каждой административной роли.
- [ ] **Настроить сопоставление Standard-N продавцов.** В production приходят внешние USER_ID
      (например `33`), но активного сопоставленного фармацевта пока нет. Активировать профили и
      создать правило через новый UI. Код уже хранит pharmacy-scoped mapping и immutable audit,
      проверяет active/same-pharmacy и применяет его раньше эвристик имени; production-данные не менялись.
- [ ] **Провести POSM acceptance на реальной кассе.** Проверить рекомендацию, удаление триггера,
      чек на клиентском экране, 12-роликовый эфир, offline-outbox, reboot/watchdog, presence и
      новый receipt-capture lifecycle `active -> pending -> backend ACK -> delete`.
- [ ] **Провести fulfillment-пилот на двух кассах одной аптеки.** Сетевая доставка заказов включена
      2026-09-22 по прямому запросу владельца проекта: точный allowlist 477 аптек и отсечка старых
      заказов проверены, но после включения новый production-заказ ещё не поступал. Нужен согласованный
      реальный самовывоз в рабочее время: выдача по коду на двух кассах, идемпотентность, offline/retry,
      отмена и возврат статуса в кабинет покупателя. Ночная остановка касс после 22:00 Алматы —
      ожидаемое состояние, а не отказ интеграции. Частичная выдача остаётся отдельным продуктовым
      blocker: модель строк, перерасчёт и возврат оплаты не утверждены; текущая выдача атомарна.
- [ ] **Закрыть расхождения справочников перед массовой выдачей заказов.** Сверка ACC и ePharm
      нашла 496 точных активных пар, 7 связанных аптек без числового Medusa ID в ACC, одну
      ePharm-аптеку вне ACC-каталога и 25 ACC-аптек без ePharm-связи. Уточнить владельцев данных,
      исправить только подтверждённые пары и повторить read-only сверку; не включать `*` до этого.
      При сетевом rollout 26 устройств без проверенной активной пары ACC/ePharm оставлены вне
      order allowlist; подписанное обязательное обновление POSM 1.0.63 распространяется на них
      независимо от allowlist, если клиент способен подключиться к серверу.
- [ ] **Принять реальный ACC order bridge и расширить пилот.** Отдельный worker развернут с
      HMAC, allowlist, проверкой назначения и отсечкой старых заказов; после восстановления Абая
      провести согласованный самовывоз на двух независимых кассах, возврат статуса в кабинет,
      offline/retry и полную смену без ошибок. Сетевой allowlist уже включён, поэтому проверку
      выполнять с постоянным мониторингом и немедленным rollback при подтверждённом сбое.
      Не подменять этот тест синтетической записью напрямую в БД: production checkout создаёт
      коммерческий заказ через Daribar. История и rollback описаны в `ops/acc-order-bridge/README.md`.
- [ ] **Разобрать конфликты идентичности кассовых продаж.** До сетевого rollout в production уже
      возникали HTTP 409 для одного `saleId`/`DOCS.ID` с разной суммой чека (65 событий за
      21:00–21:26 UTC 2026-09-22). Проверить момент фиксации итогового чека и повторную отправку,
      не нарушая идемпотентность и атрибуцию рекомендаций; см. GitHub issue #60.
- [ ] **Устранить drift исходников ACC-витрины.** Живой `inkar-shop` на 90.156.222.185 содержит
      миграции до 024, а `storefront/` монорепозитория — до 010; заменять живой сайт старой
      сборкой нельзя. Сверить и принять актуальные исходники/миграции в Git, затем обеспечить
      воспроизводимые релизы всего сайта, а не только отслеживаемого order worker.
- [ ] **Определить доверенный источник статуса карточной оплаты.** Заказы с картой fail-closed и
      не должны попадать на кассу как оплаченные по данным браузера или клиента. Backend уже хранит
      claimed/accepted отдельно и понижает неизвестный `paid` до `pending`; осталось выбрать и
      принять подписанный server-to-server webhook/API производителя оплаты.
- [x] **Заменить временный enrollment касс.** HQ предварительно выдаёт одноразовый индивидуальный
      token для точной пары device/pharmacy, хранится только SHA-256, повторная выдача ротирует,
      отзыв немедленно даёт 401. Fleet-key и self-enrollment по умолчанию выключены в production.
- [ ] **Реализовать и принять официальный producer фискального чека.** POSM больше не строит
      нефискальную PNG-копию и принимает только побайтовый PDF/PNG с полным manifest + SHA-256.
      Нужен hardware-specific read-only адаптер установленного `TFR_Shtrih`/OFD, закрытый ACL inbox
      и приемка на конкретной версии ККМ. Без producer статус намеренно остаётся `waiting`.
- [ ] **Закрыть окно аварии после физической печати.** При нормальном завершении работают два
      независимых сигнала (print-log и Firebird close). Если Windows аварийно выключится после
      печати, но до обоих сигналов, active-черновик намеренно не считается продажей автоматически,
      чтобы не начислять бонусы по отменённым корзинам. Нужен подтверждённый closed-receipt source.
- [x] **Выдавать отдельный POSM key на устройство.** Все POSM endpoints принимают индивидуальный
      отзываемый token, проверяют pharmacy/device scope; общий ключ остался только как отключённая
      совместимость для контролируемой миграции.
- [x] **Закрыть доверенную цепочку POSM-обновлений.** Remote HTTP origins удалены, manifest
      подписывается offline ECDSA P-256 ключом и проверяется pinned SPKI до скачивания; URL, SHA,
      platform, version и mandatory связаны подписью. ZIP затем независимо проверяется по SHA-256.
- [x] **Исправить обработку неизвестных API-маршрутов.** `NoResourceFoundException` получает
      стабильный JSON 404/`NOT_FOUND`, покрытый integration test.
- [x] **Убрать шум Spring Data Redis/JPA при старте.** Redis repository scan явно выключен,
      потому что приложение использует `StringRedisTemplate`; JPA остаётся единственным repository store.

## P2 — надёжность и сопровождение

- [x] Автоматизировать PostgreSQL и MinIO backup, retention и регулярный restore-test. Код, systemd,
      encrypted off-site restic и метрики готовы; production acceptance требует заполнить backup.env.
- [x] Добавить uptime, error-rate, latency, disk/DB/MinIO monitoring и оповещения. Compose-профиль,
      dashboard и alerts готовы; ops должен подключить реальный `ALERT_WEBHOOK_URL` и test alert.
- [x] Подключить Sentry или аналог для backend, admin frontend и мобильного приложения. SDK и release
      identity готовы; нужны три DSN и staging test events.
- [x] Ввести immutable release id/tag, changelog и проверяемый rollback для каждого деплоя. Добавлены
      release contract, manifest, smoke и automatic/explicit rollback; включить protected `v*` tags.
- [ ] Провести нагрузочный тест сценариев 500 касс: heartbeat, playlist polling, offline sync,
      продажи, рекомендации и массовая загрузка роликов. k6 suite готов; нужен staging размером с prod,
      production-like dataset и сохранённый отчёт capacity run.
- [ ] Завершить mobile release checklist: TestFlight, privacy manifests, QR/камера на реальном
      устройстве, deep links, восстановление сессии и корректная обработка недоступного HTTPS endpoint.

## Выполнено 2026-09-08

- [x] Добавлены production-grade Standard-N mapping с HQ UI, same-pharmacy/active guard и audit.
- [x] Введена единая per-device POSM authentication, предварительная HQ-выдача, rotation/revoke
      и production default без legacy fleet-key.
- [x] POSM update chain переведена на HTTPS + offline ECDSA manifest signature + SHA-256;
      добавлен `tools/sign-posm-release.sh`, негативные tamper-тесты и запрет утечки device token.
- [x] Карточный payment claim отделён от доверенного состояния; до выбора authority выдача закрыта.
- [x] Исправлены API 404 и Redis/JPA startup scan; подготовлен `docs/20-production-acceptance.md`.
      Автоматизированная часть готова; TestFlight/камера/QR/privacy report требуют Apple credentials и
      физического iPhone по `docs/mobile-release-evidence.example.json`.

## Выполнено 2026-08-04

- [x] Production backup БД, исходников, конфигурации и image ids перед релизом.
- [x] Миграции обучения v035/v036 применены без потери существующих данных.
- [x] Админка, API обучения, LMS, эфир до 12 роликов и оба ingress-адреса отвечают 200.
- [x] P1SMS отключён, фиксированный OTP `5445` проверен request/verify smoke-тестом.
- [x] Presence хранится по `(pharmacyId, deviceId)`: четыре кассы видны одновременно.
- [x] Полные backend, frontend и Flutter test suites проходят локально.

## Выполнено 2026-08-20

- [x] Из Combined API Swagger извлечён и реализован Daribar OTP flow `/api/v2/sms` -> `/api/v2/auth`.
- [x] Добавлена миграция V039, provider-bound OTP, безопасная обработка ошибок и отказ от хранения
      внешних OTP/tokens.
- [x] Backend 394/394 и Flutter 107/107 проходят; `flutter analyze` сообщает 0 issues.

## Выполнено 2026-08-28

- [x] Добавлен read-only POSM receipt capture: атомарный active JSON, pending PNG/JSON, crash
      recovery, quarantine и удаление только после backend ACK.
- [x] Sale id стал детерминированным по аптеке и Standard-N `DOCS.ID`; повторные сигналы и retry
      не создают дубли.
- [x] Backend сохраняет `pharmacyId`, source document/capture metadata и внутренний `productId`
      рядом с исходными iPartID/EAN/name; Flyway V041 проходит полный backend test suite.
- [x] Восстановлен массовый канал POSM-обновлений: бинарный bridge v1.0.47 опубликован отдельно от
      приватных исходников, production URL закреплён за immutable commit через jsDelivr, резервный
      GitHub release, HTTPS/Range и SHA-256 проверены; аптечные `posm.json` не изменяются.

## Выполнено 2026-09-02

- [x] Удалён генератор нефискального `receipt.png`; legacy-файлы и ложный `artifactFormat=png`
      очищаются/игнорируются без нарушения доставки продаж от старых касс.
- [x] Добавлен exact-only handoff: строгая корреляция аптек/`DOCS.ID`/суммы/времени, обязательные
      фискальные реквизиты, проверка PDF/PNG, SHA-256 до и после durable copy, quarantine и retention.
- [x] Фискальное обогащение вынесено в отдельную outbox-запись; backend не допускает подмену первого
      принятого хеша и не запускает повторную атрибуцию/сверку.

## Выполнено 2026-09-04

- [x] Реализован сквозной модуль аптечного исполнения заказов: транзакционный outbox витрины,
      HMAC-контракт, строгая идемпотентность, монотонный feed, очередь POSM и административный UI.
- [x] Добавлены fail-closed feature flags, явная UTC-граница запуска, per-device token, защита
      кода выдачи от перебора и HMAC с привязкой к конкретному заказу.
- [x] Полные проверки проходят: backend 412/412, POSM 29/29, admin 399/399, storefront 171/171;
      обе веб-сборки, оба lint и оба dependency audit успешны.
