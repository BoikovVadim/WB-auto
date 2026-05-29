import { memo, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Schedule data
// ─────────────────────────────────────────────────────────────────────────────

type TaskCategory = "queue" | "sync" | "cache" | "import" | "system";

type IntervalTask = {
  type: "interval";
  label: string;         // e.g. "каждые 5 с"
  seconds: number;
};

type DailyTask = {
  type: "daily";
  hourMsk: number;
  minuteMsk: number;
};

type WeeklyTask = {
  type: "weekly";
  weekday: number;       // 0=Sun … 6=Sat
  hourMsk: number;
  minuteMsk: number;
};

type StartupTask = {
  type: "startup";
  delaySec?: number;
};

type ScheduledTask = {
  id: string;
  name: string;
  description: string;
  category: TaskCategory;
  source: "NestJS" | "macOS LaunchAgent" | "Startup";
  schedule: IntervalTask | DailyTask | WeeklyTask | StartupTask;
  enabled: boolean;
};

const TASKS: ScheduledTask[] = [
  // ── Queues / intervals ────────────────────────────────────────────────────
  {
    id: "bid-queue",
    name: "Очередь ставок и действий",
    description: "Обработка очереди смены ставок, действий кластеров и реконсиляции ставок",
    category: "queue",
    source: "NestJS",
    schedule: { type: "interval", label: "каждые 5 с", seconds: 5 },
    enabled: true,
  },
  {
    id: "orders-today-sync",
    name: "Заказы: обновление текущего дня",
    description: "Скачивает CSV-отчёт DETAIL_HISTORY_REPORT за сегодня и обновляет wb_product_daily_orders. Данные за сегодня корректируются в течение дня.",
    category: "sync",
    source: "NestJS",
    schedule: { type: "interval", label: "каждый час", seconds: 3600 },
    enabled: true,
  },
  {
    id: "preset-snapshot",
    name: "Очередь preset-снапшотов",
    description: "Материализация снапшотов рекламного воркспейса для товаров в очереди",
    category: "queue",
    source: "NestJS",
    schedule: { type: "interval", label: "каждые 15 с", seconds: 15 },
    enabled: true,
  },
  {
    id: "cache-prune",
    name: "Очистка кеша",
    description: "Удаление устаревших записей из in-memory кеша воркспейса",
    category: "cache",
    source: "NestJS",
    schedule: { type: "interval", label: "каждые 5 мин", seconds: 300 },
    enabled: true,
  },
  {
    id: "wb-promotion-sync",
    name: "Синхронизация WB Promotion API",
    description: "Скачивание и обновление рекламных кампаний, ставок и статусов",
    category: "sync",
    source: "NestJS",
    schedule: { type: "interval", label: "каждые 10 мин", seconds: 600 },
    enabled: true,
  },

  // ── Daily tasks ────────────────────────────────────────────────────────────
  {
    id: "jam-sync",
    name: "JAM: ночная синхронизация",
    description: "Удаление старых архивов, финализация данных вчерашнего дня, заполнение пробелов",
    category: "sync",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 6, minuteMsk: 0 },
    enabled: true,
  },
  {
    id: "vendor-sync",
    name: "Синхронизация артикулов и категорий",
    description: "Обновление вендор-кодов и названий категорий через WB Content API",
    category: "sync",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 7, minuteMsk: 0 },
    enabled: true,
  },
  {
    id: "monthly-import",
    name: "Импорт месячных частот (Safari)",
    description: "Автоматическая загрузка аналитики частот из WB через Safari + импорт в БД",
    category: "import",
    source: "macOS LaunchAgent",
    schedule: { type: "daily", hourMsk: 9, minuteMsk: 0 },
    enabled: true,
  },
  {
    id: "cost-price-snapshot",
    name: "Себестоимость: ежедневный снапшот",
    description: "Копирует актуальную себестоимость каждого товара в строку за сегодня. Ретроспектива растёт на 1 день автоматически.",
    category: "sync",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 0, minuteMsk: 1 },
    enabled: true,
  },
  {
    id: "orders-finalize",
    name: "Заказы: финализация вчерашнего дня",
    description: "Скачивает CSV-отчёт за вчера + сегодня после закрытия дня WB (~01:00 МСК). Фиксирует окончательные цифры заказов за вчера в ретроспективе.",
    category: "sync",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 2, minuteMsk: 0 },
    enabled: true,
  },
  {
    id: "orders-full-year-backfill",
    name: "Заказы: годовой бэкфил",
    description: "Однократный full-year backfill ~365 дней через DETAIL_HISTORY_REPORT — догружает пропуски (количество заказов, отмен, сумм выкупа) для корректной ретроспективы и % выкупа.",
    category: "sync",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 3, minuteMsk: 30 },
    enabled: true,
  },
  {
    id: "buyout-percent-daily-snapshot",
    name: "% выкупа: ежедневный снапшот",
    description: "Фиксирует итоговый % выкупа за вчерашний (закрытый) день — окно 365 дней, заканчивающееся вчера. Записывается через 10 минут после полной перезаливки заказов (03:30). Эта строка становится неизменной исторической записью и никогда не перезаписывается. Карточка товаров читает самый свежий snapshot одним SELECT'ом — мгновенный рендер.",
    category: "sync",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 3, minuteMsk: 40 },
    enabled: true,
  },
  {
    id: "precompute-period",
    name: "Предрасчёт рекламного периода",
    description: "Вычисление 7-дневного окна рекламной статистики на следующий день",
    category: "system",
    source: "NestJS",
    schedule: { type: "daily", hourMsk: 22, minuteMsk: 30 },
    enabled: true,
  },

  // ── Weekly tasks ───────────────────────────────────────────────────────────
  {
    id: "monthly-freq-sync",
    name: "Синхронизация read-model частот",
    description: "Обновление read-модели месячных частот запросов по всем кластерам",
    category: "sync",
    source: "NestJS",
    schedule: { type: "weekly", weekday: 0, hourMsk: 7, minuteMsk: 0 },
    enabled: true,
  },
  {
    id: "query-map-update",
    name: "Обновление карты запросов (Safari)",
    description: "Загрузка актуальной карты запросов кластеров из cmp.wildberries.ru",
    category: "import",
    source: "macOS LaunchAgent",
    schedule: { type: "weekly", weekday: 0, hourMsk: 10, minuteMsk: 0 },
    enabled: true,
  },

  // ── Startup tasks ──────────────────────────────────────────────────────────
  {
    id: "startup-vendor",
    name: "Синхронизация артикулов (старт)",
    description: "Немедленная синхронизация недостающих вендор-кодов при старте сервера",
    category: "sync",
    source: "Startup",
    schedule: { type: "startup" },
    enabled: true,
  },
  {
    id: "startup-cache-warmup",
    name: "Прогрев кеша частот",
    description: "Предварительная загрузка 300 000 записей частот поисковых запросов",
    category: "cache",
    source: "Startup",
    schedule: { type: "startup", delaySec: 30 },
    enabled: true,
  },
  {
    id: "startup-warmup",
    name: "Прогрев воркспейса",
    description: "Фоновая прогрев снапшотов для активных товаров",
    category: "system",
    source: "Startup",
    schedule: { type: "startup", delaySec: 300 },
    enabled: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  queue:  "#4caf50",
  sync:   "#2196f3",
  cache:  "#ff9800",
  import: "#9c27b0",
  system: "#607d8b",
};

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  queue:  "Очередь",
  sync:   "Синхронизация",
  cache:  "Кеш",
  import: "Импорт",
  system: "Система",
};

const DAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DAY_LABELS_FULL = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

function formatTime(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Returns today's weekday (0=Sun … 6=Sat) in MSK */
function todayWeekdayMsk(): number {
  const now = new Date();
  const msk = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Moscow" }));
  return msk.getDay();
}

/** % position along 24h for a given MSK hour:minute */
function timeToPercent(h: number, m: number) {
  return ((h * 60 + m) / (24 * 60)) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: TaskCategory }) {
  return (
    <span
      className="wb-tech-badge"
      style={{ background: CATEGORY_COLORS[category] + "22", color: CATEGORY_COLORS[category], borderColor: CATEGORY_COLORS[category] + "44" }}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function SourceBadge({ source }: { source: ScheduledTask["source"] }) {
  const colors: Record<ScheduledTask["source"], string> = {
    "NestJS": "#e3f2fd",
    "macOS LaunchAgent": "#fce4ec",
    "Startup": "#f3e5f5",
  };
  const textColors: Record<ScheduledTask["source"], string> = {
    "NestJS": "#1565c0",
    "macOS LaunchAgent": "#880e4f",
    "Startup": "#4a148c",
  };
  return (
    <span className="wb-tech-badge" style={{ background: colors[source], color: textColors[source], borderColor: "transparent" }}>
      {source}
    </span>
  );
}

// Single timeline row (one day of the week)
function DayTimeline({
  weekday,
  tasks,
  isToday,
}: {
  weekday: number;
  tasks: ScheduledTask[];
  isToday: boolean;
}) {
  const dailyTasks = tasks.filter((t): t is ScheduledTask & { schedule: DailyTask } =>
    t.schedule.type === "daily",
  );
  const weeklyTasks = tasks.filter((t): t is ScheduledTask & { schedule: WeeklyTask } =>
    t.schedule.type === "weekly" && t.schedule.weekday === weekday,
  );

  const allTimedTasks = [
    ...dailyTasks.map((t) => ({
      task: t,
      hour: (t.schedule as DailyTask).hourMsk,
      minute: (t.schedule as DailyTask).minuteMsk,
    })),
    ...weeklyTasks.map((t) => ({
      task: t,
      hour: (t.schedule as WeeklyTask).hourMsk,
      minute: (t.schedule as WeeklyTask).minuteMsk,
    })),
  ].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  return (
    <div className={`wb-tech-timeline-row${isToday ? " is-today" : ""}`}>
      <div className="wb-tech-timeline-day-label">
        <span className="wb-tech-timeline-day-short">{DAY_LABELS[weekday]}</span>
        {isToday && <span className="wb-tech-timeline-today-dot" title="Сегодня" />}
      </div>
      <div className="wb-tech-timeline-track">
        {/* Hour grid lines */}
        {[6, 9, 12, 15, 18, 21].map((h) => (
          <div
            key={h}
            className="wb-tech-timeline-gridline"
            style={{ left: `${String(timeToPercent(h, 0))}%` }}
          />
        ))}
        {/* Task markers */}
        {allTimedTasks.map(({ task, hour, minute }) => (
          <div
            key={task.id}
            className="wb-tech-timeline-marker"
            style={{
              left: `${String(timeToPercent(hour, minute))}%`,
              background: CATEGORY_COLORS[task.category],
            }}
            title={`${task.name}\n${formatTime(hour, minute)} МСК\n${task.description}`}
          >
            <span className="wb-tech-timeline-marker-time">{formatTime(hour, minute)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Task card in the list section
function TaskCard({ task }: { task: ScheduledTask }) {
  let scheduleText = "";
  const s = task.schedule;
  if (s.type === "interval") scheduleText = s.label;
  else if (s.type === "daily") scheduleText = `Ежедневно в ${formatTime(s.hourMsk, s.minuteMsk)} МСК`;
  else if (s.type === "weekly") scheduleText = `${DAY_LABELS_FULL[s.weekday]}, ${formatTime(s.hourMsk, s.minuteMsk)} МСК`;
  else if (s.type === "startup") scheduleText = s.delaySec != null ? `При старте сервера +${String(s.delaySec)} с` : "При старте сервера";

  return (
    <div className="wb-tech-task-card" style={{ borderLeftColor: CATEGORY_COLORS[task.category] }}>
      <div className="wb-tech-task-card__header">
        <span className="wb-tech-task-card__name">{task.name}</span>
        <div className="wb-tech-task-card__badges">
          <CategoryBadge category={task.category} />
          <SourceBadge source={task.source} />
        </div>
      </div>
      <div className="wb-tech-task-card__schedule">🕐 {scheduleText}</div>
      <div className="wb-tech-task-card__desc">{task.description}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main section
// ─────────────────────────────────────────────────────────────────────────────

type DashboardTechSectionProps = {
  onBack: () => void;
};

export const DashboardTechSection = memo(function DashboardTechSection({ onBack }: DashboardTechSectionProps) {
  const todayWd = todayWeekdayMsk();

  const intervalTasks = useMemo(() => TASKS.filter((t) => t.schedule.type === "interval"), []);
  const startupTasks  = useMemo(() => TASKS.filter((t) => t.schedule.type === "startup"), []);
  const timedTasks    = useMemo(() => TASKS.filter((t) => t.schedule.type === "daily" || t.schedule.type === "weekly"), []);

  // Ordered Mon–Sun (start from Monday = weekday 1)
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun

  return (
    <section className="wb-card wb-card--wide wb-tech-section">
      {/* Header */}
      <div className="wb-workspace-header wb-workspace-header--products-detail">
        <h2>Технический дашборд</h2>
        <button className="wb-secondary-button" type="button" onClick={onBack}>
          ← Дашборд
        </button>
      </div>

      <div className="wb-tech-scroll">

        {/* Legend */}
        <div className="wb-tech-legend">
          {(Object.keys(CATEGORY_COLORS) as TaskCategory[]).map((cat) => (
            <span key={cat} className="wb-tech-legend-item">
              <span className="wb-tech-legend-dot" style={{ background: CATEGORY_COLORS[cat] }} />
              {CATEGORY_LABELS[cat]}
            </span>
          ))}
        </div>

        {/* ── Weekly timeline ─────────────────────────────────────────────── */}
        <div className="wb-tech-block">
          <h3 className="wb-tech-block__title">Расписание по дням недели</h3>
          <p className="wb-tech-block__subtitle">Все задачи с конкретным временем запуска (МСК). Наведите на маркер — увидите детали.</p>

          {/* Hour labels */}
          <div className="wb-tech-timeline-hour-labels">
            <div className="wb-tech-timeline-day-label" /> {/* spacer */}
            <div className="wb-tech-timeline-track wb-tech-timeline-track--labels">
              {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
                <span
                  key={h}
                  className="wb-tech-timeline-hour-label"
                  style={{ left: `${String(timeToPercent(h, 0))}%` }}
                >
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>

          <div className="wb-tech-timeline">
            {weekdayOrder.map((wd) => (
              <DayTimeline
                key={wd}
                weekday={wd}
                tasks={TASKS}
                isToday={wd === todayWd}
              />
            ))}
          </div>
        </div>

        {/* ── Continuous / interval tasks ─────────────────────────────────── */}
        <div className="wb-tech-block">
          <h3 className="wb-tech-block__title">Непрерывные задачи</h3>
          <p className="wb-tech-block__subtitle">Работают постоянно на протяжении всего дня с фиксированным интервалом.</p>
          <div className="wb-tech-task-grid">
            {intervalTasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        </div>

        {/* ── Timed tasks list ────────────────────────────────────────────── */}
        <div className="wb-tech-block">
          <h3 className="wb-tech-block__title">Задачи по расписанию</h3>
          <p className="wb-tech-block__subtitle">Запускаются в конкретное время каждый день или раз в неделю.</p>
          <div className="wb-tech-task-grid">
            {timedTasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        </div>

        {/* ── Startup tasks ────────────────────────────────────────────────── */}
        <div className="wb-tech-block">
          <h3 className="wb-tech-block__title">Задачи при запуске сервера</h3>
          <p className="wb-tech-block__subtitle">Выполняются однократно при каждом старте бэкенда.</p>
          <div className="wb-tech-task-grid">
            {startupTasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        </div>

      </div>
    </section>
  );
});
