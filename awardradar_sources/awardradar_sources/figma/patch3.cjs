const fs = require('fs')
let content = fs.readFileSync('src/App.tsx', 'utf8')

// We need to restore the light theme border
const lightStart = content.indexOf('light: {')
const lightEnd = content.indexOf('} as const', lightStart)

let lightPart = content.substring(lightStart, lightEnd)
lightPart = lightPart.replace(/instrBorder:        'rgba\(255,255,255,0\.06\)'/, "instrBorder:        'rgba(0,0,0,0.06)'")
lightPart = lightPart.replace(/instrBorderTop:     'rgba\(255,255,255,0\.08\)'/, "instrBorderTop:     'rgba(0,0,0,0.08)'")

content = content.substring(0, lightStart) + lightPart + content.substring(lightEnd)
fs.writeFileSync('src/App.tsx', content)
