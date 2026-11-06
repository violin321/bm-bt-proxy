---
name: BM-BT-Proxy · 素白运行台
description: 白色横向导航、冷浅灰工作面与蓝色操作组成的多源运行控制台。
colors:
  primary: "#3159b7"
  primary-hover: "#24489c"
  primary-soft: "#eaf0ff"
  canvas: "#f6f7f9"
  surface: "#fff"
  ink: "#202428"
  muted: "#626b76"
  line: "#e3e7ec"
  control-border: "#d8dde1"
  quiet-control: "#eef0f4"
  tag-neutral: "#eef0f2"
  tag-ink: "#59616a"
  success: "#236444"
  success-bg: "#eaf4ee"
  error: "#b12f38"
  error-bg: "#fff0f1"
  warning: "#936322"
  warning-bg: "#faf1e0"
  partial: "#b78540"
  chart: "#6c8bcc"
  focus: "#6386d8"
  login-surface: "#edf2fc"
  toast: "#232527"
typography:
  display:
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "38px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "29px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  title:
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  body:
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "12px"
    fontWeight: 550
    lineHeight: 1.6
  metric:
    fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.035em"
  mono:
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  micro-mobile:
    fontSize: "9px"
  micro:
    fontSize: "10px"
  small:
    fontSize: "11px"
  supporting:
    fontSize: "13px"
  dashboard-title:
    fontSize: "15px"
  confirm-title:
    fontSize: "19px"
  dialog-title:
    fontSize: "20px"
  compact-brand:
    fontSize: "21px"
  brand:
    fontSize: "23px"
  headline-mobile:
    fontSize: "26px"
  metric-tablet:
    fontSize: "27px"
  metric-mobile:
    fontSize: "28px"
rounded:
  chip: "4px"
  inset: "5px"
  login-hub: "6px"
  control: "7px"
  emblem: "8px"
  diagnostics: "9px"
  surface: "12px"
  drawer: "14px"
  toggle: "20px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  card-y: "18px"
  card-x: "20px"
  panel: "24px"
  dialog-x: "28px"
  section: "30px"
  column: "34px"
  desktop-gutter: "44px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  navigation-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  tag:
    backgroundColor: "{colors.tag-neutral}"
    textColor: "{colors.tag-ink}"
    rounded: "{rounded.chip}"
    padding: "3px 7px"
  source-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "18px 20px"
  segmented:
    backgroundColor: "{colors.quiet-control}"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "3px"
---

# Design System: BM-BT-Proxy

## Overview

**Creative North Star: "素白运行台"**

白色横向导航、冷浅灰工作面和蓝色操作组成清楚、克制的运行控制台。数字、趋势与源响应通过文字层级、细分隔线和留白组织；白色容器只承载需要独立阅读或编辑的内容。用户已选择这套蓝白方向。

界面保持中文系统字体的可读性，辅以 Avenir Next 的数字与拉丁字形。配置和原始数据使用等宽字体，运行数据采用等宽数字。状态以颜色、文字和数值共同表达，保留未知、空记录、失败与重试的明确位置。

**Key Characteristics:**

- 白色横向导航与冷浅灰工作面。
- 蓝色承担操作、选中态与请求趋势。
- 细分隔线、紧凑标签与醒目数字构成信息层级。
- 白色源卡片和短历史段连接概览与配置。
- 桌面并排、手机顺排，保留相同的核心操作。

本文件按 scan 模式提取当前实现。样式依次加载 `app/static/theme.css`、`app/static/dashboard.css`，后者及更高特异性的规则决定最终结果；页面依据 `app/static/index.html`、`app/static/login.html`，方向依据 `PRODUCT.md` 与 `docs/frontend.brief.md`。实际桌面和手机截图位于 `.impeccable/review/`。前置 token 是规范值，正文说明应用关系；不要从较早的未采用方向推导当前样式。

## Colors

配色以冷白和浅灰为底，蓝色集中在操作与选中关系，绿、赭黄、红只说明响应结果。

### Primary

- **运行蓝**（`primary`）：主按钮、当前导航、链接、源图标与图表图例。
- **深运行蓝**（`primary-hover`）：主操作悬停时加深，保持同一色相。
- **浅蓝底**（`primary-soft`）：当前导航、源图标底板和统计提示。
- **趋势蓝**（`chart`）：柱形趋势的静态填色；悬停切换为运行蓝。
- **焦点蓝**（`focus`）：共享键盘焦点轮廓。

### Neutral

