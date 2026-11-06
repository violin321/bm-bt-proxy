# 设计钩子逐项处置 · 2026-11-06

本记录对应 Stop hook 的三个文件、206条 design-system 告警。保留用户选择的「素白运行台」，没有因钩子重选风格。

- 修复 4 条声明；补齐规范解决 133 条告警；69 条告警对应 67 个去重例外。
- 每个例外都经 hook-admin.mjs ignore-value 写入，并同时限定具体 rule、具体 value 与具体 file；没有关闭文件或规则，也没有通配值。
- theme.css 的23个例外：被 dashboard.css 覆盖的旧声明、无当前标记的旧导航样式，以及已核对的一次性状态／描边／选择色。两个 prototypes 文件的44个例外：保留的独立风格比较样本，不受当前产品的单一视觉规范约束。
- 最终对原三个文件复扫结果为 []。这是 CSS 静态设计系统检查，不代表完整可访问性或生产验收。
- 定向浏览器验证：可见 Chromium，1440／390宽，筛选焦点实际为蓝色边框与焦点蓝轮廓，页脚为 muted，无横向溢出。截图为 .impeccable/review/hook-sources-{1440,390}.png。业务逻辑没有变更。
- 留存提示：检测器仍提示废弃石墨方向的 COMP_ROUND_OPEN 构建元数据。用户选定的是另一套代码原型；不在本次设计任务中擅自修改流程状态，也不将该旧状态当成当前视觉验收。

