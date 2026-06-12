/*
 * api.js — thin client for the local proxy (/api/* -> aipeekaboo with key).
 * Exposes window.PBApi. Boring, obvious, guarded.
 */
(function () {
  'use strict';

  var BASE = '/api';

  function qs(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  // GET a path under /api, returns the parsed `data` field (or throws).
  async function get(path, params) {
    var url = BASE + path + qs(params);
    var res;
    try {
      res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    } catch (e) {
      throw new ApiError('NETWORK', 'Could not reach the local proxy. Is proxy_server.py running?', 0);
    }
    var json = null;
    try { json = await res.json(); } catch (e) { /* non-json */ }

    if (!res.ok || !json || json.success === false) {
      var code = (json && json.error && json.error.code) || 'HTTP_' + res.status;
      var msg = (json && json.error && json.error.message) || ('Request failed (' + res.status + ')');
      throw new ApiError(code, msg, res.status);
    }
    return json; // caller picks .data / .pagination / .metadata
  }

  function ApiError(code, message, status) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
    this.status = status;
  }
  ApiError.prototype = Object.create(Error.prototype);

  // Convenience wrappers around the documented endpoints.
  var api = {
    raw: get,
    ApiError: ApiError,

    brands: function () { return get('/brands').then(function (r) { return r.data; }); },
    brand: function (id) { return get('/brands/' + id).then(function (r) { return r.data; }); },
    snapshot: function (id) { return get('/brands/' + id + '/snapshot').then(function (r) { return r.data; }); },
    visibility: function (id, range) { return get('/brands/' + id + '/visibility', { time_range: range }).then(function (r) { return r.data; }); },
    competitors: function (id) { return get('/brands/' + id + '/competitors').then(function (r) { return r.data; }); },
    sources: function (id) { return get('/brands/' + id + '/sources').then(function (r) { return r.data; }); },
    categories: function (id, range, intent) { return get('/brands/' + id + '/categories', { time_range: range, search_intent: intent }).then(function (r) { return r.data; }); },
    // prompts returns the full envelope (has pagination)
    prompts: function (id, opts) { return get('/brands/' + id + '/prompts', opts || {}); },
    promptDetail: function (id, pid, range, full) {
      return get('/brands/' + id + '/prompts/' + pid, { time_range: range, include_full_response: full ? 'true' : undefined }).then(function (r) { return r.data; });
    },
    // looker daily rows for time-series
    looker: function (params) { return get('/looker/summary', params); },
  };

  window.PBApi = api;
})();
