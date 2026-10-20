# 使用说明（进阶）

[README.md](../README.md) 只回答「这是什么、怎么安装、行列数怎么设置」。这一份承接它：装好之后
还会用到的事实、机制的完整推导、以及全部开发规程都在这里。**当前事实以 README 与本页为准。**

本页按读者的问题组织：标题都是名词短语；部分之下的小节以「部分名 · 」开头，引用时照抄完整
标题即可。四个部分各答一件事：

| 部分     | 回答的问题                                                 |
|----------|------------------------------------------------------------|
| 机制     | 弹窗为什么长这个尺寸、图标为什么这么大；边界声明集中在末节 |
| 开发     | 构建打包、设置读改、动手前的验证规程与实测坑——共四个小节   |
| 产物约定 | 这份仓库怎么维护、内容出自谁                               |
| 常见问题 | 出问题按什么顺序查                                         |

## 机制

这一部分回答「为什么弹窗长这个尺寸、图标为什么是这么大」，顺序就是推导的顺序。先看
**写死与接管**，明白问题出在上游的哪三处；再看 **常数出处**，认识那几个量出来的数字；
然后 **弹窗尺寸与屏幕夹取** 走一遍算术链。公式只回答「该多大」，还有三件事必须动手解决：
格子要各文件夹共享（**共享格子**）、分页要自己重切（**重分页**）、贴图要跟着格子缩
（**贴图随格子**）。最后两节处理边角：太长的名字要钳制（**标签上限**）、换了屏幕或主题
什么时候会重算（**何时重算**）。末节 **已知限制与兼容性** 是全仓库边界声明的唯一去处。

这一部分只按行为描述机制。补丁注册、缓存、还原顺序这些改代码才需要的实现细节，放在
「开发 · 改 extension.js」，各小节末尾点名。

### 机制 · 写死与接管

上游写死了三处东西：一页的行列数、弹窗的尺寸、格子能有多大。`ui/appDisplay.js` 里未导出的
`FolderGrid` 固定 `rows_per_page: 3`、`columns_per_page: 3`、`allow_incomplete_pages: false`，
并且只注册一个 grid mode（第一处）；Adwaita 主题把 `.app-folder-dialog` 固定为 720×720
（第二处）。这两处都没有对应的 gsetting，`org.gnome.Shell.Eval` 又被禁——所以只能在运行时由
扩展出手。第三处不在常量里，而在测量逻辑：图标在各文件夹里大小不一，病根更深，
见「机制 · 共享格子」。

扩展只做三件事，就覆盖了以上全部：

1. 给每个文件夹网格钉上一行 `{rows, columns}` 模式，并把弹窗尺寸写成内联样式。内联样式压得过
   主题的 720×720；还原时置空字符串，控制权就交回主题。样式落在 `_viewBox` 上——就是挂
   `.app-folder-dialog` 样式类的那个 actor。
2. 把所有文件夹的格子边长钉成同一个共享值。
3. 改完行列数后，把分页重切一遍。

「钉一页形状」实际是四条语句（`setGridModes`、`_currentMode = -1`、写回 `rows_per_page` 和
`columns_per_page`），收在 `_setPageGeometry()` 一个函数里：实时路径交推导出的行列数，还原路径
交上游的 3×3，两条路径共用同一个写入形状。

### 机制 · 常数出处

输入只有两个：**行列数**和**当前屏幕**。弹窗尺寸、单元格边长、贴图分辨率都从这两者推导。
唯一的例外是标签那一行的高度——它由主题和字体决定，不参与设置，只能实测：

```
行列数 ──► 弹窗宽高（放得下一整页 147px 单元格，再被屏幕夹住）
        ──► 所有文件夹共用的单元格边长 = min(147, 弹窗算出的值, 实测能放下的最小值)
        ──► 图标贴图 = 单元格 − 标签行与内边距（实测 51px），钳在 16..96
```

147 / 96 / 51 这些数字来自对上游 3×3 弹窗的实测。那是 GNOME 自己给出的尺寸，也正是最外层
启动器网格（App Grid）在用的一档图标大小——实测两边的贴图都是 96px，所以「文件夹里的图标和
App Grid 一样大」就是这组常数的含义。推导用到的全部常数，每一个都来自那次实测：

| 常数 | 值 | 含义与来源 |
| --- | --- | --- |
| `CELL_EDGE` | 147 | 上游 3×3 弹窗里条目盒的边长（= 96 贴图 + 51 标签行与内边距）|
| `TEXTURE_EDGE` | 96 | 3×3 弹窗实际加载的贴图分辨率，也是 `IconSize` 枚举上限 |
| `GRID_SPACING` | 12 | Adwaita 下 `IconGridLayout` 的行/列间距 |
| `PAGE_MARGIN` | 48 | 让满行不贴住弹窗边框的余量 |
| `DIALOG_CHROME` | 115 | 弹窗里除「页」以外的部分：标题栏、搜索框、关闭钮、页码点 |
| `SCREEN_MARGIN` | 60 | 弹窗不许盖满屏幕，四周留的余量 |
| `MIN_TEXTURE` | 16 | 最小值得加载的一档贴图，对齐 `IconSize.TINY` |
| `MIN_CELL` | 67 | 缩放下限 = `MIN_TEXTURE(16) + 51`，再小就不值得继续缩贴图 |