| 位置 | 规则 | 值 | 处置 | 依据 |
|---|---|---|---|---|
| `app/static/theme.css:80` | `design-system-font-size` | `27px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:103` | `design-system-color` | `#dce7ff` | 精确值例外 | Agent: intentional text-selection background, paired with #193d88 for readable selected text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:104` | `design-system-color` | `#193d88` | 精确值例外 | Agent: intentional text-selection foreground, paired with #dce7ff. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:128` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:181` | `design-system-font-size` | `23px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:189` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:212` | `design-system-color` | `#303235` | 精确值例外 | Agent: base navigation hover is overridden by dashboard.css .app-header rules; .logout has no current markup. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:217` | `design-system-color` | `#3a3c3e` | 精确值例外 | Agent: base active navigation is overridden by dashboard.css .app-header .nav-link[aria-current=page]. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:224` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:228` | `design-system-color` | `#4a4c4e` | 精确值例外 | Agent: base navigation badge is overridden by dashboard.css .app-header .nav-count. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:240` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:259` | `design-system-radius` | `6px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:263` | `design-system-color` | `#303235` | 精确值例外 | Agent: base navigation hover is overridden by dashboard.css .app-header rules; .logout has no current markup. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:286` | `design-system-color` | `#b9bdc2` | 精确值例外 | Agent: intentional low-emphasis decorative breadcrumb separator; it is not content text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:298` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:336` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:342` | `design-system-color` | `#70767b` | 修复 | 页脚改用 --muted，统一辅文并提高可读性。 |
| `app/static/theme.css:343` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:372` | `design-system-color` | `#b9bec4` | 精确值例外 | Agent: intentional neutral button hover border, not foreground text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:449` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:480` | `design-system-color` | `#c67450` | 修复 | 筛选焦点边框改用 --accent。 |
| `app/static/theme.css:481` | `design-system-color` | `#e5b59e` | 修复 | 筛选焦点轮廓改用已有 focus 色。 |
| `app/static/theme.css:485` | `design-system-color` | `#747b81` | 修复 | 筛选图标改用 --muted。 |
| `app/static/theme.css:523` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:553` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:562` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:568` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:620` | `design-system-radius` | `20px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:621` | `design-system-color` | `#c7cbd0` | 精确值例外 | Agent: intentional disabled-source toggle track; switch state is also exposed semantically. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:649` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:665` | `design-system-color` | `#939ba2` | 精确值例外 | Agent: intentional untested status dot, accompanied by explicit status text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:671` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:689` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:696` | `design-system-font-size` | `15px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:729` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:732` | `design-system-font-size` | `15px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:766` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:788` | `design-system-color` | `#9d2630` | 精确值例外 | Agent: intentional stronger error-notice text within the red semantic family. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:789` | `design-system-color` | `#f2cbd0` | 精确值例外 | Agent: intentional error-notice soft border, not foreground text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:809` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:845` | `design-system-color` | `#b3bac0` | 精确值例外 | Agent: intentional field hover border, not foreground text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:848` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:898` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:908` | `design-system-color` | `#7b98d9` | 精确值例外 | Agent: intentional busy-search border within the blue semantic family. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:919` | `design-system-color` | `#a1a8ae` | 精确值例外 | Agent: intentional decorative empty-search SVG, accompanied by full empty-state text. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:925` | `design-system-color` | `#51585f` | 精确值例外 | Agent: intentional darker empty-state heading neutral. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:939` | `design-system-radius` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:965` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1012` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1050` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1060` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1070` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1092` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1098` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1102` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1156` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1216` | `design-system-color` | `#17212c70` | 精确值例外 | Agent: intentional translucent native-dialog backdrop, already documented in Elevation & Depth and sidecar shadows. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:1256` | `design-system-font-size` | `20px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1311` | `design-system-font-size` | `19px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1315` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1358` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1359` | `design-system-color` | `#b9bdc1` | 精确值例外 | Agent: base login paragraph color is overridden by dashboard.css .login-intro>p using --muted. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:1377` | `design-system-color` | `#54575a` | 精确值例外 | Agent: base dark login-diagram border is overridden by dashboard.css .diagram-source. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:1384` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1388` | `design-system-color` | `#d99a7b` | 精确值例外 | Agent: base warm login-diagram dot is overridden by dashboard.css .diagram-source .status-dot. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:1398` | `design-system-color` | `#e3a180` | 精确值例外 | Agent: base warm login hub is overridden by dashboard.css .diagram-hub using --accent. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:1400` | `design-system-radius` | `6px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1417` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1422` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1441` | `design-system-font-size` | `26px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1447` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1466` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1477` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1513` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1596` | `design-system-font-size` | `21px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1620` | `design-system-font-size` | `24px` | 精确值例外 | Agent: base mobile .page-heading h1 size is overridden by later dashboard.css .page-heading h1; this declaration does not set the selected UI heading size. |
| `app/static/theme.css:1665` | `design-system-font-size` | `28px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1706` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1708` | `design-system-radius` | `6px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1719` | `design-system-color` | `#353739` | 精确值例外 | Agent: base mobile active-navigation fill is overridden by dashboard.css .app-header .nav-link[aria-current=page]. Preserved after selected-direction source/screenshot review. |
| `app/static/theme.css:1730` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1733` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1750` | `design-system-font-size` | `25px` | 精确值例外 | Agent: base mobile .page-heading h1 size is overridden by later dashboard.css .page-heading h1; this declaration does not set the selected UI heading size. |
| `app/static/theme.css:1772` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1779` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1839` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1849` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1852` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1855` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1858` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1873` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1876` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1880` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1892` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1895` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1912` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1917` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1924` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1932` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1936` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1939` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1951` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1957` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1963` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1979` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:1991` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2005` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2015` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2020` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2023` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2026` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2030` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2048` | `design-system-font-size` | `20px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2093` | `design-system-font-size` | `26px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2103` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `app/static/theme.css:2118` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-color` | `#b9c0c9` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:3` | `design-system-color` | `#7e9cdd` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:3` | `design-system-radius` | `6px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-radius` | `20px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-font-size` | `19px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:3` | `design-system-font-size` | `20px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:5` | `design-system-radius` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:5` | `design-system-font-size` | `27px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:8` | `design-system-color` | `#16271f` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:8` | `design-system-color` | `#d7efdf` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:8` | `design-system-color` | `#141b1f` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:8` | `design-system-font-size` | `26px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:8` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:8` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:8` | `design-system-font-size` | `25px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-color` | `#eeeee6` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-color` | `#e0e4d7` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-color` | `#eeebe1` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-color` | `#6b5c3e` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-color` | `#d1d5c8` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-color` | `#f5f5ee` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-radius` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:11` | `design-system-radius` | `13px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-radius` | `6px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:11` | `design-system-font-size` | `21px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:11` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:11` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:11` | `design-system-font-size` | `34px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:11` | `design-system-font-size` | `15px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#15212f33` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#17232d65` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#dce4e8` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#253238` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#385c4d` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#f0a59a` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#353a31` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#dfdfd5` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#4d6141` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#6b7065` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-color` | `#0002` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:14` | `design-system-radius` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:14` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:14` | `design-system-font-size` | `19px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:17` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:17` | `design-system-font-size` | `30px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:18` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:18` | `design-system-font-size` | `20px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:18` | `design-system-font-size` | `26px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:18` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/styles/styles.css:18` | `design-system-font-size` | `25px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/styles/styles.css:18` | `design-system-font-size` | `24px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-color` | `#47515f` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-color` | `#a97731` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-color` | `#65483d` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-radius` | `3px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-radius` | `2px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-radius` | `10px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:1` | `design-system-radius` | `6px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:1` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:1` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:1` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:1` | `design-system-font-size` | `15px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:1` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:3` | `design-system-color` | `#27364e` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:5` | `design-system-color` | `#192125` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:5` | `design-system-color` | `#dfbb77` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:5` | `design-system-color` | `#172c24` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:5` | `design-system-font-size` | `28px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:5` | `design-system-font-size` | `31px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:5` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:5` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:7` | `design-system-color` | `#d8a278` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:7` | `design-system-color` | `#aeb8b7` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:7` | `design-system-color` | `#dfac86` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:7` | `design-system-radius` | `11px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:7` | `design-system-font-size` | `21px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:9` | `design-system-font-size` | `26px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:9` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:9` | `design-system-font-size` | `27px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:10` | `design-system-font-size` | `25px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:10` | `design-system-font-size` | `10px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:10` | `design-system-font-size` | `13px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:10` | `design-system-font-size` | `11px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:11` | `design-system-font-size` | `18px` | 精确值例外 | Agent: isolated non-production style comparison intentionally contains alternate visual systems; root DESIGN.md governs the selected app, not those preserved alternatives. |
| `prototypes/dashboard/dashboard.css:12` | `design-system-font-size` | `9px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:12` | `design-system-font-size` | `26px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
| `prototypes/dashboard/dashboard.css:12` | `design-system-font-size` | `27px` | 规范补齐 | 当前实现已有的字号／圆角已进入 DESIGN.md normative token；该值与规范一致，不需要例外。 |
