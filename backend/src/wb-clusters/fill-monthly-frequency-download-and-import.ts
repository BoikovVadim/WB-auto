/**
 * Download WB search analytics report from the Downloads panel using Safari UI.
 *
 * Flow:
 *   1. Find or create a SUCCESS report for the target period via seller-content API.
 *   2. Open the Downloads Manager panel on the analytics page.
 *   3. Click the "Скачать" chip button for the matching file row — the portal's own
 *      React handler performs the fetch with full httpOnly credentials and saves the
 *      file to ~/Downloads as a ZIP.
 *   4. Wait for the ZIP to appear, extract XLSX, import to PostgreSQL.
 *
 * IMPORTANT: Requires a fresh WB seller portal session in Safari.
 * If download fails, log out and log back in to seller.wildberries.ru.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register \
 *     backend/src/wb-clusters/fill-monthly-frequency-download-and-import.ts
 */

import { access, readdir as fsReaddir, stat as fsStat, writeFile as fsWriteFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import {
  parseMonthlyFrequencyWorkbookBuffer,
} from "./monthly-frequency-analytics.ingest";
import type { MonthlyFrequencyRow } from "./monthly-frequency-analytics.types";
import {
  countMonthlyFrequencySnapshotRows,
  ensureMonthlyFrequencyTable,
  getRequiredMonthlyFrequencyPostgresConfig,
  loadMonthlyFrequencySnapshotSample,
  replaceMonthlyFrequencySnapshot,
} from "./monthly-frequency-import.persistence";
import { getDefaultMonthlyFrequencyImportPeriod } from "./monthly-frequency-import.period";
import {
  buildSafariImportApiBaseUrl,
  loadSafariImportEnv,
} from "./safari-import.env";
import { ensureDarwinSafariRuntime } from "./safari-import.runtime";
import { executeAppleScript } from "./wb-cmp-safari.client.apple-script";
import { listXlsxFiles, readWorkbookBuffer, waitForDownloadedXlsxFile } from "./wb-cmp-safari.client.downloads";
import {
  buildAsyncXhrAppleScript,
  buildCreateReportBody,
  buildListUrl,
  ContentAnalyticsDownloadEntry,
  ContentAnalyticsListResponse,
  ContentAnalyticsReportType,
  generateReportId,
  parseXhrResult,
  WB_CONTENT_ANALYTICS_CREATE_URL,
} from "./wb-content-analytics-api.client";

const REPORT_TYPE: ContentAnalyticsReportType = "SEARCH_ANALYSIS_PREMIUM_REPORT";
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 12 * 60 * 1_000;
const DOWNLOAD_WAIT_MS = 5 * 60 * 1_000;
const DOWNLOAD_POLL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAdvertisingText(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, " ");
}

/** Find a category zip already downloaded today with the matching period dates. */
async function findExistingCategoryZip(
  downloadsDirectory: string,
  categoryName: string,
  period: { from: string; to: string },
): Promise<string | null> {
  const fromFmt = formatDateForPortal(period.from); // "21.04.2026"
  const toFmt = formatDateForPortal(period.to);     // "20.05.2026"
  const todayStr = new Date().toISOString().slice(0, 10); // "2026-05-21"
  const catNFC = categoryName.normalize("NFC").toLowerCase();

  const entries = await fsReaddir(downloadsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.zip$/i.test(entry.name)) continue;
    const nameNFC = entry.name.normalize("NFC");
    if (!nameNFC.toLowerCase().startsWith(catNFC)) continue;
    if (!nameNFC.includes(fromFmt) || !nameNFC.includes(toFmt)) continue;
    try {
      const s = await fsStat(join(downloadsDirectory, entry.name));
      if (new Date(s.mtimeMs).toISOString().slice(0, 10) === todayStr) {
        return join(downloadsDirectory, entry.name);
      }
    } catch { continue; }
  }
  return null;
}

async function runAppleScript(script: string, timeoutMs: number): Promise<string> {
  return executeAppleScript(script, {
    timeoutMs,
    errorContext: "WB Analytics Download",
    onStderr: (msg) => console.warn("[osascript]", msg),
  });
}

async function apiGet(url: string): Promise<{ status: number; body: string; error: string | null }> {
  const script = buildAsyncXhrAppleScript({ method: "GET", url, pollSeconds: 30 });
  const raw = await runAppleScript(script, 45_000);
  return parseXhrResult(raw);
}

async function apiPost(url: string, body: string): Promise<{ status: number; body: string; error: string | null }> {
  const script = buildAsyncXhrAppleScript({ method: "POST", url, body, pollSeconds: 20 });
  const raw = await runAppleScript(script, 35_000);
  return parseXhrResult(raw);
}

async function listExistingReports(): Promise<ContentAnalyticsDownloadEntry[]> {
  const result = await apiGet(buildListUrl(REPORT_TYPE));
  if (result.error || result.status !== 200) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.body) as ContentAnalyticsListResponse;
    return parsed.data?.downloads ?? [];
  } catch {
    return [];
  }
}

async function loadSubjectNamesFromDb(client: Client): Promise<string[]> {
  // Union subjects from both campaign products and product catalog so that
  // newly added products (without active campaigns yet) are also covered.
  const result = await client.query<{ subject_name: string }>(
    `SELECT DISTINCT subject_name
     FROM (
       SELECT subject_name FROM public.wb_campaign_products
       WHERE subject_name IS NOT NULL AND subject_name <> ''
       UNION
       SELECT subject_name FROM public.wb_product_catalog
       WHERE subject_name IS NOT NULL AND subject_name NOT IN ('', '-')
     ) combined
     ORDER BY subject_name`,
  );
  return result.rows.map((r) => r.subject_name.trim()).filter(Boolean);
}

/** Load distinct category names. */
async function loadCategoryNamesFromDb(client: Client): Promise<string[]> {
  const result = await client.query<{ category_name: string }>(
    `SELECT DISTINCT category_name
     FROM public.wb_product_catalog
     WHERE category_name IS NOT NULL
     ORDER BY category_name`,
  );
  return result.rows.map((r) => r.category_name.trim()).filter(Boolean);
}