最后一个细节：「在一段距离里放 `count` 个格子、中间留 `count−1` 个间距」这个整除式，页 fit 与
推导 cell 都用它，代码里是 `fitExtent(extent, spacing, count)`。

### 机制 · 弹窗尺寸与屏幕夹取

弹窗的目标尺寸就是「恰好放得下一整页全尺寸图标」，再被屏幕夹住：

```
wantHeight = rows    × 147 + (rows    − 1) × 12 + 115
wantWidth  = columns × 147 + (columns − 1) × 12 + 48
高 / 宽    = clamp(want, 320, 所在显示器尺寸 − 60)
```

夹取用弹窗所在的那个显示器（`Main.layoutManager.currentMonitor`，取不到退回 `primaryMonitor`）。
被测 shell 的 monitor 对象只有 `index/x/y/width/height/geometry_scale`，**没有 `workArea`**，
所以只能按整屏尺寸夹、扣不掉底部面板——后果见「机制 · 已知限制与兼容性」。读不到显示器
（两值皆 0）时不拒绝工作，而是**不加夹取**、按想要尺寸给：没有可信的屏幕边界，就谈不上「太挤」，
而是「无从判挤」。

「这一页放得下多大的格子」只由页尺寸与间距决定：`cols * cell + spacing * (cols - 1) <= pageWidth`。
**页边距不参与**——`FolderGrid` 的页是居中的（`page_halign/valign = CENTER`），
`_calculateSpacing()` 把首个条目放在 `pagePadding.left + emptySpace / 2`，两侧内边距相等时正好
抵消。没分配过的页 `_pageWidth` 是 0（上游未分配时还报 `-Infinity`），此时 `pageFitSize()` 返回
null，表示「还不知道」，不参与取最小。实现见「开发 · 改 extension.js」的缓存条。

### 机制 · 共享格子

这是整个扩展的核心一步，病根在上游。`IconGridLayout._getChildrenMaxSize()` 按**每个网格自己的
条目**测量，取的是「该网格内条目最小尺寸的最大值」——等于被本文件夹最长的应用名撑开——结果还按
文件夹缓存在 `_childrenMaxSize`。而图标画的就是分到的那块方块：条目是 `BaseIcon extends
Shell.SquareBin` 且 `setSizeManually: true`，`setIconSize()` 只决定加载多大分辨率的贴图。于是
同一个应用在不同文件夹里会大小不一。

改法是把格子边长变成**算出来的全局值**，而不是各弹窗量出来的局部值：`ownedCellSize()` 从
`_analyticCellSize()` 起步——直接由弹窗想要的那对宽高算出，不依赖任何测量——再对每个 owned
弹窗实测的 `pageFitSize()` 取最小，最后 `max(MIN_CELL, min(CELL_EDGE, …))`。这样任何文件夹在
第一次测量之前就与其他文件夹同值；屏幕装不下时**所有**文件夹一起缩小，不会出现某个文件夹独占
大图标、另一个被压小。

为什么不直接读「自己那一页量出来的尺寸」？那样某个文件夹拿到 147 还是被压缩的值，取决于它的弹窗
有没有被分配过、有没有被别的扩展改写过，真实桌面上各文件夹会不一致。而隔离会话里所有弹窗都是
同一步新建的，永远测不出这个分叉——这是本仓库第一次「实测与真实桌面不一致」，教训见
「开发 · 隔离嵌套会话」。实测值仍留在 `min` 里当保险：弹窗真的比要求的窄时，把所有人一起降，
不各降各的。配套的重钉也是全局的——`SHARED.cell` 记共享值，变化时 `_repinAllTextures()` 扫所有
owned 布局器统一重贴。补丁注册、实例标记与共享状态的分层见「开发 · 改 extension.js」。

### 机制 · 重分页

上游只在条目增删时分页（`_relocateSurplusItems()` / `_fillItemVacancies()`）。
`FolderView._init()` 那一刻，每页还是上游的 3 行 × 3 列 = 9 个。所以改完行列数，必须由扩展把
每一页重切一遍——`_repackPages()`，一轮最多 `REPACK_PASSES=8` 次，直到页大小不再变化；否则
弹窗尺寸变了、每页仍按 9 个装，看着就是「改了没反应」。

两个上游函数本身是幂等的：溢出的往后推、有空位的从后一页往前拉、空页自己删除。但它们都按页号
直接索引 `_pages`、**不做越界检查**，循环上界只能用实时长度；`_pages` 是原地增删的，`nPages`
始终是活的。重分页与翻页状态的相互影响，见「开发 · 改 extension.js」的重分页条。

### 机制 · 贴图随格子

条目盒子恒等于「贴图 + 标签行 + 内边距」，所以格子被屏幕夹小时，贴图必须跟着缩——把 147 的贴图
塞进 109 的格子会互相压叠。（格子一致和条目盒子一致是两件事，这里保证的是前者。）贴图尺寸的
钳位式子是 `max(MIN_TEXTURE, min(TEXTURE_EDGE, cell − overhead))`。其中 overhead 那 51px 的
来源是**主题和字体**、不属于某个文件夹，所以 `_labelOverhead()` 只从活条目量一次并缓存，主题／
字体变化时清零重测（见「机制 · 已知限制与兼容性」的**重测条**）。overhead 还没量到时，贴图
保持设计尺寸 96，不猜。「变了才排队、排队只排一次」的重贴时机（`Patches.noteSharedCell()`、
idle）与写贴图的两条途径，都是改代码才需要的实现，见「开发 · 改 extension.js」。

