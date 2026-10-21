# AGENTS.md

给接手这个仓库的 AI 的入口索引：只做文档路由、一句话硬规则和必跑命令。
细节全部在 `docs/GUIDE.md`——**当前事实与全部开发规程以 README.md 和它为准**，
本文件与它们冲突时以它们为准。

GNOME Shell 扩展：把应用文件夹弹窗里的网格每页的行数、列数开放为设置项（默认 4×6 = 一页
24 个图标），并让所有文件夹共用同一个格子边长。只作用于应用文件夹网格（App Folder Grid），
不影响启动器网格（App Grid）。

## 文档路由

GUIDE 按读者的问题组织，四个部分：机制（推导链与全部边界声明）→ 开发（四小节：构建命令与
依赖——安装与打包在同一个小节、隔离嵌套会话、改 `prefs.js`——设置语义与界面实测坑都在其中、
改 `extension.js`）→ 产物约定 → 常见问题。小节标题是「部分名 · 子题」，引用一律照抄完整标题；
「机制 · 已知限制与兼容性」是全仓库边界声明的唯一去处。

| 任务                            | 先读 GUIDE.md 的小节                            |
|---------------------------------|-------------------------------------------------|
| 任何代码改动                    | 「开发」                                        |
| 尺寸推导、行列数行为            | 「机制」各小节（含「机制 · 已知限制与兼容性」） |
| 设置界面 `prefs.js`             | 「开发 · 改 prefs.js」                          |
| schema / dconf / 设置读写       | 「开发 · 改 prefs.js」「开发 · 构建命令与依赖」 |
| 构建、打包、安装、重登范围      | 「开发 · 构建命令与依赖」                       |
| 「加载不上 / 改了没反应」类排查 | 「常见问题」「机制 · 已知限制与兼容性」         |
| 某个补丁为什么这样写            | 「机制」各小节、「开发 · 改 extension.js」      |

`docs/HISTORY.md` 是给人看的过程档案，**不要主动去读它**；其中的键名、数字、文案不少是**当时的
状态**、后来被改过——任何结论以 GUIDE 的描述为准，不要从推导记录里取「现状」。

## 硬规则（一句话版，出处都在 GUIDE）

1. **验证一律在隔离嵌套会话里做**，启动配方与 dconf 陷阱见「开发 · 隔离嵌套会话」；能被无头
   会话复现的才算测过，量出的数字才可信。
2. **打包不走 `gnome-extensions pack`**——它丢弃 `gschemas.compiled`（`Gio.Settings` 只认编译
   产物）且在本机 segfault；用 `make zip` / `make install`，schema 先 `make compile`。
3. **gjs 只有 `log` / `logError`**：没有 `console`、`logWarn`，`catch` 里用错会把 `enable()` 打挂。
4. **读 GObject 属性用驼峰**（`lm.columnsPerPage`），连字符名报错；actor 未分配时 allocation 是
   `-Infinity`，弹窗必须真正打开才有几何数据。
5. **libadwaita 1.10 实测限制**：`Adw.PreferencesGroup` 无 `footer`；`get_suffixes()` 返回空
   （验证要看构建出的 widget 树）；group 标题里裸 `&` 静默渲染空白，必须写 `&amp;`；后缀插槽
   方法是 `add_suffix()` 而非 `add_end()`。都在「开发 · 改 prefs.js」。
6. **`<range>` 是读时强制**，越界值留在 dconf 里不改写、读回默认值——不要「顺手修正」用户的 dconf。
7. **语言与引用规矩**：界面/schema/代码里的字符串是英文，仓库文档与注释（含 schema XML 注释、
   `.gitignore`）是中文——唯一例外是 `README.en.md`，它是 `README.md` 的英文翻译、冲突以中文版
   为准；注释的「为什么」引用 `docs/GUIDE.md「小节名」` 且照抄完整标题、事实以 GUIDE 已有描述
   为准；GUIDE 小节之内不开 `####`，再分块用粗体引导句；纯注释改动用字符串感知的去注释行级 diff
   证明代码逐字不变。都在「产物约定」。
8. **prose 里不声明支持的 GNOME 版本**——唯一版本声明在 `metadata.json`，加载判定是主版本号
   前缀匹配。**本仓库内容均由 AI 生成**，文档涉及来源时如实说明（「产物约定」）。

## 命令

```sh
make check     # 提交前必跑：node 语法检查 + schema --strict 编译
make compile   # 改过 *.gschema.xml 后必须执行
make zip       # 产物含编译后 schema 与 README 中英文/GUIDE
make install   # 装到 ~/.local/share/gnome-shell/extensions/，extension.js/schema 改动需注销重登
```

## 文档维护约定

- 每新增一个功能改动：关键信息（结论、规则、常数、坑）写进 GUIDE 的对应小节，
  过程信息（推导、试错、实测数据）按时间追加进 HISTORY——HISTORY 只写新的过程，不去读它。
- 改 GUIDE 小节名必须同步全仓库指针（含代码注释里的 `「小节名」`）。
- 本文件只保留一句话规则＋GUIDE 小节名的指针；细节变化时先改 GUIDE，再同步这里的摘要，
  面向 AI 的实测坑留在 GUIDE，不要让本文件长回细节全文。
