#!/usr/bin/env python3
"""
Build live-app/index.html from the captured static dashboard so the live
(API-driven) app uses the EXACT same design (real compiled CSS, Geist fonts,
real sidebar + header markup). We keep the shell and replace only the main
content region with <main id="view"> that the SPA renders into.

Run:  python3 build_shell.py
"""
import re
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "app", "dashboard.html")

with open(SRC, encoding="utf-8") as f:
    html = f.read()

# 1. strip ?dpl=... cache-busting query from asset URLs (we serve them locally)
html = re.sub(r'\?dpl=[^"\']*', '', html)

# 2. remove ALL <script> tags (no Next.js hydration; our SPA scripts added later)
html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.DOTALL)
html = re.sub(r"<script\b[^>]*/>", "", html)
# remove next preload <link as=script>
html = re.sub(r'<link\b[^>]*as="script"[^>]*>', "", html)

# 3. Inside <main>, KEEP the sticky <header> (the topbar) and replace only the
#    content that follows it with our #view mount point.
mstart = html.find("<main")
mtagend = html.find(">", mstart) + 1
depth = 0
for m in re.finditer(r"<(/?)main", html[mstart:]):
    if m.group(1) == "":
        depth += 1
    else:
        depth -= 1
    if depth == 0:
        mclose = mstart + m.start()
        break
main_open = html[mstart:mtagend]

# locate the header element inside main and keep it verbatim
hstart = html.find("<header", mtagend)
header_html = ""
content_after = mtagend
if hstart != -1 and hstart < mclose:
    hdepth = 0
    for m in re.finditer(r"<(/?)header", html[hstart:]):
        if m.group(1) == "":
            hdepth += 1
        else:
            hdepth -= 1
        if hdepth == 0:
            hend = hstart + m.end() + html[hstart + m.end():].find(">") + 1
            break
    header_html = html[hstart:hend]
    content_after = hend

new_main = (
    main_open + header_html +
    # bare mount: the dashboard injects the captured `container mx-auto pb-8 px-4`
    # wrapper itself; other views get padding via a CSS :has() fallback.
    '\n<div id="view"></div>\n</main>'
)
html = html[:mstart] + new_main + html[mclose + len("</main>"):]

# 4. Rewrite sidebar nav hrefs (static .html routes) -> SPA hash routes.
ROUTE = {
    "/dashboard.html": "#/dashboard",
    "/prompts.html": "#/prompts",
    "/competitors.html": "#/competitors",
    "/sources.html": "#/sources",
    # leave the rest pointing at the static mirror so they still show *something*
}
for stat, hashr in ROUTE.items():
    html = html.replace('href="%s"' % stat, 'href="%s"' % hashr)
# the home/logo link
html = html.replace('href="/dashboard.html"', 'href="#/dashboard"')

# 5. Inject our head assets (fonts already via real CSS) — add Chart.js, Lucide,
#    a tiny live-overrides stylesheet, before </head>.
head_inject = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">'
    '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>'
    '<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>'
    '<link rel="stylesheet" href="/assets/live-overrides.css">'
)
html = html.replace("</head>", head_inject + "</head>")

# 6. Inject our SPA scripts before </body>.
body_inject = (
    '<script src="/assets/api.js"></script>'
    '<script src="/assets/app.js"></script>'
    '<script src="/binders/visibility.js"></script>''<script src="/binders/competitors.js"></script>''<script src="/binders/sources.js"></script>''<script src="/binders/recentchats.js"></script>''<script src="/views/dashboard.js"></script>'
    '<script src="/views/competitors.js"></script>'
    '<script src="/views/prompts.js"></script>'
    '<script src="/views/prompt-detail.js"></script>'
    '<script src="/views/sources.js"></script>'
    '<script src="/views/categories.js"></script>'
    '<script>window.PB && window.PB.boot && window.PB.boot();</script>'
)
html = html.replace("</body>", body_inject + "</body>")

with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
    f.write(html)

print("index.html rebuilt from captured shell (%d bytes)" % len(html))