### 机制 · 标签上限

`vfunc_allocate()` 给每个条目的尺寸是 `max(childSize, naturalWidth)`，而应用名是未省略的
`St.Label`。名字比格子宽时，条目被撑宽、标签画到隔壁列上——密集网格里「糊成一片」就是它。
`applyLabelCap()` 给每个标签设 `max-width: <cell>px` 加 `EllipsizeMode.END`：比格子短的名字
不受影响；`cell <= 0`（交回上游）时还原 `set_style('')` 与 `NONE`；`_afgdLabelCap` 记录上次
生效的上限，避免重复重设。标签在条目上的真实位置是一个易踩点，见「开发 · 改 extension.js」。

### 机制 · 何时重算

有两条自动失效的路。改分辨率或插拔显示器时，整条推导按新屏幕重跑；改 GTK 主题、深浅配色、
字体或文字缩放时，51px 那个实测值清零、从活的图标上重测一遍。两个钩子各自依赖什么、失效了
会怎样，写在「机制 · 已知限制与兼容性」。

### 机制 · 已知限制与兼容性

这一节是全仓库**边界声明的唯一去处**：机制在哪里依赖外部事实、什么情况下会失效，都写在这里，
别处只留指针。

- **依赖 shell 的私有成员**：`FolderView._grid`、`AppFolderDialog._viewBox`、
  `IconGridLayout._getChildrenMaxSize`、`_folderIcons`、`_childrenMaxSize`、`_currentMode`、
  `_pages`、`_relocateSurplusItems`、`_fillItemVacancies`、`_currentPage`、`item.icon.label` 等，
  任何一次 shell 更新中都可能变动。所以一旦出现「加载不上」或「改了列数没反应」，先按「私有接口
  挪了位置」来排查——对照当前 shell 的 `appDisplay.js` 与 `iconGrid.js` 重新核对这些成员——
  而不是先怀疑设置。排查步骤见「常见问题」。
- **本文不声明具体支持版本**。唯一一处版本声明在 `metadata.json` 里，那一栏才是 shell 实际用来
  判断可否加载的。加载判定只做**主版本号前缀匹配**：shell 取自身版本号的第一段，只要数组里有
  某一项以它开头就算兼容，所以声明一个主版本已经覆盖它的全部小版本，不需要逐个列出。另一处的
  `validateMetaData()`（`ui/extensionUtils.js`）只要求 `uuid`、`name`、`description`、
  `shell-version` 四项，多余键合法，所以 `metadata.json` 里除了 `settings-schema` 还带一个 `url`。
- **图标大小是「上限 + 屏幕夹取」，不是固定值**：列数大到当前屏幕放不下时，图标会连同格子一起
  缩小——这是设计行为，不是缺陷。在 1920×1080 上 8 列仍保持全尺寸 147/96 是可以的；缩到下限
  `MIN_CELL=67`（贴图 16）就不再让步，再多则纵向真溢出（隔离屏 12×12 实测 `fitsY=false`、
  首行 `col0y=-24`）。这是刻意的取舍：扩展不替用户改写他指定的行列数，只保证「同一应用在各
  文件夹大小一致」。想既大又多，只能换更宽的显示器或多显示器（`_dialogSize()` 用弹窗所在显示器
  的尺寸）。
- **弹窗按整屏夹取、不算底部面板**（被测 monitor 对象没有 `workArea`），行数大时可能贴近面板，
  但 `SCREEN_MARGIN=60` 保证不盖满屏幕。
- **重测条**：主题/字体变化的重测是尽力而为——它挂在公开的 `org.gnome.desktop.interface` 上，
  那个 schema 万一缺失，只是丢掉重测时机（`enable()` 不受影响），51px 会停在最后一次量到的值，
  直到设置变化或重新启用。屏幕变化的重算同理，依赖 `monitors-changed` 信号名不变。
- **GNOME Shell 不热加载扩展**：代码与 schema 的改动要注销重登，设置界面重开窗口即可——范围
  详见「开发 · 构建命令与依赖」。
- **本页的实测数字都来自隔离会话**，真实桌面上的效果仍需注销重登后目视确认——规矩是「能被
  隔离会话复现的才算测过」。
- 备选路线（未采用）：ABS/AUR 重打 `gnome-shell` 包，直接改 `FolderGrid` 常量与主题 CSS。

## 开发

改代码前先通读本部分。第一节管产物：**构建命令与依赖**（安装与打包在同一个小节里）。第二节
**隔离嵌套会话**是所有验证共用的舞台。后两节按改动落点各管一段：**改 prefs.js**（设置的读改
与界面实测坑都在其中）、**改 extension.js**（补丁的实现约束与 gjs 的坑）。

### 开发 · 构建命令与依赖

```sh
make check     # node 语法检查 + schema 严格编译（--strict 就是 schema 的 XML 校验）
make compile   # 重新编译 gschemas.compiled（改过 *.gschema.xml 必须执行）
make zip       # -> build/app-folder-grid-dimensions@luanrz.zip（含编译后的 schema 与全部文档）
make install   # 装到用户扩展目录，之后注销重登
make uninstall # 只删扩展目录；dconf 里那两个值刻意保留，重装即恢复观感
make clean     # 只删 build/
```

