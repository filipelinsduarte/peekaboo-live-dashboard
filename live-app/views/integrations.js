/*
 * integrations.js — Integrations view (live), pixel-faithful clone of the
 * captured reference pages:
 *   app/integrations.html                    (MCP tab, page chrome, tab bar)
 *   app/integrations__tab1-rest-api.html     (REST API tab)
 *   app/integrations__tab2-usage.html        (Usage tab)
 *   app/integrations__tab3-looker-studio.html(Looker Studio tab)
 * The API Docs tab was not captured; it reuses the captured endpoint /
 * rate-limit blocks so its chrome matches the rest of the page.
 *
 * Layout (markup/classes copied from the captured pages):
 *   - page header: blocks icon + "Integrations" + subtitle
 *   - shadcn tab bar with 5 triggers: MCP (New badge) / REST API / Usage /
 *     Looker Studio (img logo) / API Docs
 *   - one tabpanel per trigger, exact captured card markup
 *
 * Dynamic bits:
 *   - the user's API key is fetched from /config.json (served by the local
 *     proxy); it is shown masked in the REST API tab and substituted into the
 *     MCP config snippets and the Quick Start curl examples
 *   - copy buttons write the snippet text to the clipboard
 *   - the inner MCP client tabs (Claude Desktop / Claude Code / Cursor) work
 *   - write actions (generate key / revoke) show a toast: the local mirror
 *     never mutates the production account
 *
 * Tests: live-app/tests/integrations.test.mjs (node) covers the pure helpers
 * (maskKey, snippet builders, usagePct).
 */