function normalizeQueryIdentityForDedup(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[_/\\|.,:;!?()[\]{}"'+=*%#№@`~^&-]+/g, " ")
    .replace(/\s+/g, " ");
}

async function createAndPollReport(
  reportId: string,
  subjectIds: number[],
  label: string,
): Promise<ContentAnalyticsDownloadEntry> {
  const body = buildCreateReportBody({ reportId, reportType: REPORT_TYPE, subjectIds });
  const createResult = await apiPost(WB_CONTENT_ANALYTICS_CREATE_URL, body);
  if (createResult.error || (createResult.status !== 200 && createResult.status !== 201)) {
    throw new Error(
      `Failed to create ${label} (HTTP ${createResult.status}): ${createResult.body.slice(0, 200)}`,
    );
  }
  console.log(`${label} created (HTTP ${createResult.status}). Polling for readiness...`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const list = await listExistingReports();
    const entry = list.find((e) => e.id === reportId);
    if (!entry) { console.log("Report not in list yet..."); continue; }
    console.log(`Report status: ${entry.status}`);
    if (entry.status === "SUCCESS") return entry;
    if (entry.status === "FAILED") throw new Error(`Report ${reportId} generation failed on WB servers.`);
  }
  throw new Error(`Report did not become ready within ${POLL_TIMEOUT_MS / 60_000} minutes.`);
}

async function findOrCreateReport(
  targetFrom: string,
  targetTo: string,
  subjectIds: number[],
): Promise<ContentAnalyticsDownloadEntry> {
  if (subjectIds.length > 0) {
    // Subject-filtered reports are always created fresh — we cannot distinguish
    // them from global 300k reports in the downloads list (params are not returned).
    const reportId = generateReportId();
    console.log(`Creating subject-filtered report ${reportId} for ${subjectIds.length} subjects: [${subjectIds.slice(0, 8).join(",")}${subjectIds.length > 8 ? "..." : ""}]`);
    return createAndPollReport(reportId, subjectIds, `subject-filtered report for ${targetFrom}→${targetTo}`);
  }

  // No subject IDs — fall back to global 300k report (check for existing SUCCESS first).
  console.log("No subject IDs provided. Checking for existing global ready reports...");
  const existing = await listExistingReports();
  const targetReportSize = 30_000_000;
  const matching = existing.filter(
    (e) =>
      e.status === "SUCCESS" &&
      e.startDate === targetFrom &&
      e.endDate === targetTo &&
      e.size >= targetReportSize,
  );
  if (matching.length > 0) {
    const best = matching.sort((a, b) => b.size - a.size)[0];
    console.log(`Found existing global report: ${best.id} (${best.name}, ${Math.round(best.size / 1024 / 1024)}MB)`);
    return best;
  }
  const reportId = generateReportId();
  console.log(`No global report found. Creating new global report ${reportId}...`);
  return createAndPollReport(reportId, [], `global report for ${targetFrom}→${targetTo}`);
}

/** Format ISO date (YYYY-MM-DD) to WB portal display format (DD.MM.YYYY). */
function formatDateForPortal(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Navigate to the WB search analytics page, apply filters by the given tab
 * ("Предметы" or "Категории"), click export, then download via Downloads panel.
 */
async function applyFiltersAndDownload(
  names: string[],
  filterTabText: string,
  filterSearchKeyword: string,
  startedAtMs: number,
  fileLabel?: string,
): Promise<void> {
  // language=javascript
  // Strategy:
  //  1. Use existing open WB tab, navigate to search-analytics
  //  2. Click "Фильтры" → filterTabText, type each name, click its checkbox
  //  3. Click "Применить" with full MouseEvent sequence (React-compatible)
  //  4. Click "Создать Excel", confirm dialog, download via Downloads panel
  const jsApplyFilters = `
(function(){
  window.__wbFilterResult = null;
  var SUBJECTS = ${JSON.stringify(names)};
  var FILTER_TAB_TEXT = ${JSON.stringify(filterTabText)};
  var FILTER_SEARCH_KEYWORD = ${JSON.stringify(filterSearchKeyword)};
  var FILE_LABEL = ${JSON.stringify(fileLabel ?? "")};
  var myRunId = window.__wbRunId || 1;

  // settled flag prevents double-calling done() from safety-timeout vs normal path
  var settled = false;
  function done(r){
    if(settled) return;
    settled = true;
    var s = JSON.stringify(r);
    window.__wbFilterResult = s;
    try { localStorage.setItem('__wbFilterResult', s); } catch(e){}
    try { document.cookie = '__wbFR=' + encodeURIComponent(s) + '; path=/; max-age=3600'; } catch(e){}
  }

  // Safety: after 300s always resolve so AppleScript doesn't hang
  setTimeout(function(){
    if(window.__wbRunId !== myRunId) return;
    done({s:'safety-timeout', idx:window.__wbIdx||0, total:SUBJECTS.length, step:window.__wbStep||'unknown'});
  }, 300000);

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Full React-compatible click: mousedown + mouseup + click + .click()
  function reactClick(el){
    el.focus();
    el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));
    el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,view:window}));
    el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    el.click();
  }

  // React-controlled input: set value + fire keyboard + input + change events.
  // keydown/keyup are required for WB's search to trigger (input alone doesn't fire the request).
  function reactType(input, value){
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    input.focus();
    setter.call(input, value);
    var lastChar = value ? value[value.length-1] : 'a';
    input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:lastChar}));
    input.dispatchEvent(new Event('input',{bubbles:true,cancelable:true}));
    input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,cancelable:true,key:lastChar}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }

  // Strip trailing count like " (25)" so "предмет (25)" matches "предмет"
  function normText(el){
    return (el.innerText||el.textContent||'').toLowerCase().trim()
      .replace(/\\s*\\(\\d+\\)\\s*$/, '').replace(/\\s+/g, ' ');
  }

  function findSearchInput(){
    return document.querySelector('#searchInput') ||
      Array.from(document.querySelectorAll('input')).find(function(i){
        return i.offsetParent !== null && (i.placeholder||'').toLowerCase().includes(FILTER_SEARCH_KEYWORD);
      }) || null;
  }

  // Find filter list item matching nameLower — multiple strategies + count-suffix stripping
  function findItemByText(nameLower){
    var s1 = Array.from(document.querySelectorAll('[class*=Filter-checkbox],[class*=filter-checkbox]'));
    for(var i=0; i<s1.length; i++){
      var el = s1[i]; if(!el.offsetParent) continue;
      if(normText(el) === nameLower) return el;
    }
    var s2 = Array.from(document.querySelectorAll('label'));
    for(var i=0; i<s2.length; i++){
      var el = s2[i]; if(!el.offsetParent) continue;
      if(normText(el) === nameLower) return el;
    }
    var s3 = Array.from(document.querySelectorAll('li,[role="option"],[role="listitem"]'));
    for(var i=0; i<s3.length; i++){
      var el = s3[i]; if(!el.offsetParent) continue;
      if(normText(el) === nameLower) return el;
    }
    return null;
  }

  // ── Step 0: close Excel creation dialog if it is open ────────────────────
  window.__wbStep = 'step0-cleanup';
  var didCloseDialog = false;
  (function(){
    // Strategy: look for the filename input OR any visible modal that contains "Сформировать"
    var nameInput = document.querySelector('#modalGetNameFileInput');
    var hasDialog = !!(nameInput && nameInput.offsetParent);
    if(!hasDialog){
      // Broader check: any visible modal with "Сформировать" text
      var allModals = Array.from(document.querySelectorAll('[class*="Modal"],[class*="modal"],[class*="Popup"],[class*="popup"],[class*="Dialog"],[class*="dialog"]'));
      for(var mi=0; mi<allModals.length; mi++){
        var m = allModals[mi];
        if(m.offsetParent && (m.innerText||'').includes('Сформировать')){ hasDialog = true; break; }
      }
    }
    if(hasDialog){
      // Find any cancel button on the page that's visible
      var cancelBtn = Array.from(document.querySelectorAll('button,[role="button"]')).find(function(b){
        if(!b.offsetParent) return false;
        var t = (b.innerText||b.textContent||'').trim();
        return t === 'Отмена' || t === 'Закрыть' || t === '✕' || t === '×';
      });
      if(cancelBtn){ cancelBtn.click(); didCloseDialog = true; }
    }
  })();

  // If we just closed a dialog, wait 1s for React to settle before opening filter panel
  setTimeout(function(){
    if(window.__wbRunId !== myRunId) return;

  // ── Step 1: click "Фильтры" button ──────────────────────────────────────
  window.__wbStep = 'step1-finding-filter-btn';
  // ── Step 0: wait for analytics page to be fully rendered (filter button) ─
  window.__wbStep = 'step0-waiting-page';
  var pageReadyWait = 0;
  var pageReadyPoll = setInterval(function(){
    pageReadyWait += 250;
    if(window.__wbRunId !== myRunId){ clearInterval(pageReadyPoll); return; }
    var allBtnsStep0 = Array.from(document.querySelectorAll('button'));
    var fb = allBtnsStep0.find(function(b){
      return (b.innerText||b.textContent||'').trim() === 'Фильтры';
    });
    if(!fb) fb = allBtnsStep0.find(function(b){
      var t = (b.innerText||b.textContent||'').trim();
      return t.toLowerCase().includes('фильтр') && t.length < 15;
    });
    if(fb || pageReadyWait >= 10000){
      clearInterval(pageReadyPoll);
      if(!fb){ return done({s:'no-filter-btn'}); }
      proceedWithFilters(fb);
    }
  }, 500);

  function proceedWithFilters(filterBtn){
  window.__wbStep = 'step1-clicking-filter-btn';
  // Only click "Фильтры" if panel is not already open
  // (clicking while open would toggle it closed)
  var panelAlreadyOpen = Array.from(document.querySelectorAll('button,[role="button"]')).some(function(b){
    return b.offsetParent !== null && (b.innerText||'').trim() === 'Применить';
  });
  if(!panelAlreadyOpen) reactClick(filterBtn);

  // ── Step 2: wait for filter panel = "Применить" visible ─────────────────
  var sidebarWait = 0;
  var sidebarPoll = setInterval(function(){
    sidebarWait += 150;
    // Stop if a newer run started
    if(window.__wbRunId !== myRunId){ clearInterval(sidebarPoll); return; }
    var panelOpen = Array.from(document.querySelectorAll('button,[role="button"]')).some(function(b){
      return b.offsetParent !== null && (b.innerText||'').trim() === 'Применить';
    });
    if(!panelOpen && sidebarWait < 4000) return;
    clearInterval(sidebarPoll);
    if(!panelOpen){ return done({s:'filter-panel-not-opened'}); }

    // ── Step 2b: RESET FILTERS — find "Сбросить" inside open panel ────────
    window.__wbStep = 'step2b-resetting-filters';
    var resetBtn = null;
    var allBtnsR = Array.from(document.querySelectorAll('button,[role="button"]'));
    for(var ri=0; ri<allBtnsR.length; ri++){
      var rb = allBtnsR[ri]; if(!rb.offsetParent) continue;
      var rt = (rb.innerText||rb.textContent||'').trim();
      if(rt === 'Сбросить' || rt === 'Сбросить всё' || rt === 'Очистить всё' || rt === 'Сбросить фильтры'){ resetBtn = rb; break; }
    }
    if(resetBtn){
      window.__wbStep = 'step2b-reset-clicking';
      reactClick(resetBtn);
    }

    // ── Step 2c: poll until panel is open again (reset may close it), then navigate ─
    var step2cWait = 0;
    var step2cPoll = setInterval(function(){
      step2cWait += 400;
      if(window.__wbRunId !== myRunId){ clearInterval(step2cPoll); return; }

      var panelIsOpen = Array.from(document.querySelectorAll('button,[role="button"]')).some(function(b){
        return b.offsetParent !== null && (b.innerText||'').trim() === 'Применить';
      });

      // Give up to 3s for panel to settle after reset before acting
      if(!panelIsOpen && step2cWait < 3000) return;

      clearInterval(step2cPoll);

      if(!panelIsOpen){
        // Reset closed the panel — re-open filter panel
        window.__wbStep = 'step2c-reopening-panel';
        var filterBtnR = Array.from(document.querySelectorAll('button')).find(function(b){
          var t = (b.innerText||b.textContent||'').trim();
          return t === 'Фильтры' || (t.toLowerCase().includes('фильтр') && t.length < 15);
        });
        if(filterBtnR) reactClick(filterBtnR);
        setTimeout(function(){
          if(window.__wbRunId !== myRunId) return;
          proceedToPredmety();
        }, 2000);
      } else {
        proceedToPredmety();
      }
    }, 400);

    function proceedToPredmety(){
    // ── Step 2d: find filter tab (Предметы / Категории) inside open panel ─
    var xr = document.evaluate(
      '//*[normalize-space(text())="' + FILTER_TAB_TEXT + '" and not(*)]',
      document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    );
    var predmetyEl = xr ? xr.singleNodeValue : null;
    if(predmetyEl && predmetyEl.offsetParent === null) predmetyEl = null;
    if(!predmetyEl){ return done({s:'no-sidebar-tab-' + FILTER_TAB_TEXT}); }

    // ── Step 3: click the filter tab nav item ───────────────────────────
    window.__wbStep = 'step3-clicking-' + FILTER_TAB_TEXT;
    var navItem = predmetyEl.closest(
      'button,[role="button"],[role="menuitem"],[role="tab"],[class*="nav"],[class*="Nav"],[class*="tab"],[class*="Tab"],[class*="item"],[class*="Item"]'
    ) || predmetyEl.parentElement || predmetyEl;

    reactClick(navItem);

    // ── Step 4: wait for search input to appear (up to 8s) ──────────────
    window.__wbStep = 'step4-waiting-predmety-load';
    var searchWait = 0;
    var searchPoll = setInterval(function(){
      searchWait += 150;
      if(window.__wbRunId !== myRunId){ clearInterval(searchPoll); return; }
      var si0 = findSearchInput();
      if(si0 || searchWait >= 4000){
        clearInterval(searchPoll);
        if(!si0){ return done({s:'no-search-input-after-predmety-tab'}); }

      window.__wbStep = 'step5-selecting-subjects';
      var subjectIdx = 0;
      var selectedCount = 0;
      var skippedSubjects = [];
      window.__wbIdx = 0;

      // ── Step 5: type each subject, wait for checkbox, click ─────────────
      function selectSubject(){
        if(window.__wbRunId !== myRunId) return;
        window.__wbIdx = subjectIdx;

        if(subjectIdx >= SUBJECTS.length){
          window.__wbStep = 'step5-done-selected-' + selectedCount + '-of-' + SUBJECTS.length;
          if(skippedSubjects.length > 0){
            window.__wbSkipped = JSON.stringify(skippedSubjects);
          }
          // Guard: if nothing was selected, don't create a report for all data
          if(selectedCount === 0){
            return done({s:'filter-load-failed', name: SUBJECTS[0]||'unknown', retries: 0, step: 'no-item-selected'});
          }
          // ── Step 6: click "Применить" ───────────────────────────────────
          setTimeout(doApply, 400);
          return;
        }

        var name = SUBJECTS[subjectIdx++];
        var nameLower = name.toLowerCase().trim();

        // Re-acquire search input each iteration (panel may re-render)
        var si = findSearchInput();
        if(!si){
          // Try to reopen the correct filter tab
          var xrR = document.evaluate('//*[normalize-space(text())="' + FILTER_TAB_TEXT + '" and not(*)]',document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null);
          var pelR = xrR ? xrR.singleNodeValue : null;
          if(pelR && pelR.offsetParent !== null){
            var niR = pelR.closest('button,[role="button"],[class*="item"],[class*="Item"]') || pelR.parentElement;
            if(niR) reactClick(niR);
          }
          setTimeout(selectSubject, 400);
          return;
        }

        // Type the subject name
        try { reactType(si, name); } catch(e){ setTimeout(selectSubject, 200); return; }

        // Poll: wait for loader to finish, then find and click item (max 8s total)
        var waitMs = 0;
        var loadingDone = false;
        var afterLoadMs = 0;
        var retryCount = 0;
        var retrying = false;  // pauses poll during retry wait
        var pollMatch = setInterval(function(){
          waitMs += 200;
          if(window.__wbRunId !== myRunId){ clearInterval(pollMatch); return; }

          // Pause counting while we're waiting for retry sequence to complete
          if(retrying) return;

          // Track when loader disappears
          var loaderEl = document.querySelector('[class*=Filter-checkbox-group__loader]');
          var isLoading = !!(loaderEl && loaderEl.offsetParent);
          if(!isLoading && !loadingDone){ loadingDone = true; afterLoadMs = 0; }
          if(loadingDone) afterLoadMs += 200;

          // Keep waiting while loading (up to 12s)
          if(isLoading && waitMs < 12000) return;

          // Detect "Обновить" error button (WB shows it when data fails to load)
          // Only check once loading is done and we've waited a bit (avoid false positives during load)
          if(loadingDone && afterLoadMs >= 800){
            var retryBtn = null;
            var allBtnsR = Array.from(document.querySelectorAll('button,[role="button"]'));
            for(var ri=0; ri<allBtnsR.length; ri++){
              var rb = allBtnsR[ri]; if(!rb.offsetParent) continue;
              var rt = (rb.innerText||rb.textContent||'').trim();
              if(rt === 'Обновить' || rt === 'Загрузить заново' || rt === 'Повторить'){
                retryBtn = rb; break;
              }
            }
            if(retryBtn){
              retryCount++;
              if(retryCount > 5){
                // Too many Обновить retries — portal won't load this filter; skip category
                clearInterval(pollMatch);
                done({s:'filter-load-failed', name: name, retries: retryCount});
                return;
              }
              retrying = true;
              reactClick(retryBtn);
              // Reset poll state; clear search and re-type subject name after page settles
              waitMs = 0; loadingDone = false; afterLoadMs = 0;
              setTimeout(function(){
                if(window.__wbRunId !== myRunId) return;
                var si2 = findSearchInput();
                if(si2){
                  try{ reactType(si2, ''); }catch(e){}
                  setTimeout(function(){
                    if(window.__wbRunId !== myRunId) return;
                    loadingDone = false; afterLoadMs = 0;  // reset again after retype
                    retrying = false;  // resume poll
                    var si3 = findSearchInput();
                    if(si3){ try{ reactType(si3, name); }catch(e){} }
                  }, 800);
                } else {
                  loadingDone = false; afterLoadMs = 0;
                  retrying = false;
                }
              }, 5000);
              return;
            }
          }

          var item = findItemByText(nameLower);

          // Once loading finished, give 800ms more for React to render, then skip
          if(item || (loadingDone && afterLoadMs >= 800) || waitMs >= 12000){
            clearInterval(pollMatch);

            if(item){
              // item = div.Filter-checkbox; find label inside it for a clean single click
              var lbl = item.querySelector('label') || item;
              var chk = item.querySelector('input[type="checkbox"]');
              if(chk && chk.checked){
                // Already selected — skip, don't toggle off
                selectedCount++;
              } else {
                // Single .click() on label triggers checkbox check in React
                lbl.click();
                selectedCount++;
              }
            } else {
              // Item not found: log which subject was skipped and why
              var skipReason = (waitMs >= 12000) ? 'timeout-'+retryCount+'retries' : 'no-item-after-load';
              skippedSubjects.push({name: name, reason: skipReason, retries: retryCount});
              window.__wbStep = 'step5-skipped-'+name.substring(0,20)+'-'+skipReason;
            }

            // Clear input so list resets for next subject
            var inp = findSearchInput();
            if(inp){ try{ reactType(inp, ''); }catch(e){} }

            setTimeout(selectSubject, 250);
          }
        }, 400);
      }

      // ── Step 6: click "Применить" with full MouseEvent sequence ─────────
      function doApply(){
        window.__wbStep = 'step6-finding-apply';

        var applyBtn = null;
        var allBtnsA = Array.from(document.querySelectorAll('button,[role="button"]'));
        for(var ai=0; ai<allBtnsA.length; ai++){
          var ab = allBtnsA[ai]; if(!ab.offsetParent) continue;
          var at = (ab.innerText||ab.textContent||'').trim();
          if(at === 'Применить'){ applyBtn = ab; break; }
        }
        if(!applyBtn){
          for(var ai=0; ai<allBtnsA.length; ai++){
            var ab = allBtnsA[ai]; if(!ab.offsetParent) continue;
            var at = (ab.innerText||ab.textContent||'').trim();
            if(at.indexOf('Применить') === 0){ applyBtn = ab; break; }
          }
        }

        if(applyBtn){
          window.__wbStep = 'step6-apply-clicking';
          reactClick(applyBtn);
          window.__wbStep = 'step6-apply-clicked';
        } else {
          window.__wbStep = 'step6-apply-not-found';
        }

        // Poll: wait for Apply panel to close (up to 6s), then create Excel
        var applyWait = 0;
        var applyPoll = setInterval(function(){
          applyWait += 200;
          if(window.__wbRunId !== myRunId){ clearInterval(applyPoll); return; }

          var panelStillOpen = Array.from(document.querySelectorAll('button,[role="button"]')).some(function(b){
            return b.offsetParent !== null && (b.innerText||'').trim() === 'Применить';
          });

          if(!panelStillOpen || applyWait >= 3000){
            clearInterval(applyPoll);
            window.__wbStep = panelStillOpen ? 'step6-apply-panel-still-open' : 'step6-apply-panel-closed';

            // ── Step 7: click "Создать Excel" (give 600ms for filtered data to reload)
            setTimeout(function(){
              if(window.__wbRunId !== myRunId) return;
              window.__wbStep = 'step7-finding-create-excel';

              var createBtn = null;
              var allBtns7 = Array.from(document.querySelectorAll('button,[role="button"]'));

              for(var bi=0; bi<allBtns7.length; bi++){
                var b = allBtns7[bi]; if(!b.offsetParent) continue;
                var ti = (b.getAttribute('title')||b.getAttribute('aria-label')||b.getAttribute('data-tooltip')||'').toLowerCase();
                var bt = (b.innerText||b.textContent||'').toLowerCase();
                if(ti.includes('excel') || ti.includes('создать') || bt.includes('создать excel')){
                  createBtn = b; break;
                }
              }

              if(!createBtn){
                var iconBtns = Array.from(document.querySelectorAll('button')).filter(function(b){
                  return b.offsetParent !== null &&
                    b.className.indexOf('rt-0-surface--control') !== -1 &&
                    (b.innerText||'').trim() === '';
                }).sort(function(a,b){ return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
                if(iconBtns.length >= 1) createBtn = iconBtns[0];
              }

              if(!createBtn){
                var dbg = allBtns7.filter(function(b){ return b.offsetParent!==null; }).slice(0,40).map(function(b){
                  return {t:(b.innerText||'').trim().slice(0,30),ti:b.getAttribute('title')||'',al:b.getAttribute('aria-label')||''};
                });
                return done({s:'no-create-excel', selected:selectedCount, skipped:skippedSubjects, btns:dbg});
              }

              window.__wbStep = 'step7-create-excel-clicking';
              // Click "Создать Excel" — this opens a dialog asking for filename
              reactClick(createBtn);

              // Wait for the dialog with filename input to appear (up to 8s)
              var dlgWait = 0;
              var dlgPoll = setInterval(function(){
                dlgWait += 400;
                if(window.__wbRunId !== myRunId){ clearInterval(dlgPoll); return; }

                var nameInput = document.querySelector('#modalGetNameFileInput');
                var dlgOpen = !!(nameInput && nameInput.offsetParent);

                if(dlgOpen || dlgWait >= 8000){
                  clearInterval(dlgPoll);

                  if(dlgOpen){
                    window.__wbStep = 'step7-excel-dialog-found';
                    // Set filename if provided
                    if(FILE_LABEL && nameInput.offsetParent){
                      try {
                        var setter7 = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
                        nameInput.focus();
                        setter7.call(nameInput, FILE_LABEL);
                        nameInput.dispatchEvent(new Event('input',{bubbles:true}));
                        nameInput.dispatchEvent(new Event('change',{bubbles:true}));
                      } catch(e) {}
                    }
                    // Find "Сформировать" / "Создать" / "Скачать" submit button in the dialog.
                    // Walk up to the full modal container (has "Modal--" class) so that
                    // buttons in the footer section are included, not just the content area.
                    var fullModal = nameInput;
                    for(var mi2=0; mi2<15; mi2++){
                      if(!fullModal.parentElement || fullModal.tagName === 'BODY') break;
                      fullModal = fullModal.parentElement;
                      if((fullModal.className||'').includes('Modal--')) break;
                    }
                    var submitBtn = null;
                    var dlgBtns = Array.from(fullModal.querySelectorAll('button,[role="button"]'));
                    for(var dbi=0; dbi<dlgBtns.length; dbi++){
                      var db = dlgBtns[dbi];
                      if(!db.offsetParent) continue;
                      var dt = (db.innerText||db.textContent||'').trim();
                      if(dt==='Сформировать'||dt==='Создать'||dt==='Скачать'||dt==='Сохранить'||dt==='OK'||dt==='Ок'){
                        submitBtn = db; break;
                      }
                    }
                    if(submitBtn){
                      window.__wbStep = 'step7-excel-submit-clicking';
                      submitBtn.click();
                      window.__wbStep = 'step7-excel-submit-clicked';
                    } else {
                      window.__wbStep = 'step7-excel-no-submit-btn';
                    }
                  } else {
                    // No dialog appeared — Excel may have been created without dialog
                    window.__wbStep = 'step7-no-dialog-ok';
                  }

                  done({s:'ok', selected:selectedCount, total:SUBJECTS.length, skipped:skippedSubjects});
                }
              }, 200);
            }, 600);
          }
        }, 400);
      }

      selectSubject();
      }  // end if(si0 || searchWait >= 8000)
    }, 300);  // end searchPoll setInterval
    }  // end proceedToPredmety
  }, 300);  // end sidebarPoll setInterval
  }  // end proceedWithFilters
  }, didCloseDialog ? 1000 : 0);  // end outer setTimeout — delay after closing Excel dialog
})()`.trim();

  // Write JS to a temp file so AppleScript reads it without any escaping issues
  const jsTmpPath = "/tmp/wb-filter-inject.js";
  await fsWriteFile(jsTmpPath, jsApplyFilters, "utf8");

  const ANALYTICS_URL = "https://seller.wildberries.ru/search-analytics/popular-search-queries";

  const appleScriptApply = `
tell application "Safari"
  -- Find existing WB seller tab (do NOT create a new one)
  set analyticsTab to null
  repeat with w in windows
    repeat with t in tabs of w
      try
        if URL of t contains "seller.wildberries.ru" then
          set analyticsTab to t
          exit repeat
        end if
      on error
      end try
    end repeat
    if analyticsTab is not null then exit repeat
  end repeat
  if analyticsTab is null then
    error "No seller.wildberries.ru tab found in Safari. Please open it and log in."
  end if

  -- Navigate only if not already on the analytics page
  if URL of analyticsTab does not contain "search-analytics" then
    set URL of analyticsTab to ${JSON.stringify(ANALYTICS_URL)}
    delay 9
  else
    delay 1
  end if

  -- Reset: bump runId so old intervals self-stop, aggressively clear stale results
  do JavaScript "(function(){window.__wbRunId=(window.__wbRunId||0)+1;window.__wbFilterResult=null;window.__wbStep='init';try{localStorage.removeItem('__wbFilterResult');localStorage.setItem('__wbFilterResult','');localStorage.removeItem('__wbFilterResult');}catch(e){};try{document.cookie='__wbFR=; path=/; max-age=0';}catch(e){};})()" in analyticsTab

  -- Read JS from temp file — avoids all AppleScript string-escaping issues
  set jsCode to (read POSIX file "/tmp/wb-filter-inject.js" as «class utf8»)

  -- Capture injection errors
  try
    do JavaScript jsCode in analyticsTab
  on error injErr
    return "{'s':'js-injection-error'}"
  end try

  -- Poll for result (360 s max), re-inject JS if page reloads
  set filterResult to "timeout"
  set pollCount to 0
  set errCount to 0
  set unknownStepCount to 0
  repeat 360 times
    delay 1
    set pollCount to pollCount + 1
    try
      set v to do JavaScript "(function(){var v=window.__wbFilterResult||localStorage.getItem('__wbFilterResult');if(!v){try{var m=document.cookie.match(/__wbFR=([^;]+)/);if(m)v=decodeURIComponent(m[1]);}catch(e){}}return(typeof v==='string'?v:null);})()" in analyticsTab
      set errCount to 0
      if v is not missing value and v is not "" and v is not "null" then
        set filterResult to v
        exit repeat
      end if
    on error pollErr
      set errCount to errCount + 1
      if errCount >= 15 then
        -- 15 consecutive poll errors = tab navigated away or crashed, abort
        set filterResult to "{'s':'poll-error'}"
        exit repeat
      end if
    end try
    -- Check every 5 s if JS is still alive (step != unknown)
    if pollCount mod 5 = 0 then
      try
        set stepNow to do JavaScript "window.__wbStep||'unknown'" in analyticsTab
        if stepNow is "unknown" then
          set unknownStepCount to unknownStepCount + 1
          if unknownStepCount >= 3 then
            -- JS lost (page likely reloaded) — navigate back to analytics, then re-inject
            log "JS lost at " & pollCount & "s — navigating back to analytics then re-injecting"
            set URL of analyticsTab to "${ANALYTICS_URL}"
            delay 9
            try
              do JavaScript "(function(){window.__wbRunId=(window.__wbRunId||0)+1;window.__wbFilterResult=null;window.__wbStep='init';})()" in analyticsTab
              do JavaScript jsCode in analyticsTab
            end try
            set unknownStepCount to 0
          end if
        else
          set unknownStepCount to 0
        end if
      on error
      end try
    end if
    -- Log progress every 30 iterations
    if pollCount mod 30 = 0 then
      try
        set stepNow to do JavaScript "window.__wbStep||'unknown'" in analyticsTab
        log "progress at " & pollCount & "s: " & stepNow
      end try
    end if
  end repeat
  return filterResult
end tell`.trim();

  // Take snapshot BEFORE the AppleScript runs "Создать Excel" — otherwise the new
  // report is created during the script and lands inside the snapshot (PENDING → invisible).
  const knownIdsSnapshot = new Set((await listExistingReports()).map((r) => r.id));
  console.log(`Snaphotted ${knownIdsSnapshot.size} existing report IDs before export click.`);

  const filterRaw = await runAppleScript(appleScriptApply, 420_000);
  console.log(`Filter + export click result: ${filterRaw}`);

  let filterResult: { s: string; selected?: number; total?: number; skipped?: Array<{name: string; reason: string; retries: number}>; btns?: unknown[] };
  // AppleScript may return single-quote JSON on error paths — normalise before parsing
  const filterRawNorm = filterRaw.replace(/'/g, '"');
  try { filterResult = JSON.parse(filterRawNorm); }
  catch { throw new Error(`Unexpected filter result: ${filterRaw}`); }

  if (filterResult.s === "filter-load-failed") {
    const failedName = (filterResult as Record<string, unknown>)["name"] ?? "";
    throw new Error(
      `WB portal could not load filter results after 5 retries for "${failedName}" — skipping category.`,
    );
  }
  if (filterResult.s !== "ok") {
    throw new Error(
      `Could not apply subject filters on the analytics page (${JSON.stringify(filterResult)}). ` +
      `Make sure Safari is open and logged into seller.wildberries.ru.`,
    );
  }
  const selectedCount = filterResult.selected ?? 0;
  const totalCount = filterResult.total ?? 0;
  const skippedList = filterResult.skipped ?? [];
  if (skippedList.length > 0) {
    console.warn(`\n⚠  Skipped ${skippedList.length} subjects (out of ${totalCount}):`);
    for (const s of skippedList) {
      console.warn(`   • ${s.name}  — reason: ${s.reason}, retries attempted: ${s.retries}`);
    }
  }
  console.log(`Applied filters and clicked export (${selectedCount}/${totalCount} subjects selected).`);
  console.log(`Polling for new SUCCESS report (${knownIdsSnapshot.size} known IDs to skip)...`);

  let newReport: ContentAnalyticsDownloadEntry | null = null;
  const reportPollDeadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatusLog = "";
  while (Date.now() < reportPollDeadline) {
    await sleep(POLL_INTERVAL_MS);
    const reports = await listExistingReports();
    const newOnes = reports.filter((r) => !knownIdsSnapshot.has(r.id));
    const ready = newOnes.find((r) => r.status === "SUCCESS");
    if (ready) {
      newReport = ready;
      break;
    }
    const inProgress = newOnes.find((r) => r.status === "PENDING" || r.status === "PROCESSING");
    const statusLine = inProgress
      ? `generating (${inProgress.status})`
      : `waiting for new report... (${newOnes.length} new, ${reports.length} total)`;
    if (statusLine !== lastStatusLog) {
      console.log(statusLine);
      lastStatusLog = statusLine;
    }
  }

  if (!newReport) {
    throw new Error(`New report did not become ready within ${POLL_TIMEOUT_MS / 60_000} minutes.`);
  }
  console.log(
    `New report ready: ${newReport.id} (${newReport.name}, ${Math.round(newReport.size / 1024 / 1024)}MB). ` +
    `Triggering download...`,
  );

  // Step C: Click "Скачать" for the specific report we just generated.
  // Pass the report name so we click the right row (not just any SUCCESS row).
  await triggerSafariDownloadNewestEntry(newReport.name);
  console.log(`Download triggered via Downloads Manager.`);
}

/** Filter by subject names (Предметы tab) — existing behavior. */
async function applySubjectFiltersAndDownload(subjectNames: string[], startedAtMs: number): Promise<void> {
  return applyFiltersAndDownload(subjectNames, "Предметы", "предмет", startedAtMs);
}

/** Filter by a single category name (Категории tab), names the file accordingly. */
async function applyCategoryFilterAndDownload(
  categoryName: string,
  period: { from: string; to: string },
  startedAtMs: number,
): Promise<void> {
  const label = `${categoryName} ${formatDateForPortal(period.from)}—${formatDateForPortal(period.to)}`;
  return applyFiltersAndDownload([categoryName], "Категории", "категори", startedAtMs, label);
}

/** Click "Скачать" for the specific report name in WB Downloads Manager panel.
 *  Falls back to the first SUCCESS row if the preferred name is not found. */
async function triggerSafariDownloadNewestEntry(preferredName?: string): Promise<void> {
  // JS injected after the analytics page has loaded: open Downloads panel, click target entry.
  const jsClick = `(function(){
    window.__dlNewestResult = null;
    var PREFERRED = ${JSON.stringify(preferredName ?? "")}.toLowerCase().trim();
    var wrapper = document.querySelector('[class*=Download-manager-wrapper]');
    if(!wrapper){ window.__dlNewestResult = JSON.stringify({s:'no-wrapper'}); return; }
    // Click toggle button to open panel (do it once; if already open, clicking again would close it)
    var panelContent = document.querySelector('[class*=Download-manager-wrapper__downloads-wrapper]');
    if(!panelContent){
      var btn = wrapper.querySelector('button');
      if(btn) btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    }
    var att = 0;
    function poll(){
      att++;
      var p = document.querySelector('[class*=Download-manager-wrapper__downloads-wrapper]');
      if(!p){
        if(att >= 30){ window.__dlNewestResult = JSON.stringify({s:'panel-not-opened', att:att}); return; }
        setTimeout(poll, 250);
        return;
      }
      if(p.querySelector('[class*=skeleton]')){
        if(att >= 60){ window.__dlNewestResult = JSON.stringify({s:'panel-loading-timeout'}); return; }
        setTimeout(poll, 250);
        return;
      }
      var rows = Array.from(p.querySelectorAll('[class*=File-row]'));
      // First pass: find the row matching preferredName
      var targetRow = null;
      if(PREFERRED){
        for(var i=0;i<rows.length;i++){
          var t = (rows[i].innerText||'').toLowerCase();
          var dlBtn = rows[i].querySelector('[data-testid=File-row-SUCCESS-chips-component]');
          if(dlBtn && t.includes(PREFERRED)){ targetRow = rows[i]; break; }
        }
      }
      // Second pass: fall back to first SUCCESS row
      if(!targetRow){
        for(var i=0;i<rows.length;i++){
          var t = rows[i].innerText||'';
          if(/[0-9]+ *\u041a\u0411/.test(t) && !/[0-9]+ *\u041c\u0411/.test(t)) continue;
          var dlBtn = rows[i].querySelector('[data-testid=File-row-SUCCESS-chips-component]');
          if(dlBtn){ targetRow = rows[i]; break; }
        }
      }
      if(targetRow){
        var t = targetRow.innerText||'';
        var dlBtn = targetRow.querySelector('[data-testid=File-row-SUCCESS-chips-component]');
        dlBtn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        window.__dlNewestResult = JSON.stringify({s:'ok', row:t.substring(0,80)});
        return;
      }
      if(att >= 60){ window.__dlNewestResult = JSON.stringify({s:'no-row', count:rows.length}); return; }
      setTimeout(poll, 250);
    }
    setTimeout(poll, 400);
  })();`;

  const ANALYTICS_URL = "https://seller.wildberries.ru/search-analytics/popular-search-queries";
  const jsDlTmpPath = "/tmp/wb-dl-inject.js";
  await fsWriteFile(jsDlTmpPath, jsClick, "utf8");

  const appleScript = `tell application "Safari"
  set myTab to null
  repeat with w in windows
    repeat with tr in tabs of w
      try
        if URL of tr contains "seller.wildberries.ru" then
          set myTab to tr
          exit repeat
        end if
      on error
      end try
    end repeat
    if myTab is not null then exit repeat
  end repeat
  if myTab is null then error "No seller.wildberries.ru tab found"
  -- Already on analytics page after filter application — no navigation needed
  set dlCode to (read POSIX file "/tmp/wb-dl-inject.js" as «class utf8»)
  do JavaScript dlCode in myTab
  set dlResult to "timeout"
  repeat 90 times
    delay 0.5
    try
      set v to do JavaScript "(function(){var v=window.__dlNewestResult;return typeof v==='string'?v:null;})()" in myTab
      if v is not missing value and v is not "" and v is not "null" then
        set dlResult to v
        exit repeat
      end if
    on error
    end try
  end repeat
  return dlResult
end tell`;

  const raw = await runAppleScript(appleScript, 90_000);
  console.log(`Downloads panel (newest): ${raw}`);
  if (raw === "timeout") {
    throw new Error("Downloads Manager panel timed out. Make sure Safari is open at seller.wildberries.ru");
  }
  let result: { s: string; row?: string; att?: number; count?: number };
  try { result = JSON.parse(raw); } catch { throw new Error(`Unexpected newest-download result: ${raw}`); }
  if (result.s !== "ok") {
    throw new Error(`Downloads panel failed (${JSON.stringify(result)}). Make sure Safari is open at seller.wildberries.ru`);
  }
  console.log(`Clicked download: ${result.row}`);
}

/**
 * Download a WB report by triggering a Fetch in the open Safari tab.
 * Fetch uses the browser's own credentials (httpOnly cookies for .wildberries.ru),
 * converts the response to a blob URL (same-origin → Safari downloads, not navigates),
 * and clicks <a download>. This is the most reliable approach for cross-origin files.
 */
async function triggerSafariDownloadByUrl(downloadUrl: string): Promise<void> {
  const jsCode = `(function(){
    window.__dlFetchResult = null;
    var av3 = localStorage.getItem('wb-eu-passport-v2.access-token') || '';
    fetch(${JSON.stringify(downloadUrl)}, {
      credentials: 'include',
      mode: 'cors',
      headers: av3 ? {'AuthorizeV3': av3} : {}
    })
      .then(function(r){
        if(!r.ok){ window.__dlFetchResult=JSON.stringify({s:'fetch-error',status:r.status}); return; }
        return r.blob();
      })
      .then(function(blob){
        if(!blob) return;
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'frequency-report.zip';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ URL.revokeObjectURL(blobUrl); document.body.removeChild(a); }, 2000);
        window.__dlFetchResult = JSON.stringify({s:'ok', size:blob.size});
      })
      .catch(function(e){
        window.__dlFetchResult = JSON.stringify({s:'error', msg:String(e)});
      });
  })();`;

  const jsDlTmpPath = "/tmp/wb-dl-fetch.js";
  await fsWriteFile(jsDlTmpPath, jsCode, "utf8");

  const appleScript = `tell application "Safari"
  set myTab to null
  repeat with w in windows
    repeat with tr in tabs of w
      try
        if URL of tr contains "seller.wildberries.ru" then
          set myTab to tr
          exit repeat
        end if
      on error
      end try
    end repeat
    if myTab is not null then exit repeat
  end repeat
  if myTab is null then error "No seller.wildberries.ru tab found"
  set dlFetchCode to (read POSIX file "/tmp/wb-dl-fetch.js" as «class utf8»)
  do JavaScript dlFetchCode in myTab
  set fetchResult to "timeout"
  repeat 120 times
    delay 0.5
    try
      set v to do JavaScript "(function(){var v=window.__dlFetchResult;return typeof v==='string'?v:null;})()" in myTab
      if v is not missing value and v is not "" and v is not "null" then
        set fetchResult to v
        exit repeat
      end if
    on error
    end try
  end repeat
  return fetchResult
end tell`;

  const raw = await runAppleScript(appleScript, 90_000);
  console.log(`Fetch download result: ${raw}`);
  if (raw === "timeout") {
    throw new Error("Fetch download timed out (60s). File may still be downloading in Safari.");
  }
  let result: { s: string; size?: number; status?: number; msg?: string };
  try { result = JSON.parse(raw); } catch { throw new Error(`Unexpected fetch result: ${raw}`); }
  if (result.s !== "ok") {
    throw new Error(`Fetch download failed: ${JSON.stringify(result)}`);
  }
  console.log(`File fetched via blob (${Math.round((result.size ?? 0) / 1024 / 1024 * 10) / 10} MB).`);
}

/** Fallback: click the Downloads panel for a global report matching the period (≥1 МБ). */
async function triggerSafariDownloadViaPanel(period: { from: string; to: string }): Promise<void> {
  const expectedPeriod = `${formatDateForPortal(period.from)}—${formatDateForPortal(period.to)}`;
  const jsClick = `(function(){window.__dlPanelResult=null;var PERIOD=${JSON.stringify(expectedPeriod)};
function getP(){return document.querySelector('[class*=Download-manager-wrapper__downloads-wrapper]');}
function openPanel(cb){var w=document.querySelector('[class*=Download-manager-wrapper]');if(!w){window.__dlPanelResult=JSON.stringify({s:'no-wrapper'});return;}var b=w.querySelector('button');if(b)b.dispatchEvent(new MouseEvent('click',{bubbles:true}));setTimeout(cb,200);}
function tryClick(p){if(p.querySelector('[class*=skeleton]'))return{s:'loading'};
var rows=Array.from(p.querySelectorAll('[class*=File-row__G]'));
for(var i=0;i<rows.length;i++){var t=rows[i].innerText||'';if(t.indexOf(PERIOD)<0)continue;if(/[0-9]+ *\u041a\u0411/.test(t)&&!/[0-9]+ *\u041c\u0411/.test(t))continue;var b=rows[i].querySelector('[data-testid=File-row-SUCCESS-chips-component]');if(!b)continue;b.dispatchEvent(new MouseEvent('click',{bubbles:true}));return{s:'ok',row:t.substring(0,80)};}return{s:'no-row',count:rows.length};}
var a=0;function poll(p){a++;var r=tryClick(p);if(r.s==='ok'||a>=60){window.__dlPanelResult=JSON.stringify(r);}else{setTimeout(function(){poll(getP()||p);},250);}}
var p=getP();if(p){openPanel(function(){setTimeout(function(){openPanel(function(){var pp=getP();if(pp)poll(pp);});},200);});}else{openPanel(function(){var pp=getP();if(pp)poll(pp);});}})();`;

  // Write JS to temp file — avoids AppleScript string-escaping issues
  const jsPanelTmpPath = "/tmp/wb-dl-panel-inject.js";
  await fsWriteFile(jsPanelTmpPath, jsClick, "utf8");

  const appleScript = `tell application "Safari"
  set t to null
  repeat with w in windows
    repeat with tabItem in tabs of w
      try
        if URL of tabItem contains "seller.wildberries.ru" then
          set t to tabItem
          exit repeat
        end if
      on error
      end try
    end repeat
    if t is not null then exit repeat
  end repeat
  if t is null then
    set t to (make new document with properties {URL:"https://seller.wildberries.ru/search-analytics/popular-search-queries"})
    delay 12
  end if
  set dlPanelCode to (read POSIX file "/tmp/wb-dl-panel-inject.js" as «class utf8»)
  do JavaScript dlPanelCode in t
  set r to "timeout"
  repeat 60 times
    delay 0.5
    try
      set v to do JavaScript "(function(){var v=window.__dlPanelResult;return typeof v==='string'?v:null;})()" in t
      if v is not missing value and v is not "" and v is not "null" then
        set r to v
        exit repeat
      end if
    on error
    end try
  end repeat
  return r
end tell`;

  const raw = await runAppleScript(appleScript, 60_000);
  console.log(`Downloads panel: ${raw}`);
  let result: { s: string; row?: string };
  try { result = JSON.parse(raw); } catch { throw new Error(`Unexpected panel result: ${raw}`); }
  if (result.s !== "ok") {
    throw new Error(`Download panel failed (${JSON.stringify(result)}). Open Safari at seller.wildberries.ru`);
  }
  console.log(`Clicked download for: ${result.row}`);
}

async function notifyFrequencyCacheBust(): Promise<void> {
  loadSafariImportEnv();
  const baseUrl = buildSafariImportApiBaseUrl();
  const url = `${baseUrl}/wb-clusters/sync/frequency-cache-bust`;
  const writeKey = (process.env.WB_CLUSTERS_WRITE_API_KEY ?? "").trim();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-wb-write-intent": "dashboard",
    };
    if (writeKey) {
      headers["x-wb-write-key"] = writeKey;
    }

    const res = await fetch(url, { method: "POST", headers });
    if (res.ok) {
      const body = await res.json() as { clearedAt?: string };
      console.log(`\nServer caches cleared at ${body.clearedAt ?? "unknown"}. Frequency data is live immediately.`);
    } else {
      console.warn(`\nCache-bust request returned ${res.status}. Server caches will expire naturally (TTL).`);
    }
  } catch (err) {
    console.warn(
      `\nCould not reach server to bust caches (${(err as Error).message}). ` +
      `Frequency data will appear after cache TTL expiry (up to 65 min).`,
    );
  }
}

async function main() {
  ensureDarwinSafariRuntime(
    "This importer must run on macOS because it uses Safari automation.",
  );

  const defaultPeriod = getDefaultMonthlyFrequencyImportPeriod();
  const period = {
    from: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_FROM ?? "").trim() || defaultPeriod.from,
    to: (process.env.WB_MONTHLY_FREQUENCY_IMPORT_TO ?? "").trim() || defaultPeriod.to,
  };

  const categoryMode = (process.env.CATEGORY_MODE ?? "").trim() === "1";
  const downloadsDirectory = join(homedir(), "Downloads");
  await access(downloadsDirectory);

  // ── Category-by-category mode ──────────────────────────────────────────────
  if (categoryMode) {
    console.log(`=== WB Monthly Frequency Download by Category ===`);
    console.log(`Target period: ${period.from} → ${period.to}`);

    const client = new Client(getRequiredMonthlyFrequencyPostgresConfig());
    await client.connect();
    let categoryNames: string[];
    try {
      await ensureMonthlyFrequencyTable(client);
      categoryNames = await loadCategoryNamesFromDb(client);
      console.log(`Categories to download: ${categoryNames.join(", ")}`);
    } finally {
      await client.end();
    }

    if (categoryNames.length === 0) {
      throw new Error("No categories found in wb_product_catalog. Run syncCategoryNames() first.");
    }

    // Global dedup accumulator: keep max frequency per normalised query identity
    const globalRows = new Map<string, MonthlyFrequencyRow>();
    const stats: Array<{ category: string; rows: number }> = [];

    // Pipeline: while current file downloads, start next category filter immediately.
    type PendingFile = {
      category: string;
      filePromise: Promise<MonthlyFrequencyRow[]>;
    };
    let pending: PendingFile | null = null;

    async function flushPending() {
      if (!pending) return;
      const { category, filePromise } = pending;
      pending = null;
      try {
        const rows = await filePromise;
        for (const row of rows) {
          const key = normalizeQueryIdentityForDedup(row.queryText);
          const existing = globalRows.get(key);
          if (!existing || row.monthlyFrequency > existing.monthlyFrequency) {
            globalRows.set(key, row);
          }
        }
        stats.push({ category, rows: rows.length });
        console.log(`  ✓ [${category}] ${rows.length} rows (global total: ${globalRows.size})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ [${category}] FAILED while waiting for file: ${msg}`);
        stats.push({ category, rows: 0 });
      }
    }

    for (const categoryName of categoryNames) {
      console.log(`\n[${categoryName}]`);

      // ── Smart resume: reuse file already downloaded today ────────────────
      const cachedPath = await findExistingCategoryZip(downloadsDirectory, categoryName, period);
      if (cachedPath) {
        await flushPending();
        console.log(`  Cached: ${cachedPath.split("/").pop()} — parsing directly.`);
        let cacheOk = false;
        try {
          const workbookBuffer = await readWorkbookBuffer(cachedPath);
          const rows = parseMonthlyFrequencyWorkbookBuffer({ workbookBuffer, readOptionalString, normalizeAdvertisingText });
          for (const row of rows) {
            const key = normalizeQueryIdentityForDedup(row.queryText);
            const existing = globalRows.get(key);
            if (!existing || row.monthlyFrequency > existing.monthlyFrequency) globalRows.set(key, row);
          }
          stats.push({ category: categoryName, rows: rows.length });
          console.log(`  ✓ [${categoryName}] ${rows.length} rows from cache (global total: ${globalRows.size})`);
          cacheOk = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  Cache parse failed (${msg}), will re-download.`);
        }
        if (cacheOk) continue; // skip download only if parse succeeded
      }

      // ── Normal download flow ─────────────────────────────────────────────
      try {
        const knownBefore = await listXlsxFiles(downloadsDirectory);
        const startMs = Date.now();

        // Apply filter + click export + click "Скачать" (~1-2 min).
        // While this runs, the PREVIOUS category's file is downloading in Safari.
        await applyCategoryFilterAndDownload(categoryName, period, startMs);

        // Start watching for THIS category's file in background.
        const filePromise = waitForDownloadedXlsxFile({
          downloadsDirectory,
          reportName: categoryName,
          downloadHint: categoryName.split(" ")[0] ?? "категори",
          startedAtMs: startMs,
          knownDownloadFiles: knownBefore,
          downloadWaitMs: DOWNLOAD_WAIT_MS,
          downloadPollMs: DOWNLOAD_POLL_MS,
          sleep,
        }).then((dlFile) =>
          parseMonthlyFrequencyWorkbookBuffer({
            workbookBuffer: dlFile.workbookBuffer,
            readOptionalString,
            normalizeAdvertisingText,
          }),
        );

        // Flush previous category's file (it downloaded during the filter run above).
        await flushPending();

        pending = { category: categoryName, filePromise };
        console.log(`  Download triggered — starting next category filter immediately.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ FAILED: ${msg}`);
        await flushPending();
        stats.push({ category: categoryName, rows: 0 });
      }
    }

    // Flush the last pending file
    await flushPending();

    if (globalRows.size === 0) {
      throw new Error("No rows collected across all categories. Nothing imported.");
    }

    console.log(`\n=== Importing ${globalRows.size} unique rows to DB ===`);
    const importClient = new Client(getRequiredMonthlyFrequencyPostgresConfig());
    await importClient.connect();
    try {
      const rowsUpserted = await replaceMonthlyFrequencySnapshot(importClient, {
        rows: Array.from(globalRows.values()),
        reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX_BY_CATEGORY",
        reportId: `by-category-${period.from}-${period.to}`,
        downloadId: `by-category-${period.from}-${period.to}`,
        period,
        normalizeAdvertisingText,
      });

      const snapshotRows = await countMonthlyFrequencySnapshotRows(importClient);
      console.log(`\n=== Done ===`);
      console.log(`Rows upserted: ${rowsUpserted} | Snapshot total: ${snapshotRows}`);
      console.log(`Per-category:`);
      for (const s of stats) {
        console.log(`  ${s.rows > 0 ? "✓" : "✗"} ${s.category}: ${s.rows} rows`);
      }
    } finally {
      await importClient.end();
    }

    await notifyFrequencyCacheBust();
    return;
  }

  // ── Standard mode (all subjects at once) ──────────────────────────────────
  console.log(`=== WB Monthly Frequency Download & Import ===`);
  console.log(`Target period: ${period.from} → ${period.to}`);

  // Step 0: Connect to DB early — load product subject names for the filter UI
  const client = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await client.connect();

  let subjectNames: string[] = [];
  try {
    await ensureMonthlyFrequencyTable(client);
    subjectNames = await loadSubjectNamesFromDb(client);
    console.log(
      `Loaded ${subjectNames.length} product subjects for filter: ` +
      `[${subjectNames.slice(0, 5).join(", ")}${subjectNames.length > 5 ? `... +${subjectNames.length - 5} more` : ""}]`,
    );
  } catch (err) {
    console.warn(
      `Warning: could not load subject names (${(err as Error).message}). ` +
      `Will attempt download without subject filter.`,
    );
  }

  // Close DB connection before the long Safari automation to avoid idle timeout.
  // A fresh connection is opened before import (Step 4 below).
  await client.end();

  // Step 1: Apply subject filters on analytics page and click export, then
  //         download the freshest large report from the Downloads panel.
  //         This uses the "Поисковые запросы на WB" UI tab, NOT the subjectIDs API
  //         param (which creates an empty Джем report).
  const knownDownloadFiles = await listXlsxFiles(downloadsDirectory);
  const startedAtMs = Date.now();

  if (subjectNames.length > 0) {
    console.log("Using UI-based subject filter download flow...");
    await applySubjectFiltersAndDownload(subjectNames, startedAtMs);
  } else {
    // Fallback: global 300k report via API + Downloads panel
    console.log("No subjects found. Falling back to global 300k report...");
    const entry = await findOrCreateReport(period.from, period.to, []);
    console.log(`Opening Downloads panel and clicking Скачать for ${entry.id}...`);
    await triggerSafariDownloadViaPanel(period);
  }

  // Step 2: Wait for file
  console.log(`Waiting for file in ~/Downloads (${DOWNLOAD_WAIT_MS / 60_000} min timeout)...`);
  const downloadedFile = await waitForDownloadedXlsxFile({
    downloadsDirectory,
    reportName: "поисковые запросы",
    downloadHint: "поисковые",
    startedAtMs,
    knownDownloadFiles,
    downloadWaitMs: DOWNLOAD_WAIT_MS,
    downloadPollMs: DOWNLOAD_POLL_MS,
    sleep,
  });
  console.log(`File: ${downloadedFile.fileName} (${downloadedFile.absolutePath})`);

  // Step 3: Parse
  const rows = parseMonthlyFrequencyWorkbookBuffer({
    workbookBuffer: downloadedFile.workbookBuffer,
    readOptionalString,
    normalizeAdvertisingText,
  });

  if (rows.length === 0) {
    throw new Error(
      `Could not parse rows from ${downloadedFile.fileName}. ` +
      `Try: fill-monthly-frequency-from-local-file.ts --file="${downloadedFile.absolutePath}" --from="${period.from}" --to="${period.to}"`,
    );
  }

  console.log(`Parsed ${rows.length} rows.`);

  // Step 4: Reconnect to DB (previous connection was closed before Safari automation)
  const importClient = new Client(getRequiredMonthlyFrequencyPostgresConfig());
  await importClient.connect();
  try {
    const rowsUpserted = await replaceMonthlyFrequencySnapshot(importClient, {
      rows,
      reportType: "FREE_SEARCH_ANALYTICS_PORTAL_XLSX",
      reportId: downloadedFile.fileName,
      downloadId: downloadedFile.fileName,
      period,
      normalizeAdvertisingText,
    });

    const snapshotRows = await countMonthlyFrequencySnapshotRows(importClient);
    const sample = await loadMonthlyFrequencySnapshotSample(importClient, 5);

    console.log(`\n=== Done ===`);
    console.log(`Report type: ${subjectNames.length > 0 ? `subject-filtered UI (${subjectNames.length} subjects)` : "global 300k"}`);
    console.log(`Rows upserted: ${rowsUpserted}`);
    console.log(`Snapshot rows: ${snapshotRows}`);
    console.log(`Sample: ${JSON.stringify(sample, null, 2)}`);
  } finally {
    await importClient.end();
  }

  // Step 5: Bust production server caches so the new frequency data is visible
  //         immediately on the next request, without waiting for TTL expiry.
  await notifyFrequencyCacheBust();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