- **冷浅灰工作面**（`canvas`）：控制台连续背景。
- **素白表面**（`surface`）：导航、表单、源卡片和弹窗。
- **深墨文字**（`ink`）：标题、指标、正文与当前分段文字。
- **蓝灰辅文**（`muted`）：说明、时间、单位、未选中导航与次要值。
- **细分隔灰**（`line`）：结构线、表格行线与容器边界。
- **字段边灰**（`control-border`）：输入字段的静态描边。
- **控件浅灰**（`quiet-control`）：分段控件底板和请求表头。
- **标签灰底／灰字**（`tag-neutral`、`tag-ink`）：非状态型元数据标签。
- **登录浅蓝面**（`login-surface`）：桌面登录页叙事区域。
- **提示深底**（`toast`）：短暂反馈条的反白底色。

### Status

- **响应绿**（`success`、`success-bg`）：成功文字、状态点、结果构成和历史段；浅底用于正向标签。
- **错误红**（`error`、`error-bg`）：失败文字、历史段、危险操作与错误提示底。
- **提醒赭黄**（`warning`、`warning-bg`）：部分成功文字及其提醒语义；构成条与历史段使用 `partial`。

**The Action Blue Rule.** 蓝色建立操作和选中关系；请求成功、部分成功、失败保持各自状态色，并同时显示可读文字。

## Typography

**Display Font:** Avenir Next，回退至 PingFang SC、Microsoft YaHei 和 sans-serif。

**Body Font:** 与 Display 相同。

**Label/Mono Font:** SFMono-Regular，回退至 Consolas、Liberation Mono 和 monospace，仅用于代码、原始 JSON 和配置文本。

**Character:** 文字清楚、紧凑而温和。标题轻微收紧字距；主指标通过尺寸和留白突出，避免将所有数字变成等宽代码文本。

### Hierarchy

- **Display**（`typography.display`）：桌面登录叙事标题；随窗口降为（32px／28px）。
- **Headline**（`typography.headline`）：控制台页面标题；手机为（26px）。登录表单标题为（26px）。
- **Title**（`typography.title`）：通用分区标题；运行概览分区为（15px），手机为（14px）。
- **Body**（`typography.body`）：基础文字；页面说明常用（13px），手机常用（12px）。
- **Label**（`typography.label`）：按钮、字段名和紧凑操作。辅文使用（10–12px），根据层级安排。
- **Metric**（`typography.metric`）：主要运行指标；手机为（28px）。时间、耗时和结果数设置 `tabular-nums`。
- **Mono**（`typography.mono`）：请求配置与 JSON；长内容允许折行或局部滚动，不能挤压主布局。

前置字号角色同时包含紧凑辅文、状态文字、品牌、弹窗及响应式指标。`micro-mobile`、`micro`、`small`、`supporting` 用于紧凑信息；`dashboard-title`、`confirm-title`、`dialog-title` 区分分区与模态层；`compact-brand`、`brand` 区分品牌尺寸；`headline-mobile`、`metric-tablet`、`metric-mobile` 对应实际响应式尺寸。仅提供字号的角色沿用所在组件的字族、字重与行高。

**The Readable Data Rule.** 指标保持系统无衬线字体和等宽数字；只有配置与原始数据进入等宽字族。

## Layout

当前控制台采用顶部横向导航。桌面页头最小高（84px），品牌、导航和退出操作同排；内容区居中，最大宽度（1440px），内部左右留白（44px）。同步状态独立放在页头下方。宽屏（1600px 起）调整页头内边距并将主内容顶部留白增加至（30px）。

运行概览四项指标通过上下线和竖线组成连续指标带。趋势与结果构成按（1.85:1）并排，列间距使用 `spacing.column`；源概览为两列白色卡片；最近请求使用平面列表。此处是当前页面的空间表达，新页面沿用层级与密度，不必复制相同组成。

主要断点为（1200px、1100px、800px、650px），详见 sidecar。到（1100px）趋势与右侧比例收紧为（1.6:1），源管理主工作区改单列；到（800px）主内容左右留白为（24px），导航图标隐藏。到（650px）品牌与退出在首行，四项横向导航在第二行，仍位于页面顶部；主内容左右留白为（17px）。指标带变为两列，趋势与构成顺排，源卡片变为单列，请求列表保留时间、关键词、状态和耗时，完整数据在详情中查看。

桌面登录为叙事区与表单区双列；手机隐藏叙事区、显示紧凑品牌和单列表单。源编辑使用右侧原生 dialog 抽屉，双字段行在小屏改单列，保留可滚动内容与固定首尾区域。间距以（8–24px）的组件节奏和（28–34px）的区块节奏构成。

## Elevation & Depth

默认表面平直，以底色、细边线和间距分组。源卡片和表格不使用悬浮阴影。深度只帮助分段选中态、短暂反馈和模态编辑表达层级。

### Shadow Vocabulary

- **分段选中**（`0 1px 3px #20242813`）：白色分段按钮从浅灰底板轻微抬起。
- **短暂反馈**（`0 6px 24px #1a20202b`）：底部 toast 与工作面分离。
- **模态层**（`0 10px 48px #11182026`）：原生 dialog 配合半透明遮罩（`#17212c70`）。

