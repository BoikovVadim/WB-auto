# Переезд на Oqqi — runbook (cutover)

Пошаговый переезд боевого экземпляра WB-автоматизации на `sales.oqqi.io`. Цель: ни одной минуты
двойной записи в кабинет WB и ни одной потерянной автоматической функции.

**Релиз-точка («свежий бандл»):** git-тег `oqqi-cutover` (коммит с read-only-гейтами). Перед
сверкой и перед cutover экземпляр Oqqi должен стоять РОВНО на этом теге.

---

## 0. Роли

- **Я (разработчик)** — держу код в релиз-точке, в момент cutover останавливаю свой экземпляр,
  снимаю догоняющий дамп бизнес-данных, помогаю с проверкой.
- **Ты (Oqqi)** — обновляешь код Oqqi до тега, держишь `WB_AUTOMATION_READ_ONLY=true` в shadow,
  в момент cutover снимаешь read-only и рестартишь. (Либо даёшь мне SSH к Oqqi — сделаю сам.)

---

## 1. Shadow-фаза (идёт сейчас)

1. **Обновить код Oqqi до релиз-точки** (на сервере Oqqi):
   ```bash
   cd <repo-на-oqqi>
   git fetch --tags && git checkout oqqi-cutover
   npm --prefix backend ci && npm --prefix backend run build
   npm --prefix Frontend ci && npm --prefix Frontend run build
   pm2 restart <oqqi-backend-process>
   ```
   ⚠️ До этого шага на Oqqi ОТКРЫТЫ 3 дыры записи в WB (ручной apply ставки/действия + смена
   цены). Тег `oqqi-cutover` их закрывает — пока не обновился, не трогай в UI цены/ставки/кластеры.

2. **Подтвердить read-only** (health должен показать флаг):
   ```bash
   curl -s https://sales.oqqi.io/wb/api/health | grep -i readOnly
   ```
   Ожидаем `wbAutomationReadOnly: true`. Если нет — выставить `WB_AUTOMATION_READ_ONLY=true` в env
   Oqqi и `pm2 restart`.

3. **Сверка несколько дней.** Расхождения «сегодня»-значений, отставание синков (rate-limit),
   накопители с точки старта — нормальны, сойдутся. Реальное расхождение → конкретный товар +
   метрика + оба значения, разбираем точечно.

---

## 2. Cutover (день переключения, порядок строгий)

1. **Я: останавливаю свой экземпляр** — конец двойной записи:
   ```bash
   pm2 stop wb-automation-backend   # на 95.163.226.154
   ```

2. **Я: догоняющий дамп бизнес-данных** (5 крупных регенерируемых таблиц НЕ трогаются — Oqqi
   накопил их сам за shadow):
   ```bash
   scripts/oqqi-db-transfer.sh cutover
   ```
   → восстановить в БД Oqqi через `pg_restore --clean --if-exists` (только бизнес-таблицы).

3. **Перенаправить Mac-агенты на БД Oqqi** (частоты + карта кластеров). В корневом `.env` мака:
   ```bash
   WB_HEADLESS_DB_SSH_HOST=root@<oqqi-host>        # SSH-хост БД Oqqi
   DATABASE_URL=postgres://<oqqi-creds>@localhost:15432/<db>   # креды Oqqi через туннель
   ```
   затем перезагрузить агенты:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.wb-automation.headless-frequency.plist
   launchctl load   ~/Library/LaunchAgents/com.wb-automation.headless-frequency.plist
   launchctl unload ~/Library/LaunchAgents/com.wb-automation.headless-query-map.plist
   launchctl load   ~/Library/LaunchAgents/com.wb-automation.headless-query-map.plist
   ```
   Без этого после cutover ТИХО встанут состав кластеров и частоты запросов (см.
   project-headless-query-map / project-frequency-import).

4. **Ты: снять read-only на Oqqi** — он становится единственным писателем:
   ```bash
   # env Oqqi: WB_AUTOMATION_READ_ONLY=false
   pm2 restart <oqqi-backend-process>
   ```

5. **Проверка первого живого цикла:**
   - health зелёный, `wbAutomationReadOnly: false`;
   - в «Истории изменений» появляется авто-смена с `initiated_by=automation` (движок реально пишет);
   - очереди ставок/действий флашатся (не копятся pending).

---

## 3. Откат (если на cutover что-то не так)

1. Ты: вернуть `WB_AUTOMATION_READ_ONLY=true` на Oqqi + `pm2 restart` (Oqqi снова немой).
2. Я: `pm2 start wb-automation-backend` — мой экземпляр снова единственный писатель.
3. Mac-агенты: вернуть `.env` к дефолту (убрать `WB_HEADLESS_DB_SSH_HOST`/вернуть мой `DATABASE_URL`),
   перезагрузить launchd.
Состояние — как до cutover, разбираемся без давления.

---

## 4. Перед самым cutover — финальный чек-лист

- [ ] Oqqi на теге `oqqi-cutover` (свежий бандл), health read-only=true.
- [ ] Сверка сошлась (нет необъяснённых расхождений).
- [ ] Ротирован пароль БД (старый когда-то был в репо).
- [ ] Готов SSH-хост Oqqi для Mac-агентов + креды БД Oqqi.
- [ ] DNS/домен для сотрудников указывает на Oqqi.
- [ ] Решено, кто гасит мой экземпляр и в каком окне.
