/*
 * addbrand-wizard.js — faithful port of the v4 "Add New Brand" wizard
 * (from ai-monitoring-dashboard-v4.html) into the Peekaboo live dashboard mirror.
 *
 * 3-step flow, opened from the brand-switcher dropdown's "Add New Brand" item:
 *   Step 1 Brand Info — choose method (auto-fill from URL | fill manually),
 *                       URL autofill, then editable brand-info form.
 *   Step 2 Competitors — website scan, suggested-competitor grid (max 8),
 *                        "generate with AI", manual add (URL auto-fills name).
 *   Step 3 Prompts — language + target-market combos, intent pills,
 *                    AI prompt generation, inline-editable prompt list.
 *
 * Self-contained: all symbols are aim / _aim / _AIM_ namespaced (no PB. clash).
 * Inline onclick handlers require the functions to stay global, so this loads as
 * a plain (non-module) script. Create is local-only (mirror never writes to the
 * real API) — it just shows a success toast, matching the rest of the mirror.
 */
// HTML-escape helper (the v4 file defines this globally; included here so the
// wizard module is standalone).
function aimEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Add New Brand wizard ────────────────────────────────────────────────────

var _aimNewBrand = {
  step: 1,
  mode: 'auto',
  lookupUrl: '',
  name: '', description: '', url: '', industry: '',
  selectedComps: {},   // name → {name, domain}
  manualComps: [],     // [{name, domain}]
  language: 'English',
  location: 'United States',
  intents: ['Commercial', 'Informational'],
  prompts: [],         // [{text, intent}]
};

var _AIM_INDUSTRIES = [
  'SaaS & Software','E-Commerce','Healthcare','Finance & Fintech',
  'Marketing & SEO','AI & Machine Learning','Education','Real Estate',
  'Travel & Hospitality','Food & Beverage','Fashion & Apparel',
  'Professional Services','Cybersecurity','Media & Publishing','Legal','Retail'
];

var _AIM_SUGGESTED_COMPS = {
  'Marketing & SEO':        [{name:'Semrush',domain:'semrush.com'},{name:'Ahrefs',domain:'ahrefs.com'},{name:'Moz',domain:'moz.com'},{name:'HubSpot',domain:'hubspot.com'},{name:'BrightEdge',domain:'brightedge.com'},{name:'Conductor',domain:'conductor.com'}],
  'AI & Machine Learning':  [{name:'OpenAI',domain:'openai.com'},{name:'Anthropic',domain:'anthropic.com'},{name:'Google DeepMind',domain:'deepmind.google'},{name:'Mistral',domain:'mistral.ai'},{name:'Cohere',domain:'cohere.com'},{name:'Perplexity',domain:'perplexity.ai'}],
  'SaaS & Software':        [{name:'G2',domain:'g2.com'},{name:'Capterra',domain:'capterra.com'},{name:'Product Hunt',domain:'producthunt.com'},{name:'Trustpilot',domain:'trustpilot.com'},{name:'GetApp',domain:'getapp.com'},{name:'Gartner',domain:'gartner.com'}],
  'E-Commerce':             [{name:'Shopify',domain:'shopify.com'},{name:'WooCommerce',domain:'woocommerce.com'},{name:'BigCommerce',domain:'bigcommerce.com'},{name:'Magento',domain:'magento.com'},{name:'Squarespace',domain:'squarespace.com'}],
  'Healthcare':             [{name:'WebMD',domain:'webmd.com'},{name:'Healthline',domain:'healthline.com'},{name:'Zocdoc',domain:'zocdoc.com'},{name:'Practo',domain:'practo.com'},{name:'Oscar Health',domain:'hioscar.com'}],
  'Finance & Fintech':      [{name:'Stripe',domain:'stripe.com'},{name:'Plaid',domain:'plaid.com'},{name:'Square',domain:'squareup.com'},{name:'Brex',domain:'brex.com'},{name:'Wise',domain:'wise.com'},{name:'Revolut',domain:'revolut.com'}],
  'Education':              [{name:'Coursera',domain:'coursera.org'},{name:'Udemy',domain:'udemy.com'},{name:'Khan Academy',domain:'khanacademy.org'},{name:'Duolingo',domain:'duolingo.com'},{name:'Skillshare',domain:'skillshare.com'}],
};
var _AIM_DEFAULT_COMPS = [
  {name:'HubSpot',domain:'hubspot.com'},
  {name:'Salesforce',domain:'salesforce.com'},
  {name:'Intercom',domain:'intercom.com'},
  {name:'Zendesk',domain:'zendesk.com'},
  {name:'Notion',domain:'notion.so'},
  {name:'Slack',domain:'slack.com'}
];

var _AIM_LANGUAGES = [
  'Arabic','Bengali','Chinese (Simplified)','Chinese (Traditional)','Czech','Danish',
  'Dutch','English','Finnish','French','German','Greek','Hebrew','Hindi','Hungarian',
  'Indonesian','Italian','Japanese','Korean','Malay','Norwegian','Persian','Polish',
  'Portuguese','Romanian','Russian','Spanish','Swedish','Thai','Turkish','Ukrainian','Vietnamese'
];
var _AIM_LOCATIONS = [
  {v:'Argentina',       l:'🇦🇷 Argentina'},
  {v:'Australia',       l:'🇦🇺 Australia'},
  {v:'Austria',         l:'🇦🇹 Austria'},
  {v:'Belgium',         l:'🇧🇪 Belgium'},
  {v:'Brazil',          l:'🇧🇷 Brazil'},
  {v:'Canada',          l:'🇨🇦 Canada'},
  {v:'Chile',           l:'🇨🇱 Chile'},
  {v:'China',           l:'🇨🇳 China'},
  {v:'Colombia',        l:'🇨🇴 Colombia'},
  {v:'Czech Republic',  l:'🇨🇿 Czech Republic'},
  {v:'Denmark',         l:'🇩🇰 Denmark'},
  {v:'Egypt',           l:'🇪🇬 Egypt'},
  {v:'Finland',         l:'🇫🇮 Finland'},
  {v:'France',          l:'🇫🇷 France'},
  {v:'Germany',         l:'🇩🇪 Germany'},
  {v:'Greece',          l:'🇬🇷 Greece'},
  {v:'Hong Kong',       l:'🇭🇰 Hong Kong'},
  {v:'Hungary',         l:'🇭🇺 Hungary'},
  {v:'India',           l:'🇮🇳 India'},
  {v:'Indonesia',       l:'🇮🇩 Indonesia'},
  {v:'Ireland',         l:'🇮🇪 Ireland'},
  {v:'Israel',          l:'🇮🇱 Israel'},
  {v:'Italy',           l:'🇮🇹 Italy'},
  {v:'Japan',           l:'🇯🇵 Japan'},
  {v:'Malaysia',        l:'🇲🇾 Malaysia'},
  {v:'Mexico',          l:'🇲🇽 Mexico'},
  {v:'Netherlands',     l:'🇳🇱 Netherlands'},
  {v:'New Zealand',     l:'🇳🇿 New Zealand'},
  {v:'Nigeria',         l:'🇳🇬 Nigeria'},
  {v:'Norway',          l:'🇳🇴 Norway'},
  {v:'Pakistan',        l:'🇵🇰 Pakistan'},
  {v:'Philippines',     l:'🇵🇭 Philippines'},
  {v:'Poland',          l:'🇵🇱 Poland'},
  {v:'Portugal',        l:'🇵🇹 Portugal'},
  {v:'Romania',         l:'🇷🇴 Romania'},
  {v:'Saudi Arabia',    l:'🇸🇦 Saudi Arabia'},
  {v:'Singapore',       l:'🇸🇬 Singapore'},
  {v:'South Africa',    l:'🇿🇦 South Africa'},
  {v:'South Korea',     l:'🇰🇷 South Korea'},
  {v:'Spain',           l:'🇪🇸 Spain'},
  {v:'Sweden',          l:'🇸🇪 Sweden'},
  {v:'Switzerland',     l:'🇨🇭 Switzerland'},
  {v:'Taiwan',          l:'🇹🇼 Taiwan'},
  {v:'Thailand',        l:'🇹🇭 Thailand'},
  {v:'Turkey',          l:'🇹🇷 Turkey'},
  {v:'Ukraine',         l:'🇺🇦 Ukraine'},
  {v:'United Arab Emirates', l:'🇦🇪 United Arab Emirates'},
  {v:'United Kingdom',  l:'🇬🇧 United Kingdom'},
  {v:'United States',   l:'🇺🇸 United States'},
  {v:'Vietnam',         l:'🇻🇳 Vietnam'},
];

function aimOpenAddBrand() {
  document.querySelectorAll('.aim-brand-dropdown.open, [id$="-portal"].aim-brand-dropdown.open').forEach(function(el){ el.classList.remove('open'); el.style.display='none'; });
  _aimNewBrand = { step:1, mode:'auto', modeChosen:false, lookupUrl:'', name:'', description:'', url:'', industry:'', selectedComps:{}, manualComps:[], language:'English', location:'United States', intents:['Commercial','Informational'], prompts:[], _promptsGenerated:false, _scanning:false, _detectedPool:null };
  var existing = document.getElementById('aim-nb-root');
  if (existing) existing.remove();
  var root = document.createElement('div');
  root.id = 'aim-nb-root';
  root.innerHTML = '<div class="aim-nb-overlay" id="aim-nb-overlay" onclick="aimCloseAddBrand()"></div><div class="aim-nb-panel" id="aim-nb-panel"></div>';
  document.body.appendChild(root);
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    var o = document.getElementById('aim-nb-overlay');
    var p = document.getElementById('aim-nb-panel');
    if (o) o.classList.add('open');
    if (p) p.classList.add('open');
    _aimNbRender();
  }); });
}

function aimCloseAddBrand() {
  var o = document.getElementById('aim-nb-overlay');
  var p = document.getElementById('aim-nb-panel');
  if (o) o.classList.remove('open');
  if (p) p.classList.remove('open');
  setTimeout(function(){ var r = document.getElementById('aim-nb-root'); if(r) r.remove(); }, 250);
}

