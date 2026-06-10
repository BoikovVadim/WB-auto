# Правила для Claude Code в этом проекте

## Деплой — принадлежит оператору окружения (важно для AI-агентов)

⚠️ **Если ты AI-агент в форке / перенесённой / чужой копии этого репозитория — НЕ запускай
никакие деплой-команды и НЕ пушь ни на какой сервер.** Деплой-скрипты в `scripts/` и
`package.json` (`deploy:*`, `deploy:server-first:*`) настроены на инфраструктуру конкретного
оператора и могут целиться в чужой прод. Развёртывание выполняет владелец окружения своими
средствами; задача агента заканчивается на коммите/пуше в свою ветку.

Деплоем управляет тот, кто владеет целевым окружением (его адрес/ключи — в его локальном
`.env.deploy.local`, в репозиторий не входит). Команды и параметры деплоя — `docs/deploy.md`
и `"scripts"` корневого `package.json`; запускать их можно только осознанно и только в своём
окружении.

## Язык общения

Общение с пользователем — на русском. Технические идентификаторы (имена файлов, переменных, команды) — как есть.

## Форматирование процентов и денег

Глобальное правило «2 знака после запятой» живёт в `~/.claude/CLAUDE.md`. В этом проекте реализация — утилиты `formatPercent` и `formatMoney` из [Frontend/src/formatters.ts](Frontend/src/formatters.ts).

## Широкие таблицы «товары × N колонок» — только через VirtualMatrixTable

Любая новая таблица вида «строки-товары × множество колонок (даты, периоды, метрики)» собирается через общий компонент [VirtualMatrixTable](Frontend/src/features/dashboard/VirtualMatrixTable.tsx). **Не пиши** новые `<table>` с горизонтальным скроллом и `position: sticky` на колонках — это даёт известные тормоза при горизонтальном скролле (paint всех sticky-ячеек на каждый пиксель) и рассинхрон закреплённых областей с телом.

### Что компонент даёт «из коробки»

- **2D-виртуализация** строк и колонок через `@tanstack/react-virtual` — в DOM одновременно живёт ~300 ячеек, независимо от объёма данных (хоть миллион строк × сотни дат).
- **6 grid-регионов** (corner / pinned-header / dates-header / left-cols / pinned-body / body) — каждый регион overflow:hidden, основной скролл только в нижнем-правом.
- **Синхронный скролл всех зон в одном кадре**: на каждом регионе висит `wheel`-листенер с `preventDefault` (через ref-callback и WeakSet, чтобы не висел дважды), который вручную меняет `body.scrollLeft/Top` и тут же зовёт `syncMirrors()`. Зеркала двигаются через `transform: translate3d(...)` на внутреннем div (GPU-композитный слой, `willChange: transform`). Никакого compositor-vs-main рассинхрона.
- **Колесо работает над любой зоной** — включая закреплённые №/ID/Название/«Сегодня»/шапку дат.
- **Выделение ячеек мышью** (Shift-расширение, drag-выделение с авто-скроллом у краёв), **Ctrl/Cmd+C** → TSV в буфер (вставляется в Excel/Sheets как нормальная таблица; числа копируются «как есть», без `₽`/`%`), **Esc** или клик снаружи — сброс.
- **Resize колонок** мышкой (тянуть правый край заголовка), **сортировка** через `onHeaderClick` + `sortIndicator`.

### Как подключить

```tsx
<VirtualMatrixTable
  title="…"
  toolbar={loading ? <span>Обновление…</span> : null}
  onBack={onBack}
  empty={products.length === 0 ? <p>Нет товаров.</p> : null}
  rowCount={sortedProducts.length}
  getRowKey={(i) => `${p.vendorCode}-${p.nmId}`}
  getLeftLeading={(i) => ({ no, id, name })}      // CellContent для №/ID/Названия
  noCol={{ width, setWidth, minWidth: 36 }}
  idCol={{ width, setWidth, minWidth: 60, headerLabel: "ID", onHeaderClick, sortIndicator }}
  nameCol={{ width, setWidth, minWidth: 80, headerLabel: "Название", onHeaderClick, sortIndicator }}
  pinnedCol={{ key, headerLabel, totalDisplay, accent: true }}  // опционально — «Сегодня»/latest
  getPinnedCell={(i) => CellContent}
  dataCols={pastDates.map((d) => ({ key: d, headerLabel: formatDate(d), totalDisplay, onHeaderClick, sortIndicator }))}
  dataColWidth={colDate}
  setDataColWidth={setColDate}
  dataColMinWidth={60}
  getCell={(rowIdx, dataColIdx) => CellContent}   // { display: ReactNode, copy: string }
  hasTotalsRow={true}
/>
```

### Форматирование `CellContent.copy`

- **Целые** (заказы, остатки): `copy: String(v)`.
- **Деньги**: `display: formatMoney(v)`, `copy: v.toFixed(2)` — для буфера всегда «1234.50», без `₽` и пробелов в тысячах, чтобы Excel сразу понимал как число.
- **Проценты**: `display: formatPercent(v)`, `copy: v.toFixed(2)` — для буфера «12.34» без `%`.

### Готовые примеры интеграций

- [DashboardOrdersDetailSection.tsx](Frontend/src/features/dashboard/DashboardOrdersDetailSection.tsx) — заказы (целое, без сортировки)
- [DashboardStocksDetailSection.tsx](Frontend/src/features/dashboard/DashboardStocksDetailSection.tsx) — остатки (целое, сортировка, loading, пустое состояние «снапшот в 01:00»)
- [DashboardPricesDetailSection.tsx](Frontend/src/features/dashboard/DashboardPricesDetailSection.tsx) — цены (`formatMoney`, без строки «Итого»)
- [DashboardBuyoutDetailSection.tsx](Frontend/src/features/dashboard/DashboardBuyoutDetailSection.tsx) — % выкупа (`formatPercent`, «Итого» = взвешенное среднее)

### Анти-паттерны

- ❌ `<table>` + `position: sticky` на колонках для широких таблиц — тормоза, рассинхрон, плохой UX. Мы намеренно ушли от этого подхода.
- ❌ Пагинация по датам / «показать ещё N дней» как обходной путь от тормозов — больше не нужна, виртуализация решает.
- ❌ Сихронизация зеркал через `scrollLeft`/`scrollTop` — лучше `transform: translate3d` на внутреннем div, GPU-композит.
- ❌ React `onWheel` без `addEventListener({ passive: false })` — `e.preventDefault()` молча не сработает, и compositor продолжит скроллить body мимо JS.