(function () {
  'use strict';
  if (!window.PB) return;
  var el = PB.el;

  var MCP_URL = 'https://www.aipeekaboo.com/api/mcp';
  var API_BASE_URL = 'https://www.aipeekaboo.com/api/v1';
  var KEY_PLACEHOLDER = 'pk_YOUR_KEY';

  // ---- pure helpers (exposed for unit tests) --------------------------------
  function maskKey(key) {
    var k = String(key || '');
    if (k.indexOf('pk_') !== 0 || k.length < 16) return '';
    return k.slice(0, 11) + '…' + k.slice(-6);
  }

  function mcpJsonSnippet(key) {
    var k = key || KEY_PLACEHOLDER;
    return '{\n' +
      '  "mcpServers": {\n' +
      '    "peekaboo": {\n' +
      '      "command": "npx",\n' +
      '      "args": [\n' +
      '        "mcp-remote@latest",\n' +
      '        "' + MCP_URL + '",\n' +
      '        "--header",\n' +
      '        "Authorization: Bearer ' + k + '"\n' +
      '      ]\n' +
      '    }\n' +
      '  }\n' +
      '}';
  }

  function mcpClaudeCodeSnippet(key) {
    var k = key || KEY_PLACEHOLDER;
    return 'claude mcp add peekaboo -- npx mcp-remote@latest ' + MCP_URL +
      ' --header "Authorization: Bearer ' + k + '"';
  }

  function quickstartSnippet(key) {
    var k = key || 'pk_your_key';
    return '# List your brands\n' +
      'curl -H "X-API-Key: ' + k + '" \\\n' +
      '  ' + API_BASE_URL + '/brands\n' +
      '\n' +
      '# Get visibility score\n' +
      'curl -H "X-API-Key: ' + k + '" \\\n' +
      '  ' + API_BASE_URL + '/brands/BRAND_ID/visibility?time_range=30d';
  }

  function usagePct(used, limit) {
    var u = Number(used) || 0;
    var l = Number(limit) || 0;
    if (l <= 0) return 0;
    var pct = Math.round((u / l) * 100);
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- class strings copied verbatim from the captured page -----------------
  var TABLIST_CLS = 'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground mb-6';
  var TRIGGER_CLS = 'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm gap-2';
  var PANEL_CLS = 'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 space-y-4';
  var COPY_BTN_CLS = 'absolute top-2 right-2 bg-white/10 border border-white/15 text-zinc-400 hover:text-white rounded px-2 py-1 text-[10px] font-medium';
  var BETA_BADGE = '<div class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe]">Beta</div>';
  var TD_CLS = 'p-4 align-middle';
  var TH_CLS = 'h-12 px-4 text-left align-middle font-medium text-muted-foreground';
  var REVOKE_BTN = '<button type="button" data-act="revoke" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors hover:bg-accent h-9 rounded-md px-3 text-destructive hover:text-destructive"><i data-lucide="trash-2" class="h-4 w-4 mr-1" style="width:16px;height:16px"></i>Revoke</button>';

  // ---- lucide icon helper ----------------------------------------------------
  function luc(name, cls) {
    return '<i data-lucide="' + name + '" class="' + (cls || '') + '"></i>';
  }

  // ---- captured data (Active API Keys table, REST tab) -----------------------
  var REST_KEYS = [
    { perm: 'Read + write', created: 'Jun 2, 2026, 07:28 PM', lastUsed: 'Jun 2, 2026, 07:31 PM' },
    { perm: 'Read + write', created: 'Apr 28, 2026, 11:44 AM', lastUsed: 'May 18, 2026, 02:56 PM' },
    { perm: 'Read + write', created: 'Apr 27, 2026, 09:21 AM', lastUsed: 'Jun 8, 2026, 12:17 PM' },
    { perm: 'Read + write', created: 'Apr 25, 2026, 05:17 PM', lastUsed: 'Jun 4, 2026, 03:21 PM' },
    { perm: 'Read + write', created: 'Apr 25, 2026, 05:12 PM', lastUsed: 'Apr 25, 2026, 05:12 PM' },
    { perm: 'Read + write', created: 'Apr 22, 2026, 04:40 PM', lastUsed: 'Apr 27, 2026, 01:02 PM' },
    { perm: 'Read + write', created: 'Apr 21, 2026, 11:02 PM', lastUsed: 'Jun 8, 2026, 07:03 PM' },
    { perm: 'Read-only', created: 'Apr 21, 2026, 10:17 PM', lastUsed: 'Apr 21, 2026, 10:17 PM' },
    { perm: 'Read-only', created: 'Apr 9, 2026, 02:31 PM', lastUsed: 'Apr 9, 2026, 02:37 PM' },
    { perm: 'Read-only', created: 'Apr 8, 2026, 01:48 PM', lastUsed: 'Apr 8, 2026, 02:35 PM' },
    { perm: 'Read-only', created: 'Apr 8, 2026, 11:23 AM', lastUsed: 'Apr 8, 2026, 01:23 PM' },
    { perm: 'Read-only', created: 'Mar 12, 2026, 08:24 AM', lastUsed: 'Jun 11, 2026, 11:45 AM' },
  ];
  var REST_REVOKED = ['Revoked Jun 2, 2026, 03:51 PM', 'Revoked Apr 14, 2026, 04:47 PM'];

  // ---- captured data (Usage tab per-key cards) --------------------------------
  var USAGE_KEYS = [
    { name: 'Looker Studio', badges: ['Read only', 'Looker'], last: 'Never used', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 8d ago', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 24d ago', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 3d ago', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 7d ago', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 46d ago', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 45d ago', used: 0 },
    { name: 'API Key', badges: ['Read + write'], last: 'Last used 2d ago', used: 0 },
    { name: 'API Key', badges: ['Read only'], last: 'Last used 50d ago', used: 0 },
    { name: 'API Key', badges: ['Read only'], last: 'Last used 63d ago', used: 0 },
    { name: 'API Key', badges: ['Read only'], last: 'Last used 64d ago', used: 0 },
    { name: 'API Key', badges: ['Read only'], last: 'Last used 64d ago', used: 0 },
    { name: 'API Key', badges: ['Read only'], last: 'Last used 3h ago', used: 100 },
    { name: 'Looker Studio', badges: ['Read only', 'Looker'], last: 'Last used 7d ago', used: 0 },
  ];
  var DAILY_LIMIT = 2000;

  // ---- captured data (Looker tab Active Keys + revoked) -----------------------
  var LOOKER_KEYS = [
    { name: 'Looker Studio', perm: 'Looker (read)', created: 'Jun 4, 2026, 11:34 AM', lastUsed: 'Never' },
    { name: 'Looker Studio', perm: 'Looker (read)', created: 'Feb 23, 2026, 03:48 PM', lastUsed: 'Jun 4, 2026, 11:35 AM' },
  ];
  var LOOKER_REVOKED = [
    'Revoked Feb 23, 2026, 03:48 PM', 'Revoked Feb 6, 2026, 04:16 PM',
    'Revoked Feb 5, 2026, 11:25 PM', 'Revoked Feb 5, 2026, 10:58 AM',
    'Revoked Feb 3, 2026, 07:57 PM', 'Revoked Feb 3, 2026, 07:50 PM',
    'Revoked Feb 3, 2026, 05:58 PM', 'Revoked Feb 3, 2026, 01:30 PM',
    'Revoked Jan 16, 2026, 05:54 PM', 'Revoked Jan 16, 2026, 05:50 PM',
    'Revoked Jan 16, 2026, 05:50 PM', 'Revoked Jan 16, 2026, 05:43 PM',
  ];

  var ENDPOINTS = [
    ['/api/v1/brands', 'List all brands'],
    ['/api/v1/brands/:id/snapshot', 'Full analytics snapshot'],
    ['/api/v1/brands/:id/visibility', 'Visibility score & market share'],
    ['/api/v1/brands/:id/competitors', 'Competitor comparison'],
    ['/api/v1/brands/:id/sources', 'Source/domain coverage'],
    ['/api/v1/brands/:id/prompts', 'Prompt performance metrics'],
    ['/api/v1/brands/:id/prompts/:pid', 'Prompt detail & run history'],
  ];

  var MCP_TOOLS = [
    ['list_brands', 'Read', 'Every brand in your project with IDs and names'],
    ['get_brand_visibility', 'Read', 'Latest visibility score, rank, and top prompts for one brand'],
    ['list_competitors', 'Read', 'Competitors with their scores and traffic data'],
    ['get_rate_limit_status', 'Read', 'Remaining per-minute and per-day requests on the current key'],
    ['add_prompt', 'Read + write', 'Add a tracking prompt to a brand'],
    ['add_competitor', 'Read + write', 'Add a competitor to a brand for visibility tracking'],
  ];

  // ---- shared markup builders -------------------------------------------------
  function permBadgeHtml(perm) {
    if (perm === 'Read + write') {
      return '<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-[10px] border-amber-300 text-amber-600">Read + write</div>';
    }
    return '<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-foreground text-[10px]">' + escapeHtml(perm) + '</div>';
  }

  function keysTableHtml(rows, nameDefault) {
    var body = rows.map(function (r) {
      return '<tr class="border-b transition-colors hover:bg-muted/50">' +
        '<td class="' + TD_CLS + ' font-medium">' + escapeHtml(r.name || nameDefault) + '</td>' +
        '<td class="' + TD_CLS + '">' + permBadgeHtml(r.perm) + '</td>' +
        '<td class="' + TD_CLS + ' text-sm text-muted-foreground">' + escapeHtml(r.created) + '</td>' +
        '<td class="' + TD_CLS + ' text-sm text-muted-foreground">' + escapeHtml(r.lastUsed) + '</td>' +
        '<td class="' + TD_CLS + ' text-right">' + REVOKE_BTN + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="border rounded-lg"><div class="relative w-full overflow-auto">' +
      '<table class="w-full caption-bottom text-sm">' +
      '<thead class="[&_tr]:border-b"><tr class="border-b transition-colors hover:bg-muted/50">' +
      '<th class="' + TH_CLS + '">Name</th><th class="' + TH_CLS + '">Permissions</th>' +
      '<th class="' + TH_CLS + '">Created</th><th class="' + TH_CLS + '">Last Used</th>' +
      '<th class="h-12 px-4 align-middle font-medium text-muted-foreground text-right">Actions</th>' +
      '</tr></thead><tbody class="[&_tr:last-child]:border-0">' + body + '</tbody></table>' +
      '</div></div>';
  }

  function revokedDetailsHtml(items, nameDefault) {
    var body = items.map(function (when) {
      return '<tr class="border-b transition-colors hover:bg-muted/50 opacity-60">' +
        '<td class="' + TD_CLS + ' font-medium">' + escapeHtml(nameDefault) + '</td>' +
        '<td class="' + TD_CLS + ' text-sm text-muted-foreground">' + escapeHtml(when) + '</td>' +
        '</tr>';
    }).join('');
    return '<details class="text-sm"><summary class="cursor-pointer text-muted-foreground hover:text-foreground">Show ' +
      items.length + ' revoked keys</summary>' +
      '<div class="mt-2 border rounded-lg"><div class="relative w-full overflow-auto">' +
      '<table class="w-full caption-bottom text-sm"><tbody class="[&_tr:last-child]:border-0">' + body + '</tbody></table>' +
      '</div></div></details>';
  }

  function endpointsBlockHtml() {
    var rows = ENDPOINTS.map(function (e) {
      return '<div><span class="text-green-700 font-semibold">GET</span> ' +
        '<span class="text-zinc-100">' + escapeHtml(e[0]) + '</span> ' +
        '<span class="text-zinc-500">' + escapeHtml(e[1]) + '</span></div>';
    }).join('');
    return '<div class="bg-zinc-900 rounded-lg p-4 font-mono text-xs leading-loose overflow-x-auto">' + rows + '</div>' +
      '<p class="text-[11px] text-muted-foreground mt-2">All endpoints accept <code class="bg-muted px-1 py-0.5 rounded">time_range</code> (7d, 30d, 90d) query parameter.</p>';
  }

  function rateLimitsBlockHtml() {
    var rows = [
      ['Peek', '5', '50'],
      ['Grow', '20', '1,000'],
      ['Pro / Enterprise / Custom', '40', '2,000'],
    ].map(function (r) {
      return '<tr class="border-b transition-colors hover:bg-muted/50">' +
        '<td class="' + TD_CLS + ' text-sm">' + r[0] + '</td>' +
        '<td class="' + TD_CLS + ' text-sm text-muted-foreground">' + r[1] + '</td>' +
        '<td class="' + TD_CLS + ' text-sm text-muted-foreground">' + r[2] + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="border rounded-lg overflow-hidden"><div class="relative w-full overflow-auto">' +
      '<table class="w-full caption-bottom text-sm">' +
      '<thead class="[&_tr]:border-b"><tr class="border-b transition-colors hover:bg-muted/50">' +
      '<th class="' + TH_CLS + ' text-xs">Plan</th><th class="' + TH_CLS + ' text-xs">Per Minute</th><th class="' + TH_CLS + ' text-xs">Daily</th>' +
      '</tr></thead><tbody class="[&_tr:last-child]:border-0">' + rows + '</tbody></table></div></div>' +
      '<p class="text-[11.5px] text-muted-foreground mt-3 leading-relaxed">Limits are enforced per API key. Every response includes <code class="bg-muted px-1 py-0.5 rounded">X-RateLimit-Remaining</code> and <code class="bg-muted px-1 py-0.5 rounded">X-RateLimit-Daily-Remaining</code> headers. Exceeding limits returns a <code class="bg-muted px-1 py-0.5 rounded">429</code> with retry timing in the response.</p>';
  }

  function copyPreHtml(snippetId, ariaLabel, text) {
    return '<div class="relative">' +
      '<button type="button" data-copy="' + snippetId + '" aria-label="' + escapeHtml(ariaLabel) + '" class="' + COPY_BTN_CLS + '">Copy</button>' +
      '<pre id="' + snippetId + '" class="text-[11px] bg-zinc-900 text-zinc-100 rounded-lg p-3.5 pr-14 overflow-x-auto leading-relaxed font-mono">' + escapeHtml(text) + '</pre>' +
      '</div>';
  }

  // ===========================================================================
  // Tab panel builders (markup copied from the captured pages)
  // ===========================================================================

  function mcpPanelHtml(key) {
    var clientCard = function (logo, name, sub) {
      return '<div class="rounded-xl border p-3 text-center">' +
        '<img alt="" class="mx-auto mb-2 h-5 w-5 object-contain" src="' + logo + '" onerror="this.style.visibility=\'hidden\'">' +
        '<p class="text-xs font-semibold leading-tight">' + name + '</p>' +
        '<p class="text-[10px] text-muted-foreground leading-tight mt-0.5 mb-2">' + sub + '</p>' +
        '<span class="inline-block rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">Native</span>' +
        '</div>';
    };

    var toolRows = MCP_TOOLS.map(function (t) {
      return '<tr class="border-b transition-colors hover:bg-muted/50">' +
        '<td class="' + TD_CLS + ' font-mono text-[11px] text-[#0550ae]">' + t[0] + '</td>' +
        '<td class="' + TD_CLS + ' text-xs text-muted-foreground">' + t[1] + '</td>' +
        '<td class="' + TD_CLS + ' text-xs text-muted-foreground">' + t[2] + '</td>' +
        '</tr>';
    }).join('');

    var clientTabBtn = function (id, label, active) {
      return '<button type="button" role="tab" data-mcp-tab="' + id + '" aria-selected="' + (active ? 'true' : 'false') + '" aria-controls="mcp-panel-' + id + '" id="mcp-tab-' + id + '" class="rounded-md px-3 py-1 text-xs font-medium transition-colors ' +
        (active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground') + '">' + label + '</button>';
    };

    return '' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6">' +
          '<div class="flex items-start justify-between gap-3"><div>' +
            '<div class="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2">' + luc('sparkles', 'h-5 w-5 text-amber-600') + 'Talk to your data with Claude</div>' +
            '<div class="text-sm text-muted-foreground mt-2">Connect Peekaboo to Claude Desktop, Claude Code, or Cursor with one config file. Ask “how is my brand trending vs competitors this month?” — your AI assistant pulls the answer directly from your data.</div>' +
          '</div>' + BETA_BADGE + '</div>' +
        '</div>' +
        '<div class="p-6 pt-0 space-y-6">' +
          '<div class="grid gap-3 sm:grid-cols-2">' +
            '<div class="rounded-xl border bg-muted/30 p-4">' +
              '<div class="flex items-center gap-2 mb-2">' + luc('code-xml', 'h-4 w-4 text-muted-foreground') + '<span class="text-sm font-semibold">REST API: for your code</span></div>' +
              '<p class="text-xs text-muted-foreground leading-relaxed">A developer reads docs, picks endpoints, writes glue code. Best for Looker dashboards, Zapier syncs, and bulk imports.</p>' +
            '</div>' +
            '<div class="rounded-xl border border-blue-200 bg-blue-50 p-4">' +
              '<div class="flex items-center gap-2 mb-2">' + luc('sparkles', 'h-4 w-4 text-blue-700') + '<span class="text-sm font-semibold text-blue-700">MCP: for your AI assistant</span></div>' +
              '<p class="text-xs text-muted-foreground leading-relaxed">Claude reads tool descriptions and chains calls itself. Best for natural-language questions, on-the-fly analysis, and editing prompts from your chat.</p>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="mb-1 text-sm font-semibold">Works with these AI clients</div>' +
            '<div class="mb-4 text-xs text-muted-foreground">Any MCP-compatible client works.</div>' +
            '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">' +
              clientCard('/logos/clients/anthropic.svg', 'Claude Desktop', 'Anthropic') +
              clientCard('/logos/clients/anthropic.svg', 'Claude Code', 'Anthropic · CLI') +
              clientCard('/logos/clients/anthropic.svg', 'Claude.ai', 'Anthropic · Web') +
              clientCard('/logos/clients/cursor.svg', 'Cursor', 'IDE · multi-model') +
            '</div>' +
            '<p class="mt-3 text-[11px] text-muted-foreground"><strong class="text-foreground">Native</strong> = drop-in setup below · <strong class="text-foreground">Compatible</strong> = same JSON config · <strong class="text-foreground">Limited</strong> = vendor beta</p>' +
          '</div>' +
          '<div class="rounded-xl border bg-card p-5 space-y-4">' +
            '<div class="flex items-center gap-2"><span class="flex items-center justify-center h-5 w-5 rounded-full bg-gray-700 text-white text-[11px] font-bold shrink-0">1</span><span class="text-sm font-semibold">Generate an API key</span></div>' +
            '<p class="text-xs text-muted-foreground leading-relaxed pl-8 -mt-2">MCP uses the same <code class="text-[11px] bg-muted px-1 rounded">pk_*</code> key as the REST API. Pick <strong>Read + Write</strong> if you want Claude to add prompts or competitors for you.</p>' +
            '<div class="pl-8"><button type="button" data-act="open-rest" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors bg-brand text-[var(--theme-on-primary)] hover:bg-brand/90 h-9 rounded-md px-3 gap-1.5">' + luc('key', 'h-3.5 w-3.5') + 'Open key generator</button></div>' +
            '<div class="flex items-center gap-2 pt-2 border-t"><span class="flex items-center justify-center h-5 w-5 rounded-full bg-gray-700 text-white text-[11px] font-bold shrink-0">2</span><span class="text-sm font-semibold">Paste this into your MCP client</span></div>' +
            '<div class="space-y-3 pl-8">' +
              '<div class="inline-flex gap-1 rounded-lg border bg-muted/30 p-1" role="tablist" aria-label="MCP client config">' +
                clientTabBtn('desktop', 'Claude Desktop', true) +
                clientTabBtn('code', 'Claude Code', false) +
                clientTabBtn('cursor', 'Cursor', false) +
              '</div>' +
              '<div role="tabpanel" id="mcp-panel-desktop" aria-labelledby="mcp-tab-desktop">' +
                '<p class="text-[11px] text-muted-foreground mb-2">Add to <code class="text-[10px] bg-muted px-1 rounded">~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or <code class="text-[10px] bg-muted px-1 rounded">%APPDATA%\\Claude\\claude_desktop_config.json</code> (Windows), then restart the app.</p>' +
                copyPreHtml('mcp-snippet-desktop', 'Copy Claude Desktop MCP config', mcpJsonSnippet(key)) +
              '</div>' +
              '<div role="tabpanel" id="mcp-panel-code" aria-labelledby="mcp-tab-code" hidden>' +
                '<p class="text-[11px] text-muted-foreground mb-2">Run this in your terminal, then restart Claude Code.</p>' +
                copyPreHtml('mcp-snippet-code', 'Copy Claude Code MCP command', mcpClaudeCodeSnippet(key)) +
              '</div>' +
              '<div role="tabpanel" id="mcp-panel-cursor" aria-labelledby="mcp-tab-cursor" hidden>' +
                '<p class="text-[11px] text-muted-foreground mb-2">Add to <code class="text-[10px] bg-muted px-1 rounded">~/.cursor/mcp.json</code>, then reload Cursor.</p>' +
                copyPreHtml('mcp-snippet-cursor', 'Copy Cursor MCP config', mcpJsonSnippet(key)) +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2 pt-2 border-t"><span class="flex items-center justify-center h-5 w-5 rounded-full bg-gray-700 text-white text-[11px] font-bold shrink-0">3</span><span class="text-sm font-semibold">Try it</span></div>' +
            '<div class="rounded-lg border bg-stone-50 p-4 ml-8">' +
              '<div class="flex items-center gap-2 mb-2">' + luc('message-square-text', 'h-4 w-4 text-muted-foreground') + '<span class="text-xs font-semibold">Try this query first</span></div>' +
              '<blockquote class="text-sm italic text-foreground leading-relaxed">“List all my brands in Peekaboo, then for the top two, fetch their visibility scores for the last 30 days and summarise which is improving.”</blockquote>' +
              '<p class="text-[11px] text-muted-foreground mt-2">Claude will call <code class="text-[10px] bg-muted px-1 rounded">list_brands</code> → <code class="text-[10px] bg-muted px-1 rounded">get_brand_visibility</code> (twice) and draft the summary. One natural-language prompt, four tool invocations.</p>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<h3 class="text-sm font-semibold">Available tools</h3>' +
            '<p class="text-xs text-muted-foreground mb-3 mt-0.5">Same rate limits as REST · Grow plan and above</p>' +
            '<div class="rounded-xl border overflow-hidden"><div class="relative w-full overflow-auto">' +
              '<table class="w-full caption-bottom text-sm">' +
              '<thead class="[&_tr]:border-b"><tr class="border-b transition-colors hover:bg-muted/50">' +
              '<th class="' + TH_CLS + ' text-xs">Tool</th><th class="' + TH_CLS + ' text-xs">Key type</th><th class="' + TH_CLS + ' text-xs">What it does</th>' +
              '</tr></thead><tbody class="[&_tr:last-child]:border-0">' + toolRows + '</tbody></table>' +
            '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function restPanelHtml(key) {
    var masked = maskKey(key);
    var yourKeyBlock = '';
    if (masked) {
      yourKeyBlock =
        '<div class="rounded-lg border bg-muted/30 p-4">' +
          '<label class="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Your active key (local proxy)</label>' +
          '<div class="flex items-center gap-2 mt-2">' +
            '<code id="rest-your-key" data-full="' + escapeHtml(key) + '" class="flex-1 min-w-0 truncate text-xs font-mono bg-background border rounded-md px-3 py-2">' + escapeHtml(masked) + '</code>' +
            '<button type="button" data-act="toggle-key" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors border border-input bg-background hover:bg-accent h-9 rounded-md px-3 gap-1.5">' + luc('eye', 'h-3.5 w-3.5') + 'Show</button>' +
            '<button type="button" data-act="copy-key" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors border border-input bg-background hover:bg-accent h-9 rounded-md px-3 gap-1.5">' + luc('copy', 'h-3.5 w-3.5') + 'Copy</button>' +
          '</div>' +
          '<p class="text-[10.5px] text-muted-foreground mt-1.5">Read from <code class="bg-muted px-1 rounded">config.json</code> — the key the local proxy sends as <code class="bg-muted px-1 rounded">X-API-Key</code>.</p>' +
        '</div>';
    }

    return '' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden p-0">' +
        '<div class="flex items-start gap-3.5 border-b bg-stone-50 px-6 py-5">' +
          '<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900">' + luc('key', 'h-5 w-5 text-white') + '</div>' +
          '<div><h3 class="text-base font-bold leading-tight">Generate an API Key</h3>' +
          '<p class="text-xs text-muted-foreground leading-relaxed mt-1">Scoped to your project. Pass <code class="text-[11px] bg-muted px-1 py-0.5 rounded">X-API-Key: pk_...</code> in every request.</p></div>' +
        '</div>' +
        '<div class="px-6 py-5 space-y-5">' +
          yourKeyBlock +
          '<div>' +
            '<label class="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground" id="rest-perm-label">Select permissions</label>' +
            '<div role="group" aria-labelledby="rest-perm-label" class="grid gap-2 sm:grid-cols-2 mt-2">' +
              '<button type="button" data-perm="read" aria-pressed="true" class="text-left p-3.5 rounded-lg border-2 transition-colors border-foreground bg-stone-50">' +
                '<div class="flex items-center gap-2 mb-1">' +
                  '<div class="h-6 w-6 shrink-0 rounded-md flex items-center justify-center bg-foreground text-background">' + luc('eye', 'h-3 w-3') + '</div>' +
                  '<span class="text-sm font-bold">Read</span>' +
                  '<div data-perm-check class="ml-auto h-4 w-4 rounded-full bg-foreground flex items-center justify-center">' + luc('circle-check', 'h-3 w-3 text-background') + '</div>' +
                '</div>' +
                '<p class="text-[11.5px] text-muted-foreground leading-relaxed">Pull visibility scores, prompts, sources, and competitors. Safe for dashboards and reports.</p>' +
              '</button>' +
              '<button type="button" data-perm="write" aria-pressed="false" class="text-left p-3.5 rounded-lg border-2 transition-colors border-border hover:border-foreground/40">' +
                '<div class="flex items-center gap-2 mb-1">' +
                  '<div class="h-6 w-6 shrink-0 rounded-md flex items-center justify-center bg-stone-500 text-white">' + luc('pencil', 'h-3 w-3') + '</div>' +
                  '<span class="text-sm font-bold">Read + Write</span>' +
                  '<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold ml-auto text-[9px] border-amber-300 text-amber-600">elevated</div>' +
                '</div>' +
                '<p class="text-[11.5px] text-muted-foreground leading-relaxed">Everything in Read, plus create and update brands, prompts, and competitors.</p>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<label class="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground" for="apiKeyName">Key name <span class="font-normal normal-case text-muted-foreground/70 tracking-normal">(optional)</span></label>' +
            '<input class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm mt-2" id="apiKeyName" placeholder="e.g. CI Pipeline, Data Warehouse, Slack bot" value="">' +
            '<p class="text-[10.5px] text-muted-foreground mt-1.5">A label to identify this key in your Active Keys list</p>' +
          '</div>' +
          '<button type="button" data-act="generate" class="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors h-10 px-4 py-2 w-full bg-zinc-900 hover:bg-zinc-800 text-white tracking-tight">' + luc('key', 'mr-2 h-4 w-4') + 'Generate API Key</button>' +
        '</div>' +
      '</div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm"><div class="p-6 pt-5">' +
        '<div><h3 class="text-sm font-semibold mb-3">Active API Keys</h3>' + keysTableHtml(REST_KEYS, 'API Key') + '</div>' +
        revokedDetailsHtml(REST_REVOKED, 'API Key') +
      '</div></div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm"><div class="p-6 pt-5">' +
        '<h3 class="text-sm font-semibold mb-3">Available Endpoints</h3>' + endpointsBlockHtml() +
      '</div></div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm"><div class="p-6 pt-5">' +
        '<h3 class="text-sm font-semibold mb-3">Rate Limits</h3>' + rateLimitsBlockHtml() +
      '</div></div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm"><div class="p-6 pt-5">' +
        '<h3 class="text-sm font-semibold mb-3">Quick Start</h3>' +
        '<div class="relative">' +
          '<button type="button" data-copy="rest-quickstart" aria-label="Copy quickstart curl examples" class="' + COPY_BTN_CLS + '">Copy</button>' +
          '<pre id="rest-quickstart" class="bg-zinc-900 text-zinc-100 rounded-lg p-4 pr-14 font-mono text-xs leading-relaxed overflow-x-auto">' + escapeHtml(quickstartSnippet(key)) + '</pre>' +
        '</div>' +
      '</div></div>';
  }

  function usagePanelHtml() {
    var cards = USAGE_KEYS.map(function (k) {
      var pct = usagePct(k.used, DAILY_LIMIT);
      var left = DAILY_LIMIT - k.used;
      var badges = k.badges.map(function (b) {
        return '<div class="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-foreground text-[10px]">' + escapeHtml(b) + '</div>';
      }).join('');
      return '<div class="rounded-xl border p-4 space-y-3">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
            '<div class="flex items-center gap-2 flex-wrap"><p class="text-sm font-semibold truncate">' + escapeHtml(k.name) + '</p>' + badges + '</div>' +
            '<p class="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1">' + luc('clock', 'h-3 w-3') + escapeHtml(k.last) + '</p>' +
          '</div>' +
          '<div class="text-right shrink-0">' +
            '<p class="text-sm font-semibold tabular-nums">' + k.used.toLocaleString('en-US') + ' <span class="text-muted-foreground font-normal">/ ' + DAILY_LIMIT.toLocaleString('en-US') + '</span></p>' +
            '<p class="text-[11px] text-muted-foreground">' + left.toLocaleString('en-US') + ' left today</p>' +
          '</div>' +
        '</div>' +
        '<div role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + escapeHtml(k.name) + ': ' + pct + '% of daily limit used" class="h-2 w-full rounded-full bg-muted overflow-hidden">' +
          '<div class="h-full rounded-full transition-all bg-brand" style="width: ' + pct + '%;"></div>' +
        '</div>' +
      '</div>';
    }).join('');

    var statCard = function (label, valueHtml) {
      return '<div class="rounded-xl border bg-muted/30 p-4">' +
        '<p class="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">' + label + '</p>' +
        '<p class="text-base font-bold mt-1.5">' + valueHtml + '</p>' +
      '</div>';
    };

    return '' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6">' +
          '<div class="flex items-start justify-between gap-3"><div>' +
            '<div class="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2">' + luc('activity', 'h-5 w-5') + 'API Usage</div>' +
            '<div class="text-sm text-muted-foreground mt-2">Today’s request count for each active API key. Both REST and MCP requests count against the same key budget. Counters reset at midnight UTC.</div>' +
          '</div>' +
          '<button type="button" data-act="refresh-usage" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3 gap-1.5">' + luc('refresh-ccw', 'h-3.5 w-3.5') + 'Refresh</button>' +
          '</div>' +
        '</div>' +
        '<div class="p-6 pt-0 space-y-5">' +
          '<div class="grid gap-3 sm:grid-cols-3">' +
            statCard('Plan', 'custom') +
            statCard('Per-key daily limit', '2,000 <span class="text-[11px] font-normal text-muted-foreground">requests</span>') +
            statCard('Per-minute limit', '40 <span class="text-[11px] font-normal text-muted-foreground">requests</span>') +
          '</div>' +
          '<h3 class="text-[13px] font-semibold text-foreground">Per-Key Usage</h3>' +
          '<div class="space-y-3">' + cards + '</div>' +
          '<div class="flex items-center justify-between gap-3 pt-2 border-t text-[11px] text-muted-foreground">' +
            '<span>Resets at midnight UTC (01:00 AM GMT+1)</span><span>Auto-refreshes every 30s</span>' +
          '</div>' +
          '<div class="rounded-xl border-2 border-dashed border-border p-4 flex items-start gap-3">' +
            luc('info', 'h-4 w-4 text-muted-foreground shrink-0 mt-0.5') +
            '<div><p class="text-xs font-semibold text-muted-foreground">Coming soon: 7 and 30-day usage trends</p>' +
            '<p class="text-xs text-muted-foreground/80 mt-0.5">We’ll persist daily snapshots so you can see usage patterns over time.</p></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function lookerPanelHtml() {
    var fieldRow = function (field, note) {
      return '<tr class="border-b transition-colors hover:bg-muted/50">' +
        '<td class="' + TD_CLS + ' font-mono text-[11px]">' + field + '</td>' +
        '<td class="' + TD_CLS + ' text-[11px] text-muted-foreground">' + note + '</td>' +
        '</tr>';
    };
    var dims = [['date', 'Both'], ['brand', 'Both'], ['prompt', 'Both'], ['prompt_id', 'Summary'], ['entity_type', 'Both'], ['sentiment', 'Both'], ['ai_model', 'Detailed'], ['domain', 'Detailed']].map(function (d) { return fieldRow(d[0], d[1]); }).join('');
    var mets = [['visibility', '0–100, use AVG'], ['citations', 'Raw count, use SUM'], ['chats', 'Raw count, use SUM'], ['models_used', 'Summary only, AVG'], ['avg_position', 'Both, use AVG']].map(function (m) { return fieldRow(m[0], m[1]); }).join('');

    var tip = function (n, strong, rest) {
      return '<div class="flex items-start gap-2.5">' +
        '<span class="h-[18px] w-[18px] shrink-0 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center mt-0.5" aria-hidden="true">' + n + '</span>' +
        '<div class="text-xs leading-relaxed"><strong class="text-foreground">' + strong + '</strong> <span class="text-muted-foreground">' + rest + '</span></div>' +
      '</div>';
    };

    return '' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6">' +
          '<div class="flex items-start justify-between"><div>' +
            '<div class="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2"><img alt="Looker Studio" class="w-5 h-5 object-contain" src="/logos/looker-studio-logo.png">Connect to Looker Studio</div>' +
            '<div class="text-sm text-muted-foreground mt-1">Pull your Peekaboo data into Looker Studio to build client reports and custom dashboards.</div>' +
          '</div>' + BETA_BADGE + '</div>' +
        '</div>' +
        '<div class="p-6 pt-0 space-y-6">' +
          '<div class="grid gap-3 sm:grid-cols-3">' +
            '<div class="rounded-lg border bg-muted/30 p-4">' +
              '<div class="flex items-center gap-2 mb-3"><span class="h-7 w-7 shrink-0 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center" aria-hidden="true">1</span><h3 class="text-sm font-semibold">Create an API key</h3></div>' +
              '<div class="space-y-2">' +
                '<input class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm text-sm" id="lookerKeyName" placeholder="Key name (optional)" value="">' +
                '<button type="button" data-act="generate" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-colors bg-brand text-[var(--theme-on-primary)] hover:bg-brand/90 h-9 rounded-md px-3 w-full">' + luc('key', 'mr-2 h-4 w-4') + 'Generate Key</button>' +
              '</div>' +
            '</div>' +
            '<div class="rounded-lg border bg-muted/30 p-4">' +
              '<div class="flex items-center gap-2 mb-3"><span class="h-7 w-7 shrink-0 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center" aria-hidden="true">2</span><h3 class="text-sm font-semibold">Open the connector</h3></div>' +
              '<div class="space-y-2">' +
                '<a href="https://datastudio.google.com/datasources/create?connectorId=AKfycby_1CAYoTpkorKcDVX3OfepjXG_G7FTCBskeM6WabyZCCT3gZwEmi02Q96AJuuvurut" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center w-full gap-2 rounded-md bg-background border border-input px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">' + luc('external-link', 'h-4 w-4') + 'Open in Looker Studio</a>' +
                '<p class="text-[11px] text-muted-foreground text-center">v21 — latest version</p>' +
              '</div>' +
              '<div class="mt-3 pt-2 border-t border-dashed">' +
                '<a href="https://datastudio.google.com/datasources/create?connectorId=AKfycbwtOzEEuxr3Uo9ma3n4q2CSsEhmFgs3ahq1Oss655hBoOvWnS0nSFDK1RXdgBWT8Nef" target="_blank" rel="noopener noreferrer" class="text-[11px] text-muted-foreground hover:underline flex items-center justify-center gap-1">Legacy v20/v19 (older dashboards)</a>' +
              '</div>' +
            '</div>' +
            '<div class="rounded-lg border bg-muted/30 p-4">' +
              '<div class="flex items-center gap-2 mb-3"><span class="h-7 w-7 shrink-0 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center" aria-hidden="true">3</span><h3 class="text-sm font-semibold">Authorize and connect</h3></div>' +
              '<ol class="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside"><li>Click "Authorize" in Looker Studio</li><li>Paste your API key when prompted</li><li>Select your brand and start building</li></ol>' +
            '</div>' +
          '</div>' +
          '<p class="text-xs text-muted-foreground text-center mt-4">Already on v20 or earlier? Those dashboards keep working. Add a v21 data source for the most accurate scores.</p>' +
        '</div>' +
      '</div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6 pb-3"><div class="font-semibold tracking-tight text-base">Active Keys</div></div>' +
        '<div class="p-6 pt-0">' +
          '<div>' + keysTableHtml(LOOKER_KEYS, 'Looker Studio') + '</div>' +
          revokedDetailsHtml(LOOKER_REVOKED, 'Looker Studio') +
        '</div>' +
      '</div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6 pb-3">' +
          '<div class="font-semibold tracking-tight text-base flex items-center gap-2">' + luc('info', 'h-4 w-4') + 'How It Works</div>' +
          '<div class="text-sm text-muted-foreground">Choose a data mode when you create your Looker Studio data source. You can have one of each.</div>' +
        '</div>' +
        '<div class="p-6 pt-0 space-y-4">' +
          '<div class="grid gap-3 sm:grid-cols-2">' +
            '<div class="rounded-lg border p-4">' +
              '<div class="flex items-center gap-2 mb-2"><span class="text-[10px] font-bold uppercase tracking-[0.07em] text-emerald-600">Recommended</span><span class="text-sm font-semibold">Summary mode</span></div>' +
              '<p class="text-sm text-muted-foreground mb-3">Scores are averaged across all AI models before they reach Looker Studio. Fewer rows, faster charts, and numbers that match what you see in Peekaboo. Use this for client reports and scorecards.</p>' +
              '<a href="#field-reference" data-act="scroll-fields" class="inline-flex items-center rounded-md border bg-background px-3 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors">Show all 14 fields</a>' +
            '</div>' +
            '<div class="rounded-lg border p-4">' +
              '<div class="flex items-center gap-2 mb-2"><span class="text-[10px] font-bold uppercase tracking-[0.07em] text-muted-foreground">Advanced</span><span class="text-sm font-semibold">Detailed mode</span></div>' +
              '<p class="text-sm text-muted-foreground mb-3">One row per AI model response. Use this if you need to compare how ChatGPT, Gemini, and Perplexity mention your brand differently, or to see which websites AI models cite most often.</p>' +
              '<a href="#field-reference" data-act="scroll-fields" class="inline-flex items-center rounded-md border bg-background px-3 py-1 text-[11px] font-semibold text-foreground hover:bg-muted transition-colors">Show all 14 fields</a>' +
            '</div>' +
          '</div>' +
          '<div class="rounded-lg border bg-muted/30 p-4">' +
            '<h3 class="text-sm font-semibold mb-2">Competitor data is included automatically</h3>' +
            '<p class="text-sm text-muted-foreground mb-3">Every row includes both your brand and your tracked competitors. Use the <code class="text-xs bg-muted px-1 py-0.5 rounded">entity_type</code> field to separate them in your charts.</p>' +
            '<div class="grid gap-2 sm:grid-cols-2">' +
              '<div class="rounded-md border bg-background px-3 py-2"><code class="text-xs font-mono text-primary">entity_type = "brand"</code><p class="text-[11px] text-muted-foreground mt-0.5">Your brand only</p></div>' +
              '<div class="rounded-md border bg-background px-3 py-2"><code class="text-xs font-mono text-primary">entity_type = "competitor"</code><p class="text-[11px] text-muted-foreground mt-0.5">Competitors only</p></div>' +
            '</div>' +
            '<p class="text-[11px] text-muted-foreground mt-2">Competitors that were not mentioned by an AI in a given response get a visibility score of 0, keeping averages honest.</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm scroll-mt-24" id="field-reference">' +
        '<div class="flex flex-col space-y-1.5 p-6 pb-3"><div class="font-semibold tracking-tight text-base">Field Reference</div></div>' +
        '<div class="p-6 pt-0"><div class="grid gap-6 sm:grid-cols-2">' +
          '<div><h4 class="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground mb-2">Dimensions</h4>' +
            '<div class="border rounded-md overflow-hidden"><div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">' +
            '<thead class="[&_tr]:border-b"><tr class="border-b transition-colors hover:bg-muted/50"><th class="h-12 px-4 text-left align-middle text-muted-foreground text-[11px] font-semibold">Field</th><th class="h-12 px-4 text-left align-middle text-muted-foreground text-[11px] font-semibold">Available in</th></tr></thead>' +
            '<tbody class="[&_tr:last-child]:border-0">' + dims + '</tbody></table></div></div></div>' +
          '<div><h4 class="text-[11px] font-bold uppercase tracking-[0.07em] text-muted-foreground mb-2">Metrics</h4>' +
            '<div class="border rounded-md overflow-hidden"><div class="relative w-full overflow-auto"><table class="w-full caption-bottom text-sm">' +
            '<thead class="[&_tr]:border-b"><tr class="border-b transition-colors hover:bg-muted/50"><th class="h-12 px-4 text-left align-middle text-muted-foreground text-[11px] font-semibold">Field</th><th class="h-12 px-4 text-left align-middle text-muted-foreground text-[11px] font-semibold">Notes</th></tr></thead>' +
            '<tbody class="[&_tr:last-child]:border-0">' + mets + '</tbody></table></div></div></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6 pb-3"><div class="font-semibold tracking-tight text-base">Quick-reference tips</div></div>' +
        '<div class="p-6 pt-0 space-y-2.5">' +
          tip(1, 'Always filter by entity_type.', 'Without this, brand and competitor rows mix together.') +
          tip(2, 'AVG for visibility, SUM for citations.', 'Visibility is a 0–100 score. Citations are raw counts.') +
          tip(3, 'Start with Summary mode.', 'Fewer rows, faster charts. Switch to Detailed only when you need per-model breakdowns.') +
          tip(4, 'Use prompt_id for prompt counts.', 'Prompt text gets cut off at 100 characters. COUNT_DISTINCT(prompt_id) gives the correct unique count.') +
        '</div>' +
      '</div>';
  }

  function apiDocsPanelHtml(key) {
    return '' +
      '<div class="rounded-lg border bg-card text-card-foreground shadow-sm">' +
        '<div class="flex flex-col space-y-1.5 p-6">' +
          '<div class="flex items-start justify-between gap-3"><div>' +
            '<div class="text-2xl font-semibold leading-none tracking-tight flex items-center gap-2">' + luc('book-open', 'h-5 w-5') + 'API Documentation</div>' +
            '<div class="text-sm text-muted-foreground mt-2">Endpoint reference for the Peekaboo REST API. Authenticate with <code class="text-[11px] bg-muted px-1 py-0.5 rounded">X-API-Key: pk_...</code> on every request; the base URL is <code class="text-[11px] bg-muted px-1 py-0.5 rounded">' + API_BASE_URL + '</code>.</div>' +
          '</div></div>' +
        '</div>' +
        '<div class="p-6 pt-0 space-y-6">' +
          '<div><h3 class="text-sm font-semibold mb-3">Available Endpoints</h3>' + endpointsBlockHtml() + '</div>' +
          '<div><h3 class="text-sm font-semibold mb-3">Authentication example</h3>' +
            '<div class="relative">' +
              '<button type="button" data-copy="docs-quickstart" aria-label="Copy authentication example" class="' + COPY_BTN_CLS + '">Copy</button>' +
              '<pre id="docs-quickstart" class="bg-zinc-900 text-zinc-100 rounded-lg p-4 pr-14 font-mono text-xs leading-relaxed overflow-x-auto">' + escapeHtml(quickstartSnippet(key)) + '</pre>' +
            '</div>' +
          '</div>' +
          '<div><h3 class="text-sm font-semibold mb-3">Rate Limits</h3>' + rateLimitsBlockHtml() + '</div>' +
        '</div>' +
      '</div>';
  }

  // ===========================================================================
  PB.registerView('integrations', async function (root, ctx) {
    // fetch the local proxy key (best effort; the page renders without it)
    var apiKey = '';
    try {
      var res = await fetch('/config.json', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        var cfg = await res.json();
        if (cfg && typeof cfg.api_key === 'string') apiKey = cfg.api_key;
      }
    } catch (e) { /* render without the key */ }

    root.innerHTML = '';

    var TABS = [
      { id: 'mcp', label: 'MCP', icon: 'sparkles', badge: true, html: function () { return mcpPanelHtml(apiKey); } },
      { id: 'rest-api', label: 'REST API', icon: 'code-xml', html: function () { return restPanelHtml(apiKey); } },
      { id: 'usage', label: 'Usage', icon: 'activity', html: function () { return usagePanelHtml(); } },
      { id: 'looker', label: 'Looker Studio', img: '/logos/looker-studio-logo.png', html: function () { return lookerPanelHtml(); } },
      { id: 'api-docs', label: 'API Docs', icon: 'book-open', html: function () { return apiDocsPanelHtml(apiKey); } },
    ];

    var wrap = el('div', { class: 'p-6 max-w-screen-2xl mx-auto' });

    // ---- page header (exact captured markup) --------------------------------
    var headerHtml =
      '<div class="mb-8">' +
        '<div class="flex items-center gap-3 mb-2">' + luc('blocks', 'h-8 w-8 text-primary') + '<h1 class="text-3xl font-bold">Integrations</h1></div>' +
        '<p class="text-muted-foreground">Connect Peekaboo to external tools and platforms</p>' +
      '</div>';

    // ---- tab bar + panels ----------------------------------------------------
    var triggersHtml = TABS.map(function (t, i) {
      var iconHtml = t.img
        ? '<img src="' + t.img + '" alt="" class="w-4 h-4 object-contain">'
        : luc(t.icon, 'h-4 w-4');
      var badgeHtml = t.badge
        ? '<span class="ml-1 rounded-full bg-brand/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-brand">New</span>'
        : '';
      return '<button type="button" role="tab" data-tab="' + t.id + '" aria-selected="' + (i === 0 ? 'true' : 'false') +
        '" aria-controls="pb-int-content-' + t.id + '" data-state="' + (i === 0 ? 'active' : 'inactive') +
        '" class="' + TRIGGER_CLS + '">' + iconHtml + t.label + badgeHtml + '</button>';
    }).join('');

    var panelsHtml = TABS.map(function (t, i) {
      return '<div data-state="' + (i === 0 ? 'active' : 'inactive') + '" role="tabpanel" id="pb-int-content-' + t.id +
        '" tabindex="0" class="' + PANEL_CLS + '"' + (i === 0 ? '' : ' hidden') + '>' + t.html() + '</div>';
    }).join('');

    wrap.innerHTML = headerHtml +
      '<div dir="ltr" data-orientation="horizontal">' +
        '<div role="tablist" aria-orientation="horizontal" class="' + TABLIST_CLS + '">' + triggersHtml + '</div>' +
        panelsHtml +
      '</div>';

    root.appendChild(wrap);
    if (window.lucide) window.lucide.createIcons();

    // ---- behaviour -----------------------------------------------------------
    function selectTab(id) {
      TABS.forEach(function (t) {
        var btn = wrap.querySelector('[data-tab="' + t.id + '"]');
        var panel = wrap.querySelector('#pb-int-content-' + t.id);
        var active = t.id === id;
        if (btn) {
          btn.setAttribute('data-state', active ? 'active' : 'inactive');
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        if (panel) {
          panel.setAttribute('data-state', active ? 'active' : 'inactive');
          if (active) panel.removeAttribute('hidden');
          else panel.setAttribute('hidden', '');
        }
      });
    }

    function selectMcpClientTab(id) {
      ['desktop', 'code', 'cursor'].forEach(function (t) {
        var btn = wrap.querySelector('[data-mcp-tab="' + t + '"]');
        var panel = wrap.querySelector('#mcp-panel-' + t);
        var active = t === id;
        if (btn) {
          btn.setAttribute('aria-selected', active ? 'true' : 'false');
          btn.className = 'rounded-md px-3 py-1 text-xs font-medium transition-colors ' +
            (active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground');
        }
        if (panel) {
          if (active) panel.removeAttribute('hidden');
          else panel.setAttribute('hidden', '');
        }
      });
    }

    function copyText(text, btn) {
      var done = function () {
        if (btn) {
          var old = btn.textContent;
          btn.textContent = 'Copied';
          setTimeout(function () { btn.textContent = old; }, 1400);
        }
        PB.toast('Copied to clipboard');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { PB.toast('Copy failed', true); });
      } else {
        PB.toast('Clipboard not available', true);
      }
    }

    wrap.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) { selectTab(tabBtn.getAttribute('data-tab')); return; }

      var mcpBtn = e.target.closest('[data-mcp-tab]');
      if (mcpBtn) { selectMcpClientTab(mcpBtn.getAttribute('data-mcp-tab')); return; }

      var copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        var pre = wrap.querySelector('#' + copyBtn.getAttribute('data-copy'));
        if (pre) copyText(pre.textContent, copyBtn);
        return;
      }

      var permBtn = e.target.closest('[data-perm]');
      if (permBtn) {
        var group = permBtn.parentNode;
        Array.prototype.forEach.call(group.querySelectorAll('[data-perm]'), function (b) {
          var on = b === permBtn;
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b.className = 'text-left p-3.5 rounded-lg border-2 transition-colors ' +
            (on ? 'border-foreground bg-stone-50' : 'border-border hover:border-foreground/40');
        });
        return;
      }

      var actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        var act = actBtn.getAttribute('data-act');
        if (act === 'open-rest') { selectTab('rest-api'); return; }
        if (act === 'generate' || act === 'revoke') {
          PB.toast('Key management is disabled in the local mirror');
          return;
        }
        if (act === 'refresh-usage') { PB.toast('Usage refreshed'); return; }
        if (act === 'toggle-key') {
          var code = wrap.querySelector('#rest-your-key');
          if (!code) return;
          var full = code.getAttribute('data-full') || '';
          var showing = code.getAttribute('data-showing') === '1';
          if (showing) {
            code.textContent = maskKey(full);
            code.setAttribute('data-showing', '0');
            actBtn.innerHTML = luc('eye', 'h-3.5 w-3.5') + 'Show';
          } else {
            code.textContent = full;
            code.setAttribute('data-showing', '1');
            actBtn.innerHTML = luc('eye-off', 'h-3.5 w-3.5') + 'Hide';
          }
          if (window.lucide) window.lucide.createIcons();
          return;
        }
        if (act === 'copy-key') {
          var keyCode = wrap.querySelector('#rest-your-key');
          if (keyCode) copyText(keyCode.getAttribute('data-full') || '', null);
          return;
        }
        if (act === 'scroll-fields') {
          e.preventDefault();
          var target = wrap.querySelector('#field-reference');
          if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth' });
          return;
        }
      }
    });
  });

  // pure helpers exposed for unit tests (node live-app/tests/integrations.test.mjs)
  PB._integrationsInternals = {
    maskKey: maskKey,
    mcpJsonSnippet: mcpJsonSnippet,
    mcpClaudeCodeSnippet: mcpClaudeCodeSnippet,
    quickstartSnippet: quickstartSnippet,
    usagePct: usagePct,
    escapeHtml: escapeHtml,
  };
})();
