/*
 * competitors.js — binds LIVE competitor data into the "Competitors" card,
 * preserving the EXACT captured row markup.
 *
 * Content model (matches the real dashboard):
 *   The list ranks the user's brand AND competitors together by VISIBILITY.
 *   Each row shows: rank #, favicon, name, optional "untracked" badge,
 *   VISIBILITY % + bar, SENTIMENT %, POSITION (avg position, 1 decimal).
 *
 *   Entities + their metrics are derived from data.looker.data when available
 *   (aggregated per entity_name):
 *     VISIBILITY = avg of `visibility` (0..100) over that entity's rows
 *     SENTIMENT  = % positive among rows whose `sentiment` is a real value
 *                  (positive / neutral / negative); "—" if none typed
 *     POSITION   = avg of `avg_position` over rows where avg_position > 0
 *                  (1 decimal); "—" if none
 *   "untracked" badge: shown for an entity that is neither the user's brand
 *   nor one of the API-tracked competitors (i.e. surfaced only in AI answers).
 *
 *   Fallback (no looker): build from data.snap.competitors (+ the brand) using
 *   score for VISIBILITY, rank for POSITION, "—" for SENTIMENT.
 *
 * Row template (from _ref_full.html), a grid with 5 columns
 *   grid-cols-[24px_1fr_72px_68px_56px]:
 *     1) span ........................ rank number
 *     2) div.flex.items-center ....... favicon (img inside div.relative) +
 *                                      span.truncate (name) + optional badge
 *     3) div.text-right .............. span.font-medium (visibility %) + bar
 *     4) span.text-right ............. sentiment %
 *     5) span.text-right ............. position
 *
 * The first .grid row inside the list is the uppercase column-label header and
 * is NOT a data row; we keep it and only repopulate the data rows.
 */
