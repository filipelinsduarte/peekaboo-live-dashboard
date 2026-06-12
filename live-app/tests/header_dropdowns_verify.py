import json
from playwright.sync_api import sync_playwright

results = {"console_errors": [], "checks": {}}
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: results["console_errors"].append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: results["console_errors"].append(str(e)))
    pg.goto("http://localhost:7898/#/dashboard", wait_until="networkidle")
    pg.wait_for_timeout(1500)

    trig = pg.locator(".pb-dd-trigger")
    results["checks"]["trigger_count"] = trig.count()
    if trig.count() >= 2:
        models_btn = trig.nth(0)
        date_btn = trig.nth(1)
        results["checks"]["models_label"] = models_btn.inner_text().strip()
        results["checks"]["date_label"] = date_btn.inner_text().strip()
        st = models_btn.evaluate("""el => { const c = getComputedStyle(el); return {
            h: el.offsetHeight, border: c.borderTopWidth + ' ' + c.borderTopColor,
            radius: c.borderRadius, bg: c.backgroundColor, fs: c.fontSize, pad: c.padding }; }""")
        results["checks"]["models_trigger_style"] = st

        # open models dropdown
        models_btn.click()
        pg.wait_for_timeout(300)
        panel = pg.locator(".pb-dd-panel")
        results["checks"]["panel_open"] = panel.count()
        if panel.count():
            ps = panel.first.evaluate("""el => { const c = getComputedStyle(el); return {
                w: el.offsetWidth, pad: c.padding, radius: c.borderRadius,
                border: c.borderTopWidth + ' ' + c.borderTopColor, shadow: c.boxShadow, bg: c.backgroundColor }; }""")
            results["checks"]["panel_style"] = ps
            items = panel.first.locator(".pb-dd-item")
            results["checks"]["model_items"] = [items.nth(i).inner_text().strip() for i in range(items.count())]
            results["checks"]["active_has_check"] = panel.first.locator(".pb-dd-item-active .pb-dd-check svg").count()
            results["checks"]["sep_count"] = panel.first.locator(".pb-dd-sep").count()
            results["checks"]["favicon_count"] = panel.first.locator("img.pb-dd-fav").count()
            pg.screenshot(path="/tmp/pb_models_open.png")
            # pick ChatGPT
            items.nth(1).click()
            pg.wait_for_timeout(400)
            results["checks"]["models_label_after_pick"] = pg.locator(".pb-dd-trigger").nth(0).inner_text().strip()
            results["checks"]["trigger_has_fav_after_pick"] = pg.locator(".pb-dd-trigger").nth(0).locator("img.pb-dd-fav").count()

        # open date dropdown
        pg.locator(".pb-dd-trigger").nth(1).click()
        pg.wait_for_timeout(300)
        dpanel = pg.locator(".pb-dd-panel")
        if dpanel.count():
            ditems = dpanel.first.locator(".pb-dd-item")
            results["checks"]["range_items"] = [ditems.nth(i).inner_text().strip() for i in range(ditems.count())]
            results["checks"]["range_active_check"] = dpanel.first.locator(".pb-dd-item-active .pb-dd-check svg").count()
            pg.screenshot(path="/tmp/pb_date_open.png")
            ditems.nth(1).click()
            pg.wait_for_timeout(400)
            results["checks"]["date_label_after_pick"] = pg.locator(".pb-dd-trigger").nth(1).inner_text().strip()
        # outside click closes
        pg.locator(".pb-dd-trigger").nth(0).click()
        pg.wait_for_timeout(250)
        pg.mouse.click(700, 500)
        pg.wait_for_timeout(300)
        results["checks"]["panel_closed_on_outside"] = pg.locator(".pb-dd-panel").count() == 0
    b.close()
print(json.dumps(results, indent=2))
