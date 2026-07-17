import os
import re

def test_runtime_html_assets():
    """
    Ensure that templates/app.html references built app_ui assets
    that actually exist in the static/app_ui/assets directory.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for template_name, static_name in (("landing", "landing"), ("app", "app_ui")):
        html_path = os.path.join(base_dir, "templates", f"{template_name}.html")
        assets_dir = os.path.join(base_dir, "static", static_name, "assets")

        assert os.path.exists(html_path), f"templates/{template_name}.html not found"
        assert os.path.exists(assets_dir), f"static/{static_name}/assets not found"

        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read()

        prefix = re.escape(f"/static/{static_name}/assets/")
        js_matches = re.findall(rf'src="{prefix}(index-[A-Za-z0-9_.-]+\.js)"', content)
        css_matches = re.findall(rf'href="{prefix}(index-[A-Za-z0-9_.-]+\.css)"', content)

        assert len(js_matches) == 1, f"Expected one JS asset in {template_name}.html, got {len(js_matches)}"
        assert len(css_matches) == 1, f"Expected one CSS asset in {template_name}.html, got {len(css_matches)}"
        assert os.path.exists(os.path.join(assets_dir, js_matches[0])), f"Stale JS hash in {template_name}.html"
        assert os.path.exists(os.path.join(assets_dir, css_matches[0])), f"Stale CSS hash in {template_name}.html"