function _aimNbRender() {
  var p = document.getElementById('aim-nb-panel');
  if (!p) return;
  var s = _aimNewBrand.step;
  var stepLabels = ['Brand Info','Competitors','Prompts'];
  var stepsHtml = stepLabels.map(function(lbl, i) {
    var n = i + 1;
    var cls = n < s ? 'done' : (n === s ? 'active' : '');
    var dotInner = n < s
      ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : n;
    var line = i < 2 ? '<div class="aim-nb-step-line' + (n < s ? ' done' : '') + '"></div>' : '';
    return '<div class="aim-nb-step-item ' + cls + '">'
      + '<div class="aim-nb-step-dot">' + dotInner + '</div>'
      + '<span class="aim-nb-step-label">' + lbl + '</span>'
      + '</div>' + line;
  }).join('');

  var bodyHtml = s === 1 ? _aimNbStep1Html() : (s === 2 ? _aimNbStep2Html() : _aimNbStep3Html());

  var backBtn = s > 1
    ? '<button onclick="aimNbPrev()" style="padding:8px 18px;border:1px solid var(--border);background:#fff;border-radius:7px;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);color:var(--text);">Back</button>'
    : '<div></div>';
  var nextLabel = s === 3 ? 'Create Brand' : 'Next →';
  var nextStyle = s === 3 ? 'background:#10b981;' : 'background:var(--accent);';
  var nextBtn = '<button onclick="aimNbNext()" style="padding:8px 20px;' + nextStyle + 'color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);">' + nextLabel + '</button>';

  p.innerHTML = '<div class="aim-nb-top">'
    + '<div class="aim-nb-title-row"><span class="aim-nb-title">Add New Brand</span><button class="aim-nb-close" onclick="aimCloseAddBrand()">&#x2715;</button></div>'
    + '<div class="aim-nb-steps">' + stepsHtml + '</div>'
    + '</div>'
    + '<div class="aim-nb-body">' + bodyHtml + '</div>'
    + '<div class="aim-nb-footer">' + backBtn + nextBtn + '</div>';

  _aimNbBindStep(s);
}

