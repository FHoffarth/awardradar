const fs = require('fs')

let content = fs.readFileSync('src/App.tsx', 'utf8')

// Update colors in dark theme
content = content.replace(/eyebrow:\s*'rgba\(207,199,186,0\.8\)',/, "eyebrow:            '#6F7480',")
content = content.replace(/line1:\s*'#F5F2EC',/, "line1:              '#F3F4F6',")
content = content.replace(/line2:\s*'rgba\(214,206,194,0\.7\)',/, "line2:              '#B8BBC3',")
content = content.replace(/lineWhy:\s*'#FFFDF7',/, "lineWhy:            '#F3F4F6',")

// Update lineHeight
content = content.replace(/lineHeight: 1\.15/g, "lineHeight: 1.22")

// Update spacing
content = content.replace(/margin: '0 0 2em 0',/, "margin: '0 0 calc(2em + 24px) 0',")

fs.writeFileSync('src/App.tsx', content)