依赖只有两条：`glib-compile-schemas` 是唯一的硬依赖；`make check` 用 `node` 做 JS 语法检查
（shell 的 JS 就是 ES module），没装 node 时会给出明确提示。schema 的 XML 校验不单独跑
`xmllint`——编译时的 `--strict` 就是校验，坏 XML 和坏 `<range>` 值都会带文件、行、列报出来。

打包不走 `gnome-extensions pack`：它丢弃 `gschemas.compiled`（`Gio.Settings` 只认编译产物），
且在本机 segfault。Makefile 的 `zip`/`install` 目标手工 staging 单个 `<uuid>/` 顶层目录，
`install -D` 按仓库路径逐个落文件，`docs/` 与 `schemas/` 保持目录结构。

安装与打包是同一件事的两条路径。`make install` 和 `make zip` 都会先跑 `make compile`：schema
必须以编译产物 `schemas/gschemas.compiled` 的形式存在，而这个文件是构建产物、没有进 git。
绕过 make 手工拷文件的话，启用时会报：

```
Settings schema org.gnome.shell.extensions.app-folder-grid-dimensions is not installed
```

另一条路径用打包产物安装，内容相同，只是走 `gnome-extensions install`：

```sh
make zip
gnome-extensions install --force build/app-folder-grid-dimensions@luanrz.zip
```

产物里除了代码与 `schemas/`，还带着两份中文文档：README（仓库根目录）与这份 GUIDE（`docs/`
下）。`make uninstall` 只删扩展目录；dconf 里那两个值刻意保留，重装即恢复观感——那两个值存在
用户的 dconf 数据库里，不在扩展目录里。

重登的范围比 README 那句「装完要注销再登录一次」更细：只有 `extension.js` 与 schema 的改动需要
重登（shell 不热加载代码，运行中的 `Gio.Settings` 实例还持有旧 schema——所以改过
`*.gschema.xml` 之后，除了 `make compile` 还要重登才对齐）；改设置界面 `prefs.js` 重开一次
设置窗口就能看到，因为每次打开都会新拉起一个 prefs 进程。

### 开发 · 隔离嵌套会话

**验证一律在隔离会话里做**：能被嵌套无头（headless）会话复现的行为——尺寸推导、翻页、启停循环
——才算测过，量出来的数字才可信。这条规矩来自一次真实的教训：曾有一版「各文件夹格子不一致」的
缺陷，隔离会话里所有弹窗都是 enable 之后同一步新建的，永远测不出那个分叉，而真实桌面上会复现
（背景见「机制 · 共享格子」）。启动配方：

```sh
rm -f /run/user/1000/gnome-shell-disable-extensions
timeout 90 env HOME=/tmp/afgd-scratch XDG_CONFIG_HOME=/tmp/afgd-scratch/.config \
  dbus-run-session -- bash run-nested.sh
```

`run-nested.sh` 是临时验证脚本、刻意不进 git——它的职责就是在 `dbus-run-session` 里拉起下面
描述的嵌套会话，按本节描述几行就能重写出来。内层跑 `gnome-shell --headless --virtual-monitor
1280x1024 --no-x11`；自检扩展放在隔离
`$XDG_DATA_HOME/gnome-shell/extensions` 下、经隔离的 gsettings 启用（shell 不热加载**新建**的
扩展目录）。

四条环境规矩，都是踩过大坑的：

- `HOME`/`XDG_CONFIG_HOME` **必须**在 `dbus-run-session` 之前导出（写在外层 `env` 里，放进
  内层脚本不算）：D-Bus 激活的 dconf-service 继承的是 dbus-daemon 的环境，否则测试写入会覆盖
  真实的 `org.gnome.shell enabled-extensions`。
- `XDG_RUNTIME_DIR` 保留真实值 `/run/user/1000`：换成私有的，嵌套 shell 会注册 GDM 后因
  screencast 失败退出。
- 运行前 `rm -f /run/user/1000/gnome-shell-disable-extensions`，留着它扩展会静默不加载。
- 跑之前给真实 `enabled-extensions` 留一份快照，跑完逐字比对——这曾是本机最贵的坑。

会话里量几何也有三条规矩：GJS 读连字符的 GObject 属性要用驼峰名（`lm.columnsPerPage`，
`get_property('icon-size')` 会报错）；actor 没分配过时 allocation 报 `-Infinity`，弹窗必须真正
打开才有数据（`AppFolderIcon.open()` 在无头会话里可用）；enable/disable 循环用
`Main.extensionManager.enableExtension(uuid)` / `disableExtension(uuid)` 在同一会话里演练
（`disableExtension` 是异步的，状态要到后面的超时里再读）。

判读输出：日志里 `JS ERROR`、`St-CRITICAL`、`TypeError` 应为 0；`translation-x "nan"` 与关闭时
的 `already disposed` 是上游噪声，只装探针不装本扩展也照样出现。探针的 `enable()` 在一次嵌套
会话里可能跑两遍，比对输出要看**去重后的行集合**，不是总行数。另注意 `org.gnome.Shell.Eval` 在
本机被拒（返回 `(false, '')`），实时检查只能经自检扩展的日志输出做。

无头会话里没有主题切换器，也没有插拔显示器这回事，要验证那两个监听只能自己把事件发出来：
`Main.layoutManager.emit('monitors-changed')` 手动触发屏幕重算；改
`org.gnome.desktop.interface` 的 `font-name`／`text-scaling-factor` 走真实设置变更触发
`_retheme()`。两条都实测过能打到回调上。

