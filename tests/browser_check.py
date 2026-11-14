"""Run with Python and Playwright. Pass --screenshots DIRECTORY to capture comparisons."""
import argparse
import functools
import http.server
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SIZES = [(1366, 768), (1280, 720), (390, 844)]


def pick(page, answer):
    page.locator("#work .choice").filter(has_text=answer).click()


def check_layout(page, width, height, state):
    metrics = page.evaluate("""() => {
      const root = document.documentElement;
      const items = [...document.querySelectorAll('.choice,.clickable,.latest-proof')];
      return {
        width: root.scrollWidth, height: root.scrollHeight,
        clipped: items.some(x => x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1)
      };
    }""")
    assert metrics["width"] <= width and not metrics["clipped"], (state, metrics)
    if width >= 1000:
        assert metrics["height"] <= height, (state, metrics)


def exercise(page, url, width, height, screenshots):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url)
    if screenshots:
        page.screenshot(path=screenshots / f"after-{width}x{height}.png", full_page=True)

    for level, build_count, find_count in [("basic", 8, 8), ("advanced", 13, 8)]:
        page.locator("#buildTab").click()
        page.locator(f"#{level}Tab").click()
        for index in range(build_count):
            steps = page.evaluate("cur().steps")
            for step in steps:
                check_layout(page, width, height, (level, index, step["label"]))
                pick(page, step["wrong"][0])
                assert page.locator(".feedback").inner_text() == "ヒント　" + step["why"]
                check_layout(page, width, height, (level, index, "hint"))
                pick(page, step["correct"])
            assert page.locator(".success").is_visible()
            if index == 0:
                page.get_by_role("button", name="順番チャレンジ", exact=True).click()
                for step in steps:
                    pick(page, step["correct"])
                assert page.locator(".success").is_visible()
                assert page.locator("#questMeterBar").evaluate("(bar) => bar.style.width") == "100%"
            page.locator("#work").get_by_role("button", name="次の問題へ").click()

        page.locator("#findTab").click()
        for index in range(find_count):
            mission = page.evaluate("cur()")
            wrong = mission["wrong"]
            check_layout(page, width, height, mission["id"])
            page.locator(".proof-line.clickable").nth((wrong + 1) % len(mission["lines"])).click()
            assert mission["focus"] in page.locator(".feedback").inner_text()
            page.locator(".proof-line.clickable").nth(wrong).click()
            check_layout(page, width, height, (mission["id"], "reason"))
            pick(page, page.evaluate("FIND_REASON[cur().id]"))
            check_layout(page, width, height, (mission["id"], "repair"))
            pick(page, mission["fix"])
            assert page.locator(".notebook .done").inner_text().endswith(mission["fix"])
            check_layout(page, width, height, (mission["id"], "success"))
            page.locator("#work").get_by_role("button", name="次の問題へ").click()

    page.reload()
    assert "証明 8/8" in page.locator("#stats").inner_text()
    assert "誤り探し 8/8" in page.locator("#stats").inner_text()
    assert page.evaluate("progress.build.basic.b08.order.date") == "2025-01-01T00:00:00.000Z"
    assert not errors, errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    if args.screenshots:
        args.screenshots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as directory:
        preview = Path(directory)
        (preview / "before.html").write_bytes(
            subprocess.check_output(["git", "show", "fb06c4f:index.html"], cwd=ROOT)
        )
        (preview / "index.html").write_bytes((ROOT / "index.html").read_bytes())
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=directory)
        with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            url = f"http://127.0.0.1:{server.server_port}"
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(channel=os.environ.get("PROOF_BROWSER", "chrome"))
                    for width, height in SIZES:
                        page = browser.new_page(viewport={"width": width, "height": height})
                        if args.screenshots:
                            page.goto(f"{url}/before.html")
                            page.screenshot(path=args.screenshots / f"before-{width}x{height}.png", full_page=True)
                            page.locator("#findTab").click()
                            assert page.locator(".clickable").count() == 5
                        page.goto(url)
                        page.evaluate("""localStorage.setItem('shoumei-builder-v4-buttons', JSON.stringify({
                          build: {basic: {b08: {order: {date:'2025-01-01T00:00:00.000Z', misses:0,hints:0}}},advanced:{}},
                          find: {basic:{},advanced:{}}
                        }))""")
                        page.reload()
                        assert "順番チャレンジ 1/8" in page.locator("#stats").inner_text()
                        exercise(page, url, width, height, args.screenshots)
                        page.close()
                        print(f"PASS {width}x{height}", flush=True)
            finally:
                server.shutdown()


if __name__ == "__main__":
    main()