function _aimNbStep1Html() {
  var nb = _aimNewBrand;

  // Phase 1: Mode selection only
  if (!nb.modeChosen) {
    return '<div class="aim-nb-mode-choice">'
      + '<div class="aim-nb-mode-choice-title">How would you like to add your brand?</div>'
      + '<div class="aim-nb-mode-choice-row">'
      + '<button class="aim-nb-mode-choice-btn" onclick="aimNbSetMode(\'auto\')">'
      +   '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
      +   '<span>Auto-fill from URL</span>'
      +   '<span class="aim-nb-mode-choice-sub">Paste your website and we\'ll fill in the details</span>'
      + '</button>'
      + '<button class="aim-nb-mode-choice-btn" onclick="aimNbSetMode(\'manual\')">'
      +   '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      +   '<span>Fill out manually</span>'
      +   '<span class="aim-nb-mode-choice-sub">Enter your brand details yourself</span>'
      + '</button>'
      + '</div>'
      + '</div>';
  }

  // Phase 2 (auto mode, not yet fetched): URL input + Autofill CTA
  if (nb.mode === 'auto' && !nb.name) {
    return '<div class="aim-nb-autofill-hero">'
      + '<div class="aim-nb-field-label" style="margin-bottom:10px;">Enter your website URL</div>'
      + '<div class="aim-nb-autofill-row">'
      +   '<input id="aim-nb-lookup-url" class="aim-nb-input" type="text" placeholder="https://yourbrand.com" value="' + aimEscHtml(nb.lookupUrl) + '" onkeydown="if(event.key===\'Enter\')aimNbLookup()">'
      +   '<button id="aim-nb-lookup-btn" class="aim-nb-lookup-btn" onclick="aimNbLookup()">Autofill</button>'
      + '</div>'
      + '<div id="aim-nb-fetch-status"></div>'
      + '<div style="display:flex;gap:12px;margin-top:4px;">'
      +   '<button class="aim-nb-switch-mode" onclick="aimNbResetMode()">← Back</button>'
      +   '<button class="aim-nb-switch-mode" onclick="aimNbSetMode(\'manual\')">Fill out manually instead</button>'
      + '</div>'
      + '</div>';
  }

  // Phase 3: Brand info form (after autofill, or manual mode)
  var indOpts = _AIM_INDUSTRIES.map(function(ind) {
    return '<option value="' + ind + '"' + (nb.industry === ind ? ' selected' : '') + '>' + ind + '</option>';
  }).join('');
  var favPreview = (nb.name && nb.url)
    ? '<div class="aim-nb-fav-preview">'
      + '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(nb.url.replace(/^https?:\/\//,'').split('/')[0]) + '&sz=64" onerror="this.style.display=\'none\'">'
      + '<span class="aim-nb-fav-name">' + aimEscHtml(nb.name) + '</span>'
      + '<span class="aim-nb-fav-domain">' + aimEscHtml(nb.url.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]) + '</span>'
      + '</div>'
    : '';

  return '<button class="aim-nb-switch-mode" onclick="aimNbResetMode()" style="margin-bottom:14px;">← Change method</button>'
    + favPreview
    + '<div id="aim-nb-fields-section">'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label">Brand Name <span style="color:#ef4444">*</span></div>'
    +   '<input id="aim-nb-name" class="aim-nb-input" type="text" placeholder="e.g. Acme Corp" value="' + aimEscHtml(nb.name) + '"></div>'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label">Short Description</div>'
    +   '<textarea id="aim-nb-desc" class="aim-nb-textarea" placeholder="Briefly describe what your brand does...">' + aimEscHtml(nb.description) + '</textarea></div>'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label">Website URL <span style="color:#ef4444">*</span></div>'
    +   '<input id="aim-nb-website" class="aim-nb-input" type="text" placeholder="https://yourbrand.com" value="' + aimEscHtml(nb.url) + '"></div>'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label">Industry <span style="color:#ef4444">*</span></div>'
    +   '<select id="aim-nb-industry" class="aim-nb-select"><option value="">Select industry</option>' + indOpts + '</select></div>'
    + '</div>';
}
var _AIM_COMP_POOLS = {
  'ai-visibility':   [{name:'Profound',domain:'profound.so'},{name:'Otterly AI',domain:'otterly.ai'},{name:'Semrush',domain:'semrush.com'},{name:'Wincher',domain:'wincher.com'},{name:'BrandWatch',domain:'brandwatch.com'},{name:'Nightwatch',domain:'nightwatch.io'},{name:'Mention',domain:'mention.com'},{name:'Brand24',domain:'brand24.com'}],
  'ai-visibility-2': [{name:'NightWatch',domain:'nightwatch.io'},{name:'AthenaHQ',domain:'athenahq.com'},{name:'Visio AI',domain:'visio.ai'},{name:'Profound',domain:'profound.so'},{name:'Semrush',domain:'semrush.com'},{name:'Ahrefs',domain:'ahrefs.com'},{name:'Moz',domain:'moz.com'},{name:'SE Ranking',domain:'seranking.com'}],
  'ecommerce':       [{name:'Shopify',domain:'shopify.com'},{name:'WooCommerce',domain:'woocommerce.com'},{name:'BigCommerce',domain:'bigcommerce.com'},{name:'Wix',domain:'wix.com'},{name:'Squarespace',domain:'squarespace.com'},{name:'Magento',domain:'magento.com'}],
  'ecommerce-2':     [{name:'PrestaShop',domain:'prestashop.com'},{name:'Volusion',domain:'volusion.com'},{name:'OpenCart',domain:'opencart.com'},{name:'Ecwid',domain:'ecwid.com'},{name:'3dcart',domain:'shift4shop.com'},{name:'Wix',domain:'wix.com'}],
  'healthcare':      [{name:'WebMD',domain:'webmd.com'},{name:'Healthline',domain:'healthline.com'},{name:'Zocdoc',domain:'zocdoc.com'},{name:'Teladoc',domain:'teladoc.com'},{name:'Hims',domain:'forhims.com'},{name:'Headspace',domain:'headspace.com'}],
  'healthcare-2':    [{name:'Calm',domain:'calm.com'},{name:'Practo',domain:'practo.com'},{name:'Oscar Health',domain:'hioscar.com'},{name:'Noom',domain:'noom.com'},{name:'Maven Clinic',domain:'mavenclinic.com'},{name:'Tempus',domain:'tempus.com'}],
  'fintech':         [{name:'Stripe',domain:'stripe.com'},{name:'Plaid',domain:'plaid.com'},{name:'Brex',domain:'brex.com'},{name:'Wise',domain:'wise.com'},{name:'Revolut',domain:'revolut.com'},{name:'Adyen',domain:'adyen.com'}],
  'fintech-2':       [{name:'Square',domain:'squareup.com'},{name:'Checkout.com',domain:'checkout.com'},{name:'Payoneer',domain:'payoneer.com'},{name:'Ramp',domain:'ramp.com'},{name:'Mercury',domain:'mercury.com'},{name:'Patreon',domain:'patreon.com'}],
  'seo':             [{name:'Semrush',domain:'semrush.com'},{name:'Ahrefs',domain:'ahrefs.com'},{name:'Moz',domain:'moz.com'},{name:'BrightEdge',domain:'brightedge.com'},{name:'Conductor',domain:'conductor.com'},{name:'Mangools',domain:'mangools.com'}],
  'seo-2':           [{name:'SE Ranking',domain:'seranking.com'},{name:'Wincher',domain:'wincher.com'},{name:'Ubersuggest',domain:'neilpatel.com'},{name:'Surfer SEO',domain:'surferseo.com'},{name:'Clearscope',domain:'clearscope.io'},{name:'MarketMuse',domain:'marketmuse.com'}],
  'ai-ml':           [{name:'OpenAI',domain:'openai.com'},{name:'Anthropic',domain:'anthropic.com'},{name:'Mistral',domain:'mistral.ai'},{name:'Cohere',domain:'cohere.com'},{name:'Perplexity',domain:'perplexity.ai'},{name:'xAI',domain:'x.ai'}],
  'ai-ml-2':         [{name:'Writer',domain:'writer.com'},{name:'Jasper',domain:'jasper.ai'},{name:'Copy.ai',domain:'copy.ai'},{name:'Runway',domain:'runwayml.com'},{name:'Stability AI',domain:'stability.ai'},{name:'Inflection AI',domain:'inflection.ai'}],
  'crm':             [{name:'Salesforce',domain:'salesforce.com'},{name:'HubSpot',domain:'hubspot.com'},{name:'Pipedrive',domain:'pipedrive.com'},{name:'Zoho CRM',domain:'zoho.com'},{name:'Monday.com',domain:'monday.com'},{name:'Freshsales',domain:'freshworks.com'}],
  'crm-2':           [{name:'Close',domain:'close.com'},{name:'Copper',domain:'copper.com'},{name:'Streak',domain:'streak.com'},{name:'Keap',domain:'keap.com'},{name:'ActiveCampaign',domain:'activecampaign.com'},{name:'Nutshell',domain:'nutshell.com'}],
  'marketing':       [{name:'HubSpot',domain:'hubspot.com'},{name:'Marketo',domain:'marketo.com'},{name:'Mailchimp',domain:'mailchimp.com'},{name:'ActiveCampaign',domain:'activecampaign.com'},{name:'Klaviyo',domain:'klaviyo.com'},{name:'Braze',domain:'braze.com'}],
  'marketing-2':     [{name:'Iterable',domain:'iterable.com'},{name:'Customer.io',domain:'customer.io'},{name:'Pardot',domain:'pardot.com'},{name:'Drip',domain:'drip.com'},{name:'Omnisend',domain:'omnisend.com'},{name:'Sendgrid',domain:'sendgrid.com'}],
  'analytics':       [{name:'Mixpanel',domain:'mixpanel.com'},{name:'Amplitude',domain:'amplitude.com'},{name:'Segment',domain:'segment.com'},{name:'Heap',domain:'heap.io'},{name:'Pendo',domain:'pendo.io'},{name:'FullStory',domain:'fullstory.com'}],
  'analytics-2':     [{name:'Hotjar',domain:'hotjar.com'},{name:'Mouseflow',domain:'mouseflow.com'},{name:'Crazy Egg',domain:'crazyegg.com'},{name:'Contentsquare',domain:'contentsquare.com'},{name:'LogRocket',domain:'logrocket.com'},{name:'PostHog',domain:'posthog.com'}],
  'hr':              [{name:'Workday',domain:'workday.com'},{name:'BambooHR',domain:'bamboohr.com'},{name:'Rippling',domain:'rippling.com'},{name:'Gusto',domain:'gusto.com'},{name:'Lattice',domain:'lattice.com'},{name:'Namely',domain:'namely.com'}],
  'hr-2':            [{name:'Deel',domain:'deel.com'},{name:'Remote',domain:'remote.com'},{name:'Oyster',domain:'oysterhr.com'},{name:'Greenhouse',domain:'greenhouse.io'},{name:'Lever',domain:'lever.co'},{name:'Personio',domain:'personio.com'}],
  'project':         [{name:'Asana',domain:'asana.com'},{name:'Monday.com',domain:'monday.com'},{name:'Linear',domain:'linear.app'},{name:'Jira',domain:'atlassian.com'},{name:'Notion',domain:'notion.so'},{name:'Basecamp',domain:'basecamp.com'}],
  'project-2':       [{name:'ClickUp',domain:'clickup.com'},{name:'Trello',domain:'trello.com'},{name:'Wrike',domain:'wrike.com'},{name:'Smartsheet',domain:'smartsheet.com'},{name:'Teamwork',domain:'teamwork.com'},{name:'Airtable',domain:'airtable.com'}],
  'devtools':        [{name:'GitHub',domain:'github.com'},{name:'GitLab',domain:'gitlab.com'},{name:'CircleCI',domain:'circleci.com'},{name:'Vercel',domain:'vercel.com'},{name:'Netlify',domain:'netlify.com'},{name:'Datadog',domain:'datadoghq.com'}],
  'devtools-2':      [{name:'Sentry',domain:'sentry.io'},{name:'New Relic',domain:'newrelic.com'},{name:'PagerDuty',domain:'pagerduty.com'},{name:'Honeycomb',domain:'honeycomb.io'},{name:'LaunchDarkly',domain:'launchdarkly.com'},{name:'Supabase',domain:'supabase.com'}],
  'security':        [{name:'CrowdStrike',domain:'crowdstrike.com'},{name:'Palo Alto',domain:'paloaltonetworks.com'},{name:'SentinelOne',domain:'sentinelone.com'},{name:'Cloudflare',domain:'cloudflare.com'},{name:'Snyk',domain:'snyk.io'},{name:'1Password',domain:'1password.com'}],
  'communication':   [{name:'Slack',domain:'slack.com'},{name:'Microsoft Teams',domain:'microsoft.com'},{name:'Zoom',domain:'zoom.us'},{name:'Intercom',domain:'intercom.com'},{name:'Zendesk',domain:'zendesk.com'},{name:'Freshdesk',domain:'freshdesk.com'}],
  'education':       [{name:'Coursera',domain:'coursera.org'},{name:'Udemy',domain:'udemy.com'},{name:'Skillshare',domain:'skillshare.com'},{name:'LinkedIn Learning',domain:'linkedin.com'},{name:'Pluralsight',domain:'pluralsight.com'},{name:'Teachable',domain:'teachable.com'}],
  'education-2':     [{name:'Thinkific',domain:'thinkific.com'},{name:'Kajabi',domain:'kajabi.com'},{name:'LearnDash',domain:'learndash.com'},{name:'Duolingo',domain:'duolingo.com'},{name:'Khan Academy',domain:'khanacademy.org'},{name:'Podia',domain:'podia.com'}],
  'hospitality':     [{name:'Marriott',domain:'marriott.com'},{name:'Hilton',domain:'hilton.com'},{name:'IHG',domain:'ihg.com'},{name:'Hyatt',domain:'hyatt.com'},{name:'Wyndham',domain:'wyndham.com'},{name:'Best Western',domain:'bestwestern.com'}],
  'hospitality-2':   [{name:'Accor',domain:'accor.com'},{name:'Radisson',domain:'radissonhotels.com'},{name:'Choice Hotels',domain:'choicehotels.com'},{name:'Four Seasons',domain:'fourseasons.com'},{name:'Mandarin Oriental',domain:'mandarinoriental.com'},{name:'Fairmont',domain:'fairmont.com'}],
  'travel':          [{name:'Booking.com',domain:'booking.com'},{name:'Airbnb',domain:'airbnb.com'},{name:'Expedia',domain:'expedia.com'},{name:'Hotels.com',domain:'hotels.com'},{name:'Trivago',domain:'trivago.com'},{name:'VRBO',domain:'vrbo.com'}],
  'travel-2':        [{name:'TripAdvisor',domain:'tripadvisor.com'},{name:'Agoda',domain:'agoda.com'},{name:'Kayak',domain:'kayak.com'},{name:'Hopper',domain:'hopper.com'},{name:'Skyscanner',domain:'skyscanner.com'},{name:'Google Travel',domain:'travel.google.com'}],
  'retail':          [{name:'Amazon',domain:'amazon.com'},{name:'Walmart',domain:'walmart.com'},{name:'Target',domain:'target.com'},{name:'IKEA',domain:'ikea.com'},{name:'Costco',domain:'costco.com'},{name:'Home Depot',domain:'homedepot.com'}],
  'retail-2':        [{name:'Zara',domain:'zara.com'},{name:'H&M',domain:'hm.com'},{name:'Nike',domain:'nike.com'},{name:'Adidas',domain:'adidas.com'},{name:'Uniqlo',domain:'uniqlo.com'},{name:'Gap',domain:'gap.com'}],
  'food':            [{name:'DoorDash',domain:'doordash.com'},{name:'Uber Eats',domain:'ubereats.com'},{name:'OpenTable',domain:'opentable.com'},{name:'Yelp',domain:'yelp.com'},{name:'Grubhub',domain:'grubhub.com'},{name:'Deliveroo',domain:'deliveroo.com'}],
  'food-2':          [{name:'Resy',domain:'resy.com'},{name:'Toast',domain:'toasttab.com'},{name:'SevenRooms',domain:'sevenrooms.com'},{name:'Tock',domain:'exploretock.com'},{name:'Olo',domain:'olo.com'},{name:'Square for Restaurants',domain:'squareup.com'}],
  'realestate':      [{name:'Zillow',domain:'zillow.com'},{name:'Realtor.com',domain:'realtor.com'},{name:'Redfin',domain:'redfin.com'},{name:'Compass',domain:'compass.com'},{name:'Trulia',domain:'trulia.com'},{name:'Opendoor',domain:'opendoor.com'}],
  'realestate-2':    [{name:'CoStar',domain:'costar.com'},{name:'LoopNet',domain:'loopnet.com'},{name:'Mashvisor',domain:'mashvisor.com'},{name:'Arrived',domain:'arrived.com'},{name:'Homesnap',domain:'homesnap.com'},{name:'Roofstock',domain:'roofstock.com'}],
  'media':           [{name:'Netflix',domain:'netflix.com'},{name:'Spotify',domain:'spotify.com'},{name:'YouTube',domain:'youtube.com'},{name:'Apple TV+',domain:'apple.com'},{name:'Disney+',domain:'disneyplus.com'},{name:'Amazon Prime',domain:'amazon.com'}],
  'media-2':         [{name:'Substack',domain:'substack.com'},{name:'Patreon',domain:'patreon.com'},{name:'Medium',domain:'medium.com'},{name:'Beehiiv',domain:'beehiiv.com'},{name:'ConvertKit',domain:'convertkit.com'},{name:'Ghost',domain:'ghost.org'}],
  'logistics':       [{name:'FedEx',domain:'fedex.com'},{name:'UPS',domain:'ups.com'},{name:'DHL',domain:'dhl.com'},{name:'ShipBob',domain:'shipbob.com'},{name:'Flexport',domain:'flexport.com'},{name:'Shippo',domain:'goshippo.com'}],
  'logistics-2':     [{name:'Easyship',domain:'easyship.com'},{name:'ShipStation',domain:'shipstation.com'},{name:'Pirate Ship',domain:'pirateship.com'},{name:'FreightQuote',domain:'freightquote.com'},{name:'Echo Global',domain:'echo.com'},{name:'Convoy',domain:'convoy.com'}],
};