### 开发 · 改 prefs.js

这一节分五块：**设置读写**讲两个键的存储与 GSettings 行为，**spin 与 `get_range()`** 讲界面
上下限从哪里来，**libadwaita 限制** 与 **验证替身** 讲构建这套界面的实测坑与验证办法，
**界面文案** 讲文案规矩。

**设置读写**——设置只有两个整数键：`rows`、`columns`，默认 4 与 6，范围 3–12，存在
`/org/gnome/shell/extensions/app-folder-grid-dimensions/` 下。schema 只在扩展目录里、没有登记
进系统默认源，所以日常读写用 `dconf` 而不是 `gsettings`：

```sh
dconf dump /org/gnome/shell/extensions/app-folder-grid-dimensions/
dconf write /org/gnome/shell/extensions/app-folder-grid-dimensions/columns 8

# 想让 gsettings 认识键与范围，把 schema 目录显式告诉它
gsettings --schemadir ./schemas range org.gnome.shell.extensions.app-folder-grid-dimensions columns
```

在这个前提下，GSettings 有三条行为值得知道：

- **取值范围是在「读的时候」强制的**。这直接影响 `dconf write` 的观感：用 `dconf` 直接写一个
  越界的数字（例如 `columns 20`）不会报错，dconf 里也确实存着 20，但扩展和 `gsettings get`
  读到的都是 schema 默认值——范围不改写存储，只在读取时把它挡回去。所以「写了没效果」，先看
  是不是写到了范围外。`gsettings set` 和设置界面走的是 `set_int`，越界会直接报错，不会静默。
- dconf-editor 会把这条路径下的两个键显示成「未找到架构」，这是预期行为：schema 只随扩展放在
  `<扩展目录>/schemas`，只有扩展进程显式把它加进 `SettingsSchemaSource`，系统默认源里没有
  登记，按 schema 索引视图的 dconf-editor 自然查不到定义。值本身是正常读写的，用 `dconf`
  命令行或上面的 `gsettings --schemadir` 都能看到键与取值范围。
- 升级时的坑：从旧版本升上来，如果 dconf 里存过后来被收紧的取值（比如曾经的 1、2 列），改完
  schema 之后读到的不是新的下限 3，而是默认值——想保住原来的观感，就按新范围重新写一次。
  schema 删掉的键同理：dconf 里残留的旧值无害，`Gio.Settings` 只读 schema 里声明的键。

**spin 与 `get_range()`**——界面是 `Rows` / `Columns` 两行 `Adw.ActionRow`，后缀挂
`Gtk.SpinButton`，除此之外什么都没有：弹窗尺寸、格子边长、贴图分辨率全部由「机制」推导，界面上
不解释（取舍的理由见「机制 · 写死与接管」）。spin 的上下限不是手抄的第二份数字，而是用
`get_range()` 从 schema 现读——改范围只需改 schema，界面上的可点范围跟着变。下限取 3 的理由是
上游本来就是 3×3：缩到 3 以下只会让弹窗比原生更难用，没有意义。

`get_range()` 的返回形状实测是：一个 `(sv)` 变体，`deep_unpack()` 出来是 `[format, value]`。
整数键带 `<range>` 时 `format === 'range'` 且 `value` 是 `(ii)`，直接解出 `[下限, 上限]`；
浮点键的 range 是 `(dd)`，所以判断时 `format` 和类型字符串都要看——只判 `format === 'range'`
会把一对 double 当整数用。没有 `<range>` 的键不返回 null，而是 `format === 'type'`：整数给
`ai`、字符串给 `as`，枚举键给 `'enum'`。

兜底分支（`format` 不是 `range` 或类型不是 `(ii)`）用 `[1, 32]`，实测过：把隔离 profile 里
schema 的两行 `<range>` 删掉重编译，两行都走兜底、0 条 CRITICAL。兜底可以写宽，是因为界面上
的上下限只防手滑输入，存储值真正的钳制发生在读值时（读时强制见本节的 **设置读写**）。步长
没有 schema 对应物，`STEP = 1` 留在代码里，滚轮步进与 Page 键步进（4 倍）都从它派生。

**libadwaita 限制**——libadwaita 1.10 有三条实测限制。`Adw.PreferencesGroup` **没有 `footer`
属性**，解释性文字只能放进行的 subtitle，或做成不带控件的独立说明行。
`Adw.ActionRow.get_suffixes()` 对 `add_suffix()` 加进去的控件返回空数组，校验控件是否存在要
看构建出的 widget 树（能数出 `Gtk_SpinButton`），别拿 `get_suffixes()` 当依据。
`Adw.PreferencesGroup` 的 `title` 走 Pango markup，标题里的裸 `&` 解析失败后**只在日志留一条
`Gtk-WARNING`，窗口里那一行静默变成空白**，所以必须写 `&amp;`；而且 `get_title()` 返回的是
原始串，遍历 widget 树时它证明不了渲染结果——要读分组子树里第一个非空 `Gtk.Label`。另外，
后缀插槽的方法名是 `add_suffix()`，`Gtk.Box` 那套 `add_end()` 在 `Adw.ActionRow` 上不存在。

