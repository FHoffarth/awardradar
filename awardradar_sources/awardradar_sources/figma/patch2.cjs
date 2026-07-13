const fs = require('fs')

let content = fs.readFileSync('src/App.tsx', 'utf8')

// Adjust opacities in T object
// dark theme
content = content.replace(/eyebrow:            '#CFC7BA',/g, "eyebrow:            'rgba(207,199,186,0.8)',")
content = content.replace(/line2:              '#D6CEC2',/g, "line2:              'rgba(214,206,194,0.7)',")
content = content.replace(/instrLabel:         '#BEB5A8',/g, "instrLabel:         'rgba(190,181,168,0.7)',")
content = content.replace(/instrBorder:        '#3A3D42',/g, "instrBorder:        'rgba(255,255,255,0.06)',")
content = content.replace(/instrBorderTop:     '#3A3D42',/g, "instrBorderTop:     'rgba(255,255,255,0.08)',")
content = content.replace(/fieldLabel:         '#D1C8BB',/g, "fieldLabel:         'rgba(209,200,187,0.6)',")
content = content.replace(/divider:            'rgba\(245,242,236,0\.08\)',/g, "divider:            'rgba(245,242,236,0.05)',")
content = content.replace(/btnBorder:          'rgba\(245,242,236,0\.08\)',/g, "btnBorder:          'rgba(245,242,236,0.05)',")

// light theme
content = content.replace(/eyebrow:            '#756D62',/g, "eyebrow:            'rgba(117,109,98,0.8)',")
content = content.replace(/line2:              '#514A41',/g, "line2:              'rgba(81,74,65,0.7)',")
content = content.replace(/instrLabel:         '#70675C',/g, "instrLabel:         'rgba(112,103,92,0.7)',")
content = content.replace(/instrBorder:        '#3A3D42',/g, "instrBorder:        'rgba(0,0,0,0.06)',")
content = content.replace(/instrBorderTop:     '#3A3D42',/g, "instrBorderTop:     'rgba(0,0,0,0.08)',")
content = content.replace(/fieldLabel:         '#B8B1A7',/g, "fieldLabel:         'rgba(184,177,167,0.7)',")

fs.writeFileSync('src/App.tsx', content)
