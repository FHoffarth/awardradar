const fs = require('fs')

let content = fs.readFileSync('src/App.tsx', 'utf8')

// Adjust PX for more side margin
content = content.replace(/const PX = 'clamp\(52px, 5\.8vw, 92px\)'/, "const PX = 'clamp(64px, 7.5vw, 120px)'")

// Top nav padding
content = content.replace(/paddingTop: '4\.2vh'/, "paddingTop: '5.5vh'")

// Eyebrow typography
content = content.replace(/fontSize: '8\.5px',/g, "fontSize: '10px',")
content = content.replace(/fontWeight: 400,/g, "fontWeight: 500,") // only in eyebrow
content = content.replace(/letterSpacing: '0\.36em',/g, "letterSpacing: '0.24em',")
content = content.replace(/margin: '0 0 48px 0',/g, "margin: '0 0 56px 0',")

// Manifesto typography
content = content.replace(/fontSize: 'clamp\(24px, 2\.4vw, 34px\)',/g, "fontSize: 'clamp(28px, 3vw, 42px)',")
content = content.replace(/fontWeight: 400,/g, "fontWeight: 350,") // manifesto
content = content.replace(/lineHeight: 1\.38,/g, "lineHeight: 1.15,")

// spacing in manifesto couplets
content = content.replace(/margin: '0 0 0\.1em 0',/g, "margin: '0 0 0.15em 0',")
content = content.replace(/margin: '0 0 2\.45em 0',/g, "margin: '0 0 2em 0',")
content = content.replace(/margin: '1\.72em 0 0 0',/g, "margin: '1.4em 0 0 0',")

// Instrument container
content = content.replace(/padding: '21px 40px 18px'/g, "padding: '24px 48px 22px'")
content = content.replace(/width: 'calc\(100% \+ 72px\)'/g, "width: 'calc(100% + 96px)'")
content = content.replace(/flex: '0 0 72px'/g, "flex: '0 0 96px'")

// input typography inside Field
content = content.replace(/fontSize: '19px',/g, "fontSize: '21px',")
content = content.replace(/fontWeight: 480,/g, "fontWeight: 400,")
content = content.replace(/letterSpacing: '-0\.01em',/g, "letterSpacing: '-0.015em',")

// Logo tracking
content = content.replace(/fontSize: '13\.9px',/g, "fontSize: '13px',")
content = content.replace(/fontWeight: 350,/g, "fontWeight: 400,")
content = content.replace(/letterSpacing: '0\.04em',/g, "letterSpacing: '0.06em',")

// Nav links
content = content.replace(/fontSize: '11px',/g, "fontSize: '11.5px',")
content = content.replace(/letterSpacing: '0\.07em',/g, "letterSpacing: '0.09em',")
// fontWeight 350 -> 400
content = content.replace(/fontWeight: 350,\s*letterSpacing: '0\.09em',/g, "fontWeight: 400,\n        letterSpacing: '0.09em',")

fs.writeFileSync('src/App.tsx', content)