**验证替身**——验证用「构建窗口但不 `present()`」的宿主替身：`gjs -m` 里 `await import` 真实的
`prefs.js`、`new mod.default(metadata)`、`fillPreferencesWindow(new Adw.PreferencesWindow())`，
然后遍历构建出的 widget 树。几个实测点：必须先显式 `Gtk.init()`，否则 `new Gtk.Window()` 直接
崩（exit 139）；构造窗口需要能连上 display（保留真实 `WAYLAND_DISPLAY` 即可），不 `present()`
就不会在桌面上弹出——反过来，**一旦误调 `present()`，测试窗口会真的出现在当前桌面上**。想靠
`env -u DISPLAY -u WAYLAND_DISPLAY` 断开 compositor 是不成立的：GTK 还会从 `XDG_RUNTIME_DIR`
里找到套接字。替身的 stderr 满是无关噪声（gvfs、xdg-desktop-portal 等），只看 `Failed to set
text` 与 `CRITICAL`；隔离 profile 里 `.config/dconf` 非空，是有写入逃逸了的信号。另外
`gi://System` 在 GJS 模块里不可 import，替身脚本结尾直接销毁窗口、靠进程自然退出。

**界面文案**——界面文案一共五条：窗口标题、分组标题、分组描述、两个行标签（schema 的
`summary`/`description` 与 `metadata.json` 同语言）。它们一律**英文**，仓库文档与代码注释是
中文——原因见「产物约定」。行序由 `prefs.js` 顶部的 `ROWS` 表驱动：表的顺序就是屏幕顺序
（Rows 在上、Columns 在下），没有第二处代码要改；README 的设置表与正文里「行」一律写在「列」
前面，增删文案时保持这一处顺序一致即可。文案的生效方式：重开设置窗口即可见，不需要重登；
`metadata.json` 的 `name` 则要 shell 重启才会刷新扩展列表里的显示。构建这套界面踩到的实测
限制，集中在本节的 **libadwaita 限制**。

### 开发 · 改 extension.js

「机制」按行为描述了机制；这一节记的是**实现层面**的约束与实测坑：为什么补丁必须这样注册、
状态必须放在哪里、还原为什么有顺序。分三层：先是 shell 环境本身的硬约束，然后是语言坑，
最后是补丁机制。

**环境约束**：

- JS 导入只有 `resource:///org/gnome/shell/...` 这条路；`gi://org/gnome/shell/...` 不提供
  `Extension` 导出，会 SyntaxError。
- 重排只能用 `queue_relayout()`；这个版本没有 `queue_allocate()`，调用直接 TypeError。
- prefs 宿主侧不 import `ExtensionPreferences`——它的 resource 路径在 shell 版本间挪过位置。
  自己从 `<扩展目录>/schemas` 建 `SettingsSchemaSource`。
- 接管已有文件夹视图必须走
  `Main.overview._overview.controls.appDisplay._folderIcons[].view._grid`，不能遍历 `uiGroup`
  的 actor 树：AppDisplay 在**首次打开概览之前**不挂在 actor 树上，遍历结果是 0 个，启动期就
  建好的 FolderView 会全部停留在上游 3×3。`_reapply()` 里先同步再接管，避免设置变动时漏掉
  晚出现的视图。
- 收集与只登记要分开：`_adoptExistingViews()` 只做登记（`Patches.track()` 入集合、挂 `destroy`
  出表），apply 交回 `_reapply()` 后面的循环——否则新接管的文件夹会被重复触发 `_repackPages()`。
  这个重复曾在每次改设置时把每个弹窗 `set_style()` 两遍、重分页跑两遍，净减两行才行为等价。
  集合里的网格与弹窗是同一生命周期的 actor，所以一个 `destroy` 信号就够：销毁即出表，还原时
  逐成员交回上游。

**语言坑**：gjs 全局只有 `log` 与 `logError`，没有 `console`、也没有 `logWarn`。在 `catch` 里
用错日志函数，会让兜底分支自己抛 `ReferenceError`，把 `enable()` 打挂——这条兜底路径本身就被
它打过一次。

**补丁机制**：

- 标签行高的来源是主题和字体，不属于某个文件夹，所以 `_labelOverhead()` 只从活条目量一次并
  缓存，主题／字体变化时清零重测。测量有两道闸：只有**贴图当前正好等于设计尺寸**的条目才拿来
  量——拿已被压小的贴图做基准会报出更大的 overhead，下一轮又据此把贴图压得更小，锁死在过小
  尺寸；actor 必须已挂到 stage（`get_stage()` 非空）——对未挂载的 actor 调
  `get_preferred_width()` 会让 St 按每个子控件刷一行 `not in the stage` 的 CRITICAL。
- 网格的孩子是 `AppViewItem`，标签挂在它的 `BaseIcon` 上（`this.label_actor = this.icon.label`），
  读 `child.label` 恒为 `undefined`。遍历标签的循环会**安静地空转**，改动后要用探针读回 actor
  的真实样式，确认它真的跑了。
- `IconGridLayout` 没有被 `export`，模块里拿不到类对象，只能对某个活实例取
  `Object.getPrototypeOf()` 再替换方法。所以这一步不在 `Patches.install()` 里，而在第一次
  adopt 文件夹网格时走 `Patches.installLate()`，并用标记保证只装一次。替换只对带自有标记的
  布局器生效——应用网格与 dash 共用同一个原型，不受影响。
