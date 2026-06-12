/*
 * untracked-mentions.js — fetches all prompt histories for a brand and
 * extracts brandMentions with type="untracked" into synthetic looker-format
 * rows. Also computes correct visibility stats per entity.
 *
 * API: window.PBUntracked.fetch(brandId, timeRange) -> Promise<{rows, entityStats, citedDomains}>
 *   rows        = looker-compatible objects (entity_type: "untracked"); use for
 *                 the prompt matrix (visibility field = rank score, for sort tie-breaking only)
 *   entityStats = { [entityName]: { vis: number, byModel: { [model]: number } } }
 *                 vis = mentionCount / totalRuns * 100  (correct visibility %)
 *                 byModel[model] = modelMentions / totalRunsForModel * 100
 *   citedDomains = unique domains the AI actually cited across the fetched
 *                 prompt details (history[].sources + sourceSummary); feeds
 *                 PB.entityDomain so untracked entity names can resolve to
 *                 real cited domains (never guessed ones)
 *
 * Concurrency: 4 prompt-detail fetches at a time.
 * Caching: in-memory, 5-min TTL, keyed by brandId + "|" + timeRange.
 */
(function () {
  'use strict';

  var CACHE_TTL_MS = 300000; // 5 minutes
  var CONCURRENCY = 4;
  var cache = {};

  function cacheKey(brandId, timeRange) {
    return String(brandId) + '|' + String(timeRange);
  }

  function getCached(brandId, timeRange) {
    var key = cacheKey(brandId, timeRange);
    var entry = cache[key];
    if (!entry) return null;
    if (Date.now() > entry.expires) { delete cache[key]; return null; }
    return { rows: entry.rows, entityStats: entry.entityStats, citedDomains: entry.citedDomains || [] };
  }

  function setCached(brandId, timeRange, rows, entityStats, citedDomains) {
    var key = cacheKey(brandId, timeRange);
    cache[key] = { expires: Date.now() + CACHE_TTL_MS, rows: rows, entityStats: entityStats, citedDomains: citedDomains || [] };
  }

  function runWithConcurrency(factories, limit) {
    return new Promise(function (resolve) {
      var results = [];
      var index = 0;
      var active = 0;
      var total = factories.length;

      if (total === 0) { resolve(results); return; }

      function next() {
        while (active < limit && index < total) {
          var i = index;
          index += 1;
          active += 1;
          (function (factoryFn) {
            var p;
            try { p = factoryFn(); } catch (e) { p = Promise.reject(e); }
            p.then(function (val) { results.push(val); }).catch(function () {
              // swallow; skip this prompt
            }).then(function () {
              active -= 1;
              if (active === 0 && index >= total) { resolve(results); }
              else { next(); }
            });
          })(factories[i]);
        }
      }

      next();
    });
  }

  function fetchUntrackedRows(brandId, timeRange) {
    var api = window.PBApi;
    if (!api) return Promise.resolve({ rows: [], entityStats: {}, citedDomains: [] });

    var cached = getCached(brandId, timeRange);
    if (cached !== null) return Promise.resolve(cached);

    return api.prompts(brandId, { time_range: timeRange, per_page: 100, page: 1 }).then(function (envelope) {
      var promptList = (envelope && Array.isArray(envelope.data)) ? envelope.data : [];
      if (!promptList.length) {
        setCached(brandId, timeRange, [], {}, []);
        return { rows: [], entityStats: {}, citedDomains: [] };
      }

      var factories = promptList.map(function (prompt) {
        return function () {
          var promptId = prompt.promptId || prompt.id;
          var promptText = prompt.promptText || prompt.prompt || '';
          if (!promptId) return Promise.resolve(null);
          return api.promptDetail(brandId, promptId, timeRange, false).then(function (detail) {
            return { detail: detail, promptText: promptText };
          }).catch(function () { return null; });
        };
      });

      return runWithConcurrency(factories, CONCURRENCY).then(function (detailResults) {
        var rows = [];

        // Unique cited domains across all fetched details (real citations
        // only; used by PB.entityDomain, never for guessing).
        var citedDomains = [];
        var citedSeen = {};
        function addCited(domain) {
          if (!domain) return;
          var d = String(domain).trim().toLowerCase();
          if (!d || citedSeen[d]) return;
          citedSeen[d] = true;
          citedDomains.push(d);
        }

        // Counters for correct visibility calculation
        var totalRuns = 0;
        var totalRunsByModel = {};     // model -> count of history entries
        var entityMentionRuns = {};    // entityName -> count of runs that mention it
        var entityModelMentions = {};  // entityName -> model -> count

        for (var i = 0; i < detailResults.length; i++) {
          var result = detailResults[i];
          if (!result || !result.detail) continue;
          var detail = result.detail;
          var promptText = result.promptText;
          var history = Array.isArray(detail.history) ? detail.history : [];

          var summarySources = Array.isArray(detail.sourceSummary) ? detail.sourceSummary : [];
          for (var ss = 0; ss < summarySources.length; ss++) {
            if (summarySources[ss]) addCited(summarySources[ss].domain);
          }

          for (var h = 0; h < history.length; h++) {
            var histEntry = history[h];
            if (!histEntry) continue;

            var histSources = Array.isArray(histEntry.sources) ? histEntry.sources : [];
            for (var hs = 0; hs < histSources.length; hs++) {
              if (histSources[hs]) addCited(histSources[hs].domain);
            }

            totalRuns++;
            var histModel = histEntry.aiModel || '';
            totalRunsByModel[histModel] = (totalRunsByModel[histModel] || 0) + 1;

            var brandMentions = Array.isArray(histEntry.brandMentions) ? histEntry.brandMentions : [];
            var mentionedThisRun = {};

            for (var m = 0; m < brandMentions.length; m++) {
              var mention = brandMentions[m];
              if (!mention || mention.type !== 'untracked') continue;
              var eName = mention.entityName;
              if (!eName) continue;

              // Track per-run deduplication (entity might appear multiple times in one run)
              if (!mentionedThisRun[eName]) {
                mentionedThisRun[eName] = true;
                entityMentionRuns[eName] = (entityMentionRuns[eName] || 0) + 1;
                entityModelMentions[eName] = entityModelMentions[eName] || {};
                entityModelMentions[eName][histModel] = (entityModelMentions[eName][histModel] || 0) + 1;
              }

              rows.push({
                entity_name: eName,
                entity_type: 'untracked',
                ai_model: histModel,
                prompt: promptText,
                // Keep rank score for prompt matrix tie-breaking; entityStats.vis is the real % metric
                visibility: Number(mention.score) || 0,
                avg_position: Number(mention.rank) || 0,
                sentiment: mention.sentiment || '',
                date: histEntry.date || '',
              });
            }
          }
        }

        // Compute correct visibility per entity as a fraction of total runs
        var entityStats = {};
        var entityNames = Object.keys(entityMentionRuns);
        for (var ei = 0; ei < entityNames.length; ei++) {
          var en = entityNames[ei];
          var vis = totalRuns > 0 ? (entityMentionRuns[en] / totalRuns * 100) : 0;
          var byModel = {};
          var modelKeys = Object.keys(entityModelMentions[en] || {});
          for (var mi = 0; mi < modelKeys.length; mi++) {
            var mk = modelKeys[mi];
            var mTotal = totalRunsByModel[mk] || 1;
            byModel[mk] = entityModelMentions[en][mk] / mTotal * 100;
          }
          entityStats[en] = { vis: vis, byModel: byModel };
        }

        setCached(brandId, timeRange, rows, entityStats, citedDomains);
        return { rows: rows, entityStats: entityStats, citedDomains: citedDomains };
      });
    }).catch(function () {
      return { rows: [], entityStats: {}, citedDomains: [] };
    });
  }

  window.PBUntracked = {
    fetch: function (brandId, timeRange) {
      try {
        return fetchUntrackedRows(brandId, timeRange);
      } catch (e) {
        return Promise.resolve({ rows: [], entityStats: {}, citedDomains: [] });
      }
    },
  };
})();