**The Flat Workspace Rule.** 运行内容以细线和色面组织；阴影保留给选中控件和浮层。

## Shapes

轮廓以轻圆角矩形为主。白色容器使用 `rounded.surface`，按钮、导航、分段底板与输入字段使用 `rounded.control`，标签使用 `rounded.chip`，源图标底板使用 `rounded.emblem`。分段内部选中块采用 `rounded.inset`。源编辑抽屉仅左侧两个角使用 `rounded.drawer`，贴靠窗口右边缘。

登录关系图中心块使用 `rounded.login-hub`，诊断结果容器使用 `rounded.diagnostics`，启停开关轨道使用 `rounded.toggle`。

普通边线为（1px）；状态点是小圆点，构成条和历史短段保留小圆角。图标使用线性 SVG，默认描边（1.65px），操作按钮内常为（17px）；避免用装饰图形代替状态文字。

## Components

### Buttons

清楚而克制的操作块。主按钮使用运行蓝与白字，普通按钮使用白底、深墨字和细描边，弱操作透明，危险操作使用错误红。默认最小高（42px）；表单主操作至少（44px），登录操作（46px）。内边距和圆角见 token。主按钮悬停加深；普通按钮悬停变浅灰并加深边线；弱操作悬停出现灰底。默认颜色过渡为（0.18s），键盘焦点使用共享轮廓；禁用时透明度（0.55）并显示等待光标。

### Inputs / Fields

白色字段、轻圆角与静态细描边，最小高（44px）。字段名在上，间距（8px）；说明位于下方，长配置使用等宽多行文本。悬停加深边线，共享键盘焦点轮廓为（3px）、外移（3px）。密码复合字段在容器上显示同样焦点。源列表筛选容器在 `focus-within` 时使用运行蓝边框与焦点蓝轮廓；筛选图标和页脚沿用蓝灰辅文。

### Navigation

顶部横向文字导航，默认蓝灰字，悬停为冷浅灰底与深墨字；当前页为浅蓝底和运行蓝字，图标同步着色。桌面文字（13px），手机（11px）；手机在品牌下保留一整行四个入口。当前页由 `aria-current="page"` 表达。

### Chips / Tags

元数据标签紧凑、浅灰底与灰字，采用（10px）文字和小圆角。正向标签切换为响应绿与浅绿底。数量徽标使用更小的低对比灰底块；状态标签同时带文字和圆点，不能只靠底色区分结果。

### Cards / Containers

源概览卡片使用白底、细线和轻圆角，无阴影。桌面内边距见 `source-card`，手机内边距为（17px）。卡片上部承载图标、名称与最近状态，中部为关键数值和进入操作，下部为历史段、时间与编辑链接。搜索和设置容器沿用同一白色材料；设置、搜索常用内边距（24px）。

### Segmented Controls

浅灰底板内放白色选中块，选中块以轻微阴影表达层级。内部按钮圆角更小，基础最小宽（57px），统计范围控件在手机收紧。由 `aria-pressed` 表达选择，键盘焦点沿用共享轮廓。

### Source History

历史由一排短段组成，间距（3px），高（13px），单段最大宽（20px）、圆角（2px）、透明度（0.7）。成功、部分成功与失败使用对应状态色；没有记录时显示文字。每段只表示已完成的请求，未知不补成成功；配置变更后的待测试状态保持可读。

### Dialogs / Drawers

源编辑为宽（550px）的右侧抽屉，最大不超过视口，整屏高（100dvh）。内容可滚动，首尾操作区域分隔清楚。请求详情宽（740px）、最大高（90dvh），确认弹窗宽（420px），均在窄屏保留两侧空间。抽屉以（0.2s）、`cubic-bezier(0.16, 1, 0.3, 1)` 进入；减少动态效果偏好沿用实现中的动画与过渡抑制。

## Do's and Don'ts

### Do:

- **Do** 延续白色顶部横向导航、冷浅灰工作面和蓝色操作。
- **Do** 用字体层级、细分隔线和间距组织运行信息。
- **Do** 同时使用状态文字、数字和颜色说明实际响应结果。
- **Do** 让未知和空记录保留明确位置，并让失败反馈可见。
- **Do** 在手机保留导航、源编辑、搜索与设置操作，并在详情中呈现完整数据。
- **Do** 保留可见的键盘焦点和减少动态效果偏好。

### Don't:

- **Don't** 将此前未采用的深色侧栏或锈橙主操作恢复成当前视觉系统。
- **Don't** 给每个运行区块加阴影或额外装饰卡片。
- **Don't** 用绿色历史段填补未知记录，或将最近成功暗示为持续在线。
- **Don't** 让长地址、配置或原始 JSON 撑破窄屏布局。
- **Don't** 把样本数字呈现为真实统计，或让颜色成为状态的唯一表达。
