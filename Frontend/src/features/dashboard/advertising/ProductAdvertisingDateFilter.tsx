import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addCalendarMonths,
  buildAdvertisingCalendarDays,
  calendarWeekdayLabels,
  formatAdvertisingDateRangeLabel,
  formatAdvertisingMonthTitle,
  getAdvertisingDatePresetRange,
  getCalendarMonthStart,
  isAdvertisingCalendarDayDisabled,
  isCalendarDayWithinRange,
  isCalendarMonthDay,
  isSameCalendarDay,
  type AdvertisingDateBounds,
  type AdvertisingDatePreset,
  type AdvertisingDateRange,
} from "./date";

type ProductAdvertisingDateFilterProps = {
  dateRange: AdvertisingDateRange;
  bounds: AdvertisingDateBounds;
  onDateRangeChange: (value: AdvertisingDateRange) => void;
  onPresetHover?: (preset: AdvertisingDatePreset) => void;
};

export function ProductAdvertisingDateFilter(props: ProductAdvertisingDateFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [month, setMonth] = useState(() => getCalendarMonthStart(new Date()));
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setPreset = useCallback(
    (preset: AdvertisingDatePreset) => {
      const nextRange = getAdvertisingDatePresetRange(preset);
      props.onDateRangeChange(nextRange);
      setMonth(getCalendarMonthStart(nextRange.end ?? nextRange.start ?? new Date()));
      setIsOpen(false);
    },
    [props],
  );

  const handleDatePick = useCallback(
    (date: Date) => {
      const currentValue = props.dateRange;
      if (!currentValue.start || currentValue.end) {
        props.onDateRangeChange({ start: date, end: null });
        return;
      }

      if (date.getTime() < currentValue.start.getTime()) {
        props.onDateRangeChange({ start: date, end: currentValue.start });
        return;
      }

      props.onDateRangeChange({ start: currentValue.start, end: date });
    },
    [props],
  );

  useEffect(() => {
    if (props.dateRange.start && props.dateRange.end) {
      setIsOpen(false);
    }
  }, [props.dateRange.end, props.dateRange.start]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  const label = useMemo(
    () => formatAdvertisingDateRangeLabel(props.dateRange),
    [props.dateRange],
  );
  const calendarMonths = useMemo(() => [month, addCalendarMonths(month, 1)], [month]);

  return (
    <div className="wb-advertising-date-filter" ref={rootRef}>
      <button
        type="button"
        className={`wb-advertising-date-trigger${isOpen ? " is-open" : ""}`}
        onClick={() => {
          setIsOpen((currentValue) => !currentValue);
        }}
        aria-expanded={isOpen}
        aria-label="Фильтр по датам данных WB"
      >
        <span className="wb-advertising-date-trigger__value">{label}</span>
        <span className="wb-advertising-date-trigger__icon" aria-hidden="true">
          {isOpen ? "▴" : "▾"}
        </span>
      </button>
      {isOpen ? (
        <div className="wb-advertising-date-popover">
          <div className="wb-advertising-date-presets">
            {(
              [
                { preset: "today" as AdvertisingDatePreset, label: "Сегодня" },
                { preset: "yesterday" as AdvertisingDatePreset, label: "Вчера" },
                { preset: "week" as AdvertisingDatePreset, label: "Неделя" },
                { preset: "month" as AdvertisingDatePreset, label: "Месяц" },
              ] as const
            ).map(({ preset, label }) => (
              <button
                key={preset}
                type="button"
                className="wb-advertising-date-preset"
                onClick={() => setPreset(preset)}
                onMouseEnter={() => props.onPresetHover?.(preset)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="wb-advertising-date-calendar">
            <div className="wb-advertising-date-calendar__nav">
              <button
                type="button"
                className="wb-advertising-date-calendar__nav-button"
                onClick={() => {
                  setMonth((currentValue) => addCalendarMonths(currentValue, -1));
                }}
                aria-label="Предыдущий месяц"
              >
                ‹
              </button>
              <button
                type="button"
                className="wb-advertising-date-calendar__nav-button"
                onClick={() => {
                  setMonth((currentValue) => addCalendarMonths(currentValue, 1));
                }}
                aria-label="Следующий месяц"
              >
                ›
              </button>
            </div>
            <div className="wb-advertising-date-calendar__months">
              {calendarMonths.map((monthDate) => (
                <div
                  key={monthDate.toISOString()}
                  className="wb-advertising-date-calendar__month"
                >
                  <div className="wb-advertising-date-calendar__title">
                    {formatAdvertisingMonthTitle(monthDate)}
                  </div>
                  <div className="wb-advertising-date-calendar__weekdays">
                    {calendarWeekdayLabels.map((weekdayLabel) => (
                      <span key={`${monthDate.toISOString()}:${weekdayLabel}`}>
                        {weekdayLabel}
                      </span>
                    ))}
                  </div>
                  <div className="wb-advertising-date-calendar__days">
                    {buildAdvertisingCalendarDays(monthDate).map((day) => {
                      const isSelectedStart =
                        props.dateRange.start !== null &&
                        isSameCalendarDay(day, props.dateRange.start);
                      const isSelectedEnd =
                        props.dateRange.end !== null &&
                        isSameCalendarDay(day, props.dateRange.end);
                      const isSelected = isSelectedStart || isSelectedEnd;
                      const isInRange = isCalendarDayWithinRange(day, props.dateRange);
                      const isDisabled = isAdvertisingCalendarDayDisabled(day, props.bounds);

                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          className={`wb-advertising-date-calendar__day${
                            isCalendarMonthDay(day, monthDate) ? "" : " is-outside"
                          }${isInRange ? " is-in-range" : ""}${
                            isSelected ? " is-selected" : ""
                          }`}
                          onClick={() => handleDatePick(day)}
                          disabled={isDisabled}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
