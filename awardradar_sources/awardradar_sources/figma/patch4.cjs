const fs = require('fs')

let css = fs.readFileSync('src/index.css', 'utf8')

// Adjust field label typography
css = css.replace(/font-size: 10px;/, "font-size: 9.5px;")
css = css.replace(/letter-spacing: 0\.18em;/, "letter-spacing: 0.22em;")
css = css.replace(/letter-spacing: 0\.19em;/, "letter-spacing: 0.23em;")
css = css.replace(/font-weight: 500;/g, "font-weight: 600;") // there are a few 500s

// Technical code
css = css.replace(/font-size: 12px;/, "font-size: 11px;")
css = css.replace(/letter-spacing: 0\.15em;/, "letter-spacing: 0.18em;")
css = css.replace(/letter-spacing: 0\.16em;/, "letter-spacing: 0.19em;")

// Instrument drop shadow for light theme
// It might be nice to add a subtle shadow
css = css.replace(/\.ar-instrument {/, ".ar-instrument {\n  border-radius: 1px;")

fs.writeFileSync('src/index.css', css)
