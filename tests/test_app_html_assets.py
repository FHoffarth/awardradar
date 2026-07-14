import os
import re

def test_app_html_assets():
    """
    Ensure that templates/app.html references built app_ui assets
    that actually exist in the static/app_ui/assets directory.
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app_html_path = os.path.join(base_dir, "templates", "app.html")
    assets_dir = os.path.join(base_dir, "static", "app_ui", "assets")
    
    assert os.path.exists(app_html_path), "templates/app.html not found"
    assert os.path.exists(assets_dir), "static/app_ui/assets directory not found"
    
    with open(app_html_path, "r", encoding="utf-8") as f:
        content = f.read()
        
    js_matches = re.findall(r'src="/static/app_ui/assets/(index-[A-Za-z0-9_.-]+\.js)"', content)
    css_matches = re.findall(r'href="/static/app_ui/assets/(index-[A-Za-z0-9_.-]+\.css)"', content)
    
    assert len(js_matches) == 1, f"Expected exactly one JS asset match in app.html, got {len(js_matches)}"
    assert len(css_matches) == 1, f"Expected exactly one CSS asset match in app.html, got {len(css_matches)}"
    
    js_filename = js_matches[0]
    css_filename = css_matches[0]
    
    js_path = os.path.join(assets_dir, js_filename)
    css_path = os.path.join(assets_dir, css_filename)
    
    assert os.path.exists(js_path), f"Stale JS hash in app.html: {js_filename} does not exist in {assets_dir}"
    assert os.path.exists(css_path), f"Stale CSS hash in app.html: {css_filename} does not exist in {assets_dir}"