function _aimNbGetSuggestedComps() {
  var nb = _aimNewBrand;
  if (nb._detectedPool && _AIM_COMP_POOLS[nb._detectedPool]) return _AIM_COMP_POOLS[nb._detectedPool];
  var name = (nb.name || '').toLowerCase();
  var domain = (nb.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
  var combined = name + ' ' + domain;
  var chas = function(w) { return combined.indexOf(w) !== -1; };

  // Precise brand/domain signals first
  if (chas('peekaboo') || chas('otterly') || chas('profound') || chas('aimondo') ||
      (chas('ai') && (chas('visibility') || chas('monitoring') || chas('mention') || chas('track'))) ||
      (chas('llm') && (chas('visibility') || chas('monitoring') || chas('track'))) ||
      /brand.?monitor|ai.?visib|llm.?monitor|ai.?search.?track/.test(combined)) return _AIM_COMP_POOLS['ai-visibility'];
  if (/shopify|woocommerce|bigcommerce|magento|e.?comm|online.?store|product.?catalog/.test(combined)) return _AIM_COMP_POOLS['ecommerce'];
  if (/stripe|plaid|payment|fintech|neobank|lending|wallet|remittance/.test(combined)) return _AIM_COMP_POOLS['fintech'];
  if (/ahrefs|semrush|moz|brightedge|conductor|rank.?track|backlink|keyword.?research/.test(combined)) return _AIM_COMP_POOLS['seo'];
  if (/openai|anthropic|mistral|cohere|llm|gpt|large.?language|foundation.?model/.test(combined)) return _AIM_COMP_POOLS['ai-ml'];
  if (/salesforce|hubspot|pipedrive|crm|customer.?relation|sales.?pipeline/.test(combined)) return _AIM_COMP_POOLS['crm'];
  if (/mailchimp|klaviyo|braze|marketo|email.?market|marketing.?auto/.test(combined)) return _AIM_COMP_POOLS['marketing'];
  if (/mixpanel|amplitude|segment|heap|pendo|product.?analytic|user.?analytic/.test(combined)) return _AIM_COMP_POOLS['analytics'];
  if (/asana|linear|jira|monday|project.?manag|task.?manag|sprint/.test(combined)) return _AIM_COMP_POOLS['project'];
  if (/bamboohr|workday|rippling|gusto|hrm|hris|payroll|recruit/.test(combined)) return _AIM_COMP_POOLS['hr'];
  if (/github|gitlab|circleci|vercel|netlify|devops|ci.?cd|deploy|cloud.?infra/.test(combined)) return _AIM_COMP_POOLS['devtools'];
  if (/crowdstrike|sentinelone|cloudflare|cyber|security|soc|threat/.test(combined)) return _AIM_COMP_POOLS['security'];
  if (/health|medical|clinic|patient|doctor|wellness|mental.?health|telemed/.test(combined)) return _AIM_COMP_POOLS['healthcare'];
  if (/coursera|udemy|elearn|lms|online.?course|education|training.?platform/.test(combined)) return _AIM_COMP_POOLS['education'];
  if (/slack|teams|intercom|zendesk|support|customer.?success|live.?chat/.test(combined)) return _AIM_COMP_POOLS['communication'];
  if (/hotel|resort|motel|inn|lodge|hostel|marriott|hilton|hyatt|wyndham|accor|boutique.?hotel|hospitality/.test(combined)) return _AIM_COMP_POOLS['hospitality'];
  if (/booking|airbnb|expedia|travel|flight|airline|vacation.?rental|holiday|tour|cruise/.test(combined)) return _AIM_COMP_POOLS['travel'];
  if (/restaurant|cafe|diner|food.?delivery|takeaway|takeout|doordash|grubhub|opentable|resy|bistro/.test(combined)) return _AIM_COMP_POOLS['food'];
  if (/real.?estate|property|mortgage|realty|zillow|redfin|realtor|rental|apartment|home.?buy/.test(combined)) return _AIM_COMP_POOLS['realestate'];
  if (/retail|fashion|apparel|clothing|store|shop|department.?store|supermarket|grocery|walmart|target|amazon/.test(combined) && !/shopify|bigcommerce|woocommerce/.test(combined)) return _AIM_COMP_POOLS['retail'];
  if (/media|publisher|newsletter|podcast|streaming|content.?creator|magazine|news|blog|substack|spotify/.test(combined)) return _AIM_COMP_POOLS['media'];
  if (/shipping|logistics|freight|courier|delivery|warehouse|supply.?chain|fulfillment/.test(combined)) return _AIM_COMP_POOLS['logistics'];

  // Industry fallback — but if industry was auto-set to SaaS default, try a deeper domain check first
  var iMap = {
    'Marketing & SEO':       'seo',
    'AI & Machine Learning': 'ai-ml',
    'SaaS & Software':       null,
    'E-Commerce':            'ecommerce',
    'Healthcare':            'healthcare',
    'Finance & Fintech':     'fintech',
    'Education':             'education',
    'Cybersecurity':         'security',
    'Professional Services': 'crm',
    'Travel & Hospitality':  'hospitality',
    'Food & Beverage':       'food',
    'Fashion & Apparel':     'retail',
    'Retail':                'retail',
    'Media & Publishing':    'media',
    'Real Estate':           'realestate',
  };
  var industryPool = iMap[nb.industry];
  if (industryPool) return _AIM_COMP_POOLS[industryPool];

  // Deep domain-only fallback: try expanded brand-name fragments the keyword pass may have missed
  var domOnly = domain;
  if (/ritz|carlton|four.?seasons|peninsula|kimpton|aman|shangri|rosewood|raffles|burj|claridge|savoy|bvlgari|st.?regis|park.?hyatt|andaz/.test(domOnly)) return _AIM_COMP_POOLS['hospitality'];
  if (/mcdonalds|kfc|subway|starbucks|chipotle|dominos|wendys|burger|popeyes|chick.?fil/.test(domOnly)) return _AIM_COMP_POOLS['food'];
  if (/delta|united|american.*air|southwest|easyjet|ryanair|emirates|lufthansa|qantas/.test(domOnly)) return _AIM_COMP_POOLS['travel'];
  if (/ikea|zara|primark|topshop|asos|boohoo|farfetch|selfridge|nordstrom|bloomingdale/.test(domOnly)) return _AIM_COMP_POOLS['retail'];
  if (/nytimes|bbc|guardian|forbes|bloomberg|reuters|ap.?news|economist|wsj|ft\.com/.test(domOnly)) return _AIM_COMP_POOLS['media'];
  if (/zillow|redfin|rightmove|purplebrick|openrent|zoopla|trulia|realtor|cbre|jll/.test(domOnly)) return _AIM_COMP_POOLS['realestate'];

  // True final fallback
  return _AIM_COMP_POOLS['analytics'];
}

function _aimNbCompCard(c, isSel) {
  var favUrl = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(c.domain) + '&sz=64';
  var fl = (c.name[0]||'?').toUpperCase();
  var fc = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'][c.name.charCodeAt(0)%6];
  var checkSvg = isSel ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
  return '<div class="aim-nb-comp-card' + (isSel ? ' selected' : '') + '" onclick="aimNbToggleComp(\'' + c.name.replace(/'/g,'\\\'') + '\',\'' + c.domain + '\')" data-comp-name="' + aimEscHtml(c.name) + '">'
    + '<img class="aim-nb-comp-fav" src="' + favUrl + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">'
    + '<div style="display:none;width:26px;height:26px;border-radius:6px;background:' + fc + ';align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;">' + fl + '</div>'
    + '<div class="aim-nb-comp-info"><div class="aim-nb-comp-name">' + aimEscHtml(c.name) + '</div><div class="aim-nb-comp-url">' + c.domain + '</div></div>'
    + '<div class="aim-nb-comp-check">' + checkSvg + '</div>'
    + '</div>';
}

function _aimNbSelTagHtml(c, type, key) {
  var favUrl = c.domain ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(c.domain) + '&sz=64' : '';
  var fl = (c.name[0]||'?').toUpperCase();
  var fc = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'][c.name.charCodeAt(0)%6];
  var rmKey = key.replace(/'/g,"\\'");
  return '<div class="aim-nb-sel-tag">'
    + (favUrl
        ? '<img class="aim-nb-sel-fav" src="' + favUrl + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">'
          + '<div style="display:none;width:18px;height:18px;border-radius:4px;flex-shrink:0;background:' + fc + ';align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">' + fl + '</div>'
        : '<div style="width:18px;height:18px;border-radius:4px;flex-shrink:0;background:' + fc + ';display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;">' + fl + '</div>')
    + '<span class="aim-nb-sel-tag-name">' + aimEscHtml(c.name) + '</span>'
    + (c.domain ? '<span class="aim-nb-sel-tag-domain">' + c.domain + '</span>' : '')
    + '<button class="aim-nb-manual-tag-del" onclick="aimNbRemoveComp(\'' + type + '\',\'' + rmKey + '\')">&#x2715;</button>'
    + '</div>';
}

function _aimNbChipHtml(c, type, key) {
  var favUrl = c.domain ? 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(c.domain) + '&sz=32' : '';
  var fl = (c.name[0]||'?').toUpperCase();
  var fc = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'][c.name.charCodeAt(0)%6];
  var rmKey = key.replace(/'/g,"\\'");
  return '<span class="aim-nb-comp-chip">'
    + (favUrl
        ? '<img src="' + favUrl + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">'
          + '<span class="aim-nb-comp-chip-letter" style="display:none;background:' + fc + ';">' + fl + '</span>'
        : '<span class="aim-nb-comp-chip-letter" style="background:' + fc + ';">' + fl + '</span>')
    + '<span class="aim-nb-comp-chip-name">' + aimEscHtml(c.name) + '</span>'
    + '<button class="aim-nb-comp-chip-del" onclick="aimNbRemoveComp(\'' + type + '\',\'' + rmKey + '\')" title="Remove">&#x2715;</button>'
    + '</span>';
}

function _aimNbRenderSelectedList() {
  var nb = _aimNewBrand;
  var chips = [];
  Object.keys(nb.selectedComps).forEach(function(k) { chips.push(_aimNbChipHtml(nb.selectedComps[k], 'g', k)); });
  nb.manualComps.forEach(function(c, i) { chips.push(_aimNbChipHtml(c, 'm', String(i))); });
  var container = document.getElementById('aim-nb-comp-chips');
  if (container) container.innerHTML = chips.join('');
  var counter = document.getElementById('aim-nb-sel-counter');
  var total = Object.keys(nb.selectedComps).length + nb.manualComps.length;
  if (counter) counter.textContent = total + '/8 selected';
}

function _aimNbStep2Html() {
  var nb = _aimNewBrand;
  if (nb._scanning) {
    var scanDomain = (nb.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'');
    return '<div style="text-align:center;padding:48px 20px 36px;">'
      + '<div style="display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:50%;background:#f0f4ff;margin-bottom:16px;">'
      +   '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px;">Analyzing your website</div>'
      + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:28px;">' + aimEscHtml(scanDomain) + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:center;gap:6px;">'
      +   '<div style="width:8px;height:8px;border-radius:50%;background:#6366f1;animation:aimDotPulse 1.2s ease-in-out 0s infinite"></div>'
      +   '<div style="width:8px;height:8px;border-radius:50%;background:#6366f1;animation:aimDotPulse 1.2s ease-in-out 0.4s infinite"></div>'
      +   '<div style="width:8px;height:8px;border-radius:50%;background:#6366f1;animation:aimDotPulse 1.2s ease-in-out 0.8s infinite"></div>'
      + '</div>'
      + '</div>';
  }
  var sugg = nb._compsGenerated ? nb._compsGenerated : _aimNbGetSuggestedComps();
  var compCards = sugg.map(function(c) { return _aimNbCompCard(c, !!nb.selectedComps[c.name]); }).join('');
  var selItems = [];
  Object.keys(nb.selectedComps).forEach(function(k) { selItems.push(_aimNbSelTagHtml(nb.selectedComps[k], 'g', k)); });
  nb.manualComps.forEach(function(c, i) { selItems.push(_aimNbSelTagHtml(c, 'm', String(i))); });
  var hasSelected = selItems.length > 0;
  var chipItems = [];
  Object.keys(nb.selectedComps).forEach(function(k) { chipItems.push(_aimNbChipHtml(nb.selectedComps[k], 'g', k)); });
  nb.manualComps.forEach(function(c, i) { chipItems.push(_aimNbChipHtml(c, 'm', String(i))); });

  var totalSel = Object.keys(nb.selectedComps).length + nb.manualComps.length;
  return '<div class="aim-nb-section-hd">'
    +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    +   'Suggested Competitors'
    +   '<span id="aim-nb-sel-counter" style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:auto;">' + totalSel + '/8 selected</span>'
    + '</div>'
    + '<div id="aim-nb-comp-gen-status"></div>'
    + '<div class="aim-nb-comp-grid" id="aim-nb-comp-grid">' + compCards + '</div>'
    + '<button class="aim-nb-gen-comps-btn" id="aim-nb-gen-comps-btn" onclick="aimNbGenerateComps()">'
    +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>'
    +   'Generate new competitors with AI'
    + '</button>'
    + '<div class="aim-nb-section-hd" style="margin-top:4px;">'
    +   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    +   'Add Manually'
    + '</div>'
    + '<div style="margin-bottom:8px;">'
    +   '<div style="position:relative;margin-bottom:6px;">'
    +     '<input id="aim-nb-comp-url-inp" class="aim-nb-input" type="text" placeholder="Paste website URL (e.g. notion.so)" style="padding-right:80px;" oninput="aimNbCompUrlInput()" onblur="aimNbCompUrlBlur()" onkeydown="if(event.key===\'Enter\')aimNbAddManualComp()">'
    +     '<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:10px;font-weight:600;color:#6366f1;pointer-events:none;">auto-fills name</span>'
    +   '</div>'
    +   '<input id="aim-nb-comp-name-inp" class="aim-nb-input" type="text" placeholder="Brand name" onkeydown="if(event.key===\'Enter\')aimNbAddManualComp()">'
    + '</div>'
    + '<div class="aim-nb-comp-action-row">'
    +   '<button class="aim-nb-add-row-btn" onclick="aimNbAddManualComp()">Add Competitor</button>'
    +   '<div class="aim-nb-comp-chips" id="aim-nb-comp-chips">' + chipItems.join('') + '</div>'
    + '</div>';
}

function _aimNbComboHtml(id, items, selectedVal, placeholder) {
  var selLabel = '';
  for (var i = 0; i < items.length; i++) {
    var item = typeof items[i] === 'object' ? items[i] : {v: items[i], l: items[i]};
    if (item.v === selectedVal) { selLabel = item.l; break; }
  }
  var optHtml = items.map(function(it) {
    var item = typeof it === 'object' ? it : {v: it, l: it};
    var sel = item.v === selectedVal ? ' aim-nb-opt-sel' : '';
    return '<div class="aim-nb-combo-opt' + sel + '" onclick="aimNbComboSelect(\'' + id + '\',\'' + item.v.replace(/'/g,'\\\'') + '\',\'' + item.l.replace(/'/g,'\\\'') + '\')">' + item.l + '</div>';
  }).join('');
  return '<div class="aim-nb-combo">'
    + '<input id="aim-nb-combo-' + id + '" class="aim-nb-input" type="text" autocomplete="off" placeholder="' + placeholder + '" value="' + aimEscHtml(selLabel) + '"'
    + ' oninput="_aimNbComboFilter(\'' + id + '\',this.value)"'
    + ' onfocus="_aimNbComboOpen(\'' + id + '\')"'
    + ' onblur="setTimeout(function(){_aimNbComboClose(\'' + id + '\')},180)">'
    + '<div class="aim-nb-combo-list" id="aim-nb-combo-list-' + id + '">' + optHtml + '</div>'
    + '</div>';
}

function _aimNbComboOpen(id) {
  var list = document.getElementById('aim-nb-combo-list-' + id);
  if (list) { list.classList.add('open'); _aimNbScrollComboSel(id); }
}
function _aimNbComboClose(id) {
  var list = document.getElementById('aim-nb-combo-list-' + id);
  if (list) list.classList.remove('open');
}
function _aimNbComboFilter(id, q) {
  var list = document.getElementById('aim-nb-combo-list-' + id);
  if (!list) return;
  list.classList.add('open');
  var q2 = q.toLowerCase();
  Array.from(list.children).forEach(function(opt) {
    opt.style.display = (!q2 || opt.textContent.toLowerCase().includes(q2)) ? '' : 'none';
  });
}
function aimNbComboSelect(id, val, label) {
  var inp = document.getElementById('aim-nb-combo-' + id);
  if (inp) inp.value = label;
  if (id === 'lang') _aimNewBrand.language = val;
  if (id === 'loc')  _aimNewBrand.location  = val;
  _aimNbComboClose(id);
}
function _aimNbScrollComboSel(id) {
  var list = document.getElementById('aim-nb-combo-list-' + id);
  if (!list) return;
  var sel = list.querySelector('.aim-nb-opt-sel');
  if (sel) sel.scrollIntoView({block:'nearest'});
}

function _aimNbStep3Html() {
  var nb = _aimNewBrand;
  var intentColors = {Commercial:'#3b82f6',Informational:'#8b5cf6',Transactional:'#10b981',Navigational:'#f59e0b'};
  var intentPills = ['Commercial','Informational','Transactional','Navigational'].map(function(intent) {
    var active = nb.intents.indexOf(intent) !== -1;
    return '<button class="aim-nb-intent-pill' + (active ? ' active' : '') + '" onclick="aimNbToggleIntent(\'' + intent + '\')">' + intent + '</button>';
  }).join('');
  var promptItems = nb.prompts.map(function(pt, i) {
    var text = typeof pt === 'object' ? pt.text : pt;
    var intent = typeof pt === 'object' ? pt.intent : '';
    var ic = intentColors[intent] || '#6b7280';
    var badge = intent ? '<span style="font-size:10px;font-weight:600;color:' + ic + ';background:' + ic + '1a;padding:2px 7px;border-radius:4px;flex-shrink:0;white-space:nowrap;">' + intent + '</span>' : '';
    return '<div class="aim-nb-prompt-item aim-nb-prompt-item-clickable" id="aim-nb-pi-' + i + '" title="Click to edit" onclick="aimNbEditPrompt(' + i + ')">'
      + badge
      + '<span class="aim-nb-prompt-text">' + aimEscHtml(text) + '</span>'
      + '<button class="aim-nb-prompt-del" onclick="event.stopPropagation();aimNbRemovePrompt(' + i + ')">&#x2715;</button>'
      + '</div>';
  }).join('');
  var promptCount = nb.prompts.length;
  var promptLimit = 100;
  var hasGenerated = nb._promptsGenerated;

  var genBtnLabel = hasGenerated ? 'Generate new prompt' : 'Generate Prompts with AI';
  var sparkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>';

  return '<div class="aim-nb-2col" style="margin-bottom:14px;">'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label">Language</div>'
    +   _aimNbComboHtml('lang', _AIM_LANGUAGES, nb.language, 'Search language...') + '</div>'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label">Target Market</div>'
    +   _aimNbComboHtml('loc', _AIM_LOCATIONS, nb.location, 'Search country...') + '</div>'
    + '</div>'
    + '<div class="aim-nb-field"><div class="aim-nb-field-label" style="margin-bottom:8px;">Prompt Intent</div>'
    +   '<div class="aim-nb-intent-row">' + intentPills + '</div></div>'
    + '<button class="aim-nb-gen-btn" id="aim-nb-gen-btn" onclick="aimNbGeneratePrompts()">'
    +   sparkSvg + genBtnLabel
    + '</button>'
    + '<div class="aim-nb-section-hd">'
    +   'Your Prompts <span style="font-size:11px;font-weight:500;color:var(--text-muted);margin-left:4px;">(' + promptCount + '/' + promptLimit + ')</span>'
    + '</div>'
    + (promptItems ? '<div class="aim-nb-prompt-list">' + promptItems + '</div>' : '<div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:12px;">No prompts yet. Generate with AI or add manually below.</div>')
    + '<div class="aim-nb-add-row">'
    +   '<input id="aim-nb-prompt-inp" class="aim-nb-input" type="text" placeholder="Add a prompt manually..." onkeydown="if(event.key===\'Enter\')aimNbAddManualPrompt()">'
    +   '<button class="aim-nb-add-row-btn" onclick="aimNbAddManualPrompt()">Add</button>'
    + '</div>';
}

function _aimNbBindStep(s) {
  if (s === 1) {
    var nameEl = document.getElementById('aim-nb-name');
    if (nameEl) nameEl.addEventListener('input', function(){ _aimNewBrand.name = this.value; });
    var descEl = document.getElementById('aim-nb-desc');
    if (descEl) descEl.addEventListener('input', function(){ _aimNewBrand.description = this.value; });
    var webEl = document.getElementById('aim-nb-website');
    if (webEl) webEl.addEventListener('input', function(){ _aimNewBrand.url = this.value; });
    var indEl = document.getElementById('aim-nb-industry');
    if (indEl) indEl.addEventListener('change', function(){ _aimNewBrand.industry = this.value; });
  }
  // Step 3 lang/loc combos manage their own state via aimNbComboSelect
}

function aimNbSetMode(mode) {
  _aimNbSaveStep1Fields();
  _aimNewBrand.mode = mode;
  _aimNewBrand.modeChosen = true;
  _aimNbRender();
}

function aimNbResetMode() {
  _aimNbSaveStep1Fields();
  _aimNewBrand.modeChosen = false;
  _aimNbRender();
}

function _aimNbSaveStep1Fields() {
  var n = document.getElementById('aim-nb-name');
  var d = document.getElementById('aim-nb-desc');
  var w = document.getElementById('aim-nb-website');
  var i = document.getElementById('aim-nb-industry');
  if (n) _aimNewBrand.name = n.value;
  if (d) _aimNewBrand.description = d.value;
  if (w) _aimNewBrand.url = w.value;
  if (i) _aimNewBrand.industry = i.value;
}

function _aimNbCleanBrandName(slug) {
  if (!slug) return '';
  var s = slug.toLowerCase();
  var prefixes = ['try','get','use','go','my','the','best','we','hello','hey','meet','join','with','do','say','now','start','lets','let','team','work','buy','run','make','its','our','be','by','to'];
  for (var i = 0; i < prefixes.length; i++) {
    var p = prefixes[i];
    if (s.length - p.length >= 4 && s.substring(0, p.length) === p) { s = s.slice(p.length); break; }
  }
  var suffixes = ['app','hq','hub'];
  for (var j = 0; j < suffixes.length; j++) {
    var sf = suffixes[j];
    if (s.length - sf.length >= 4 && s.substring(s.length - sf.length) === sf) { s = s.slice(0, s.length - sf.length); break; }
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function aimNbLookup() {
  var urlEl = document.getElementById('aim-nb-lookup-url');
  if (!urlEl) return;
  var raw = urlEl.value.trim();
  if (!raw) return;
  _aimNewBrand.lookupUrl = raw;
  var statusEl = document.getElementById('aim-nb-fetch-status');
  var btn = document.getElementById('aim-nb-lookup-btn');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = '<div class="aim-nb-fetching"><div class="aim-nb-fetching-dot"></div>Fetching brand info…</div>';
  setTimeout(function() {
    // Simulate auto-fill
    var domain = raw.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').toLowerCase();
    var parts   = domain.split('.');
    var slug    = parts[0] || 'brand';
    var brandName = _aimNbCleanBrandName(slug);
    _aimNewBrand.name = brandName;
    _aimNewBrand.url  = 'https://' + domain;
    _aimNewBrand.description = brandName + ' is a leading platform that helps businesses achieve their goals through innovative technology and exceptional service.';
    // Guess industry
    var kw = domain.toLowerCase();
    var guessedInd = 'SaaS & Software';
    if      (/shop|store|buy|commerce|retail|mall|market/.test(kw))                                                          guessedInd = 'E-Commerce';
    else if (/hotel|resort|inn|lodge|hostel|suites|motel|palace|ritz|carlton|hilton|marriott|hyatt|wyndham|accor|fairmont|sheraton|westin|novotel|sofitel|intercontinental|waldorf|aman|mandarin/.test(kw)) guessedInd = 'Travel & Hospitality';
    else if (/travel|tours|flight|airline|cruise|vacation|holiday|airbnb|booking/.test(kw))                                  guessedInd = 'Travel & Hospitality';
    else if (/restaurant|cafe|bistro|grill|diner|eatery|pizza|burger|sushi|food|kitchen|bakery|brew/.test(kw))               guessedInd = 'Food & Beverage';
    else if (/health|med|clinic|care|hospital|pharma|dental|therapy|wellness|rehab/.test(kw))                                guessedInd = 'Healthcare';
    else if (/pay|bank|finance|money|invest|capital|fund|credit|loan|insur/.test(kw))                                        guessedInd = 'Finance & Fintech';
    else if (/ai|ml|gpt|llm|neural/.test(kw))                                                                                guessedInd = 'AI & Machine Learning';
    else if (/seo|rank|ahrefs|semrush/.test(kw))                                                                             guessedInd = 'Marketing & SEO';
    else if (/fashion|apparel|cloth|wear|style|dress|shoes|bag|jewel|luxury/.test(kw))                                       guessedInd = 'Fashion & Apparel';
    else if (/property|realty|estate|homes|realtor|mortgage|rent|apartment/.test(kw))                                        guessedInd = 'Real Estate';
    else if (/news|media|magazine|journal|press|broadcast|publish|editorial|podcast/.test(kw))                               guessedInd = 'Media & Publishing';
    else if (/school|university|college|academy|learn|edu|course|training/.test(kw))                                         guessedInd = 'Education';
    else if (/law|legal|attorney|lawyer|counsel/.test(kw))                                                                   guessedInd = 'Professional Services';
    else if (/ship|logistic|freight|courier|deliver|fulfil/.test(kw))                                                        guessedInd = 'Professional Services';
    _aimNewBrand.industry = guessedInd;
    if (statusEl) statusEl.innerHTML = '<div style="font-size:12px;color:#10b981;padding:6px 0;display:flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Brand info fetched. Review and adjust below.</div>';
    if (btn) btn.disabled = false;
    _aimNbRender();
  }, 1200);
}

function aimNbToggleComp(name, domain) {
  var nb = _aimNewBrand;
  if (nb.selectedComps[name]) {
    delete nb.selectedComps[name];
  } else {
    var total = Object.keys(nb.selectedComps).length + nb.manualComps.length;
    if (total >= 8) {
      var statusEl = document.getElementById('aim-nb-comp-gen-status');
      if (statusEl) {
        statusEl.innerHTML = '<div class="aim-nb-comp-limit-msg"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Maximum 8 competitors allowed.</div>';
        setTimeout(function(){ if(statusEl) statusEl.innerHTML=''; }, 2500);
      }
      return;
    }
    nb.selectedComps[name] = { name: name, domain: domain };
  }
  var card = document.querySelector('.aim-nb-comp-card[data-comp-name="' + name.replace(/"/g,'&quot;') + '"]');
  if (card) {
    var isSel = !!_aimNewBrand.selectedComps[name];
    card.classList.toggle('selected', isSel);
    var chk = card.querySelector('.aim-nb-comp-check');
    if (chk) chk.innerHTML = isSel ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
  }
  _aimNbRenderSelectedList();
}

function aimNbRemoveComp(type, key) {
  var nb = _aimNewBrand;
  if (type === 'g') {
    delete nb.selectedComps[key];
    var card = document.querySelector('.aim-nb-comp-card[data-comp-name="' + key.replace(/"/g,'&quot;') + '"]');
    if (card) {
      card.classList.remove('selected');
      var chk = card.querySelector('.aim-nb-comp-check');
      if (chk) chk.innerHTML = '';
    }
  } else {
    var idx = parseInt(key, 10);
    nb.manualComps.splice(idx, 1);
  }
  _aimNbRenderSelectedList();
}

function aimNbCompUrlInput() {
  var urlInp  = document.getElementById('aim-nb-comp-url-inp');
  var nameInp = document.getElementById('aim-nb-comp-name-inp');
  if (!urlInp || !nameInp) return;
  // Auto-fill brand name from URL as user types if name field is empty or was auto-filled
  var raw = urlInp.value.trim();
  var domain = raw.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
  var slug = domain.split('.')[0] || '';
  if (slug && (!nameInp.value || nameInp.dataset.autofilled === '1')) {
    nameInp.value = _aimNbCleanBrandName(slug);
    nameInp.dataset.autofilled = '1';
  }
}

function aimNbCompUrlBlur() {
  var urlInp  = document.getElementById('aim-nb-comp-url-inp');
  var nameInp = document.getElementById('aim-nb-comp-name-inp');
  if (!urlInp || !nameInp) return;
  var raw = urlInp.value.trim();
  if (!raw) return;
  var domain = raw.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
  var slug = domain.split('.')[0] || '';
  if (slug && (!nameInp.value || nameInp.dataset.autofilled === '1')) {
    nameInp.value = _aimNbCleanBrandName(slug);
    nameInp.dataset.autofilled = '1';
  }
}

function aimNbAddManualComp() {
  var nameInp = document.getElementById('aim-nb-comp-name-inp');
  var urlInp  = document.getElementById('aim-nb-comp-url-inp');
  var rawUrl  = urlInp  ? urlInp.value.trim()  : '';
  var rawName = nameInp ? nameInp.value.trim() : '';
  if (!rawName && !rawUrl) return;
  var nb = _aimNewBrand;
  var total = Object.keys(nb.selectedComps).length + nb.manualComps.length;
  if (total >= 8) {
    var statusEl = document.getElementById('aim-nb-comp-gen-status');
    if (statusEl) {
      statusEl.innerHTML = '<div class="aim-nb-comp-limit-msg"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Maximum 8 competitors allowed.</div>';
      setTimeout(function(){ if(statusEl) statusEl.innerHTML=''; }, 2500);
    }
    return;
  }
  var domain = rawUrl ? rawUrl.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase() : '';
  var slug   = domain.split('.')[0] || '';
  var name   = rawName || (slug ? _aimNbCleanBrandName(slug) : 'Unknown');
  nb.manualComps.push({ name: name, domain: domain });
  if (nameInp) { nameInp.value = ''; nameInp.dataset.autofilled = '0'; }
  if (urlInp)  urlInp.value  = '';
  _aimNbRenderSelectedList();
}

function aimNbGenerateComps() {
  var btn = document.getElementById('aim-nb-gen-comps-btn');
  var statusEl = document.getElementById('aim-nb-comp-gen-status');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.innerHTML = '<div class="aim-nb-fetching" style="margin-bottom:10px;"><div class="aim-nb-fetching-dot"></div>Generating competitors with AI...</div>';
  setTimeout(function() {
    var nb = _aimNewBrand;
    nb._genRound = ((nb._genRound || 0) + 1);
    var name = (nb.name || '').toLowerCase();
    var domain = (nb.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
    var combined = name + ' ' + domain;
    var ghas = function(w) { return combined.indexOf(w) !== -1; };

    // Use detectedPool from scan if available
    if (nb._detectedPool && _AIM_COMP_POOLS[nb._detectedPool + '-2']) {
      var scanPool = _AIM_COMP_POOLS[nb._detectedPool + '-2'];
      if (btn) btn.disabled = false;
      if (statusEl) statusEl.innerHTML = '';
      nb._compsGenerated = scanPool;
      _aimNbRender();
      return;
    }

    // Determine base pool key (alternate to -2 pools for fresh results)
    var poolKey = 'analytics-2';
    if (ghas('peekaboo') || ghas('otterly') || ghas('profound') || ghas('aimondo') ||
        (ghas('ai') && (ghas('visibility') || ghas('monitoring') || ghas('mention') || ghas('track'))) ||
        (ghas('llm') && (ghas('visibility') || ghas('monitoring') || ghas('track'))) ||
        /brand.?monitor|ai.?visib|llm.?monitor/.test(combined))                                        poolKey = 'ai-visibility-2';
    else if (/shopify|woocommerce|bigcommerce|e.?comm|online.?store/.test(combined))               poolKey = 'ecommerce-2';
    else if (/stripe|plaid|payment|fintech|neobank|lending/.test(combined))                        poolKey = 'fintech-2';
    else if (/ahrefs|semrush|moz|brightedge|rank.?track|backlink/.test(combined))                  poolKey = 'seo-2';
    else if (/openai|anthropic|mistral|llm|gpt|large.?language/.test(combined))                    poolKey = 'ai-ml-2';
    else if (/salesforce|hubspot|pipedrive|crm|sales.?pipeline/.test(combined))                    poolKey = 'crm-2';
    else if (/mailchimp|klaviyo|braze|marketo|email.?market/.test(combined))                       poolKey = 'marketing-2';
    else if (/mixpanel|amplitude|segment|heap|product.?analytic/.test(combined))                   poolKey = 'analytics-2';
    else if (/asana|linear|jira|monday|project.?manag/.test(combined))                             poolKey = 'project-2';
    else if (/bamboohr|workday|rippling|gusto|hrm|payroll/.test(combined))                         poolKey = 'hr-2';
    else if (/github|gitlab|circleci|vercel|devops|ci.?cd/.test(combined))                         poolKey = 'devtools-2';
    else if (/crowdstrike|sentinelone|cloudflare|cyber|security/.test(combined))                    poolKey = 'security';
    else if (/health|medical|clinic|patient|telemed/.test(combined))                               poolKey = 'healthcare-2';
    else if (/coursera|udemy|elearn|lms|online.?course/.test(combined))                            poolKey = 'education-2';
    else if (/slack|intercom|zendesk|support|customer.?success/.test(combined))                    poolKey = 'communication';
    else if (/hotel|resort|motel|inn|lodge|hospitality/.test(combined))                            poolKey = 'hospitality-2';
    else if (/booking|airbnb|expedia|travel|flight|vacation.?rental/.test(combined))               poolKey = 'travel-2';
    else if (/restaurant|cafe|food.?delivery|doordash|grubhub|opentable/.test(combined))           poolKey = 'food-2';
    else if (/real.?estate|property|mortgage|zillow|redfin|realtor/.test(combined))                poolKey = 'realestate-2';
    else if (/retail|fashion|apparel|clothing|store|walmart|target/.test(combined))                poolKey = 'retail-2';
    else if (/media|newsletter|podcast|streaming|substack|spotify/.test(combined))                 poolKey = 'media-2';
    else if (/shipping|logistics|freight|courier|fulfillment/.test(combined))                      poolKey = 'logistics-2';
    else {
      // For completely unknown brands, alternate between different pools each round
      var altPools = ['crm-2','marketing-2','project-2','devtools-2','hr-2'];
      poolKey = altPools[(nb._genRound - 1) % altPools.length];
    }

    var list = _AIM_COMP_POOLS[poolKey] || _AIM_COMP_POOLS['analytics-2'];
    nb._compsGenerated = list;
    if (statusEl) statusEl.innerHTML = '<div style="font-size:12px;color:#10b981;padding:4px 0 10px;display:flex;align-items:center;gap:5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Competitors refreshed based on your brand.</div>';
    var grid = document.getElementById('aim-nb-comp-grid');
    if (grid) grid.innerHTML = list.map(function(c){ return _aimNbCompCard(c, !!nb.selectedComps[c.name]); }).join('');
    if (btn) btn.disabled = false;
  }, 1400);
}

var _aimNbEditClickOut = null;
function aimNbEditPrompt(idx) {
  var item = document.getElementById('aim-nb-pi-' + idx);
  if (!item || item.dataset.editing) return;
  // Remove any existing click-outside handler
  if (_aimNbEditClickOut) { document.removeEventListener('mousedown', _aimNbEditClickOut); _aimNbEditClickOut = null; }
  item.dataset.editing = '1';
  item.classList.remove('aim-nb-prompt-item-clickable');
  item.classList.add('aim-nb-prompt-edit-row');
  item.onclick = null;
  var pt = _aimNewBrand.prompts[idx];
  var currentText = (typeof pt === 'object' ? pt.text : pt) || '';
  item.innerHTML = '<input class="aim-nb-prompt-edit-inp" id="aim-nb-edit-' + idx + '">'
    + '<button class="aim-nb-prompt-action-btn aim-nb-prompt-save-btn" onclick="aimNbSavePromptEdit(' + idx + ')">Save</button>'
    + '<button class="aim-nb-prompt-action-btn aim-nb-prompt-cancel-btn" onclick="aimNbCancelPromptEdit(' + idx + ')">Cancel</button>';
  var inp = document.getElementById('aim-nb-edit-' + idx);
  if (inp) {
    inp.value = currentText;
    inp.focus();
    inp.select();
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter')  { e.preventDefault(); aimNbSavePromptEdit(idx); }
      if (e.key === 'Escape') aimNbCancelPromptEdit(idx);
    });
  }
  _aimNbEditClickOut = function(e) {
    var el = document.getElementById('aim-nb-pi-' + idx);
    if (el && !el.contains(e.target)) {
      document.removeEventListener('mousedown', _aimNbEditClickOut);
      _aimNbEditClickOut = null;
      aimNbCancelPromptEdit(idx);
    }
  };
  setTimeout(function() { document.addEventListener('mousedown', _aimNbEditClickOut); }, 0);
}

function aimNbSavePromptEdit(idx) {
  if (_aimNbEditClickOut) { document.removeEventListener('mousedown', _aimNbEditClickOut); _aimNbEditClickOut = null; }
  var inp = document.getElementById('aim-nb-edit-' + idx);
  var val = inp ? inp.value.trim() : '';
  if (val) {
    var pt = _aimNewBrand.prompts[idx];
    if (typeof pt === 'object') pt.text = val;
    else _aimNewBrand.prompts[idx] = {text: val, intent: ''};
  }
  _aimNbRender();
}

function aimNbCancelPromptEdit(idx) {
  if (_aimNbEditClickOut) { document.removeEventListener('mousedown', _aimNbEditClickOut); _aimNbEditClickOut = null; }
  _aimNbRender();
}

function aimNbRemoveManualComp(i) {
  aimNbRemoveComp('m', String(i));
}

function aimNbToggleIntent(intent) {
  var nb = _aimNewBrand;
  var idx = nb.intents.indexOf(intent);
  if (idx !== -1) { if (nb.intents.length > 1) nb.intents.splice(idx, 1); }
  else nb.intents.push(intent);
  _aimNbRender();
}

function aimNbGeneratePrompts() {
  var nb = _aimNewBrand;
  var btn = document.getElementById('aim-nb-gen-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  setTimeout(function() {
    var name = nb.name || 'Your Brand';
    var loc  = nb.location || 'United States';
    var gen  = [];
    if (nb.intents.indexOf('Commercial') !== -1) {
      gen.push({text:'Best ' + name + ' alternatives for ' + loc + ' businesses', intent:'Commercial'});
      gen.push({text:'What are the top ' + name + ' competitors in ' + loc + '?', intent:'Commercial'});
      gen.push({text:'Is ' + name + ' worth it? Honest review', intent:'Commercial'});
      gen.push({text:'How does ' + name + ' compare to competitors?', intent:'Commercial'});
      gen.push({text:'Best ' + name + ' pricing plans for startups', intent:'Commercial'});
    }
    if (nb.intents.indexOf('Informational') !== -1) {
      gen.push({text:'How does ' + name + ' work?', intent:'Informational'});
      gen.push({text:'What is ' + name + ' used for?', intent:'Informational'});
      gen.push({text:'Key benefits of using ' + name, intent:'Informational'});
      gen.push({text:name + ' features and capabilities explained', intent:'Informational'});
      gen.push({text:'Who is ' + name + ' best suited for?', intent:'Informational'});
    }
    if (nb.intents.indexOf('Transactional') !== -1) {
      gen.push({text:name + ' pricing: what does it cost?', intent:'Transactional'});
      gen.push({text:name + ' free trial: how to get started', intent:'Transactional'});
      gen.push({text:name + ' discount codes and deals', intent:'Transactional'});
      gen.push({text:'How to sign up for ' + name, intent:'Transactional'});
    }
    if (nb.intents.indexOf('Navigational') !== -1) {
      gen.push({text:name + ' login and account access', intent:'Navigational'});
      gen.push({text:name + ' documentation and help center', intent:'Navigational'});
      gen.push({text:name + ' customer support options', intent:'Navigational'});
    }
    // Merge with existing, cap at 100
    var existing = nb.prompts.map(function(p){ return (typeof p === 'object' ? p.text : p).toLowerCase(); });
    gen.forEach(function(t) {
      if (nb.prompts.length < 100 && existing.indexOf(t.text.toLowerCase()) === -1) {
        nb.prompts.push(t);
        existing.push(t.text.toLowerCase());
      }
    });
    nb._promptsGenerated = true;
    _aimNbRender();
  }, 1400);
}

function aimNbAddManualPrompt() {
  var inp = document.getElementById('aim-nb-prompt-inp');
  if (!inp) return;
  var val = inp.value.trim();
  if (!val) return;
  if (_aimNewBrand.prompts.length >= 100) return;
  _aimNewBrand.prompts.push({text: val, intent: ''});
  inp.value = '';
  _aimNbRender();
}

function aimNbAddSuggestedPrompt(text, intent) {
  if (_aimNewBrand.prompts.length >= 100) return;
  var existing = _aimNewBrand.prompts.map(function(p){ return (typeof p === 'object' ? p.text : p).toLowerCase(); });
  if (existing.indexOf(text.toLowerCase()) === -1) {
    _aimNewBrand.prompts.push({text: text, intent: intent || ''});
  }
  _aimNbRender();
}

function aimNbRemovePrompt(i) {
  _aimNewBrand.prompts.splice(i, 1);
  _aimNbRender();
}

function aimNbPrev() {
  if (_aimNewBrand.step <= 1) return;
  _aimNewBrand.step--;
  _aimNbRender();
}

function aimNbNext() {
  var nb = _aimNewBrand;
  if (nb.step === 1) {
    _aimNbSaveStep1Fields();
    if (!nb.name.trim()) { alert('Please enter a brand name.'); return; }
    if (!nb.url.trim())  { alert('Please enter a website URL.'); return; }
    if (!nb.industry)    { alert('Please select an industry.'); return; }
    nb.step = 2;
    nb._scanning = true;
    nb._detectedPool = null;
    nb._compsGenerated = null;
    _aimNbRender();
    _aimNbScanWebsite();
  } else if (nb.step === 2) {
    nb.step = 3;
    _aimNbRender();
    if (nb.prompts.length === 0) { aimNbGeneratePrompts(); }
  } else if (nb.step === 3) {
    _aimNbCreateBrand();
  }
}

function _aimNbScanWebsite() {
  var nb = _aimNewBrand;
  var url = (nb.url || '').trim();
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  var done = false;
  var fallbackTimer = setTimeout(function() {
    if (!done) { done = true; _aimNbFinishScan('', ''); }
  }, 5000);
  fetch('https://api.microlink.io/?url=' + encodeURIComponent(url))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!done) {
        done = true;
        clearTimeout(fallbackTimer);
        var title = (data && data.data && data.data.title) || '';
        var desc  = (data && data.data && data.data.description) || '';
        _aimNbFinishScan(title, desc);
      }
    })
    .catch(function() {
      if (!done) { done = true; clearTimeout(fallbackTimer); _aimNbFinishScan('', ''); }
    });
}

function _aimNbFinishScan(title, desc) {
  var nb = _aimNewBrand;
  var domain = (nb.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].toLowerCase();
  // Use real fetched page data + domain + brand name only (not generic auto-fill description)
  var allText = (title + ' ' + desc + ' ' + domain + ' ' + (nb.name||'')).toLowerCase();
  var has = function(w) { return allText.indexOf(w) !== -1; };

  var pool = null;
  // ai-visibility: word-level matching — words don't need to be adjacent
  if (has('peekaboo') || has('otterly') || has('profound') || has('aimondo') ||
      (has('ai') && (has('visibility') || has('mentions') || has('brand tracking'))) ||
      (has('ai') && has('monitoring') && (has('brand') || has('search') || has('llm'))) ||
      (has('llm') && (has('visibility') || has('monitoring') || has('tracking') || has('mention'))) ||
      (has('generative') && (has('visibility') || has('presence') || has('monitoring'))) ||
      has('ai search visibility') || has('brand in ai') || has('ai responses') ||
      has('share of voice') && has('ai')) {
    pool = 'ai-visibility';
  } else if (has('hotel') || has('resort') || has('lodge') || has('inn') || has('hostel') || has('motel') || has('luxury hotel') || has('boutique hotel') || has('bed and breakfast')) {
    pool = 'hospitality';
  } else if (has('airline') || has('cruise') || has('travel agency') || has('vacation') || has('holiday packages') || has('tour operator') || has('flight booking')) {
    pool = 'travel';
  } else if (has('restaurant') || has('cafe') || has('bistro') || has('food delivery') || has('meal kit') || has('catering') || has('bakery') || has('takeaway') || has('eatery')) {
    pool = 'food';
  } else if (has('real estate') || has('homes for sale') || has('property listing') || has('mortgage') || has('apartment rental') || has('condo')) {
    pool = 'realestate';
  } else if (has('fashion') || has('clothing brand') || has('apparel') || has('luxury fashion') || has('designer')) {
    pool = 'retail';
  } else if (has('news') || has('media company') || has('magazine') || has('broadcasting') || has('streaming service') || has('entertainment platform')) {
    pool = 'media';
  } else if (has('hospital') || has('clinic') || has('medical') || has('pharmacy') || has('healthcare') || has('telehealth') || has('mental health')) {
    pool = 'healthcare';
  } else if (has('bank') || has('insurance') || has('fintech') || has('payment') || has('lending') || has('investment platform')) {
    pool = 'fintech';
  } else if (has('shipping') || has('logistics') || has('freight') || has('courier') || has('supply chain') || has('fulfillment') || has('warehouse')) {
    pool = 'logistics';
  } else if (has('university') || has('college') || has('online learning') || has('e-learning') || has('education platform') || has('online course')) {
    pool = 'education';
  } else if (has('cybersecurity') || has('threat detection') || has('firewall') || has('data protection') || has('security software')) {
    pool = 'security';
  } else if (has('seo') || has('rank tracking') || has('backlink') || has('keyword research') || has('search engine optimization')) {
    pool = 'seo';
  } else if (has('crm') || has('sales pipeline') || has('customer relationship') || has('lead management')) {
    pool = 'crm';
  } else if (has('email marketing') || has('marketing automation') || has('newsletter platform')) {
    pool = 'marketing';
  } else if (has('project management') || has('task management') || has('team collaboration')) {
    pool = 'project';
  } else if (has('ecommerce') || has('e-commerce') || has('online store') || has('shopify') || has('woocommerce')) {
    pool = 'ecommerce';
  }

  nb._detectedPool = pool;

  // Industry selection as final deterministic fallback
  if (!nb._detectedPool) {
    var iMap = {
      'Travel & Hospitality':'hospitality','Food & Beverage':'food','Fashion & Apparel':'retail',
      'Retail':'retail','Media & Publishing':'media','Real Estate':'realestate',
      'Healthcare':'healthcare','Finance & Fintech':'fintech','Education':'education',
      'Marketing & SEO':'seo','AI & Machine Learning':'ai-ml','Cybersecurity':'security',
      'Professional Services':'crm','SaaS & Software':null,
    };
    nb._detectedPool = iMap[nb.industry] || null;
  }
  nb._scanning = false;
  nb._compsGenerated = null;
  _aimNbRender();
}

function _aimNbCreateBrand() {
  // Local-only mirror: brand creation is NOT sent to aipeekaboo.com. We just
  // confirm the flow with a success toast (matches the rest of the mirror,
  // which never writes to the real API).
  var nb = _aimNewBrand;
  var name = nb.name || 'Brand';
  aimCloseAddBrand();
  setTimeout(function() {
    var toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:11px 20px;border-radius:9px;font-size:13px;font-weight:500;font-family:\'Inter\',system-ui,-apple-system,sans-serif;z-index:9999;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);';
    toast.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><b>' + aimEscHtml(name) + '</b>&nbsp;configured. (Local preview: nothing was sent to aipeekaboo.com)';
    document.body.appendChild(toast);
    setTimeout(function(){ toast.style.opacity='0'; toast.style.transition='opacity .4s'; setTimeout(function(){ toast.remove(); },400); }, 3400);
  }, 300);
}


window.PBAddBrand = { open: aimOpenAddBrand };
