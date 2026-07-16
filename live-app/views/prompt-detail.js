/*
 * prompt-detail.js — Prompt DETAIL drill-down (live, matches /prompts/:id).
 *
 * Exposed as window.PBPromptDetail(root, ctx) and invoked from prompts.js when
 * the router sets ctx.param to a promptId (hash #/prompts/:id). Loaded before
 * boot so prompts.js can call it.
 *
 * Page layout: originally a pixel-faithful port of the v4 prompt detail page
 * (~/Desktop/ai-monitoring-dashboard-v4.html, aimOpenPromptDetail lines
 * 7303-7494 + CSS at 944-961, 963-988, 1003-1010, 1083-1091), since customized
 * per Filipe's requests:
 *   - back button ("Back to Prompts")
 *   - a top row with two cards, same height:
 *     - header card: prompt text, a run-count badge ("N runs analyzed") plus
 *       topic + intent badges, a top stats line (Mentions / Visibility /
 *       Sentiment / Avg Position) and a bottom line of Top Brands / Top
 *       Citations icon clusters + the most-cited content type.
 *     - visibility-over-runs chart card: a Chart.js line chart of per-run
 *       score for the brand plus the top mentioned entities, with a favicon
 *       legend and favicon tooltip point-styles.
 *   - "Response History" section: one collapsible section per run date
 *     (newest first, only the latest expanded) with a 7-column table:
 *     Model | Response Preview | Sentiment | Visibility | Avg Position |
 *     Mentions | Citations. Each data row opens the full-answer modal.
 *
 * Adaptations from v4 to the live API:
 *   - Data is detail.history[] from PB.api.promptDetail(.., full=true), not
 *     window._aimPromptResponseHistory. Dates and per-model rows are grouped
 *     from history[] (groupRunsByDate).
 *   - Model badges use PB.modelLogo/PB.modelLabel for the live model slugs.
 *   - brandMentions entries carry NO domain field, so mention icons resolve
 *     entity names through entityDomainMap (the brand's own url from
 *     PB.state.brands + tracked competitor urls from PB.api.competitors,
 *     same mechanism as the competitors view's urlByName); entities that do
 *     not resolve keep the deterministic letter avatar (the v4 aimBrandIcon
 *     fallback path). We never guess domain URLs. Citation icons use real
 *     domains via PB.favicon(sources[].domain).
 *   - "No data for this date" filler rows are shown for models that ran on
 *     other dates of this prompt (consistent model set across sections), not
 *     a hardcoded provider list.
 *   - frequency in the caption comes from the brand's analysisFrequency in
 *     PB.state.brands; omitted when unknown.
 *
 * Full-answer modal: pixel-faithful port of the v4 response modal
 * (~/Desktop/ai-monitoring-dashboard-v4.html, #aim-response-modal /
 * aimOpenResponseModal / aimFormatAnswer, lines 5191-5223, 7515-7606,
 * 1093-1202). Adaptations:
 *   - Data comes from the run entry in history[] (fullResponse, sources,
 *     brandMentions) instead of window._aimChatStore.
 *   - CSS injected once as <style id="pb-prompt-modal-css">, scoped under
 *     .pb-rm-scope so nothing leaks into other views (same pattern as
 *     todos.js / injectTodosCSS, including the v4 design-token block).
 *     Page CSS is a sibling <style id="pb-prompt-page-css"> scoped under
 *     .pb-pd-scope.
 *   - Escape key + scroll lock added (the live SPA convention); v4 only had
 *     backdrop click and the close button.
 *   - Note: v4 applies NO brand highlighting inside the response text (bold
 *     names come from the model's own **markdown**). highlightMentions() is
 *     still implemented and exposed as pure logic for tests / future use.
 *
 * Pure logic (escapeHtml, normalizeSpaces, highlightMentions, formatAnswer,
 * responseTextFor, groupRunsByDate, dateAggregates, topEntities, previewText,
 * letterAvatarColor) is exposed as window.PBPromptDetailLogic so it can be
 * unit-tested with node (tests/prompt-detail.logic.test.mjs), same pattern
 * as PBTodosLogic.
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el, fmt = PB.fmt;

  // ══════════════════════════════════════════════════════════════════════════
  // Pure logic (no DOM) — exposed on window.PBPromptDetailLogic for tests.
  // ══════════════════════════════════════════════════════════════════════════

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Normalize whitespace artifacts in raw API text BEFORE escaping:
  // non-breaking-space characters (U+00A0), literal "&nbsp;" strings, and
  // Windows line endings. Mirrors the v4 aimFormatAnswer normalization.
  function normalizeSpaces(s) {
    if (s === null || s === undefined) return '';
    var t = String(s);
    t = t.replace(/\u00a0/g, ' ');
    t = t.replace(/&nbsp;/g, ' ');
    t = t.replace(/\r\n/g, '\n');
    t = t.replace(/\r/g, '\n');
    return t;
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  var HL_OPEN = '<span class="pb-rm-hl">';
  var HL_CLOSE = '</span>';

  // Wraps exact entity-name matches in an already-HTML-escaped text.
  // Longest names are applied first and shorter names never re-wrap text that
  // is already inside a highlight span (no double-wrapping for overlapping
  // names like "AI Peekaboo" / "Peekaboo").
  function highlightMentions(escapedText, entityNames) {
    if (!escapedText) return '';
    if (!entityNames || !entityNames.length) return escapedText;

    var names = [];
    entityNames.forEach(function (n) {
      if (n === null || n === undefined) return;
      var v = String(n).trim();
      if (v) names.push(v);
    });
    if (!names.length) return escapedText;

    names.sort(function (a, b) { return b.length - a.length; });

    var splitter = new RegExp('(' + escapeRegex(HL_OPEN) + '[\\s\\S]*?' + escapeRegex(HL_CLOSE) + ')');
    var result = escapedText;

    names.forEach(function (name) {
      // The text is escaped, so match the escaped form of the name.
      var escName = escapeHtml(name);
      if (!escName) return;
      var pattern = new RegExp(escapeRegex(escName), 'g');
      var parts = result.split(splitter);
      var out = [];
      parts.forEach(function (part) {
        if (part.indexOf(HL_OPEN) === 0) {
          // already-highlighted segment: leave untouched
          out.push(part);
        } else {
          out.push(part.replace(pattern, HL_OPEN + '$&' + HL_CLOSE));
        }
      });
      result = out.join('');
    });
    return result;
  }

  // Faithful port of v4 aimFormatAnswer (lines 5846-5877): escape, normalize,
  // **bold** / *italic* markdown, paragraph split, numbered + bulleted list
  // detection, single \n to <br>. Output is safe HTML built from escaped text.
  function formatAnswer(text) {
    var NO_TEXT = '<em class="pb-rm-noanswer">No response text available.</em>';
    if (!text) return NO_TEXT;
    var t = normalizeSpaces(text);
    t = escapeHtml(t);
    t = t.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');

    var paras = t.split(/\n{2,}/);
    var rendered = [];
    paras.forEach(function (para) {
      var trimmed = para.trim();
      if (!trimmed) return;
      var lines = trimmed.split('\n');
      var numListLines = lines.filter(function (l) { return /^\s*\d+[\.\)]\s/.test(l); });
      var bulletLines = lines.filter(function (l) { return /^\s*[-•\*]\s/.test(l); });
      if (numListLines.length >= 2 && numListLines.length >= lines.length * 0.5) {
        var oItems = lines.map(function (l) {
          return '<li>' + l.replace(/^\s*\d+[\.\)]\s+/, '').trim() + '</li>';
        }).join('');
        rendered.push('<ol style="padding-left:18px;margin:6px 0">' + oItems + '</ol>');
        return;
      }
      if (bulletLines.length >= 2 && bulletLines.length >= lines.length * 0.5) {
        var uItems = lines.map(function (l) {
          return '<li>' + l.replace(/^\s*[-•\*]\s+/, '').trim() + '</li>';
        }).join('');
        rendered.push('<ul style="padding-left:18px;margin:6px 0">' + uItems + '</ul>');
        return;
      }
      rendered.push('<p style="margin:0 0 8px">' + trimmed.replace(/\n/g, '<br>') + '</p>');
    });
    var html = rendered.join('');
    return html || NO_TEXT;
  }

  // Fallback chain for the modal body. fullResponse is the verbatim answer
  // (present when the detail call uses include_full_response=true); when it is
  // missing we fall back to the snippet, then the mention summary, and flag
  // the result as partial so the UI shows an honest note.
  function responseTextFor(run) {
    run = run || {};
    if (run.fullResponse) {
      return { text: run.fullResponse, partial: false };
    }
    var alt = run.responseSnippet || run.mentionSummary || '';
    return { text: alt, partial: true };
  }

  // Client-side model filter for detail.history. The /prompts/:id endpoint
  // takes a time_range param (already applied server-side via
  // PB.api.promptDetail(.., ctx.range, ..)) but has no model param, unlike
  // e.g. the dashboard's looker rows -- so the topbar's model filter has to
  // be applied here for every stat/cluster/chart on this page to agree with
  // it. 'all' (or a falsy model) means no filtering.
  function filterHistoryByModel(history, model) {
    if (!model || model === 'all') return history || [];
    return (history || []).filter(function (r) { return r && r.aiModel === model; });
  }

  // Shallow clone of a detail object with just .history swapped -- used by
  // the "Mentioned" toggle to feed every card/chart a filtered history
  // without touching detail's other fields (category, searchIntent,
  // promptText, summary, sourceSummary, ...), which describe the prompt
  // itself, not any particular run subset.
  function withHistory(detail, history) {
    var clone = {};
    for (var k in detail) {
      if (Object.prototype.hasOwnProperty.call(detail, k)) clone[k] = detail[k];
    }
    clone.history = history;
    return clone;
  }

  // Group history runs by their "YYYY-MM-DD" date, newest date first.
  // Runs without a date are grouped under "" and sort last. Returns
  // [{ date, runs: [...] }] preserving the original run order within a date.
  function groupRunsByDate(history) {
    if (!history || !history.length) return [];
    var byDate = {};
    var order = [];
    history.forEach(function (run) {
      if (!run) return;
      var d = run.date ? String(run.date) : '';
      if (!Object.prototype.hasOwnProperty.call(byDate, d)) {
        byDate[d] = [];
        order.push(d);
      }
      byDate[d].push(run);
    });
    // "YYYY-MM-DD" sorts correctly as a string; "" sorts last in desc order.
    order.sort(function (a, b) {
      if (a === b) return 0;
      return a > b ? -1 : 1;
    });
    return order.map(function (d) {
      return { date: d, runs: byDate[d] };
    });
  }

  // Client-side pager over already-grouped, newest-first date sections. Not
  // a server round-trip -- /prompts/:id has no real pagination (100-entry
  // hard cap, offset/limit ignored) -- this just windows the groups the
  // current time-range filter already fetched. page is 0-indexed and
  // clamped into range, so callers can freely do `page +/- 1` without
  // bounds-checking first.
  function paginateGroups(groups, pageSize, page) {
    var list = groups || [];
    var size = pageSize > 0 ? pageSize : 7;
    var totalPages = Math.max(1, Math.ceil(list.length / size));
    var clamped = Math.max(0, Math.min(page || 0, totalPages - 1));
    var start = clamped * size;
    return {
      page: clamped,
      totalPages: totalPages,
      pageGroups: list.slice(start, start + size),
      hasPrev: clamped > 0,
      hasNext: clamped < totalPages - 1,
    };
  }

  // Header aggregates for a set of runs (one date section, or the whole
  // history for the page header): mean visibility score (null scores count
  // as 0, like v4), dominant non-null sentiment (most frequent, fallback
  // "neutral"), and mean of rank values > 0 rounded to 1 decimal (null when
  // no usable ranks).
  function dateAggregates(runs) {
    runs = (runs || []).filter(function (r) { return !!r; });
    if (!runs.length) return { avgVis: 0, domSentiment: 'neutral', avgPos: null };

    var visSum = 0;
    runs.forEach(function (r) {
      var v = (r.score === null || r.score === undefined) ? 0 : Number(r.score);
      if (isNaN(v)) v = 0;
      visSum += v;
    });
    var avgVis = Math.round(visSum / runs.length);

    var sentCounts = {};
    runs.forEach(function (r) {
      if (!r.sentiment) return;
      var s = String(r.sentiment).toLowerCase();
      sentCounts[s] = (sentCounts[s] || 0) + 1;
    });
    var domSentiment = 'neutral';
    var best = 0;
    Object.keys(sentCounts).forEach(function (s) {
      if (sentCounts[s] > best) {
        best = sentCounts[s];
        domSentiment = s;
      }
    });

    var posVals = [];
    runs.forEach(function (r) {
      var p = Number(r.rank);
      if (r.rank !== null && r.rank !== undefined && !isNaN(p) && p > 0) posVals.push(p);
    });
    var avgPos = null;
    if (posVals.length) {
      var posSum = 0;
      posVals.forEach(function (p) { posSum += p; });
      avgPos = Number((posSum / posVals.length).toFixed(1));
    }

    return { avgVis: avgVis, domSentiment: domSentiment, avgPos: avgPos };
  }

  // Aggregate brand-mention names and citation domains across all runs.
  // Returns { topBrands: [{name, count}], topCites: [{domain, count}] },
  // each sorted by count desc (name/domain asc as tie-break), top 5.
  // Turns a { key -> count } map into a [{ [keyName]: key, count }] list
  // sorted by count desc (key asc tie-break). Shared by topEntities (capped
  // top 5) and the uncapped Sources/Mentioned Brands card tables.
  function countAndSort(counts, keyName) {
    return Object.keys(counts)
      .map(function (k) {
        var entry = {};
        entry[keyName] = k;
        entry.count = counts[k];
        return entry;
      })
      .sort(function (a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return a[keyName] < b[keyName] ? -1 : (a[keyName] > b[keyName] ? 1 : 0);
      });
  }

  function topEntities(history) {
    var brandCounts = {};
    var domainCounts = {};
    (history || []).forEach(function (run) {
      if (!run) return;
      (run.brandMentions || []).forEach(function (m) {
        if (!m) return;
        var name = String(m.entityName || '').trim();
        if (!name) return;
        brandCounts[name] = (brandCounts[name] || 0) + 1;
      });
      (run.sources || []).forEach(function (s) {
        if (!s) return;
        var dom = String(s.domain || '').trim();
        if (!dom) return;
        domainCounts[dom] = (domainCounts[dom] || 0) + 1;
      });
    });
    return {
      topBrands: countAndSort(brandCounts, 'name').slice(0, 5),
      topCites: countAndSort(domainCounts, 'domain').slice(0, 5),
    };
  }

  // Full (uncapped) brand-mention leaderboard for the Mentioned Brands card:
  // one row per distinct entity mentioned anywhere in the prompt's history,
  // { name, count }, sorted by count desc.
  function brandMentionTable(history) {
    var counts = {};
    (history || []).forEach(function (run) {
      if (!run) return;
      (run.brandMentions || []).forEach(function (m) {
        if (!m) return;
        var name = String(m.entityName || '').trim();
        if (!name) return;
        counts[name] = (counts[name] || 0) + 1;
      });
    });
    return countAndSort(counts, 'name');
  }

  // Full (uncapped) cited-source leaderboard for the Sources card: one row
  // per distinct domain with its citation count, share of total citations
  // (0-100, rounded), and the specific URLs cited under it (url/title/count,
  // sorted by count desc) for the row's expanded detail. Never guesses a
  // domain or URL -- grouped straight from run.sources[] as the API returned
  // it; a source with no title falls back to its own URL as the label.
  function sourceTable(history) {
    var domainCounts = {};
    var domainUrls = {}; // domain -> url -> {url, title, count}
    var total = 0;
    (history || []).forEach(function (run) {
      if (!run) return;
      (run.sources || []).forEach(function (s) {
        if (!s) return;
        var dom = String(s.domain || '').trim();
        if (!dom) return;
        domainCounts[dom] = (domainCounts[dom] || 0) + 1;
        total += 1;
        var url = String(s.url || '').trim() || dom;
        if (!domainUrls[dom]) domainUrls[dom] = {};
        if (!domainUrls[dom][url]) {
          domainUrls[dom][url] = { url: url, title: String(s.title || '').trim() || url, count: 0 };
        }
        domainUrls[dom][url].count += 1;
      });
    });
    return countAndSort(domainCounts, 'domain').map(function (row) {
      var urlMap = domainUrls[row.domain] || {};
      var urls = Object.keys(urlMap)
        .map(function (u) { return urlMap[u]; })
        .sort(function (a, b) {
          if (b.count !== a.count) return b.count - a.count;
          return a.url < b.url ? -1 : (a.url > b.url ? 1 : 0);
        });
      return {
        domain: row.domain,
        count: row.count,
        share: total ? Math.round((row.count / total) * 100) : 0,
        urls: urls,
      };
    });
  }

  // ---- CSV export ------------------------------------------------------------
  // Quotes a value only when it actually needs it (contains a comma, quote,
  // or newline), doubling any embedded quotes -- standard RFC 4180 escaping.
  function csvEscape(val) {
    var s = (val === null || val === undefined) ? '' : String(val);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // One row per run in history (already scoped to the current time-range +
  // model filter by the time it reaches here -- see window.PBPromptDetail),
  // for the header card's "Export to CSV" button. Never fabricates a column
  // from data the run doesn't have; mentioned-brand names and cited domains
  // are joined with "; " since a run can have several of each.
  function historyToCsv(history) {
    var header = ['Date', 'Model', 'Visibility Score', 'Sentiment', 'Avg Position', 'Mentioned Brands', 'Citation Count', 'Cited Domains'];
    var rows = (history || []).map(function (run) {
      run = run || {};
      var mentions = (run.brandMentions || [])
        .map(function (m) { return m && m.entityName; })
        .filter(Boolean)
        .join('; ');
      var domains = (run.sources || []).map(function (s) { return s && s.domain; }).filter(Boolean);
      var uniqueDomains = domains.filter(function (d, i) { return domains.indexOf(d) === i; });
      return [
        run.date || '',
        run.aiModel || '',
        (run.score === null || run.score === undefined) ? '' : Math.round(run.score),
        run.sentiment || '',
        (run.rank === null || run.rank === undefined) ? '' : run.rank,
        mentions,
        uniqueDomains.length,
        uniqueDomains.join('; '),
      ];
    });
    return [header].concat(rows).map(function (row) {
      return row.map(csvEscape).join(',');
    }).join('\r\n');
  }

  // Per-run-date visibility series for the visibility-over-runs chart: the
  // tracked brand plus a set of other mentioned entity names. One point per
  // distinct run date (runs on the same date, e.g. multiple AI models, are
  // averaged), dates ascending.
  //
  // Brand score per run comes straight from run.score (the API's own
  // pre-computed value for the tracked brand). Every other entity has no
  // top-level score field, so its score is derived with the same formula the
  // API documents for run scores: ((totalMentions - rank + 1) / totalMentions)
  // * 100, using that entity's rank within run.brandMentions[] (0 when the
  // entity was not mentioned in a given run).
  function entityVisibilitySeries(history, brandName, otherNames) {
    var brandKey = String(brandName || '').trim().toLowerCase();
    var entities = [];
    var seenKeys = {};
    function addEntity(name) {
      var key = String(name || '').trim().toLowerCase();
      if (!key || seenKeys[key]) return;
      seenKeys[key] = true;
      entities.push({ name: name, key: key, isBrand: key === brandKey });
    }
    addEntity(brandName);
    (otherNames || []).forEach(addEntity);

    var dateOrder = [];
    var dateSeen = {};
    var byEntity = {}; // key -> date -> { sum, n }
    entities.forEach(function (e) { byEntity[e.key] = {}; });

    (history || []).forEach(function (run) {
      if (!run || !run.date) return;
      var date = String(run.date);
      if (!dateSeen[date]) { dateSeen[date] = true; dateOrder.push(date); }

      var mentions = run.brandMentions || [];
      var total = mentions.length;

      entities.forEach(function (e) {
        var score = 0;
        if (e.isBrand) {
          score = (run.score === null || run.score === undefined) ? 0 : Number(run.score) || 0;
        } else if (total > 0) {
          for (var i = 0; i < mentions.length; i++) {
            var m = mentions[i];
            if (!m || String(m.entityName || '').trim().toLowerCase() !== e.key) continue;
            var rank = Number(m.rank);
            if (m.rank !== null && m.rank !== undefined && !isNaN(rank) && rank > 0) {
              score = ((total - rank + 1) / total) * 100;
            }
            break;
          }
        }
        var bucket = byEntity[e.key];
        if (!bucket[date]) bucket[date] = { sum: 0, n: 0 };
        bucket[date].sum += score;
        bucket[date].n += 1;
      });
    });

    var dates = dateOrder.slice().sort();
    var series = entities.map(function (e) {
      var bucket = byEntity[e.key];
      return {
        name: e.name,
        isBrand: e.isBrand,
        data: dates.map(function (d) {
          var cell = bucket[d];
          return cell && cell.n ? Number((cell.sum / cell.n).toFixed(1)) : 0;
        }),
      };
    });

    return { dates: dates, series: series };
  }

  // Citation count per run-date for a set of domains (the chart card's
  // "Citations" mode passes the top 5 most-cited, from sourceTable) --
  // structurally the domain-level twin of entityVisibilitySeries, but a raw
  // count per date instead of an averaged score. brandDomain (optional,
  // e.g. the brand's own site) gets isBrand: true on a case-insensitive
  // match, same "(You)" convention the other multi-line modes use.
  function domainCitationSeries(history, domains, brandDomain) {
    var brandKey = String(brandDomain || '').trim().toLowerCase();
    var uniqueDomains = [];
    var seen = {};
    (domains || []).forEach(function (d) {
      var name = String(d || '').trim();
      var key = name.toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      uniqueDomains.push({ name: name, key: key, isBrand: key === brandKey });
    });

    var dateOrder = [];
    var dateSeen = {};
    var byDomain = {};
    uniqueDomains.forEach(function (d) { byDomain[d.key] = {}; });

    (history || []).forEach(function (run) {
      if (!run || !run.date) return;
      var date = String(run.date);
      if (!dateSeen[date]) { dateSeen[date] = true; dateOrder.push(date); }
      (run.sources || []).forEach(function (s) {
        if (!s) return;
        var key = String(s.domain || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(byDomain, key)) return;
        byDomain[key][date] = (byDomain[key][date] || 0) + 1;
      });
    });

    var dates = dateOrder.slice().sort();
    var series = uniqueDomains.map(function (d) {
      var bucket = byDomain[d.key];
      return {
        name: d.name,
        isBrand: d.isBrand,
        data: dates.map(function (date) { return bucket[date] || 0; }),
      };
    });
    return { dates: dates, series: series };
  }

  // Mention count per run-date for the brand plus other entity names -- the
  // "raw occurrence count" twin of entityVisibilitySeries' averaged score.
  // Feeds the chart card's "Mentions" mode.
  function entityMentionSeries(history, brandName, otherNames) {
    var brandKey = String(brandName || '').trim().toLowerCase();
    var entities = [];
    var seenKeys = {};
    function addEntity(name) {
      var key = String(name || '').trim().toLowerCase();
      if (!key || seenKeys[key]) return;
      seenKeys[key] = true;
      entities.push({ name: name, key: key, isBrand: key === brandKey });
    }
    addEntity(brandName);
    (otherNames || []).forEach(addEntity);

    var dateOrder = [];
    var dateSeen = {};
    var byEntity = {};
    entities.forEach(function (e) { byEntity[e.key] = {}; });

    (history || []).forEach(function (run) {
      if (!run || !run.date) return;
      var date = String(run.date);
      if (!dateSeen[date]) { dateSeen[date] = true; dateOrder.push(date); }
      (run.brandMentions || []).forEach(function (m) {
        if (!m) return;
        var key = String(m.entityName || '').trim().toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(byEntity, key)) return;
        byEntity[key][date] = (byEntity[key][date] || 0) + 1;
      });
    });

    var dates = dateOrder.slice().sort();
    var series = entities.map(function (e) {
      var bucket = byEntity[e.key];
      return {
        name: e.name,
        isBrand: e.isBrand,
        data: dates.map(function (date) { return bucket[date] || 0; }),
      };
    });
    return { dates: dates, series: series };
  }

  // Traffic-light color for a 0-100 score: red at 0, yellow at 50, green at
  // 100 (linear interpolation each half). Exactly mirrors the Competitors
  // page's heatBg() (views/competitors.js) -- same stops, same 0.88 alpha --
  // so this card's heatmap looks identical to that one. Values outside
  // 0-100 are clamped; non-numeric input treated as 0.
  function heatmapColor(val) {
    var v = Number(val);
    if (isNaN(v)) v = 0;
    v = Math.max(0, Math.min(100, v));
    var RED = [220, 38, 38];
    var YELLOW = [234, 179, 8];
    var GREEN = [22, 163, 74];
    var from, to, t;
    if (v <= 50) {
      from = RED; to = YELLOW; t = v / 50;
    } else {
      from = YELLOW; to = GREEN; t = (v - 50) / 50;
    }
    var r = Math.round(from[0] + (to[0] - from[0]) * t);
    var g = Math.round(from[1] + (to[1] - from[1]) * t);
    var b = Math.round(from[2] + (to[2] - from[2]) * t);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', 0.88)';
  }

  // Count of runs where the tracked brand was actually mentioned (run.score
  // > 0). Mirrors the API's own "not mentioned -> score 0" convention
  // (documented in reference_aipeekaboo_api.md), so this needs no lookup
  // into brandMentions[] beyond the run's own pre-computed score.
  function brandMentionCount(history) {
    var n = 0;
    (history || []).forEach(function (run) {
      if (run && Number(run.score) > 0) n += 1;
    });
    return n;
  }

  // Filters history for the Response History section's 3-way "Mentioned"
  // segmented control (same run.score > 0 convention as brandMentionCount).
  // 'all' (or an unrecognized mode) returns the list unchanged. Feeds both
  // the day-section list (groupRunsByDate/modelOrder) and the Sources/
  // Mentioned Brands cards, so everything in that region agrees.
  function filterHistoryByMentionState(history, mode) {
    var list = history || [];
    if (mode === 'mentioned') return list.filter(function (run) { return run && Number(run.score) > 0; });
    if (mode === 'not-mentioned') return list.filter(function (run) { return run && !(Number(run.score) > 0); });
    return list;
  }

  // Deterministic content-type bucket for one cited source, from its real
  // title + URL path only (never fabricated, just a heuristic label over
  // text the API already returned). Order matters: more specific patterns
  // are checked first so e.g. a "Top 10 alternatives" blog post lands in
  // Listicle rather than the Blog/Comparison catch-alls.
  function classifyContentType(source) {
    var title = String((source && source.title) || '').toLowerCase();
    var url = String((source && source.url) || '').toLowerCase();
    var text = title + ' ' + url;

    if (/\btop\s*\d+\b|\bbest\s*\d+\b|\d+\s*(best|top|ways|reasons|tips|alternatives)\b|top-\d+|best-\d+/.test(text)) return 'Listicle';
    if (/\/blog\//.test(url) || /\bblog\b/.test(title)) return 'Blog';
    if (/\bvs\.?\b|\balternative(s)?\b|\bcomparison\b/.test(title)) return 'Comparison';
    if (/case study|case-stud|use-case|use case/.test(text)) return 'Case Study';
    if (/\breview(s|ed)?\b/.test(title)) return 'Review';
    if (/\braises?\b|\blaunches?\b|\bannounc(es|ed|ing)\b|\bfunding\b|series [a-e]\b/.test(title)) return 'News';
    if (/\/(careers|jobs)\b/.test(url)) return 'Careers Page';
    return 'Company Page';
  }

  // Most-cited content type across every source in the prompt's run history
  // (each citation counts once per run it appears in, same non-deduped
  // convention topEntities uses for topCites). Null when there are no
  // sources at all.
  function topContentType(history) {
    var counts = {};
    (history || []).forEach(function (run) {
      if (!run) return;
      (run.sources || []).forEach(function (s) {
        if (!s) return;
        var type = classifyContentType(s);
        counts[type] = (counts[type] || 0) + 1;
      });
    });
    var keys = Object.keys(counts);
    if (!keys.length) return null;
    keys.sort(function (a, b) {
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return keys[0];
  }

  // Table preview cell text: first 120 chars of the run's text with the v4
  // fallback chain (fullResponse, then snippet, then mention summary) and a
  // truncated flag so the renderer can append an ellipsis.
  function previewText(run) {
    run = run || {};
    var src = run.fullResponse || run.responseSnippet || run.mentionSummary || '';
    src = normalizeSpaces(src);
    return { text: src.substring(0, 120), truncated: src.length > 120 };
  }

  // v4 aimBrandIcon letter-fallback palette hash (line 5898): deterministic
  // color for a brand name. Exposed as pure logic; brandLetterIcon uses it.
  var LETTER_PALETTE = ['#b352b3', '#10b981', '#2563eb', '#8b5cf6', '#64748b', '#06b6d4', '#f59e0b', '#f472b6', '#38bdf8', '#94a3b8'];
  function letterAvatarColor(name) {
    var n = String(name === null || name === undefined ? '?' : name);
    var h = 0;
    for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffff;
    return LETTER_PALETTE[h % LETTER_PALETTE.length];
  }

  // Entity-name -> domain map for mention favicons, same mechanism as the
  // competitors view's urlByName (views/competitors.js, buildPromptMatrixCard):
  // the brand's own record (PB.state.brands entry: {name, url}) plus the
  // tracked competitors from GET /brands/:id/competitors ({name, url}).
  // Only API-provided URLs go in; we NEVER construct a domain from an entity
  // name (hard rule). Keys are trimmed + lowercased for the lookup.
  function entityDomainMap(brand, competitors) {
    var map = {};
    function add(name, url) {
      if (!name || !url) return;
      var key = String(name).trim().toLowerCase();
      if (!key) return;
      if (!Object.prototype.hasOwnProperty.call(map, key)) map[key] = String(url);
    }
    if (brand) add(brand.name, brand.url);
    (competitors || []).forEach(function (c) {
      if (c) add(c.name, c.url);
    });
    return map;
  }

  // Case-insensitive exact-name lookup against entityDomainMap's output.
  // Returns the stored url/domain string, or null when the entity is unknown
  // (callers fall back to the deterministic letter avatar).
  function resolveEntityDomain(name, map) {
    if (!name || !map) return null;
    var key = String(name).trim().toLowerCase();
    if (!key) return null;
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  }

  // All unique cited domains in this prompt's payload: per-run sources[].domain
  // across the history plus the aggregated sourceSummary[].domain. These are
  // real domains the AI actually cited, so PB.entityDomain can conservatively
  // match untracked entity names against them (exact normalized SLD equality;
  // never a guess).
  function collectCitedDomains(detail) {
    var out = [];
    var seen = {};
    function add(domain) {
      if (!domain) return;
      var d = String(domain).trim().toLowerCase();
      if (!d || seen[d]) return;
      seen[d] = true;
      out.push(d);
    }
    if (!detail) return out;
    (Array.isArray(detail.history) ? detail.history : []).forEach(function (run) {
      if (!run) return;
      (Array.isArray(run.sources) ? run.sources : []).forEach(function (s) {
        if (s) add(s.domain);
      });
    });
    (Array.isArray(detail.sourceSummary) ? detail.sourceSummary : []).forEach(function (s) {
      if (s) add(s.domain);
    });
    return out;
  }

  window.PBPromptDetailLogic = {
    escapeHtml: escapeHtml,
    normalizeSpaces: normalizeSpaces,
    highlightMentions: highlightMentions,
    formatAnswer: formatAnswer,
    responseTextFor: responseTextFor,
    filterHistoryByModel: filterHistoryByModel,
    withHistory: withHistory,
    groupRunsByDate: groupRunsByDate,
    paginateGroups: paginateGroups,
    dateAggregates: dateAggregates,
    topEntities: topEntities,
    brandMentionTable: brandMentionTable,
    sourceTable: sourceTable,
    csvEscape: csvEscape,
    historyToCsv: historyToCsv,
    entityVisibilitySeries: entityVisibilitySeries,
    domainCitationSeries: domainCitationSeries,
    entityMentionSeries: entityMentionSeries,
    heatmapColor: heatmapColor,
    brandMentionCount: brandMentionCount,
    filterHistoryByMentionState: filterHistoryByMentionState,
    classifyContentType: classifyContentType,
    topContentType: topContentType,
    previewText: previewText,
    letterAvatarColor: letterAvatarColor,
    entityDomainMap: entityDomainMap,
    resolveEntityDomain: resolveEntityDomain,
    collectCitedDomains: collectCitedDomains,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // View
  // ══════════════════════════════════════════════════════════════════════════

  // Tracked-competitor list cached per brand (one extra GET per brand, shared
  // across detail page views). entityDomains is the resolver map for the
  // current render; the run-row/modal builders read it via mentionIcon so the
  // modal (opened later from a row click) sees the same data.
  var competitorsCache = { brandId: null, list: null };
  var entityDomains = {};
  // Cited domains of the current prompt (history sources + sourceSummary),
  // step 2 of the resolution chain in mentionIcon. Reset per render.
  var citedDomainList = [];
  // Last chart mode the user picked in the visibility-over-runs card's
  // dropdown (visibility/heatmap/citations/mentions). window.PBPromptDetail
  // rebuilds the whole page from scratch on every topbar filter change
  // (model, range) and every prompt switch, so without this the chart card
  // would silently reset to "visibility" each time -- this persists the
  // choice across those re-renders instead.
  var lastChartMode = 'visibility';

  // The brand's own record ({name, url, ...}) from PB.state.brands.
  function brandRecord(brandId) {
    try {
      var brands = (PB.state && PB.state.brands) || [];
      for (var i = 0; i < brands.length; i++) {
        if (brands[i] && brands[i].id === brandId) return brands[i];
      }
    } catch (e) { /* degrade to letter avatars */ }
    return null;
  }

  window.PBPromptDetail = async function (root, ctx) {
    if (!root) return;
    var promptId = ctx && ctx.param;
    var brandId = ctx && ctx.brandId;

    // Kick off the competitors fetch alongside the detail call; any failure
    // degrades to letter avatars (null list -> empty map entries).
    var compPromise;
    if (competitorsCache.brandId === brandId && competitorsCache.list) {
      compPromise = Promise.resolve(competitorsCache.list);
    } else {
      compPromise = PB.api.competitors(brandId)
        .then(function (comp) {
          var list = (comp && Array.isArray(comp.competitors)) ? comp.competitors : [];
          competitorsCache = { brandId: brandId, list: list };
          return list;
        })
        .catch(function () { return null; });
    }

    // Prompt list for the header card's "switch prompt" dropdown, kicked off
    // alongside the detail call; a failure just leaves the dropdown empty
    // (no crash, no fallback UI needed -- it degrades to "no switcher").
    var promptListPromise = PB.api.prompts(brandId, { time_range: ctx && ctx.range, limit: 200 })
      .then(function (envelope) {
        return (envelope && Array.isArray(envelope.data)) ? envelope.data : [];
      })
      .catch(function () { return []; });

    var detail = null;
    try {
      // full=true so every run arrives with fullResponse in one request
      detail = await PB.api.promptDetail(ctx.brandId, promptId, ctx.range, true);
    } catch (err) {
      PB.toast((err && err.message) || 'Could not load prompt', true);
      injectModalCSS();
      injectPageCSS();
      root.innerHTML = '';
      var errWrap = el('div', { class: 'pb-pd-scope' }, [
        backButton(),
        el('div', { class: 'pb-pd-card', text: 'Could not load this prompt. ' + ((err && err.message) || '') }),
      ]);
      root.appendChild(errWrap);
      return;
    }

    detail = detail || {};
    // the API's time_range filter is already applied server-side (ctx.range
    // was passed into PB.api.promptDetail above); the model filter has no
    // server-side equivalent on this endpoint, so apply it here so every
    // stat/cluster/table row/chart on the page agrees with the topbar
    detail.history = filterHistoryByModel(detail.history, ctx && ctx.model);
    injectModalCSS();
    injectPageCSS();

    var compList = await compPromise;
    var promptList = await promptListPromise;
    entityDomains = entityDomainMap(brandRecord(brandId), compList || []);
    citedDomainList = collectCitedDomains(detail);

    var history = detail.history || [];
    var groups = groupRunsByDate(history);
    var tops = topEntities(history);

    root.innerHTML = '';
    var wrap = el('div', { class: 'pb-pd-scope' });
    wrap.appendChild(el('div', { class: 'pb-pd-topbar-row' }, [
      backButton(),
      buildExportButton(ctx, promptId, history),
    ]));

    // Everything below -- header card, chart card, Response History, Sources,
    // Mentioned Brands -- is driven by the same "Mentioned" toggle (All /
    // Mentioned / Not mentioned), so its state lives here and all of it gets
    // fully rebuilt from the filtered history on every change. The chart
    // card's canvas can't be sized until it's attached to the live DOM, so
    // its render() is deferred (pendingChartRender) -- on the very first
    // build that means after root.appendChild(wrap) below; on later,
    // toggle-triggered rebuilds the tree is already live, so it's called
    // immediately inside the toggle's onChange handler instead.
    var toggleBrand = brandRecord(brandId) || {};
    var toggleBrandName = toggleBrand.name || (ctx && ctx.brandName) || '';

    var topRowSlot = el('div', { class: 'pb-pd-top-row' });
    var historyColSlot = el('div');
    // invisible spacer, same markup as the section title above the history
    // column, so the Sources card's top lines up exactly with the first
    // day-section's top instead of starting higher (visibility:hidden keeps
    // its layout height without hardcoding a pixel value that would drift if
    // the title's font/line-height ever changes)
    var sideColSpacer = el('div', { class: 'pb-pd-section-title', style: { visibility: 'hidden' } }, [
      'Response History',
      el('span', { text: 'spacer' }),
    ]);
    var sideColBody = el('div');
    var sideCol = el('div', { class: 'pb-pd-side-col' }, [sideColSpacer, sideColBody]);

    var mentionMode = 'all';
    var pendingChartRender = null;

    function rerenderMentionFiltered() {
      var filteredHistory = filterHistoryByMentionState(history, mentionMode);
      var filteredGroups = mentionMode === 'all' ? groups : groupRunsByDate(filteredHistory);
      var filteredDetail = mentionMode === 'all' ? detail : withHistory(detail, filteredHistory);
      var filteredTops = mentionMode === 'all' ? tops : topEntities(filteredHistory);

      var chartCard = buildVisibilityChartCard(filteredDetail, ctx, filteredTops);
      topRowSlot.innerHTML = '';
      topRowSlot.appendChild(buildHeaderCard(filteredDetail, ctx, filteredGroups, filteredTops, promptList));
      topRowSlot.appendChild(chartCard.el);
      pendingChartRender = chartCard.render;

      historyColSlot.innerHTML = '';
      historyColSlot.appendChild(buildHistoryColumn(filteredGroups, filteredHistory, filteredDetail, mentionToggle));

      sideColBody.innerHTML = '';
      sideColBody.appendChild(buildSourcesCard(filteredHistory));
      sideColBody.appendChild(buildMentionedCard(filteredHistory));
    }
    var mentionToggle = buildMentionToggle(toggleBrandName, mentionMode, function (mode) {
      mentionMode = mode;
      rerenderMentionFiltered();
      pendingChartRender(); // tree is already live at this point
    });
    rerenderMentionFiltered();

    wrap.appendChild(topRowSlot);
    wrap.appendChild(el('div', { class: 'pb-pd-bottom-section' }, [historyColSlot, sideCol]));

    root.appendChild(wrap);
    pendingChartRender(); // first build only -- tree just became live
  };

  // ---- back button (v4 .aim-pd-back) -----------------------------------------
  var SVG_BACK_ARROW = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_CALENDAR = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="2" width="11" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 1v2M8.5 1v2M1 5.5h11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var SVG_CHEVRON_PATH = '<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';

  function backButton() {
    var btn = el('a', { class: 'pb-pd-back', href: '#/prompts' });
    var arrow = el('span', { class: 'pb-pd-back-ico', html: SVG_BACK_ARROW });
    btn.appendChild(arrow);
    btn.appendChild(el('span', { text: 'Back to Prompts' }));
    return btn;
  }

  var SVG_EXPORT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

  // Triggers a client-side file download (no server round-trip) via a
  // temporary, never-attached-to-the-visible-page <a download> -- the
  // standard browser pattern for Blob-backed downloads.
  function downloadCsv(filename, csvText) {
    var blob = new Blob(['﻿' + csvText], { type: 'text/csv;charset=utf-8;' }); // BOM so Excel opens it as UTF-8
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // "Export to CSV" CTA, top-right of the page (same row as Back to
  // Prompts). Exports history for the currently selected time range +
  // model filter (both already applied server/client-side by the time
  // history reaches here) -- NOT the local "Mentioned" toggle, which is
  // just a browsing convenience for this page, not a data-scoping filter.
  function buildExportButton(ctx, promptId, history) {
    var btn = el('button', { type: 'button', class: 'pb-pd-export-btn' }, [
      el('span', { html: SVG_EXPORT }),
      el('span', { text: 'Export to CSV' }),
    ]);
    btn.addEventListener('click', function () {
      var csv = historyToCsv(history);
      var range = (ctx && ctx.range) || 'range';
      var model = (ctx && ctx.model) || 'all';
      downloadCsv('prompt-' + (promptId || 'export') + '-' + range + '-' + model + '.csv', csv);
    });
    return btn;
  }

  // ---- prompt switcher --------------------------------------------------------
  // Reuses the app's own dropdown classes (pb-dd-trigger/-panel/-item/-check,
  // assets/live-overrides.css) so the panel matches the topbar's model/date
  // filter dropdowns exactly. Those classes are global (loaded on every
  // page) but buildDropdown() itself (assets/app.js) is not exported on
  // window.PB, so the open/close logic here mirrors it locally. Unlike that
  // trigger (a bordered pill button), this one is styled to look like plain
  // text -- only the chevron marks it as interactive.
  var SVG_DD_CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
  var SVG_DD_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';

  // Custom tooltip (not the `title` attribute) for the prompt dropdown's
  // truncated rows: the browser's native title tooltip has a fixed, fairly
  // long OS-controlled show delay that can't be shortened from HTML/CSS.
  // This shows in TOOLTIP_DELAY_MS instead, positioned under the hovered
  // element, and cleans itself up on mouseleave/click.
  var TOOLTIP_DELAY_MS = 150;
  function attachFastTooltip(node, text) {
    var tip = null;
    var timer = null;
    function hide() {
      clearTimeout(timer);
      if (tip) { tip.remove(); tip = null; }
    }
    node.addEventListener('mouseenter', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var r = node.getBoundingClientRect();
        tip = el('div', { class: 'pb-pd-fast-tip', text: text });
        document.body.appendChild(tip);
        tip.style.left = Math.round(r.left) + 'px';
        tip.style.top = Math.round(r.bottom + 4) + 'px';
      }, TOOLTIP_DELAY_MS);
    });
    node.addEventListener('mouseleave', hide);
    node.addEventListener('click', hide);
  }

  function buildPromptSwitcher(currentPromptId, promptText, validPrompts) {
    var label = el('span', { class: 'pb-pd-prompt-text', text: promptText || 'Untitled prompt' });
    if (!validPrompts.length) return label; // nothing to switch to -> plain text, no chevron

    var chevron = el('span', { class: 'pb-dd-chevron pb-pd-prompt-dd-chevron', html: SVG_DD_CHEVRON });
    var btn = el('button', {
      class: 'pb-pd-prompt-dd-trigger',
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-label': 'Switch to a different prompt',
    }, [label, chevron]);
    var container = el('div', { class: 'pb-pd-prompt-dd' }, [btn]);

    var open = false, pop = null, closing = false;
    function destroy() {
      if (pop) { pop.remove(); pop = null; }
      open = false; closing = false;
      btn.setAttribute('aria-expanded', 'false');
      chevron.style.transform = '';
      document.removeEventListener('click', onOutside);
      document.removeEventListener('keydown', onKey);
    }
    function close() {
      if (!pop || closing) return;
      closing = true;
      pop.classList.add('pb-dd-leaving');
      setTimeout(destroy, 130);
    }
    function onOutside(e) { if (pop && !container.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (open) { close(); return; }
      open = true;
      btn.setAttribute('aria-expanded', 'true');
      chevron.style.transform = 'rotate(180deg)';
      pop = el('div', { class: 'pb-dd-panel pb-pd-prompt-dd-panel', role: 'dialog' });

      // sticky sort bar: visibility score high->low or low->high. Stays
      // pinned to the top of the panel's own scroll (not the page) via
      // position: sticky, so it's always reachable even with 90+ prompts.
      var sortDir = 'desc';
      var sortIcon = el('span', { class: 'pb-dd-chevron', html: SVG_DD_CHEVRON });
      var sortBtn = el('button', {
        type: 'button',
        class: 'pb-pd-prompt-dd-sort-btn',
        onclick: function (ev) {
          ev.stopPropagation();
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          renderList();
        },
      }, [
        el('span', { text: 'Visibility' }),
        sortIcon,
      ]);
      var sortBar = el('div', { class: 'pb-pd-prompt-dd-sortbar' }, [sortBtn]);
      var listWrap = el('div');
      pop.appendChild(sortBar);
      pop.appendChild(listWrap);

      function renderList() {
        sortIcon.style.transform = sortDir === 'asc' ? 'rotate(180deg)' : '';
        var sorted = validPrompts.slice().sort(function (a, b) {
          var av = Number(a.averageScore) || 0;
          var bv = Number(b.averageScore) || 0;
          return sortDir === 'desc' ? bv - av : av - bv;
        });
        listWrap.innerHTML = '';
        sorted.forEach(function (p) {
          var active = p.promptId === currentPromptId;
          var scoreVal = (p.averageScore === null || p.averageScore === undefined) ? '–' : Math.round(p.averageScore) + '%';
          var fullText = String(p.promptText || 'Untitled prompt');
          var item = el('button', {
            class: 'pb-dd-item' + (active ? ' pb-dd-item-active' : ''),
            type: 'button',
            onclick: function (ev) {
              ev.stopPropagation();
              destroy();
              if (p.promptId !== currentPromptId) PB.navigate('#/prompts/' + p.promptId);
            },
          }, [
            el('span', { class: 'pb-pd-prompt-dd-score', text: scoreVal }),
            el('span', { class: 'pb-dd-check', html: active ? SVG_DD_CHECK : '' }),
            el('span', { class: 'truncate', text: fullText }),
          ]);
          attachFastTooltip(item, fullText); // faster than the native title-attribute delay
          listWrap.appendChild(item);
        });
      }
      renderList();

      container.appendChild(pop);
      setTimeout(function () {
        document.addEventListener('click', onOutside);
        document.addEventListener('keydown', onKey);
      }, 0);
    });

    return container;
  }

  // ---- header card ----------------------------------------------------------
  function buildHeaderCard(detail, ctx, groups, tops, promptList) {
    var history = detail.history || [];
    var agg = dateAggregates(history);
    var currentPromptId = ctx && ctx.param;

    // prompt switcher: the prompt TEXT itself is the dropdown trigger (bold
    // text + a small chevron, no button/card chrome around it), matching
    // Filipe's request that this not look like a form control. Populated
    // from the parallel PB.api.prompts() fetch in window.PBPromptDetail;
    // empty/failed list just falls back to plain, non-interactive text.
    var validPrompts = (promptList || []).filter(function (p) { return p && p.promptId; });
    var promptTextRow = el('div', { class: 'pb-pd-prompt-text-row' }, [
      buildPromptSwitcher(currentPromptId, detail.promptText, validPrompts),
    ]);

    // run-count badge (how many days this prompt has been analyzed), then
    // topic + intent badges
    var badgeRow = el('div', { class: 'pb-pd-badge-row' });
    var runLabel = groups.length + ' run' + (groups.length === 1 ? '' : 's') + ' analyzed';
    badgeRow.appendChild(el('span', { class: 'pb-pd-runcount-badge', text: runLabel }));
    if (detail.category) {
      badgeRow.appendChild(el('span', { class: 'pb-pd-topic-badge' }, [
        el('span', { class: 'pb-pd-topic-dot', style: { color: letterAvatarColor(detail.category) }, text: '●' }),
        el('span', { text: detail.category }),
      ]));
    }
    if (detail.searchIntent) {
      var intentCls = String(detail.searchIntent).toLowerCase();
      badgeRow.appendChild(el('span', {
        class: 'pb-pd-intent-badge ' + intentCls,
        text: prettyIntent(detail.searchIntent),
      }));
    }

    var promptBlock = el('div', { style: { marginBottom: '12px' } }, [
      promptTextRow,
      badgeRow,
    ]);

    // stats row
    // computed from agg (detail.history), not the API's own detail.summary,
    // so this reflects the model filter too -- detail.summary is a
    // server-side aggregate the /prompts/:id endpoint has no model param for
    var visValue = history.length ? (agg.avgVis + '%') : '–';
    // v4 shows one decimal here ("#1.0"), via toFixed(1)
    var posValue = agg.avgPos !== null ? '#' + agg.avgPos.toFixed(1) : '–';

    var statCluster = el('div', { class: 'pb-pd-stat-cluster', style: { marginBottom: '12px' } }, [
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value muted', text: String(brandMentionCount(history)) }),
        el('div', { class: 'pb-pd-stat-label', text: 'Mentions' }),
      ]),
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value accent', text: visValue }),
        el('div', { class: 'pb-pd-stat-label', text: 'Visibility' }),
      ]),
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value', style: { lineHeight: '1.4' } }, [
          sentBadge(agg.domSentiment),
        ]),
        el('div', { class: 'pb-pd-stat-label', text: 'Sentiment' }),
      ]),
      el('div', {}, [
        el('div', { class: 'pb-pd-stat-value muted', text: posValue }),
        el('div', { class: 'pb-pd-stat-label', text: 'Avg Position' }),
      ]),
    ]);

    // Top Brands cluster: real favicons for resolvable entities (own brand +
    // tracked competitors via entityDomains), letter avatars for the rest
    var brandIcons = el('div', { class: 'pb-pd-icon-row' });
    if (tops.topBrands.length) {
      tops.topBrands.slice(0, 4).forEach(function (b) {
        brandIcons.appendChild(mentionIcon(b.name, 22));
      });
      if (tops.topBrands.length > 4) {
        brandIcons.appendChild(el('span', { class: 'pb-pd-icon-more', text: '+' + (tops.topBrands.length - 4) }));
      }
    } else {
      brandIcons.appendChild(el('span', { class: 'pb-pd-icon-empty', text: '–' }));
    }
    var brandCluster = el('div', { class: 'pb-pd-side-cluster' }, [
      brandIcons,
      el('div', { class: 'pb-pd-side-label', text: 'Top Brands' }),
    ]);

    // Top Citations cluster: real favicons from sources[].domain
    var citeIcons = el('div', { class: 'pb-pd-icon-row' });
    if (tops.topCites.length) {
      tops.topCites.slice(0, 4).forEach(function (c) {
        citeIcons.appendChild(el('img', {
          class: 'pb-pd-cite-icon',
          src: PB.favicon(c.domain),
          title: c.domain,
          alt: '',
          onerror: "this.style.visibility='hidden'",
        }));
      });
      if (tops.topCites.length > 4) {
        citeIcons.appendChild(el('span', { class: 'pb-pd-icon-more', text: '+' + (tops.topCites.length - 4) }));
      }
    } else {
      citeIcons.appendChild(el('span', { class: 'pb-pd-icon-empty', text: '–' }));
    }
    var citeCluster = el('div', { class: 'pb-pd-side-cluster' }, [
      citeIcons,
      el('div', { class: 'pb-pd-side-label', text: 'Top Citations' }),
    ]);

    // Most-cited content type for this prompt, to the right of Top Citations
    var topType = topContentType(history);
    var typeCluster = el('div', { class: 'pb-pd-side-cluster' }, [
      el('div', { class: 'pb-pd-stat-value small', text: topType || '–' }),
      el('div', { class: 'pb-pd-side-label', text: 'Top Content Type' }),
    ]);

    // pushed to the bottom of the card (margin-top: auto) so it sits near
    // the card's stretched bottom edge instead of leaving empty space below
    var bottomRow = el('div', { class: 'pb-pd-bottom-row' }, [brandCluster, citeCluster, typeCluster]);

    return el('div', { class: 'pb-pd-card pb-pd-header-card' }, [promptBlock, statCluster, bottomRow]);
  }

  // ---- visibility-over-runs chart card ---------------------------------------
  // Card to the right of the header card (same row). A mode dropdown swaps
  // the body between four visuals, all built from the same detail.history:
  //   - visibility: line chart, brand + top mentioned entities, score (default)
  //   - heatmap:    entity x run-date grid, traffic-light colored by score
  //   - citations:  line chart, top 5 most-cited domains, citation count
  //   - mentions:   line chart, brand + top mentioned entities, mention count
  // Favicon legend/tooltip icons come from opts.legendIcon/opts.pointIcon
  // (mentionIcon/tooltipPointIcon for entity-name series, domainLegendIcon/
  // domainPointIcon for domain-name series). Chart.js can't size a canvas
  // until it is attached to the live DOM, so this returns { el, render } —
  // render() must be called after the card is in the document (see
  // window.PBPromptDetail above).
  var CHART_BRAND_COLOR = '#b352b3';
  // mirrors binders/visibility.js COMP_COLORS for cross-page consistency
  var CHART_COMP_COLORS = [
    'rgb(236, 72, 153)',   // pink
    'rgb(100, 116, 139)',  // slate
    'rgb(16, 185, 129)',   // emerald
    'rgb(6, 182, 212)',    // cyan
    'rgb(245, 158, 11)',   // amber
  ];
  var CHART_MODES = {
    visibility: { title: 'Visibility Over Runs', sub: 'Score per run · brand vs top mentioned brands' },
    heatmap: { title: 'Visibility Heatmap', sub: 'Score per run day · brand vs top mentioned brands' },
    citations: { title: 'Citations Over Runs', sub: 'Citation count per run day · top 5 cited domains' },
    mentions: { title: 'Mentions Over Runs', sub: 'Mention count per run day · brand vs top mentioned brands' },
  };

  function buildVisibilityChartCard(detail, ctx, tops) {
    var history = detail.history || [];
    var brand = brandRecord(ctx && ctx.brandId) || {};
    var brandName = brand.name || (ctx && ctx.brandName) || '';
    var brandKey = String(brandName || '').trim().toLowerCase();
    var brandDomain = brand.url || '';

    var compNames = (tops.topBrands || [])
      .map(function (b) { return b.name; })
      .filter(function (n) { return String(n || '').trim().toLowerCase() !== brandKey; })
      .slice(0, 4);

    var initialMeta = CHART_MODES[lastChartMode] || CHART_MODES.visibility;
    var titleEl = el('div', { class: 'pb-pd-chart-title', text: initialMeta.title });
    var subEl = el('div', { class: 'pb-pd-chart-sub', text: initialMeta.sub });
    var modeSelect = el('select', { class: 'pb-pd-chart-mode-select', 'aria-label': 'Chart type' }, [
      el('option', { value: 'visibility', text: 'Visibility' }),
      el('option', { value: 'heatmap', text: 'Heatmap' }),
      el('option', { value: 'citations', text: 'Citations' }),
      el('option', { value: 'mentions', text: 'Mentions' }),
    ]);
    modeSelect.value = lastChartMode; // reflect the persisted choice, not always "visibility"
    // heatmap-only row pager, to the right of the mode dropdown -- caps the
    // heatmap's row count so switching modes never changes the card's
    // height (see renderMode/HEATMAP_ROWS_PER_PAGE below)
    var heatmapPrevBtn = el('button', { type: 'button', class: 'pb-pd-history-pager-btn', 'aria-label': 'Previous entities' }, [
      el('span', { class: 'pb-pd-chevron', html: SVG_BACK_ARROW }),
    ]);
    var heatmapNextBtn = el('button', { type: 'button', class: 'pb-pd-history-pager-btn', 'aria-label': 'Next entities' }, [
      el('span', { class: 'pb-pd-chevron', html: SVG_BACK_ARROW, style: { transform: 'rotate(180deg)' } }),
    ]);
    var heatmapPagerLabel = el('span', { class: 'pb-pd-history-pager-label' });
    var heatmapPager = el('div', { class: 'pb-pd-chart-heatmap-pager', style: { display: 'none' } }, [heatmapPrevBtn, heatmapPagerLabel, heatmapNextBtn]);
    var heatmapPage = 0;

    var headRow = el('div', { class: 'pb-pd-chart-head-row' }, [
      el('div', {}, [titleEl, subEl]),
      // grouped together so justify-content: space-between on the row
      // pushes this whole cluster right, not just the last of 3 children
      // (which would center the dropdown between the title and the pager)
      el('div', { class: 'pb-pd-chart-head-controls' }, [modeSelect, heatmapPager]),
    ]);

    var bodyWrap = el('div', { class: 'pb-pd-chart-body' });
    var card = el('div', { class: 'pb-pd-card pb-pd-chart-card' }, [headRow, bodyWrap]);

    var activeChart = null;
    var currentMode = 'visibility';

    function renderMode(mode) {
      currentMode = mode;
      lastChartMode = mode;
      var meta = CHART_MODES[mode] || CHART_MODES.visibility;
      titleEl.textContent = meta.title;
      subEl.textContent = meta.sub;
      bodyWrap.innerHTML = '';
      if (activeChart) {
        try { activeChart.destroy(); } catch (e) { /* stale chart, ignore */ }
        activeChart = null;
      }

      if (mode === 'heatmap') {
        var pageInfo = renderHeatmapBody(bodyWrap, history, brandName, compNames, heatmapPage);
        heatmapPage = pageInfo.page;
        heatmapPagerLabel.textContent = 'Page ' + (pageInfo.page + 1) + ' of ' + pageInfo.totalPages;
        heatmapPrevBtn.disabled = pageInfo.page <= 0;
        heatmapNextBtn.disabled = pageInfo.page >= pageInfo.totalPages - 1;
        heatmapPager.style.display = pageInfo.totalPages > 1 ? '' : 'none';
        return;
      }
      heatmapPager.style.display = 'none';

      var result, opts;
      if (mode === 'citations') {
        var topDomains = sourceTable(history).slice(0, 5).map(function (r) { return r.domain; });
        result = domainCitationSeries(history, topDomains, brandDomain);
        opts = { suffix: '', maxY: null, legend: true, legendIcon: domainLegendIcon, pointIcon: domainPointIcon };
      } else if (mode === 'mentions') {
        result = entityMentionSeries(history, brandName, compNames);
        opts = { suffix: '', maxY: null, legend: true, legendIcon: mentionIcon, pointIcon: tooltipPointIcon };
      } else {
        result = entityVisibilitySeries(history, brandName, compNames);
        opts = { suffix: '%', maxY: 100, legend: true, legendIcon: mentionIcon, pointIcon: tooltipPointIcon };
      }

      if (!result.dates.length || !result.series.length) {
        bodyWrap.appendChild(el('div', { class: 'pb-pd-chart-empty', text: 'No response history available yet.' }));
        return;
      }

      if (opts.legend) {
        var legend = el('div', { class: 'pb-pd-chart-legend' });
        result.series.forEach(function (s) {
          var item = el('div', { class: 'pb-pd-chart-legend-item' });
          item.appendChild(opts.legendIcon(s.name, 14));
          item.appendChild(el('span', { text: s.isBrand ? (s.name + ' (You)') : s.name }));
          legend.appendChild(item);
        });
        bodyWrap.appendChild(legend);
      }

      var canvas = document.createElement('canvas');
      bodyWrap.appendChild(el('div', { class: 'pb-pd-chart-canvas-wrap' }, [canvas]));
      activeChart = renderLineChart(canvas, result, opts);
    }

    modeSelect.addEventListener('change', function () { renderMode(modeSelect.value); });
    heatmapPrevBtn.addEventListener('click', function () { heatmapPage -= 1; renderMode(currentMode); });
    heatmapNextBtn.addEventListener('click', function () { heatmapPage += 1; renderMode(currentMode); });

    return {
      el: card,
      render: function () { renderMode(lastChartMode); },
    };
  }

  // Generic multi-series line-chart renderer shared by the visibility/
  // citations/mentions chart modes -- all three are "brand/domain + top
  // others" series with the same isBrand-highlighting convention, just
  // different metrics. opts: { suffix ('%'/''), maxY (100 or null for
  // auto), legend (bool, whether favicons were rendered above the canvas),
  // legendIcon/pointIcon (icon builder functions for the legend/tooltip,
  // keyed on the series' isBrand-aware favicon resolution -- mentionIcon/
  // tooltipPointIcon for entity names, domainLegendIcon/domainPointIcon for
  // raw domains) }. Returns the Chart.js instance (or null on failure) so
  // the caller can destroy it on the next mode switch.
  function renderLineChart(canvas, result, opts) {
    try {
      if (typeof Chart === 'undefined' || !canvas) return null;
      var cgx = canvas.getContext('2d');
      if (!cgx) return null;

      var labels = result.dates.map(function (iso) {
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
      var datasets = result.series.map(function (s, idx) {
        var color = s.isBrand ? CHART_BRAND_COLOR : CHART_COMP_COLORS[idx % CHART_COMP_COLORS.length];
        return {
          label: s.name,
          data: s.data,
          borderColor: color,
          backgroundColor: color,
          borderWidth: s.isBrand ? 2.5 : 1.5,
          tension: 0.35,
          pointRadius: 0,
          // 0, not a few px: the tooltip's usePointStyle already draws the
          // favicon in the tooltip box independent of this -- a non-zero
          // hover radius additionally drew that same favicon AS a marker on
          // the line itself while hovering, which wasn't wanted
          pointHoverRadius: 0,
          pointStyle: (opts.legend && opts.pointIcon) ? opts.pointIcon(s.name) : 'circle',
          spanGaps: true,
          order: s.isBrand ? 0 : 1,
        };
      });

      var yScale = {
        grid: { color: '#f3f4f6' },
        ticks: { color: 'rgb(107,114,128)', font: { size: 11 }, callback: function (v) { return v + opts.suffix; } },
        border: { display: false },
      };
      if (opts.maxY !== null && opts.maxY !== undefined) {
        // beginAtZero + a hard max (e.g. 100 for score-based modes) lets a
        // 0% or 100% line sit exactly on the plot area's own border, which
        // reads as clipped/unclean. Pad the actual axis range beyond the
        // meaningful 0..maxY window for visual breathing room, but pin the
        // rendered ticks back to clean 0/20/40/60/80/100-style values via
        // afterBuildTicks so the axis still reads correctly.
        var pad = Math.round(opts.maxY * 0.08);
        yScale.min = -pad;
        yScale.max = opts.maxY + pad;
        yScale.afterBuildTicks = function (scale) {
          var step = opts.maxY / 5;
          scale.ticks = [0, 1, 2, 3, 4, 5].map(function (i) { return { value: Math.round(step * i) }; });
        };
      } else {
        yScale.beginAtZero = true;
      }

      var cx = new Chart(cgx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          // a flat line at the very top (100%) or bottom (0%) of the scale
          // otherwise sits flush against the plot area's edge, with its
          // stroke half-clipped by the canvas boundary; this padding keeps
          // it fully visible without changing what the axis ticks mean
          layout: { padding: { top: 8, bottom: 8 } },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#fff',
              titleColor: '#000',
              bodyColor: '#000',
              borderColor: '#e5e7eb',
              borderWidth: 1,
              cornerRadius: 8,
              boxPadding: 6,
              usePointStyle: opts.legend,
              pointStyleWidth: 14,
              callbacks: {
                label: function (c) {
                  var v = c.parsed.y;
                  return c.dataset.label + ': ' + (v === null || v === undefined ? '-' : v + opts.suffix);
                },
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: 'rgb(107,114,128)', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
              border: { display: false },
            },
            y: yScale,
          },
        },
      });
      return cx;
    } catch (err) {
      console.error('[prompt-detail] line chart', err);
      return null;
    }
  }

  // Heatmap mode body: entity x run-date grid (same data as the visibility
  // line chart), each cell colored red-to-green by score via heatmapColor.
  // Capped at 3 entity rows per page so the heatmap table's natural content
  // height never exceeds what the line-chart modes settle at -- without a
  // cap, up to 5 rows (brand + 4 competitors) could make the whole card
  // grow taller when switching into heatmap mode, then shrink back when
  // switching out. page is 0-indexed; pagination controls live in the head
  // row, to the right of the mode dropdown. Returns { page, totalPages } so
  // the caller can update the pager UI.
  var HEATMAP_ROWS_PER_PAGE = 3;

  function renderHeatmapBody(container, history, brandName, compNames, page) {
    var pageInfo = { page: 0, totalPages: 1 };
    try {
      var result = entityVisibilitySeries(history, brandName, compNames);
      if (!result.dates.length || !result.series.length) {
        container.appendChild(el('div', { class: 'pb-pd-chart-empty', text: 'No response history available yet.' }));
        return pageInfo;
      }
      var paged = paginateGroups(result.series, HEATMAP_ROWS_PER_PAGE, page);
      pageInfo = { page: paged.page, totalPages: paged.totalPages };

      var labels = result.dates.map(function (iso) {
        var d = new Date(iso + 'T00:00:00');
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });

      var headRow = el('tr', {}, [el('th', { text: '' })].concat(labels.map(function (l) {
        return el('th', { text: l });
      })));

      var tbody = el('tbody');
      paged.pageGroups.forEach(function (s) {
        var nameCell = el('td', { class: 'pb-pd-heatmap-name-cell' }, [
          el('div', { class: 'pb-pd-heatmap-name' }, [
            mentionIcon(s.name, 14),
            el('span', { text: s.isBrand ? (s.name + ' (You)') : s.name }),
          ]),
        ]);
        var cells = s.data.map(function (v) {
          var rounded = Math.round(v);
          return el('td', { class: 'pb-pd-heatmap-cell' }, [
            el('div', {
              class: 'pb-pd-heatmap-pill',
              style: { background: heatmapColor(v) },
              title: s.name + ': ' + rounded + '%',
              text: rounded + '%',
            }),
          ]);
        });
        tbody.appendChild(el('tr', {}, [nameCell].concat(cells)));
      });

      var table = el('table', { class: 'pb-pd-heatmap-table' }, [el('thead', {}, headRow), tbody]);
      container.appendChild(el('div', { class: 'pb-pd-heatmap-wrap' }, [table]));
    } catch (err) {
      console.error('[prompt-detail] heatmap', err);
    }
    return pageInfo;
  }

  // ---- "Mentioned" segmented control ------------------------------------------
  // All / Mentioned / Not mentioned. Owned by window.PBPromptDetail (not by
  // buildHistoryColumn) because its state has to drive TWO sibling columns
  // -- the Response History day-sections AND the Sources/Mentioned Brands
  // cards -- both of which get fully rebuilt from the filtered history on
  // every change. Built once per page render; onChange is the caller's
  // coordinator.
  var MENTION_MODES = [
    { value: 'all', label: 'All' },
    { value: 'mentioned', label: 'Mentioned' },
    { value: 'not-mentioned', label: 'Not mentioned' },
  ];

  function buildMentionToggle(brandName, initialMode, onChange) {
    var buttons = [];
    var seg = el('div', { class: 'pb-pd-mention-seg' });
    MENTION_MODES.forEach(function (opt) {
      var btn = el('button', {
        type: 'button',
        class: 'pb-pd-mention-seg-btn' + (opt.value === initialMode ? ' active' : ''),
        text: opt.label,
        onclick: function () {
          buttons.forEach(function (b, i) { b.classList.toggle('active', MENTION_MODES[i].value === opt.value); });
          onChange(opt.value);
        },
      });
      buttons.push(btn);
      seg.appendChild(btn);
    });
    return el('div', { class: 'pb-pd-mentioned-toggle' }, [mentionIcon(brandName, 12), seg]);
  }

  // ---- Response History column (paginated) -----------------------------------
  // groups/history are the already mention-filtered data for the current
  // toggle state (see rerenderMentionFiltered in window.PBPromptDetail) --
  // this pages WITHIN that data (no extra API calls), page 0 always being
  // the most recent HISTORY_PAGE_SIZE run-days. toggleEl is the externally-
  // built (and externally stateful) "Mentioned" control, just placed here.
  var HISTORY_PAGE_SIZE = 7;

  function buildHistoryColumn(groups, history, detail, toggleEl) {
    var titleBlock = el('div', { class: 'pb-pd-section-title' }, [
      'Response History',
      el('span', { text: 'Click a row to read the full response' }),
    ]);
    var titleRow = el('div', { class: 'pb-pd-section-title-row' }, [titleBlock, toggleEl]);
    var historyCol = el('div', { class: 'pb-pd-history-col' }, [titleRow]);

    if (!groups.length) {
      historyCol.appendChild(el('div', {
        style: { color: 'var(--text-faint)', fontSize: '13px', padding: '20px 0' },
        text: 'No response history available yet.',
      }));
      return historyCol;
    }

    var allModels = modelOrder(history);
    var sectionsWrap = el('div');
    var prevBtn = el('button', { type: 'button', class: 'pb-pd-history-pager-btn', 'aria-label': 'Newer dates' }, [
      el('span', { class: 'pb-pd-chevron', html: SVG_BACK_ARROW }),
    ]);
    var nextBtn = el('button', { type: 'button', class: 'pb-pd-history-pager-btn', 'aria-label': 'Older dates' }, [
      el('span', { class: 'pb-pd-chevron', html: SVG_BACK_ARROW, style: { transform: 'rotate(180deg)' } }),
    ]);
    var pagerLabel = el('span', { class: 'pb-pd-history-pager-label' });
    var pager = el('div', { class: 'pb-pd-history-pager' }, [prevBtn, pagerLabel, nextBtn]);

    var currentPage = 0;
    function renderPage() {
      var result = paginateGroups(groups, HISTORY_PAGE_SIZE, currentPage);
      currentPage = result.page;

      sectionsWrap.innerHTML = '';
      result.pageGroups.forEach(function (group, idx) {
        // "Latest" badge / auto-expand only makes sense for the single most
        // recent run overall, i.e. the first section of the first page
        var isLatest = currentPage === 0 && idx === 0;
        sectionsWrap.appendChild(buildDateSection(group, isLatest, allModels, detail));
      });

      var startN = currentPage * HISTORY_PAGE_SIZE + 1;
      var endN = startN + result.pageGroups.length - 1;
      pagerLabel.textContent = startN + '-' + endN + ' of ' + groups.length + ' days';
      prevBtn.disabled = !result.hasPrev;
      nextBtn.disabled = !result.hasNext;
      pager.style.display = result.totalPages > 1 ? '' : 'none';
    }

    prevBtn.addEventListener('click', function () { currentPage -= 1; renderPage(); });
    nextBtn.addEventListener('click', function () { currentPage += 1; renderPage(); });

    renderPage();
    historyCol.appendChild(sectionsWrap);
    historyCol.appendChild(pager);
    return historyCol;
  }

  // ---- Sources card (right column, under the chart) -------------------------
  // Search bar + a table of every domain cited anywhere in the prompt's
  // history (domain + citation share), each row expandable to the specific
  // URLs cited under that domain.
  function buildSourcesCard(history) {
    var rows = sourceTable(history);

    var head = el('div', { class: 'pb-pd-side-head-row' }, [
      el('div', { class: 'pb-pd-chart-title', text: 'Sources' }),
      el('div', { class: 'pb-pd-chart-sub', text: 'Cited domains for this prompt' }),
    ]);

    if (!rows.length) {
      return el('div', { class: 'pb-pd-card pb-pd-side-card' }, [
        head,
        el('div', { class: 'pb-pd-chart-empty', text: 'No sources cited yet.' }),
      ]);
    }

    var searchInput = el('input', {
      class: 'pb-pd-search-input',
      type: 'text',
      placeholder: 'Search domains…',
      'aria-label': 'Search sources by domain',
    });

    var tbody = el('tbody');
    function renderRows(filter) {
      tbody.innerHTML = '';
      var f = String(filter || '').trim().toLowerCase();
      var filtered = f ? rows.filter(function (r) { return r.domain.toLowerCase().indexOf(f) !== -1; }) : rows;
      if (!filtered.length) {
        tbody.appendChild(el('tr', {}, [
          el('td', { colspan: '2', class: 'pb-pd-nodata', text: 'No domains match "' + filter + '"' }),
        ]));
        return;
      }
      filtered.forEach(function (row) {
        var chevron = el('span', {
          class: 'pb-pd-chevron pb-pd-src-chevron',
          html: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none">' + SVG_CHEVRON_PATH + '</svg>',
          style: { transform: 'rotate(-90deg)' },
        });
        var domainCell = el('td', {}, [
          el('div', { class: 'pb-pd-src-domain' }, [
            chevron,
            el('img', {
              class: 'pb-pd-cite-icon sm',
              src: PB.favicon(row.domain),
              alt: '',
              onerror: "this.style.visibility='hidden'",
            }),
            el('span', { text: row.domain }),
          ]),
        ]);
        var shareCell = el('td', { class: 'pb-pd-src-share', text: row.share + '%' });

        var detailBody = el('div', { class: 'pb-pd-src-urls' }, [
          // reuses the data rows' own count/title layout classes so the
          // "Used"/"URL" labels line up with their columns below, instead
          // of justify-content: space-between pushing them to opposite ends
          el('div', { class: 'pb-pd-src-url-header' }, [
            el('span', { class: 'pb-pd-src-url-title', text: 'URL' }),
            el('span', { class: 'pb-pd-src-url-count', text: 'Used' }),
          ]),
        ]);
        row.urls.forEach(function (u) {
          detailBody.appendChild(el('a', {
            class: 'pb-pd-src-url-row',
            href: u.url,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, [
            el('span', { class: 'pb-pd-src-url-title', text: u.title }),
            el('span', { class: 'pb-pd-src-url-count', text: u.count + '×' }),
          ]));
        });
        var detailRow = el('tr', { class: 'pb-pd-src-detail-row', style: { display: 'none' } }, [
          el('td', { colspan: '2' }, [detailBody]),
        ]);

        var mainRow = el('tr', {
          class: 'pb-pd-row pb-pd-src-row',
          role: 'button',
          tabindex: '0',
          onclick: toggle,
          onkeydown: function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
          },
        }, [domainCell, shareCell]);

        function toggle() {
          var collapsed = detailRow.style.display === 'none';
          detailRow.style.display = collapsed ? '' : 'none';
          chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
        }

        tbody.appendChild(mainRow);
        tbody.appendChild(detailRow);
      });
    }
    renderRows('');
    searchInput.addEventListener('input', function () { renderRows(searchInput.value); });

    var table = el('table', { class: 'pb-pd-table pb-pd-src-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Domain' }),
        el('th', { text: 'Citation Share' }),
      ])),
      tbody,
    ]);

    return el('div', { class: 'pb-pd-card pb-pd-side-card' }, [
      head,
      searchInput,
      el('div', { class: 'pb-pd-table-wrap pb-pd-side-table-wrap' }, [table]),
    ]);
  }

  // ---- Mentioned Brands card (right column, under Sources) ------------------
  // Every brand/entity mentioned anywhere in the prompt's history, ranked by
  // mention count.
  function buildMentionedCard(history) {
    var rows = brandMentionTable(history);

    var head = el('div', { class: 'pb-pd-side-head-row' }, [
      el('div', { class: 'pb-pd-chart-title', text: 'Mentioned Brands' }),
      el('div', { class: 'pb-pd-chart-sub', text: 'Brands mentioned in AI responses for this prompt' }),
    ]);

    if (!rows.length) {
      return el('div', { class: 'pb-pd-card pb-pd-side-card' }, [
        head,
        el('div', { class: 'pb-pd-chart-empty', text: 'No brand mentions yet.' }),
      ]);
    }

    var tbody = el('tbody');
    rows.forEach(function (row) {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [
          el('div', { class: 'pb-pd-src-domain' }, [
            mentionIcon(row.name, 16),
            el('span', { text: row.name }),
          ]),
        ]),
        el('td', { class: 'pb-pd-src-share', text: String(row.count) }),
      ]));
    });

    var table = el('table', { class: 'pb-pd-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Brand' }),
        el('th', { text: 'Mentions' }),
      ])),
      tbody,
    ]);

    return el('div', { class: 'pb-pd-card pb-pd-side-card' }, [
      head,
      el('div', { class: 'pb-pd-table-wrap pb-pd-side-table-wrap' }, [table]),
    ]);
  }

  // ---- model ordering ---------------------------------------------------------
  // Distinct model slugs across the whole history, ordered by the global
  // PB.models order where known, then by first appearance. Drives the
  // consistent row set (incl. "No data for this date" fillers) per section.
  function modelOrder(history) {
    var seen = [];
    (history || []).forEach(function (run) {
      if (!run || !run.aiModel) return;
      if (seen.indexOf(run.aiModel) === -1) seen.push(run.aiModel);
    });
    var known = (PB.models || []).map(function (m) { return m.tag; });
    seen.sort(function (a, b) {
      var ia = known.indexOf(a);
      var ib = known.indexOf(b);
      if (ia === -1 && ib === -1) return seen.indexOf(a) - seen.indexOf(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return seen;
  }

  // ---- date section (collapsible) ----------------------------------------------
  function buildDateSection(group, isLatest, allModels, detail) {
    var agg = dateAggregates(group.runs);
    var modelsHere = [];
    group.runs.forEach(function (r) {
      if (r && r.aiModel && modelsHere.indexOf(r.aiModel) === -1) modelsHere.push(r.aiModel);
    });

    // ---- header bar ----
    var chevron = el('span', {
      class: 'pb-pd-chevron',
      html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' + SVG_CHEVRON_PATH + '</svg>',
      style: { transform: 'rotate(' + (isLatest ? '0' : '-90') + 'deg)' },
    });
    var chevBtn = el('button', { class: 'pb-pd-chev-btn', type: 'button', 'aria-label': 'Toggle date section' }, [chevron]);

    var left = el('div', { class: 'pb-pd-day-left' }, [
      el('span', { class: 'pb-pd-cal-ico', html: SVG_CALENDAR }),
      el('span', { class: 'pb-pd-day-date', text: group.date ? fmtDateLong(group.date) : 'Unknown date' }),
      isLatest ? el('span', { class: 'pb-pd-latest-badge', text: 'Latest' }) : null,
      el('span', { class: 'pb-pd-day-faint', text: modelsHere.length + ' models' }),
      el('span', { class: 'pb-pd-day-divider' }),
      el('span', {
        class: 'pb-pd-day-vis' + (agg.avgVis > 0 ? ' on' : ''),
        text: agg.avgVis + '% vis',
      }),
      sentBadge(agg.domSentiment, true),
      el('span', { class: 'pb-pd-day-pos', text: '#' + (agg.avgPos !== null ? agg.avgPos.toFixed(1) : '–') + ' pos' }),
    ]);

    var head = el('div', {
      class: 'pb-pd-day-head',
      style: { borderBottom: '1px solid ' + (isLatest ? 'var(--border)' : 'transparent') },
    }, [left, chevBtn]);

    // ---- body (table) ----
    var body = el('div', { class: 'pb-pd-day-body', style: { display: isLatest ? '' : 'none' } }, [
      buildDayTable(group, allModels, detail),
    ]);

    var section = el('div', { class: 'pb-pd-day-section' }, [head, body]);

    function toggle() {
      if (!body) return;
      var collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      if (chevron) chevron.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
      if (head) head.style.borderBottom = '1px solid ' + (collapsed ? 'var(--border)' : 'transparent');
    }
    head.addEventListener('click', toggle);
    chevBtn.addEventListener('click', function (ev) {
      // the bar is also clickable; stop the bubble so it does not double-toggle
      ev.stopPropagation();
      toggle();
    });

    return section;
  }

  function buildDayTable(group, allModels, detail) {
    var table = el('table', { class: 'pb-pd-table' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Model' }),
      el('th', { text: 'Response Preview' }),
      el('th', { text: 'Sentiment' }),
      el('th', { text: 'Visibility' }),
      el('th', { text: 'Avg Position' }),
    ])));

    var tbody = el('tbody');
    var runsByModel = {};
    var extraRuns = [];
    group.runs.forEach(function (r) {
      if (!r) return;
      var m = r.aiModel;
      if (!m) {
        extraRuns.push(r);
        return;
      }
      if (!runsByModel[m]) runsByModel[m] = [];
      runsByModel[m].push(r);
    });

    allModels.forEach(function (model) {
      var runs = runsByModel[model] || [];
      if (!runs.length) {
        // Filler row: this model ran on other dates of this prompt
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [modelBadge(model)]),
          el('td', {
            colspan: '4',
            class: 'pb-pd-nodata',
            text: 'No data for this date',
          }),
        ]));
        return;
      }
      runs.forEach(function (run) {
        tbody.appendChild(buildRunRow(run, detail));
      });
    });
    extraRuns.forEach(function (run) {
      tbody.appendChild(buildRunRow(run, detail));
    });

    table.appendChild(tbody);
    return el('div', { class: 'pb-pd-table-wrap' }, [table]);
  }

  // Model cell: favicon only (no text label), title attribute still carries
  // the model name for hover/accessibility.
  function modelBadge(modelSlug) {
    return el('span', { class: 'pb-pd-model-badge' }, [
      el('img', {
        src: PB.modelLogo(modelSlug),
        alt: PB.modelLabel(modelSlug) || 'Unknown',
        title: PB.modelLabel(modelSlug) || 'Unknown',
        onerror: "this.style.visibility='hidden'",
      }),
    ]);
  }

  function buildRunRow(run, detail) {
    run = run || {};

    // Response Preview (escaped via textContent; ellipsis when truncated)
    var prev = previewText(run);
    var previewNode = el('p', { class: 'pb-pd-preview', text: prev.text + (prev.truncated ? '…' : '') });

    // Visibility
    var visNode;
    if (run.score === null || run.score === undefined) {
      visNode = el('span', { class: 'pb-pd-dash', text: '–' });
    } else {
      visNode = el('span', {
        class: 'pb-pd-vis' + (Number(run.score) > 0 ? ' on' : ''),
        text: Math.round(run.score) + '%',
      });
    }

    // Avg Position
    var posNode;
    var rankNum = Number(run.rank);
    if (run.rank !== null && run.rank !== undefined && !isNaN(rankNum) && rankNum > 0) {
      var rankTxt = Number.isInteger(rankNum) ? String(rankNum) : rankNum.toFixed(1);
      posNode = el('span', { class: 'pb-pd-pos', text: '#' + rankTxt });
    } else {
      posNode = el('span', { class: 'pb-pd-dash', text: '–' });
    }

    function activate() {
      openRunModal(run, detail);
    }

    return el('tr', {
      class: 'pb-pd-row',
      role: 'button',
      tabindex: '0',
      title: 'Read the full response',
      onclick: activate,
      onkeydown: function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activate();
        }
      },
    }, [
      el('td', {}, [modelBadge(run.aiModel)]),
      el('td', { style: { maxWidth: '300px' } }, [previewNode]),
      el('td', {}, [sentBadge(run.sentiment || 'neutral')]),
      el('td', {}, [visNode]),
      el('td', {}, [posNode]),
    ]);
  }

  // sentiment pill (v4 .aim-sent-badge); small=true is the 10px header-bar variant
  function sentBadge(sentiment, small) {
    var cls = rmSentClass(sentiment);
    return el('span', {
      class: 'pb-pd-sent ' + cls + (small ? ' sm' : ''),
      text: prettyIntent(sentiment || 'neutral'),
    });
  }

  // ── page CSS injection ──────────────────────────────────────────────────────
  // Page CSS extracted from ai-monitoring-dashboard-v4.html (.aim-pd-back
  // 1083-1091, .aim-full-table 944-961, badges 963-988, .aim-sent-badge
  // 1003-1010, plus the inline styles of aimOpenPromptDetail 7410-7494),
  // scoped under .pb-pd-scope. Tokens come from the shared block in
  // injectModalCSS (which also covers .pb-pd-scope).
  function injectPageCSS() {
    if (document.getElementById('pb-prompt-page-css')) return;
    if (!document.head) return;
    var s = document.createElement('style');
    s.id = 'pb-prompt-page-css';
    s.textContent = '\n' +
      '.pb-pd-scope { font-family: var(--font); color: var(--text); }\n' +
      '.pb-pd-scope *, .pb-pd-scope *::before, .pb-pd-scope *::after { box-sizing: border-box; }\n' +
      '/* back button (v4 .aim-pd-back) */\n' +
      '.pb-pd-scope .pb-pd-back {\n' +
      '  display: flex; align-items: center; gap: 6px; padding: 6px 0 14px;\n' +
      '  font-size: 13px; font-weight: 500; color: var(--text-muted);\n' +
      '  cursor: pointer; background: none; border: none;\n' +
      '  font-family: var(--font); transition: color .12s; text-decoration: none;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-back:hover { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-back:hover svg { transform: translateX(-2px); }\n' +
      '.pb-pd-scope .pb-pd-back svg { transition: transform .12s; }\n' +
      '.pb-pd-scope .pb-pd-back-ico { display: inline-flex; align-items: center; }\n' +
      '/* topbar row: Back to Prompts (left) + Export to CSV (right), roughly\n' +
      '   above the visibility chart card below it */\n' +
      '.pb-pd-scope .pb-pd-topbar-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 8px; }\n' +
      '.pb-pd-scope .pb-pd-export-btn {\n' +
      '  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;\n' +
      '  background: var(--accent); color: #fff; border: none; border-radius: var(--radius);\n' +
      '  padding: 6px 12px; font-size: 12px; font-weight: 600; font-family: var(--font); cursor: pointer;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-export-btn:hover { filter: brightness(1.08); }\n' +
      '/* header card */\n' +
      '.pb-pd-scope .pb-pd-card {\n' +
      '  background: var(--surface); border: 1px solid var(--border);\n' +
      '  border-radius: var(--radius-lg); box-shadow: var(--shadow);\n' +
      '  padding: 16px; margin-bottom: 14px;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-prompt-text { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--text); min-width: 0; }\n' +
      '.pb-pd-scope .pb-pd-prompt-text-row { margin-bottom: 7px; }\n' +
      '/* prompt switcher: the trigger looks like plain heading text (no\n' +
      '   button/border chrome) -- only the chevron marks it as clickable.\n' +
      '   The dropdown panel itself reuses the app\'s own pb-dd-panel/-item/\n' +
      '   -check classes (assets/live-overrides.css), so it matches the\n' +
      '   topbar\'s model/date dropdowns exactly. */\n' +
      '.pb-pd-scope .pb-pd-prompt-dd { position: relative; display: inline-block; max-width: 100%; }\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-trigger {\n' +
      '  display: inline-flex; align-items: flex-start; gap: 6px; max-width: 100%;\n' +
      '  background: none; border: none; padding: 0; margin: 0; cursor: pointer; text-align: left;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-trigger:hover .pb-pd-prompt-text { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-chevron { flex-shrink: 0; margin-top: 3px; color: #000; transition: transform .15s; }\n' +
      '/* wider than the default pb-dd-panel (prompt text needs the room), and\n' +
      '   capped in height with its own scroll so a long prompt list can\'t\n' +
      '   push the page taller -- it scrolls internally instead */\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-panel { left: 0; right: auto; width: 440px; max-width: 90vw; max-height: 360px; overflow-y: auto; padding-top: 0; }\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-sortbar {\n' +
      '  position: sticky; top: 0; z-index: 1; background: var(--surface);\n' +
      '  padding: 6px 4px; border-bottom: 1px solid var(--border);\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-sort-btn {\n' +
      '  display: inline-flex; align-items: center; gap: 4px; background: none; border: none; cursor: pointer;\n' +
      '  padding: 3px 6px; font-size: 11px; font-weight: 600; color: var(--text-muted); font-family: var(--font);\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-sort-btn:hover { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-sort-btn .pb-dd-chevron { width: 12px; height: 12px; transition: transform .12s; }\n' +
      '.pb-pd-scope .pb-pd-prompt-dd-score { flex-shrink: 0; font-size: 11px; font-weight: 600; color: var(--text-muted); min-width: 30px; }\n' +
      '.pb-pd-scope .pb-dd-item-active .pb-pd-prompt-dd-score { color: var(--accent); }\n' +
      '/* NOT scoped under .pb-pd-scope: attachFastTooltip appends this to\n' +
      '   document.body (position: fixed needs to escape the dropdown panel\'s\n' +
      '   own overflow:hidden/scroll), so a .pb-pd-scope-prefixed rule would\n' +
      '   never match it there */\n' +
      '.pb-pd-fast-tip {\n' +
      '  position: fixed; z-index: 10000; max-width: 320px;\n' +
      '  background: #fff; color: #000; border: 1px solid #e5e7eb; border-radius: 6px;\n' +
      '  padding: 4px 8px; font-size: 11px; font-family: var(--font, inherit);\n' +
      '  box-shadow: 0 4px 12px rgba(0,0,0,.15); pointer-events: none; white-space: normal;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-badge-row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }\n' +
      '/* topic + intent badges (v4 .aim-topic-badge / .aim-intent-badge; the\n' +
      '   #fff/#e5e7eb/#374151 chrome is verbatim v4 and has no token) */\n' +
      '.pb-pd-scope .pb-pd-topic-badge, .pb-pd-scope .pb-pd-intent-badge {\n' +
      '  display: inline-flex; align-items: center; gap: 4px;\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 2px 7px; border-radius: 4px;\n' +
      '  background: #fff; border: 1px solid #e5e7eb; color: #374151;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-topic-dot { font-size: 7px; line-height: 1; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge::before { content: \'\\25CF\'; font-size: 7px; line-height: 1; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.informational::before { color: #2563eb; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.commercial::before    { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.transactional::before { color: #059669; }\n' +
      '.pb-pd-scope .pb-pd-intent-badge.navigational::before  { color: #d97706; }\n' +
      '.pb-pd-scope .pb-pd-runcount-badge {\n' +
      '  display: inline-flex; align-items: center;\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 2px 7px; border-radius: 4px;\n' +
      '  background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border);\n' +
      '}\n' +
      '/* top row: header card + visibility-over-runs chart card, side by side */\n' +
      '.pb-pd-scope .pb-pd-top-row { display: flex; gap: 14px; align-items: stretch; margin-bottom: 14px; }\n' +
      '.pb-pd-scope .pb-pd-top-row .pb-pd-card { margin-bottom: 0; }\n' +
      '.pb-pd-scope .pb-pd-header-card { flex: 1 1 44%; min-width: 0; display: flex; flex-direction: column; }\n' +
      '.pb-pd-scope .pb-pd-chart-card { flex: 1 1 56%; min-width: 0; display: flex; flex-direction: column; }\n' +
      '.pb-pd-scope .pb-pd-chart-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }\n' +
      '.pb-pd-scope .pb-pd-chart-title { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 2px; }\n' +
      '.pb-pd-scope .pb-pd-chart-sub { font-size: 11px; color: var(--text-faint); }\n' +
      '/* Sources/Mentioned Brands card headers: title + subtitle inline on\n' +
      '   the same row, subtitle to the right, instead of stacked */\n' +
      '.pb-pd-scope .pb-pd-side-head-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }\n' +
      '.pb-pd-scope .pb-pd-side-head-row .pb-pd-chart-title { margin-bottom: 0; }\n' +
      '.pb-pd-scope .pb-pd-chart-mode-select {\n' +
      '  flex-shrink: 0; padding: 5px 8px; font-size: 11px; font-family: var(--font);\n' +
      '  border: 1px solid var(--border); border-radius: var(--radius);\n' +
      '  background: var(--surface); color: var(--text); cursor: pointer;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-chart-mode-select:focus { outline: none; border-color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-chart-head-controls { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }\n' +
      '.pb-pd-scope .pb-pd-chart-heatmap-pager { display: flex; align-items: center; gap: 6px; }\n' +
      '.pb-pd-scope .pb-pd-chart-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }\n' +
      '.pb-pd-scope .pb-pd-chart-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; flex-shrink: 0; }\n' +
      '.pb-pd-scope .pb-pd-chart-legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-chart-canvas-wrap { position: relative; flex: 1 1 auto; min-height: 140px; }\n' +
      '.pb-pd-scope .pb-pd-chart-canvas-wrap canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; }\n' +
      '.pb-pd-scope .pb-pd-chart-empty { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-height: 140px; font-size: 12px; color: var(--text-faint); }\n' +
      '/* heatmap mode -- mirrors the Competitors page\'s Brand x Model\n' +
      '   heatmap (views/competitors.js .aim-hm-*) so the two look the same:\n' +
      '   a colored pill inside each cell rather than a plain cell background,\n' +
      '   same paddings/radius/font sizes. */\n' +
      '/* overflow-y: auto is a safety net on top of the 3-row cap above --\n' +
      '   if content still doesn\'t fit the available flex space, it scrolls\n' +
      '   internally instead of growing the card taller than the other modes */\n' +
      '.pb-pd-scope .pb-pd-heatmap-wrap { overflow-x: auto; overflow-y: auto; flex: 1 1 auto; min-height: 140px; }\n' +
      '.pb-pd-scope .pb-pd-heatmap-table { border-collapse: collapse; width: 100%; table-layout: fixed; }\n' +
      '.pb-pd-scope .pb-pd-heatmap-table th {\n' +
      '  padding: 6px 3px 5px; text-align: center; border-bottom: 1px solid var(--border);\n' +
      '  font-size: 10px; font-weight: 600; color: var(--text-muted); white-space: nowrap;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-heatmap-table th:first-child { text-align: left; padding-left: 10px; width: 105px; }\n' +
      '.pb-pd-scope .pb-pd-heatmap-table td { border-bottom: 1px solid var(--border-light); vertical-align: middle; }\n' +
      '.pb-pd-scope .pb-pd-heatmap-name-cell { padding: 6px 4px 6px 10px; }\n' +
      '.pb-pd-scope .pb-pd-heatmap-name {\n' +
      '  display: flex; align-items: center; gap: 5px; overflow: hidden;\n' +
      '  font-size: 11px; font-weight: 500; color: var(--text-muted);\n' +
      '  white-space: nowrap; text-overflow: ellipsis;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-heatmap-cell { padding: 6px 4px; text-align: center; }\n' +
      '.pb-pd-scope .pb-pd-heatmap-pill {\n' +
      '  border-radius: 6px; padding: 8px 6px; font-size: 10px; font-weight: 700;\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  cursor: default; transition: filter .12s; color: #fff;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-heatmap-pill:hover { filter: brightness(.88); }\n' +
      '@media (max-width: 900px) { .pb-pd-scope .pb-pd-top-row { flex-direction: column; } }\n' +
      '/* bottom section: Response History (left, narrower) + Sources /\n' +
      '   Mentioned Brands cards (right, stacked, a bit narrower than the\n' +
      '   visibility chart card above them) */\n' +
      '.pb-pd-scope .pb-pd-bottom-section { display: flex; gap: 14px; align-items: flex-start; }\n' +
      '.pb-pd-scope .pb-pd-history-col { flex: 1 1 58%; min-width: 0; }\n' +
      '/* no flex gap here: each .pb-pd-card already carries its own margin-\n' +
      '   bottom (14px, base .pb-pd-card rule); a flex gap on top of that\n' +
      '   double-spaced the Sources card away from the invisible spacer\n' +
      '   above it, pushing it lower than the first day-section */\n' +
      '.pb-pd-scope .pb-pd-side-col { flex: 1 1 42%; min-width: 0; display: flex; flex-direction: column; }\n' +
      '.pb-pd-scope .pb-pd-side-card { padding-bottom: 12px; }\n' +
      '/* full-bleed: table rows reach the card edges instead of sitting inside\n' +
      '   the card\'s 16px padding, same edge-to-edge look as the day-section\n' +
      '   tables (whose .pb-pd-day-body has no side padding at all) */\n' +
      '.pb-pd-scope .pb-pd-side-table-wrap { margin: 0 -16px; max-height: 320px; overflow-y: auto; }\n' +
      '@media (max-width: 900px) { .pb-pd-scope .pb-pd-bottom-section { flex-direction: column; } }\n' +
      '/* stats: top line (Mentions/Visibility/Sentiment/Avg Position), bottom\n' +
      '   line (Top Brands / Top Citations / Top Content Type) pushed to the\n' +
      '   bottom of the (stretched-height) header card via margin-top: auto */\n' +
      '.pb-pd-scope .pb-pd-stat-cluster { display: flex; flex-wrap: wrap; row-gap: 10px; gap: 20px; justify-content: space-between; }\n' +
      '.pb-pd-scope .pb-pd-stat-value { font-size: 20px; font-weight: 700; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-stat-value.accent { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-stat-value.muted { color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-stat-value.small { font-size: 13px; font-weight: 600; }\n' +
      '.pb-pd-scope .pb-pd-stat-label { font-size: 11px; color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-bottom-row { display: flex; align-items: flex-start; flex-wrap: wrap; row-gap: 10px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border); }\n' +
      '.pb-pd-scope .pb-pd-bottom-row .pb-pd-side-cluster:first-child { border-left: none; padding-left: 0; margin-left: 0; }\n' +
      '/* Top Brands / Top Citations / Top Content Type: equal-width, evenly\n' +
      '   distributed across the row instead of each sized to its own content */\n' +
      '.pb-pd-scope .pb-pd-bottom-row .pb-pd-side-cluster { flex: 1 1 0; min-width: 0; }\n' +
      '.pb-pd-scope .pb-pd-side-cluster { border-left: 1px solid var(--border); padding-left: 18px; margin-left: 18px; }\n' +
      '.pb-pd-scope .pb-pd-side-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }\n' +
      '.pb-pd-scope .pb-pd-icon-row { display: flex; align-items: center; gap: 4px; min-height: 26px; }\n' +
      '.pb-pd-scope .pb-pd-icon-more { font-size: 10px; font-weight: 600; color: var(--text-muted); margin-left: 2px; }\n' +
      '.pb-pd-scope .pb-pd-icon-empty { font-size: 13px; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-cite-icon { width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border-light); flex-shrink: 0; }\n' +
      '/* restores the 16px favicon size for the Sources card\'s domain rows,\n' +
      '   matching Mentioned Brands\' mentionIcon(name, 16) -- this modifier\n' +
      '   was dropped in an earlier cleanup pass while it was still in use\n' +
      '   here, leaving Sources rows on the 22px base size and visibly\n' +
      '   bulkier than Mentioned Brands\' rows */\n' +
      '.pb-pd-scope .pb-pd-cite-icon.sm { width: 16px; height: 16px; border-radius: 3px; border: none; }\n' +
      '/* sentiment pill (v4 .aim-sent-badge) */\n' +
      '.pb-pd-scope .pb-pd-sent {\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 2px 8px; border-radius: 100px;\n' +
      '  border: 1px solid; display: inline-block;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-sent.positive { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }\n' +
      '.pb-pd-scope .pb-pd-sent.neutral  { background: var(--surface-alt); color: var(--text-muted); border-color: var(--border); }\n' +
      '.pb-pd-scope .pb-pd-sent.negative { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }\n' +
      '.pb-pd-scope .pb-pd-sent.sm { font-size: 10px; padding: 1px 7px; }\n' +
      '/* section title row: title (left) + Mentioned toggle (right, roughly\n' +
      '   above each day-section\'s own expand/collapse chevron) */\n' +
      '.pb-pd-scope .pb-pd-section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }\n' +
      '.pb-pd-scope .pb-pd-section-title { font-size: 13px; font-weight: 700; color: #111827; }\n' +
      '.pb-pd-scope .pb-pd-section-title span { margin-left: 8px; font-size: 11px; font-weight: 400; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-mentioned-toggle { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }\n' +
      '/* 3-way All / Mentioned / Not mentioned segmented control -- compact\n' +
      '   on purpose (small pill group, not a full-size button row) */\n' +
      '.pb-pd-scope .pb-pd-mention-seg { display: flex; align-items: center; border: 1px solid var(--border); border-radius: var(--radius); padding: 2px; gap: 2px; background: var(--surface-alt); }\n' +
      '.pb-pd-scope .pb-pd-mention-seg-btn {\n' +
      '  background: none; border: none; cursor: pointer; border-radius: calc(var(--radius) - 2px);\n' +
      '  padding: 3px 7px; font-size: 10px; font-weight: 500; color: var(--text-muted); font-family: var(--font);\n' +
      '  white-space: nowrap;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-mention-seg-btn:hover:not(.active) { color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-mention-seg-btn.active { background: var(--accent); color: #fff; font-weight: 600; }\n' +
      '/* date sections: same card chrome (radius/shadow) and white header as\n' +
      '   the header/chart/Sources/Mentioned cards -- was a flatter, greyer look */\n' +
      '.pb-pd-scope .pb-pd-day-section { border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow); margin-bottom: 10px; overflow: hidden; background: var(--surface); }\n' +
      '.pb-pd-scope .pb-pd-day-head {\n' +
      '  display: flex; align-items: center; justify-content: space-between;\n' +
      '  padding: 10px 14px; background: var(--surface); cursor: pointer;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-day-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n' +
      '.pb-pd-scope .pb-pd-cal-ico { display: inline-flex; align-items: center; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-day-date { font-size: 13px; font-weight: 700; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-latest-badge { font-size: 10px; font-weight: 600; background: var(--accent); color: #fff; padding: 1px 6px; border-radius: 4px; }\n' +
      '.pb-pd-scope .pb-pd-day-faint { font-size: 11px; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-day-divider { width: 1px; height: 12px; background: var(--border); display: inline-block; margin: 0 2px; }\n' +
      '.pb-pd-scope .pb-pd-day-vis { font-size: 11px; font-weight: 600; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-day-vis.on { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-day-pos { font-size: 11px; color: var(--text-muted); }\n' +
      '.pb-pd-scope .pb-pd-chev-btn {\n' +
      '  background: none; border: none; cursor: pointer; padding: 2px;\n' +
      '  display: flex; align-items: center; color: var(--text-muted); flex-shrink: 0;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-chevron { display: inline-flex; align-items: center; transition: transform .2s; }\n' +
      '/* Response History pager, below the last day-section card */\n' +
      '.pb-pd-scope .pb-pd-history-pager { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 4px; }\n' +
      '.pb-pd-scope .pb-pd-history-pager-btn {\n' +
      '  background: none; border: 1px solid var(--border); border-radius: var(--radius);\n' +
      '  cursor: pointer; padding: 4px 8px; display: flex; align-items: center; color: var(--text-muted);\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-history-pager-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-history-pager-btn:disabled { opacity: .4; cursor: default; }\n' +
      '.pb-pd-scope .pb-pd-history-pager-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }\n' +
      '/* table (v4 .aim-full-table) */\n' +
      '.pb-pd-scope .pb-pd-table-wrap { overflow-x: auto; }\n' +
      '.pb-pd-scope .pb-pd-table { width: 100%; font-size: 12px; border-collapse: collapse; }\n' +
      '.pb-pd-scope .pb-pd-table th {\n' +
      '  font-size: 10px; font-weight: 600;\n' +
      '  text-transform: uppercase; letter-spacing: .06em;\n' +
      '  color: var(--text-faint); padding: 8px 18px;\n' +
      '  border-bottom: 1px solid var(--border);\n' +
      '  text-align: center; background: var(--surface);\n' +
      '  white-space: nowrap;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-table td {\n' +
      '  padding: 10px 18px;\n' +
      '  border-bottom: 1px solid var(--border-light);\n' +
      '  vertical-align: middle; text-align: center;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-table th:first-child, .pb-pd-scope .pb-pd-table td:first-child { text-align: left; }\n' +
      '.pb-pd-scope .pb-pd-table tr:last-child td { border-bottom: none; }\n' +
      '.pb-pd-scope .pb-pd-table tbody tr:hover td { background: var(--surface-alt); }\n' +
      '.pb-pd-scope .pb-pd-row { cursor: pointer; }\n' +
      '.pb-pd-scope .pb-pd-row:focus-visible { outline: 2px solid var(--accent-30); outline-offset: -2px; }\n' +
      '/* Sources card: search input, expandable domain rows */\n' +
      '.pb-pd-scope .pb-pd-search-input {\n' +
      '  width: 100%; box-sizing: border-box; margin-bottom: 10px;\n' +
      '  padding: 6px 10px; font-size: 12px; font-family: var(--font);\n' +
      '  border: 1px solid var(--border); border-radius: var(--radius);\n' +
      '  background: var(--surface); color: var(--text);\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-search-input:focus { outline: none; border-color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-src-domain { display: flex; align-items: center; gap: 6px; }\n' +
      '.pb-pd-scope .pb-pd-src-chevron { display: inline-flex; flex-shrink: 0; color: var(--text-faint); transition: transform .12s; }\n' +
      '.pb-pd-scope .pb-pd-src-share { font-weight: 600; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-src-detail-row td { padding: 10px 12px 8px 30px; border-bottom: 1px solid var(--border); }\n' +
      '/* each domain is a [main row, detail row] pair, so the detail row (not\n' +
      '   the main row) is always the table\'s true last-child; the generic\n' +
      '   "last row has no border" rule only strips it there, leaving a stray\n' +
      '   line under the last VISIBLE (collapsed) row -- fix by targeting the\n' +
      '   second-from-last row directly */\n' +
      '.pb-pd-scope .pb-pd-src-row:nth-last-child(2) td { border-bottom: none; }\n' +
      '/* table-layout: fixed keeps the Domain/Citation Share columns from\n' +
      '   growing to fit the expanded detail row\'s content -- without it the\n' +
      '   long URL/title text pushed the whole table wider than the card,\n' +
      '   forcing a horizontal scroll instead of truncating with an ellipsis */\n' +
      '.pb-pd-scope .pb-pd-src-table { table-layout: fixed; }\n' +
      '.pb-pd-scope .pb-pd-src-table th:first-child, .pb-pd-scope .pb-pd-src-table td:first-child { width: 68%; }\n' +
      '.pb-pd-scope .pb-pd-src-table th:last-child, .pb-pd-scope .pb-pd-src-table td:last-child { width: 32%; }\n' +
      '.pb-pd-scope .pb-pd-src-urls { display: flex; flex-direction: column; gap: 4px; min-width: 0; }\n' +
      '.pb-pd-scope .pb-pd-src-url-header {\n' +
      '  display: flex; align-items: center; justify-content: space-between; gap: 10px;\n' +
      '  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;\n' +
      '  color: var(--text-faint); padding-bottom: 4px; margin-bottom: 2px;\n' +
      '  border-bottom: 1px solid var(--border-light);\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-src-url-row {\n' +
      '  display: flex; align-items: center; justify-content: space-between; gap: 10px;\n' +
      '  min-width: 0; font-size: 11px; color: var(--accent); text-decoration: none;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-src-url-row:hover { text-decoration: underline; }\n' +
      '/* min-width: 0 is required for a flex child to actually shrink and\n' +
      '   truncate -- without it the title refused to shrink below its own\n' +
      '   content width, which is what forced the horizontal scroll */\n' +
      '.pb-pd-scope .pb-pd-src-url-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
      '.pb-pd-scope .pb-pd-src-url-count { flex-shrink: 0; color: var(--text-faint); font-weight: 500; }\n' +
      '/* table cells */\n' +
      '.pb-pd-scope .pb-pd-model-badge {\n' +
      '  display: inline-flex; align-items: center;\n' +
      '  padding: 3px; border-radius: 4px;\n' +
      '  background: transparent; border: 1px solid var(--border); line-height: 0;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-model-badge img { width: 16px; height: 16px; border-radius: 2px; flex-shrink: 0; object-fit: contain; }\n' +
      '.pb-pd-scope .pb-pd-preview {\n' +
      '  font-size: 11px; line-height: 1.5; color: var(--text-muted); margin: 0;\n' +
      '  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;\n' +
      '  text-align: left;\n' +
      '}\n' +
      '.pb-pd-scope .pb-pd-vis { font-weight: 600; font-size: 12px; color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-vis.on { color: var(--accent); }\n' +
      '.pb-pd-scope .pb-pd-pos { font-size: 12px; font-weight: 600; color: var(--text); }\n' +
      '.pb-pd-scope .pb-pd-dash { color: var(--text-faint); }\n' +
      '.pb-pd-scope .pb-pd-nodata { font-size: 11px; color: var(--text-faint); padding: 10px 12px; }\n';
    document.head.appendChild(s);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Full-answer modal (v4 #aim-response-modal port)
  // ══════════════════════════════════════════════════════════════════════════

  // Single source of truth for the open modal so a thrown error can never
  // leave the scroll lock stuck: closeRunModal() always restores everything
  // it can find, and openRunModal() calls it from its catch block.
  var modalState = { overlay: null, keyHandler: null, prevOverflow: '' };

  function openRunModal(run, detail) {
    try {
      closeRunModal();
      injectModalCSS();
      var overlay = buildModalDom(run || {}, detail || {});
      modalState.overlay = overlay;
      modalState.prevOverflow = document.body.style.overflow || '';
      modalState.keyHandler = function (ev) {
        if (ev.key === 'Escape') closeRunModal();
      };
      document.addEventListener('keydown', modalState.keyHandler);
      document.body.style.overflow = 'hidden';
      document.body.appendChild(overlay);
    } catch (err) {
      closeRunModal();
      if (PB.toast) PB.toast('Could not open the response window', true);
      if (window.console && console.error) console.error('openRunModal failed', err);
    }
  }

  function closeRunModal() {
    if (modalState.keyHandler) {
      document.removeEventListener('keydown', modalState.keyHandler);
      modalState.keyHandler = null;
    }
    if (modalState.overlay && modalState.overlay.parentNode) {
      modalState.overlay.parentNode.removeChild(modalState.overlay);
    }
    modalState.overlay = null;
    document.body.style.overflow = modalState.prevOverflow || '';
    modalState.prevOverflow = '';
  }

  // v4 long date: "June 3, 2026" (aimFmtDate, line 5722)
  function fmtDateLong(iso) {
    if (!iso || String(iso).indexOf('-') === -1) return iso || '';
    try {
      var parts = String(iso).split('-');
      var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      if (isNaN(d)) return iso;
      return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function rmSentClass(sentiment) {
    var s = String(sentiment || 'neutral').toLowerCase();
    if (s === 'positive' || s === 'negative') return s;
    return 'neutral';
  }

  // Shared domain-resolution chain (1. own brand / tracked competitor urls in
  // entityDomains, 2. domains the AI actually cited for this prompt, 3.
  // curated known-brand map via PB.entityDomain). Returns null when the
  // entity does not resolve; callers fall back to a letter avatar. Domains
  // are never constructed from names. Used by both mentionIcon (DOM icons)
  // and tooltipPointIcon (Chart.js tooltip point-style icons).
  function resolveMentionDomain(name) {
    var domain = resolveEntityDomain(name, entityDomains);
    if (!domain && PB && typeof PB.entityDomain === 'function') {
      domain = PB.entityDomain(name, citedDomainList);
    }
    return domain || null;
  }

  // Mention icon: real favicon when the entity name resolves through
  // resolveMentionDomain, deterministic letter avatar otherwise. The img
  // swaps itself for the letter avatar if the favicon fails to load.
  function mentionIcon(name, sz) {
    var label = String(name || '?');
    var domain = resolveMentionDomain(label);
    if (!domain) {
      var fallback = brandLetterIcon(label, sz);
      fallback.title = label;
      return fallback;
    }
    var r = Math.round(sz * 0.22);
    var img = el('img', {
      src: PB.favicon(domain),
      alt: '',
      title: label,
      style: {
        width: sz + 'px', height: sz + 'px', borderRadius: r + 'px',
        flexShrink: '0', display: 'block', objectFit: 'contain',
      },
      onerror: function () {
        var letter = brandLetterIcon(label, sz);
        letter.title = label;
        if (img && img.parentNode) img.parentNode.replaceChild(letter, img);
      },
    });
    return img;
  }

  // Point-style icon for the visibility chart's tooltip. Chart.js draws
  // dataset.pointStyle straight onto the canvas, so (unlike mentionIcon) it
  // must be an Image/Canvas rather than a DOM <img>/<span>. Real favicon via
  // the same resolveMentionDomain chain when available; otherwise a
  // canvas-drawn circle in the entity's deterministic letter-avatar color and
  // initial (same palette as brandLetterIcon).
  function tooltipPointIcon(name) {
    var size = 14; // matches the tooltip's pointStyleWidth in renderVisibilityChart
    var domain = resolveMentionDomain(name);
    if (domain && PB && PB.favicon) {
      var img = new Image();
      // PB.favicon requests a 64x64 source (see assets/app.js); without an
      // explicit width/height Chart.js draws the image at its NATURAL size
      // (style.width/style.height), not the tooltip's pointStyleWidth --
      // that drew a huge 64px icon inside the small tooltip row, which is
      // what looked "broken". Setting these forces the drawn size to match.
      img.width = size;
      img.height = size;
      img.src = PB.favicon(domain);
      return img;
    }
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var cx = c.getContext && c.getContext('2d');
    if (cx) {
      cx.fillStyle = letterAvatarColor(name);
      cx.beginPath();
      cx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      cx.fill();
      cx.fillStyle = '#fff';
      cx.font = '700 9px sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(String(name || '?').charAt(0).toUpperCase(), size / 2, size / 2 + 1);
    }
    return c;
  }

  // Domain-based counterparts to mentionIcon/tooltipPointIcon, used by the
  // chart card's "Citations" mode: its series names are already real
  // domains (from sourceTable), not entity names, so no name->domain
  // resolution is needed -- just PB.favicon(domain) directly. No letter-
  // avatar fallback (unlike mentionIcon): a domain always yields a favicon
  // URL, even if that specific icon 404s.
  function domainLegendIcon(domain, sz) {
    return el('img', {
      src: PB.favicon(domain),
      alt: '',
      title: domain,
      style: { width: sz + 'px', height: sz + 'px', borderRadius: '3px', flexShrink: '0', objectFit: 'contain', border: '1px solid var(--border-light)' },
      onerror: "this.style.visibility='hidden'",
    });
  }
  function domainPointIcon(domain) {
    var size = 14;
    var img = new Image();
    img.width = size;
    img.height = size;
    img.src = PB.favicon(domain);
    return img;
  }

  // v4 aimBrandIcon letter fallback (line 5898): deterministic palette hash.
  // Used for every mention entity that does not resolve in entityDomains
  // (untracked entities); we never guess a domain from the name.
  function brandLetterIcon(name, sz) {
    var n = String(name || '?');
    var letter = n.charAt(0).toUpperCase();
    var bg = letterAvatarColor(n);
    var r = Math.round(sz * 0.22);
    var fs = Math.max(8, Math.round(sz * 0.46));
    return el('span', {
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: sz + 'px', height: sz + 'px', borderRadius: r + 'px',
        background: bg, color: '#fff', fontSize: fs + 'px', fontWeight: '700', flexShrink: '0',
      },
      text: letter,
    });
  }

  var SVG_MENTIONS_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9.5 1.5h-7a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1v-7a1 1 0 00-1-1z" stroke="#8b5cf6" stroke-width="1.2"/><path d="M4 4h4M4 6h3" stroke="#8b5cf6" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var SVG_CITATIONS_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#b352b3" stroke-width="1.2"/><path d="M1.5 6h9M6 1.5A6.5 6.5 0 006 10.5M6 1.5A6.5 6.5 0 016 10.5" stroke="#b352b3" stroke-width="1.2"/></svg>';
  var SVG_EXT_LINK = '<svg class="aim-rm-source-ext" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6M6 1h3v3M5 5L8.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';

  function buildModalDom(run, detail) {
    var modelName = PB.modelLabel(run.aiModel);
    var modelIcon = PB.modelLogo(run.aiModel);
    var resp = responseTextFor(run);
    var answerHtml = formatAnswer(resp.text);

    // ---- header -------------------------------------------------------------
    var headerLeft = el('div', { class: 'aim-rm-header-left' }, [
      el('img', { class: 'aim-rm-model-icon', src: modelIcon, alt: '' }),
      el('div', {}, [
        el('div', { class: 'aim-rm-model-name', text: modelName }),
        el('div', { class: 'aim-rm-date', text: fmtDateLong(run.date) }),
      ]),
    ]);

    var headerRight = el('div', { class: 'aim-rm-header-right' }, [
      (run.score === null || run.score === undefined) ? null
        : el('span', { class: 'aim-rm-stat-badge', text: 'Score ' + fmt.score(run.score) }),
      (run.rank === null || run.rank === undefined) ? null
        : el('span', { class: 'aim-rm-stat-badge', text: 'Rank ' + run.rank }),
      run.sentiment
        ? el('span', { class: 'aim-rm-sentiment-badge ' + rmSentClass(run.sentiment), text: prettyIntent(run.sentiment) })
        : null,
      el('button', { class: 'aim-rm-close', type: 'button', html: '&#215;', 'aria-label': 'Close', onclick: closeRunModal }),
    ]);

    var header = el('div', { class: 'aim-rm-header' }, [headerLeft, headerRight]);

    // ---- chat column ----------------------------------------------------------
    var userBubble = el('div', { class: 'aim-rm-bubble-wrap user' }, [
      el('div', { class: 'aim-rm-bubble-meta', text: 'You' }),
      el('div', { class: 'aim-rm-bubble-user', text: detail.promptText || '' }),
    ]);

    var aiBubbleChildren = [
      el('div', { class: 'aim-rm-ai-label' }, [
        el('span', { class: 'aim-rm-ai-dot' }),
        modelName + ' Response',
      ]),
      el('div', { class: 'aim-rm-answer', html: answerHtml }),
    ];
    if (resp.partial && resp.text) {
      aiBubbleChildren.push(el('div', {
        class: 'aim-rm-partial-note',
        text: 'Partial response: the full text was not stored for this run.',
      }));
    }

    var aiBubble = el('div', { class: 'aim-rm-bubble-wrap ai' }, [
      el('div', { class: 'aim-rm-bubble-meta' }, [
        el('img', { src: modelIcon, alt: '' }),
        modelName,
      ]),
      el('div', { class: 'aim-rm-bubble-ai' }, aiBubbleChildren),
    ]);

    var chat = el('div', { class: 'aim-rm-chat' }, [userBubble, aiBubble]);

    // ---- sidebar --------------------------------------------------------------
    var mentions = run.brandMentions || [];
    var sources = run.sources || [];
    var sidebarSections = [];

    if (mentions.length) {
      var chipList = el('div', {});
      // own brand first (v4 lists the "You" chip before competitor chips)
      var ordered = [];
      mentions.forEach(function (m) {
        if (m && String(m.type || '').toLowerCase() === 'brand') ordered.push(m);
      });
      mentions.forEach(function (m) {
        if (!m || String(m.type || '').toLowerCase() !== 'brand') ordered.push(m);
      });
      ordered.forEach(function (m) {
        chipList.appendChild(buildMentionChip(m));
      });
      sidebarSections.push(el('div', { class: 'aim-rm-sidebar-section' }, [
        el('div', { class: 'aim-rm-sidebar-title' }, [
          el('span', { class: 'aim-rm-title-ico', html: SVG_MENTIONS_ICON }),
          'Mentions (' + mentions.length + ')',
        ]),
        chipList,
      ]));
    }

    if (sources.length) {
      var srcList = el('div', {});
      sources.forEach(function (s, i) {
        srcList.appendChild(buildSourceRow(s || {}, i));
      });
      sidebarSections.push(el('div', { class: 'aim-rm-sidebar-section' }, [
        el('div', { class: 'aim-rm-sidebar-title' }, [
          el('span', { class: 'aim-rm-title-ico', html: SVG_CITATIONS_ICON }),
          'Citations (' + sources.length + ')',
        ]),
        srcList,
      ]));
    }

    // ---- assemble -------------------------------------------------------------
    var bodyChildren = [chat];
    if (sidebarSections.length) {
      bodyChildren.push(el('div', { class: 'aim-rm-sidebar' }, sidebarSections));
    }
    var body = el('div', { class: 'aim-rm-body' }, bodyChildren);

    var panel = el('div', {
      class: 'aim-rm-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': modelName + ' response',
    }, [header, body]);

    var overlay = el('div', { class: 'pb-rm-scope aim-rm-overlay' }, [panel]);
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closeRunModal();
    });
    return overlay;
  }

  function buildMentionChip(m) {
    m = m || {};
    var name = m.entityName || '—';
    var isOwnBrand = String(m.type || '').toLowerCase() === 'brand';

    var titleParts = [];
    if (m.score !== null && m.score !== undefined) titleParts.push('Score ' + fmt.score(m.score));
    if (m.mentionSummary) titleParts.push(m.mentionSummary);

    var children = [
      mentionIcon(name, 18),
      el('span', { class: 'aim-rm-brand-chip-name' + (isOwnBrand ? ' you' : ''), text: name }),
    ];
    if (m.rank !== null && m.rank !== undefined) {
      children.push(el('span', { class: 'aim-rm-brand-rank', text: '#' + m.rank }));
    }
    if (isOwnBrand) {
      children.push(el('span', { class: 'aim-you-badge', text: 'You' }));
    } else if (m.sentiment) {
      children.push(el('span', { class: 'aim-rm-brand-sent ' + rmSentClass(m.sentiment), text: prettyIntent(m.sentiment) }));
    }

    return el('div', {
      class: 'aim-rm-brand-chip ' + (isOwnBrand ? 'own' : 'neutral'),
      title: titleParts.join(' · '),
    }, children);
  }

  function buildSourceRow(s, i) {
    var domain = s.domain || '';
    var label = s.title || domain || '—';
    var url = s.url || '';
    var hasUrl = /^https?:\/\//i.test(url);

    var inner = el('div', { class: 'aim-rm-source-inner' }, [
      el('span', { class: 'aim-rm-source-num', text: String(i + 1) }),
      domain ? el('img', { src: PB.favicon(domain), alt: '', onerror: "this.style.visibility='hidden'" }) : null,
      el('span', { class: 'aim-rm-source-domain', text: label }),
      hasUrl ? el('span', { class: 'aim-rm-source-ext-wrap', html: SVG_EXT_LINK }) : null,
    ]);

    // exact URLs only: when the API gives no URL we render a plain row
    // instead of guessing a link (never construct URLs)
    if (hasUrl) {
      return el('a', {
        class: 'aim-rm-source-row',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: url,
      }, [inner]);
    }
    return el('div', { class: 'aim-rm-source-row static' }, [inner]);
  }

  // ── CSS injection ───────────────────────────────────────────────────────────
  // Modal CSS extracted verbatim from ai-monitoring-dashboard-v4.html
  // (lines 1093-1202 + .aim-you-badge at 565), scoped under .pb-rm-scope so it
  // cannot leak into other views. The token block mirrors the v4 :root the
  // same way views/todos.js injectTodosCSS() does. .pb-pd-scope (the page
  // wrapper) shares the token block because the page lives outside the
  // modal scope.
  function injectModalCSS() {
    if (document.getElementById('pb-prompt-modal-css')) return;
    if (!document.head) return;
    var s = document.createElement('style');
    s.id = 'pb-prompt-modal-css';
    s.textContent = '\n' +
      '/* === tokens (v4 :root) === */\n' +
      '.pb-rm-scope, .pb-pd-scope {\n' +
      '  --bg:              #ffffff;\n' +
      '  --surface:         #ffffff;\n' +
      '  --surface-alt:     #fafafa;\n' +
      '  --surface-hover:   #f4f4f5;\n' +
      '  --border:          #EEEEEF;\n' +
      '  --border-light:    rgba(0,0,0,0.05);\n' +
      '  --text:            #1c1917;\n' +
      '  --text-muted:      #545D6C;\n' +
      '  --text-faint:      #9CA3AF;\n' +
      '  --accent:          #b352b3;\n' +
      '  --accent-hover:    #a043a0;\n' +
      '  --accent-light:    rgba(179,82,179,0.08);\n' +
      '  --accent-30:       rgba(179,82,179,0.3);\n' +
      '  --radius:          10px;\n' +
      '  --radius-lg:       14px;\n' +
      '  --shadow:          0 1px 2px rgba(0,0,0,0.05);\n' +
      '  --font:            \'Inter\', ui-sans-serif, system-ui, sans-serif;\n' +
      '}\n' +
      '/* === v4 response modal (lines 1093-1202) === */\n' +
      '.pb-rm-scope { font-family: var(--font); -webkit-font-smoothing: antialiased; }\n' +
      '.pb-rm-scope *, .pb-rm-scope *::before, .pb-rm-scope *::after { box-sizing: border-box; }\n' +
      '.pb-rm-scope.aim-rm-overlay {\n' +
      '  position: fixed; inset: 0; z-index: 1000;\n' +
      '  background: rgba(0,0,0,.4);\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  padding: 16px; backdrop-filter: blur(4px);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-panel {\n' +
      '  width: 100%; max-width: 900px;\n' +
      '  max-height: calc(100vh - 32px);\n' +
      '  background: var(--surface); border-radius: 16px;\n' +
      '  box-shadow: 0 24px 64px rgba(0,0,0,.2);\n' +
      '  display: flex; flex-direction: column; overflow: hidden;\n' +
      '  border: 1px solid var(--border);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-header {\n' +
      '  display: flex; align-items: center; justify-content: space-between;\n' +
      '  padding: 12px 16px; border-bottom: 1px solid var(--border-light); flex-shrink: 0;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-header-left { display: flex; align-items: center; gap: 10px; }\n' +
      '.pb-rm-scope .aim-rm-model-icon { width: 24px; height: 24px; border-radius: 6px; object-fit: contain; }\n' +
      '.pb-rm-scope .aim-rm-model-name { font-size: 11px; color: var(--text-muted); font-weight: 500; }\n' +
      '.pb-rm-scope .aim-rm-date { font-size: 13px; font-weight: 600; color: var(--text); }\n' +
      '.pb-rm-scope .aim-rm-header-right { display: flex; align-items: center; gap: 8px; }\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge {\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 3px 10px; border-radius: 100px; border: 1px solid;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge.positive { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge.neutral  { background: var(--surface-alt); color: var(--text-muted); border-color: var(--border); }\n' +
      '.pb-rm-scope .aim-rm-sentiment-badge.negative { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }\n' +
      '.pb-rm-scope .aim-rm-stat-badge {\n' +
      '  font-size: 11px; font-weight: 600;\n' +
      '  padding: 3px 10px; border-radius: 100px;\n' +
      '  border: 1px solid var(--border); background: var(--surface-alt); color: var(--text-muted);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-close {\n' +
      '  width: 28px; height: 28px; border-radius: var(--radius);\n' +
      '  background: none; border: none; cursor: pointer;\n' +
      '  font-size: 20px; color: var(--text-faint);\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  line-height: 1; transition: all .12s; font-family: var(--font);\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-close:hover { background: var(--surface-alt); color: var(--text); }\n' +
      '.pb-rm-scope .aim-rm-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }\n' +
      '.pb-rm-scope .aim-rm-chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }\n' +
      '.pb-rm-scope .aim-rm-bubble-wrap { display: flex; flex-direction: column; }\n' +
      '.pb-rm-scope .aim-rm-bubble-wrap.user { align-items: flex-end; }\n' +
      '.pb-rm-scope .aim-rm-bubble-wrap.ai   { align-items: flex-start; }\n' +
      '.pb-rm-scope .aim-rm-bubble-meta {\n' +
      '  font-size: 10px; color: var(--text-faint); margin-bottom: 4px;\n' +
      '  display: flex; align-items: center; gap: 5px;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-bubble-meta img { width: 14px; height: 14px; border-radius: 3px; object-fit: contain; }\n' +
      '.pb-rm-scope .aim-rm-bubble-user {\n' +
      '  background: var(--accent); color: #fff;\n' +
      '  border-radius: 14px; border-top-right-radius: 3px;\n' +
      '  padding: 12px 16px; max-width: 85%;\n' +
      '  font-size: 13px; font-weight: 500; line-height: 1.5;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-bubble-ai {\n' +
      '  background: var(--surface-alt);\n' +
      '  border: 1px solid var(--border-light);\n' +
      '  border-radius: 14px; border-top-left-radius: 3px;\n' +
      '  padding: 16px; max-width: 92%;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-ai-label {\n' +
      '  display: flex; align-items: center; gap: 5px; margin-bottom: 10px;\n' +
      '  font-size: 10px; font-weight: 700; text-transform: uppercase;\n' +
      '  letter-spacing: .05em; color: var(--text-faint);\n' +
      '}\n' +
      '/* v4 inlines this dot color (#6b7280, line 7527); kept as a class here */\n' +
      '.pb-rm-scope .aim-rm-ai-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #6b7280; margin-right: 4px; }\n' +
      '.pb-rm-scope .aim-rm-answer { font-size: 13px; color: var(--text); line-height: 1.65; white-space: pre-wrap; }\n' +
      '.pb-rm-scope .aim-rm-answer p { margin: 0 0 6px; white-space: normal; }\n' +
      '.pb-rm-scope .aim-rm-answer p:last-child { margin-bottom: 0; }\n' +
      '.pb-rm-scope .aim-rm-answer ol, .pb-rm-scope .aim-rm-answer ul { white-space: normal; }\n' +
      '.pb-rm-scope .pb-rm-noanswer { color: var(--text-faint); }\n' +
      '.pb-rm-scope .pb-rm-hl { background: var(--accent-light); border-radius: 3px; }\n' +
      '.pb-rm-scope .aim-rm-partial-note { margin-top: 10px; font-size: 11px; font-style: italic; color: var(--text-faint); }\n' +
      '.pb-rm-scope .aim-rm-sidebar {\n' +
      '  width: 220px; flex-shrink: 0;\n' +
      '  border-left: 1px solid var(--border-light); overflow-y: auto;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-sidebar-section { padding: 14px; border-bottom: 1px solid var(--border-light); }\n' +
      '.pb-rm-scope .aim-rm-sidebar-section:last-child { border-bottom: none; }\n' +
      '.pb-rm-scope .aim-rm-sidebar-title {\n' +
      '  font-size: 10px; font-weight: 700; text-transform: uppercase;\n' +
      '  letter-spacing: .06em; color: var(--text-faint); margin-bottom: 8px;\n' +
      '  display: flex; align-items: center; gap: 5px;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-title-ico { display: inline-flex; align-items: center; }\n' +
      '.pb-rm-scope .aim-rm-brand-chip {\n' +
      '  display: flex; align-items: center; gap: 7px;\n' +
      '  padding: 6px 8px; border-radius: var(--radius);\n' +
      '  border: 1px solid var(--border); margin-bottom: 5px;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-brand-chip.neutral { background: var(--surface); border-color: var(--border); }\n' +
      '.pb-rm-scope .aim-rm-brand-chip.own { background: var(--accent-light); border-color: var(--accent); }\n' +
      '.pb-rm-scope .aim-rm-brand-chip img { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-brand-chip-name {\n' +
      '  font-size: 11px; font-weight: 500; color: var(--text);\n' +
      '  flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-brand-chip-name.you { color: var(--accent); font-weight: 600; }\n' +
      '.pb-rm-scope .aim-rm-brand-rank { font-size: 9px; font-weight: 700; color: var(--text-faint); flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-brand-sent { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-brand-sent.positive { color: #15803d; }\n' +
      '.pb-rm-scope .aim-rm-brand-sent.neutral  { color: var(--text-muted); }\n' +
      '.pb-rm-scope .aim-rm-brand-sent.negative { color: #b91c1c; }\n' +
      '.pb-rm-scope .aim-you-badge {\n' +
      '  font-size: 9px; background: var(--accent); color: #ffffff;\n' +
      '  font-weight: 700; padding: 1px 6px; border-radius: 100px; flex-shrink: 0;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-source-row {\n' +
      '  display: flex; align-items: flex-start; gap: 7px;\n' +
      '  padding: 6px 8px; border-radius: var(--radius);\n' +
      '  border: 1px solid var(--border-light);\n' +
      '  background: var(--surface); margin-bottom: 5px;\n' +
      '  cursor: pointer; text-decoration: none;\n' +
      '  transition: border-color .1s;\n' +
      '}\n' +
      '.pb-rm-scope .aim-rm-source-row:hover { border-color: var(--accent); }\n' +
      '.pb-rm-scope .aim-rm-source-row.static { cursor: default; }\n' +
      '.pb-rm-scope .aim-rm-source-row.static:hover { border-color: var(--border-light); }\n' +
      '.pb-rm-scope .aim-rm-source-inner { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-num { font-size: 10px; font-weight: 700; color: var(--text-faint); width: 14px; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-row img { width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-domain { font-size: 11px; font-weight: 500; color: var(--text); flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }\n' +
      '.pb-rm-scope .aim-rm-source-ext-wrap { display: inline-flex; align-items: center; flex-shrink: 0; }\n' +
      '.pb-rm-scope .aim-rm-source-ext { color: var(--text-faint); flex-shrink: 0; }\n';
    document.head.appendChild(s);
  }

  // ---- shared helpers -------------------------------------------------------
  function prettyIntent(i) {
    if (!i) return '';
    var s = String(i).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
})();