- 被替换的原型是**进程全局**的，而 `enable()`/`disable()` 可以跑任意多遍，所以存旧实现的
  `PATCH` 与跨实例共享的 `SHARED` 都刻意放在模块顶层：放在扩展实例上，下一次的 `enable()` 就
  找不到上一次存的原函数了。`Patches.install()` 自带已装守卫，重复调用直接返回。
- `IconGrid` 每次 `allocate()` 都从模式列表里按「分配比例 vs 模式比例」挑模式：列表只放一条就
  把它钉死了，但 `_currentMode` 必须同时置 `-1`，否则 `_setGridMode()` 认为模式没变直接短路，
  新的行列数不会生效。四条语句的收纳见「机制 · 写死与接管」。
- 密集列数下的标签钳制（`applyLabelCap` 的前因与规则）见「机制 · 标签上限」；它的守卫
  `_afgdLabelCap` 记录上次生效的上限，避免每轮测量都重设样式。
- **重分页条**：重分页要当心翻页状态。`IconGrid.goToPage()` 对越界页号直接 `throw`，而
  `_currentPage` 只由它自己写入；`_repackPages()` 可能清空尾部的页，所以末尾要在
  `nPages > 0 && _currentPage >= nPages` 时把视图送回存在的最后一页。`nPages > 0` 必不可少——
  `_createGrid()` 时视图还没有条目、页表为空，无条件 `goToPage(0)` 会抛 `IconGrid does not have
  page 0`。这是测试先抓到的错误。
- **缓存条**：派生尺寸按输入缓存。纯计算收在 `computeLayout()`，`_layout()` 只缓存，键是全部
  输入 `[rows, columns, screenWidth, screenHeight]`——键覆盖了输入，就**不需要失效钩子**，这
  比「在哪里加 invalidate」好验证得多。另注意 `_getChildrenMaxSize()` 在每个 measure pass、每个
  文件夹上都会跑，不做缓存就是每轮二十几次 `get_int` 加 monitor 查找。
- **订阅生命周期**：三个钩子（设置、屏幕、主题）都经 `this._watch(target, signal, callback)`
  登记进 `this._signals`，`disable()` 遍历断开；`_interfaceSettings` 在 `disable()` 里置空。
  手动逐个记 id 容易漏。
- **_retheme 条**：`St.Settings` **没有** `gtk-theme` 属性（gjs introspection 验过），shell
  重载 CSS 的时机是从 `org.gnome.desktop.interface` 同步来的 `high-contrast`/`color-scheme`。
  决定 51px 的主题与字体，权威来源就是这个公开 schema 的
  `gtk-theme`/`color-scheme`/`font-name`/`text-scaling-factor` 四键，盯它比盯 shell 私有信号
  更稳。schema 缺失时 `catch` 兜住、只丢重测时机，绝不让 `enable()` 抛错（尽力而为的边界见
  「机制 · 已知限制与兼容性」）。清零后的回落是安全的：`overhead === 0` 时贴图按设计尺寸给，
  下一次量到活条目再修正。
- 重贴贴图必须放到 idle（`GLib.idle_add()` 排队、按标记去重）：贴图钳位要用的页面几何总要晚
  一次 allocation 才可用，而测量过程中重建贴图 actor 不安全。并且下一轮要对**所有**文件夹
  统一执行——cell 是共享的，只补发现变化那一个，会留下别的文件夹还在用旧贴图。这套「变了才
  排队、排队只排一次」就是 `Patches.noteSharedCell(cell)`。`SHARED.cell` 归零有两个时机：
  `_reapply()` 开头（让新设置重新争取共享值）与 `_restore()`（连同 `SHARED.overhead` 一起
  清掉）。贴图尺寸的写入两条途径都要做：设 `_iconSize` 并 `notify('icon-size')`，再遍历现有
  条目逐个 `child.icon.setIconSize()`；实时路径与还原路径共用同一个 `_writeIconSize()` 辅助，
  不各写一份。
- 还原路径有三处顺序不能变。先 `GLib.source_remove()` 掉挂起的 idle 重贴——它可能在布局器已
  交回 GNOME、actor 已销毁之后才跑。`_childrenMaxSize = -1` 要写在把行列数还回上游**之后**，
  否则下一轮测量仍拿旧缓存。`fixed_icon_size = -1` 之后要立刻手工 `_findBestIconSize()` 并
  `notify('icon-size')`——`adaptToSize()` 在页尺寸没变时直接早退，会留下缓存的旧值。最后一步
  才是 `Patches.uninstall()`。（早先用定时重调 `timeout_add` 替代 idle，disable→enable 循环后
  贴图会粘在 83/84，才改成现在这套。）删 `_afgdOwned`/`_afgdLabelCap` 标记（`release()`）放在
  手工重测之后不改变结果：上游 `_findBestIconSize()` 不会回调 `_getChildrenMaxSize()`（读
  `ui/iconGrid.js` 源码确认），这一段不存在「标记删早了会让补丁走另一条分支」的问题。
- **探针条**：用探针排查「图标大小不一致」时，读回四个量再下结论。`cell`/`itemBox` 不一致，是
  **格子**的问题；各文件夹 `itemBox`、`iconActor`、贴图分辨率全一致而观感仍不同，就是**图标
  文件**的问题——`_findBestIconSize()` 从 `[96, 64, 48, 32, 24, 16]` 里挑最大的可用档（且只量
  第一个子项），它只决定加载哪张图，救不了 `.desktop` 指向的文件自带留白或只有小尺寸位图；
  这时去核对 `/usr/share/icons/hicolor/*/*/<name>.png` 与 svg 的实际尺寸和留白。另注意**格子
  一致与条目盒子一致是两件事**：盒子由内容自然高度撑出，字号大到超出 cell 时 `itemBox` 会略
  越过 stride 混排（147/150/151），共享 cell 保证的是图标方块与列间距一致，不保证盒子逐像素
  相同。