(function () {
  'use strict';
  window.PBbind = window.PBbind || {};

  window.PBbind.competitors = function (root, ctx, data) {
    try {
      if (!root) return;
      var dash = window.PBdash;
      var card = (dash && dash.cardByTitle) ? dash.cardByTitle(root, 'Competitors') : null;
      if (!card) { console.error('[bind competitors] card not found'); return; }

      var PB = window.PB || {};
      var fmt = (PB.fmt) || {};

      var snap = (data && data.snap) || {};
      var looker = (data && data.looker) || null;
      var untrackedRows = (data && data.untracked && Array.isArray(data.untracked.rows))
        ? data.untracked.rows : [];
      var entityStats = (data && data.untracked && data.untracked.entityStats)
        ? data.untracked.entityStats : {};

      // brand identity + tracked-competitor universe (for the "untracked" badge)
      var brandName = (snap.brand && snap.brand.name) || (ctx && ctx.brandName) || '';
      var brandUrl = guessBrandUrl(snap, ctx);

      var snapComps = (snap && Array.isArray(snap.competitors)) ? snap.competitors : [];
      var urlByName = {};
      var trackedNames = {};
      if (brandName) trackedNames[brandName.toLowerCase()] = true;
      for (var sc = 0; sc < snapComps.length; sc++) {
        var sco = snapComps[sc] || {};
        if (sco.name) {
          trackedNames[String(sco.name).toLowerCase()] = true;
          if (sco.url) urlByName[String(sco.name).toLowerCase()] = sco.url;
        }
      }
      if (brandName && brandUrl) urlByName[brandName.toLowerCase()] = brandUrl;

      // --- build the ranked entity list ----------------------------------
      var mergedLooker = looker
        ? { data: (looker.data || []).concat(untrackedRows) }
        : (untrackedRows.length ? { data: untrackedRows } : null);
      var entities = buildFromLooker(mergedLooker, urlByName);
      if (!entities.length) {
        entities = buildFromSnapshot(snap, brandName, brandUrl, snapComps);
      }

      // cited-domain corpus for the favicon resolution chain: snapshot
      // sources + the domains seen while fetching untracked mentions. These
      // are domains the AI actually cited; never constructed from names.
      var citedDomains = [];
      var citedSeen = {};
      function addCited(domain) {
        if (!domain) return;
        var cd = String(domain).trim().toLowerCase();
        if (!cd || citedSeen[cd]) return;
        citedSeen[cd] = true;
        citedDomains.push(cd);
      }
      var snapSources = (snap && Array.isArray(snap.sources)) ? snap.sources : [];
      for (var ss = 0; ss < snapSources.length; ss++) {
        if (snapSources[ss]) addCited(snapSources[ss].domain);
      }
      var untrackedCited = (data && data.untracked && Array.isArray(data.untracked.citedDomains))
        ? data.untracked.citedDomains : [];
      for (var uc = 0; uc < untrackedCited.length; uc++) addCited(untrackedCited[uc]);

      // mark "untracked", fix visibility for entities from AI answers only,
      // and resolve a favicon domain: API url first, then the shared chain
      // (cited domains -> curated known map). Unresolved entities keep
      // favDomain = '' (the img hides itself; no guessed kn.com style urls).
      for (var ei = 0; ei < entities.length; ei++) {
        var en = entities[ei];
        en.untracked = !en.isBrand && !trackedNames[String(en.name || '').toLowerCase()];
        if (en.untracked && entityStats[en.name] != null) {
          en.visibility = entityStats[en.name].vis;
        }
        en.favDomain = en.url || '';
        if (!en.favDomain && PB.entityDomain) {
          en.favDomain = PB.entityDomain(en.name, citedDomains) || '';
        }
      }

      // sort by visibility desc (stable-ish: tie-break on name)
      entities.sort(function (a, b) {
        var d = (Number(b.visibility) || 0) - (Number(a.visibility) || 0);
        if (d !== 0) return d;
        return String(a.name).localeCompare(String(b.name));
      });

      // --- locate the row list container ---------------------------------
      var grids = card.querySelectorAll('.grid');
      if (!grids || !grids.length) { console.error('[bind competitors] no grid rows'); return; }
      var container = grids[0].parentNode;
      if (!container) { console.error('[bind competitors] no row container'); return; }

      // Separate the uppercase column-label header (keep) from data rows.
      var labelHeader = null;
      var dataRows = [];
      for (var i = 0; i < grids.length; i++) {
        var g = grids[i];
        if (g.parentNode !== container) continue; // only direct children
        var cls = g.className || '';
        if (cls.indexOf('uppercase') !== -1) {
          if (!labelHeader) labelHeader = g;
        } else {
          dataRows.push(g);
        }
      }

      // --- empty state ----------------------------------------------------
      if (!entities.length) {
        for (var d = 0; d < dataRows.length; d++) {
          if (dataRows[d] && dataRows[d].parentNode === container) {
            container.removeChild(dataRows[d]);
          }
        }
        var existingEmpty = container.querySelector('[data-pb-empty]');
        if (!existingEmpty) {
          var empty = document.createElement('div');
          empty.setAttribute('data-pb-empty', '1');
          empty.className = 'text-sm text-muted-foreground py-3';
          empty.textContent = 'No competitors tracked for this brand.';
          container.appendChild(empty);
        }
        updateCount(card, 0);
        disableNext(card);
        return;
      }

      // remove any prior empty message
      var prevEmpty = container.querySelector('[data-pb-empty]');
      if (prevEmpty && prevEmpty.parentNode) prevEmpty.parentNode.removeChild(prevEmpty);

      // --- pick a template row -------------------------------------------
      if (!dataRows.length) { console.error('[bind competitors] no template row'); return; }
      var template = dataRows[0].cloneNode(true);

      // remove all existing data rows from the container
      for (var r = 0; r < dataRows.length; r++) {
        if (dataRows[r] && dataRows[r].parentNode === container) {
          container.removeChild(dataRows[r]);
        }
      }

      // --- build a row per entity ----------------------------------------
      for (var c = 0; c < entities.length; c++) {
        var ent = entities[c] || {};
        var row = template.cloneNode(true);
        fillRow(row, ent, c + 1, PB, fmt);
        container.appendChild(row);
      }

      // --- update pagination count ("1-N of N") + disable next -----------
      updateCount(card, entities.length);
      disableNext(card);
    } catch (e) {
      console.error('[bind competitors]', e);
    }
  };

  // -------------------------------------------------------------------------
  // Aggregate looker rows into a per-entity list with visibility / sentiment /
  // position metrics. Returns [] if looker is absent/empty.
  function buildFromLooker(looker, urlByName) {
    var out = [];
    try {
      if (!looker || !Array.isArray(looker.data) || !looker.data.length) return out;
      var rows = looker.data;
      var map = {}; // name -> agg
      for (var i = 0; i < rows.length; i++) {
        var rrow = rows[i] || {};
        var name = rrow.entity_name || rrow.brand;
        if (!name) continue;
        var key = String(name);
        var a = map[key];
        if (!a) {
          a = {
            name: key,
            type: rrow.entity_type || '',
            vSum: 0, vN: 0,
            pSum: 0, pN: 0,
            sPos: 0, sTyped: 0,
          };
          map[key] = a;
        }
        // visibility (counts every row, including zeroes)
        a.vSum += (Number(rrow.visibility) || 0);
        a.vN += 1;
        // average position: only count rows with a real position (> 0)
        var ap = Number(rrow.avg_position);
        if (!isNaN(ap) && ap > 0) { a.pSum += ap; a.pN += 1; }
        // sentiment: only count rows with a real sentiment value
        var s = String(rrow.sentiment || '').toLowerCase();
        if (s === 'positive' || s === 'neutral' || s === 'negative') {
          a.sTyped += 1;
          if (s === 'positive') a.sPos += 1;
        }
      }
      for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        var e = map[k];
        var vis = e.vN ? (e.vSum / e.vN) : 0;
        var pos = e.pN ? (e.pSum / e.pN) : null;
        var sent = e.sTyped ? Math.round((e.sPos / e.sTyped) * 100) : null;
        out.push({
          name: e.name,
          // API url only; entities with no url resolve through the cited /
          // known-brand chain in the bind function (never name-as-domain)
          url: urlByName[e.name.toLowerCase()] || '',
          visibility: vis,
          position: pos,
          sentiment: sent,
          isBrand: e.type === 'brand',
        });
      }
    } catch (err) {
      console.error('[bind competitors buildFromLooker]', err);
    }
    return out;
  }

  // Fallback list built from the snapshot (brand + tracked competitors).
  function buildFromSnapshot(snap, brandName, brandUrl, snapComps) {
    var out = [];
    try {
      var brandVis = (snap && snap.visibility && snap.visibility.score != null)
        ? Number(snap.visibility.score) : null;
      if (brandName) {
        out.push({
          name: brandName,
          url: brandUrl || '',
          visibility: brandVis != null ? brandVis : 0,
          position: (snap && snap.visibility && snap.visibility.rank != null)
            ? Number(snap.visibility.rank) : null,
          sentiment: null,
          isBrand: true,
        });
      }
      for (var i = 0; i < snapComps.length; i++) {
        var c = snapComps[i] || {};
        if (!c.name) continue;
        out.push({
          name: c.name,
          url: c.url || '',
          visibility: (c.score != null && !isNaN(Number(c.score))) ? Number(c.score) : 0,
          position: (c.rank != null && c.rank !== '') ? Number(c.rank) : null,
          sentiment: null,
          isBrand: false,
        });
      }
    } catch (err) {
      console.error('[bind competitors buildFromSnapshot]', err);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  function fillRow(row, ent, rank, PB, fmt) {
    try {
      var children = [];
      for (var i = 0; i < row.children.length; i++) children.push(row.children[i]);
      // children: [rankSpan, brandDiv, visDiv, sentimentSpan, positionSpan]

      // 1) rank number
      var rankEl = children[0];
      if (rankEl) rankEl.textContent = String(rank);

      // 2) brand cell: favicon + name + (untracked badge toggle)
      var brandCell = children[1];
      if (brandCell) {
        var img = brandCell.querySelector('img');
        if (img) {
          // favDomain = API url or chain-resolved cited/known domain; NEVER
          // the entity name (no guessed favicon requests).
          var favSrc = (ent.favDomain || ent.url) ? ((PB.favicon) ? PB.favicon(ent.favDomain || ent.url) : '') : '';
          if (favSrc) {
            img.setAttribute('src', favSrc);
            img.style.visibility = '';
          } else {
            img.removeAttribute('src');
            img.style.visibility = 'hidden';
          }
          img.setAttribute('alt', ent.name || '');
        }
        var nameEl = brandCell.querySelector('span.truncate');
        if (nameEl) nameEl.textContent = ent.name || '';

        // untracked badge: present in the template; keep for untracked
        // entities (not the brand, not a tracked competitor), else remove.
        var badge = null;
        var spans = brandCell.querySelectorAll('span');
        for (var s = 0; s < spans.length; s++) {
          var t = (spans[s].textContent || '').trim().toLowerCase();
          if (t === 'untracked') { badge = spans[s]; break; }
        }
        if (ent.untracked) {
          // keep the badge (already cloned from template). If somehow missing,
          // leave as-is — we don't synthesize markup the template lacks.
        } else if (badge && badge.parentNode) {
          badge.parentNode.removeChild(badge);
        }
      }

      // 3) visibility cell: percent text + bar width
      var vis = Number(ent.visibility);
      if (isNaN(vis)) vis = 0;
      var visStr = (fmt.score ? fmt.score(vis) : Math.round(vis) + '%');
      var visCell = children[2];
      if (visCell) {
        var pctEl = visCell.querySelector('span.font-medium') || visCell.querySelector('span');
        if (pctEl) pctEl.textContent = visStr;
        var bars = visCell.querySelectorAll('div');
        if (bars && bars.length) {
          var inner = bars[bars.length - 1];
          if (inner) inner.style.width = clampPct(vis) + '%';
        }
      }

      // 4) sentiment % (or —)
      var sentEl = children[3];
      if (sentEl) {
        sentEl.textContent = (ent.sentiment == null)
          ? '—'
          : (fmt.pct ? fmt.pct(ent.sentiment) : Math.round(ent.sentiment) + '%');
      }

      // 5) position (avg position, 1 decimal) or —
      var posEl = children[4];
      if (posEl) {
        posEl.textContent = (ent.position == null || isNaN(Number(ent.position)))
          ? '—'
          : fmtPos(ent.position, fmt);
      }
    } catch (e) {
      console.error('[bind competitors fillRow]', e);
    }
  }

  function fmtPos(n, fmt) {
    var v = Number(n);
    if (isNaN(v)) return '—';
    // match the real card: integers show without a decimal (e.g. "3"),
    // non-integers show one decimal (e.g. "2.6").
    if (v === Math.round(v)) return String(Math.round(v));
    return (fmt && fmt.num1) ? fmt.num1(v) : v.toFixed(1);
  }

  function clampPct(n) {
    n = Number(n);
    if (isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function guessBrandUrl(snap, ctx) {
    try {
      if (snap && snap.brand && snap.brand.url) return snap.brand.url;
      if (ctx && ctx.brandUrl) return ctx.brandUrl;
    } catch (e) { /* ignore */ }
    return '';
  }

  function updateCount(card, total) {
    try {
      var spans = card.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var t = (spans[i].textContent || '').trim();
        // match the baked "1-8 of 19" pagination count
        if (/^\d+\s*-\s*\d+\s+of\s+\d+$/i.test(t) || /^\d+\s+of\s+\d+$/i.test(t)) {
          spans[i].textContent = total > 0 ? ('1-' + total + ' of ' + total) : ('0 of 0');
          return;
        }
      }
    } catch (e) { console.error('[bind competitors updateCount]', e); }
  }

  function disableNext(card) {
    try {
      var btns = card.querySelectorAll('button[aria-label="Next page"]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].setAttribute('disabled', '');
      }
    } catch (e) { console.error('[bind competitors disableNext]', e); }
  }
})();
