const fs = require('fs')

let content = fs.readFileSync('src/App.tsx', 'utf8')

// Adjust Route search label spacing
content = content.replace(/margin: '0 0 10px 0',/, "margin: '0 0 14px 0',")
content = content.replace(/fontSize: '7px',/, "fontSize: '8px',")
content = content.replace(/letterSpacing: '0\.3em',/, "letterSpacing: '0.24em',")

fs.writeFileSync('src/App.tsx', content)