## 产物约定

这份仓库的真相源与分工：

- README 与本页是**当前事实**的唯一权威；新事实、稳定下来的「为什么」写进这里。
- `docs/HISTORY.md` 是过程档案：只按时间追加改动过程、踩坑与实测数据，注明是否为当时的状态。
  它是给人翻的，AI 不需要主动读它；其中的键名、数字、文案可能已被后来的改动覆盖，任何现状结论
  一律以本页为准。
- `AGENTS.md` 是给 AI 读的薄索引：只放文档路由、一句话硬规则和必跑命令，细节以本页为权威；
  本页变化时它只同步摘要。

维护规矩：

- 标题命名约定：部分用名词短语；有子小节的部分，小节一律写成「部分名 · 子题」；全文的交叉
  引用（含代码注释里的 `「小节名」`）**照抄完整标题**，这样任何指针都能字面匹配到唯一小节。
  小节之内不再开标题，再分块用粗体引导句（如 **重分页条**），引用写作「开发 · 改 prefs.js」
  的界面文案这类形式。改小节名时必须同步全仓库指针。
- 代码注释（`extension.js`、`prefs.js`、`Makefile`、schema 的 XML 注释、`.gitignore`）一律
  中文，每条「为什么」注明它展开在哪个 GUIDE 小节（`docs/GUIDE.md「小节名」`），事实以本页已有
  描述为准。界面字符串不在此列——它们是英文文案（见「开发 · 改 prefs.js」的界面文案）。纯注释
  改动要用字符串感知的去注释行级 diff 证明代码逐字不变。
- 后续每新增一个功能改动：关键信息（结论、规则、常数、坑）写进本页对应小节，过程信息
  （推导、试错、实测数据）写进 `docs/HISTORY.md`。

代码来源：**本仓库的所有内容都由 AI 生成**——`extension.js` 里的补丁逻辑、`prefs.js` 的设置
界面、settings schema、`metadata.json`、Makefile，以及全部文档，用的 AI 是 DeepSeek、Qwen 等，
没有一行代码或文字是手写的。仓库所有者的角色是另一半：提出需求（一个文件夹放更多图标、各文件夹
格子一致）、在 AI 摆出的几个方案及其代价之间做选择、在真实桌面上使用并回报哪里不对。尺寸推导里
那些常数（147 / 96 / 51 等）也不是 AI 猜的——每一个都由临时写的探针扩展跑在真实 shell 上量出来。

## 常见问题

排查问题按「先便宜后贵」的顺序：

1. **改了行列数但弹窗没变**——改动本身是即时生效的，先确认写进去的值在范围里（读时强制见
   「开发 · 改 prefs.js」的**设置读写**）：越界值存在 dconf 里，但读出来是默认值。
   `dconf dump` 看到的和 `gsettings --schemadir ./schemas get` 读到的不一致，就是这种情况。
2. **整个扩展没生效**——代码或 schema 的改动要注销重登才加载；`gnome-extensions enable` 只是
   把 uuid 放进启用列表。用 `gnome-extensions list --enabled` 确认在列，用
   `gnome-extensions info app-folder-grid-dimensions@luanrz` 看 shell 记到的状态与错误。
3. **启用时报 schema 未安装**——`<扩展目录>/schemas/gschemas.compiled` 缺失（手工拷文件绕过了
   make），跑 `make compile && make install` 再重登。
4. **加载不上或一开文件夹就报错**——私有接口挪了位置的可能性最大（见
   「机制 · 已知限制与兼容性」）。先看日志，再猜设置：

   ```sh
   journalctl --user -t gnome-shell -n 200     # gjs 的报错以 JS ERROR 开头
   ```

   日志里出现 `FolderView`、`IconGridLayout`、`_getChildrenMaxSize` 之类的名字，就去当前 shell
   的 `appDisplay.js`、`iconGrid.js` 里核对这些成员，而不是改行列数。这两个文件不在磁盘上——
   新版 shell 的 JS 打包进 `/usr/lib/gnome-shell/libshell-*.so` 的 gresource，用 `gresource`
   取出来读：

   ```sh
   gresource list /usr/lib/gnome-shell/libshell-51.so | grep ui/
   gresource extract /usr/lib/gnome-shell/libshell-51.so /org/gnome/shell/ui/iconGrid.js
   ```

   主题 CSS 同理，在 `/usr/share/gnome-shell/gnome-shell-theme.gresource` 里。
5. **尺寸看着不对**——数字全部由行列数与屏幕推导，屏幕换了会自动重算。如果装了别的也在动
   文件夹弹窗的扩展，两边会互相覆盖；先临时关掉其它扩展再判断。
6. **只有某几个文件夹的图标看着小**——若 `cell`/`itemBox` 各文件夹一致而观感仍不同，问题多半
   不在格子，而在**图标文件本身**：`.desktop` 指向的 png/svg 自带留白、或只有小尺寸位图时，
   同一个方块里画出的「图案」就会显小显糊。区分方法与探针读数见「开发 · 改 extension.js」的
   探针条。
