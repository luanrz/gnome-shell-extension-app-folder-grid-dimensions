# 推导记录

> **归档**：本文件是从需求到实现的技术推导记录，只保留机制、常数出处、实测数据，以及每处补丁
> 「为什么非这样不可」。**剩下的内容按小节顺序连续编号**。这是一份不对外引用的存档：
> 不作为文档入口，仓库其它地方（README、GUIDE、代码注释）都不提及或链接它。

设置里只有行数与列数（默认 4 行 × 6 列），弹窗尺寸、单元格边长、贴图分辨率全部由行列数与当前屏幕推导。
下面各节记录这条推导链为什么是现在这个样子：3×3 写死在哪里、图标为什么在各文件夹大小不一、列数
调大为什么一度「没作用」、尺寸怎么算，以及 `extension.js` 里那些常数（147 / 96 / 51 / 12 / 115 / 67）
的出处。文中的代码符号一律用当前代码里的写法；设置键名保留当时的状态，第 11 节注明了后来的改动。

## 目录

- 1. 原始需求
- 2. 定位 3×3 的来源
- 3. v1 实现与踩过的坑
- 4. 第一次异常：只有一部分文件夹变大了
- 5. 第二次异常：图标大小不一致（核心推导）
- 6. v2 方案
- 7. 验证方法与数据
- 8. 第三次异常：设置窗口打不开
- 9. 第四次问题：columns 调成 8 没作用
- 10. 只保留行列数：其余尺寸改为推导
- 11. 设置项（键与默认值）
- 12. 设置界面：结构与 libadwaita 限制
- 13. 已知限制
- 14. 重复计算、两个缺失的监听、两条 GSettings 实测事实
- 15. 原先写在 extension.js 里的「为什么」
- 16. prefs.js 的输入上限：从 schema 现读
- 17. 设置页的两处界面事实

## 1. 原始需求

上游的 App Grid 里，应用文件夹网格固定 3 行 × 3 列 = 9 个图标，希望一页容纳更多图标。
经确认选择：**本地扩展**方案（而不是重建 `gnome-shell` 包），行列数**可调**，默认 **4 行 × 5 列**。

后续追加需求（第 5 节）：不同文件夹里的图标大小不一致，要求统一到**与最外层 App Grid 一样大**。
当时口头用来指认这个尺寸的说法是「GNOME-Extra 那个文件夹里看着比较大」——那只是恰好同档的
参照物（实测：App Grid 与上游文件夹弹窗的贴图都是 96px），目标一直是 App Grid 那一档，
不是某个文件夹。

## 2. 定位 3×3 的来源

这里的 shell JS 不再以散文件安装，而是打包在 `/usr/lib/gnome-shell/libshell-51.so`
的 gresource 里，用 `gresource list` / `gresource extract` 读取：

```sh
gresource extract /usr/lib/gnome-shell/libshell-51.so /org/gnome/shell/ui/appDisplay.js
gresource extract /usr/lib/gnome-shell/libshell-51.so /org/gnome/shell/ui/iconGrid.js
gresource extract /usr/share/gnome-shell/gnome-shell-theme.gresource /org/gnome/shell/theme/gnome-shell.css
```

结论：

- `ui/appDisplay.js` 里未导出的 `FolderGrid` 写死 `rows_per_page: 3`、`columns_per_page: 3`、
  `allow_incomplete_pages: false`，并只注册了一个 grid mode（`setGridModes([{rows:3,columns:3}])`）。
- Adwaita 主题把 `.app-folder-dialog` 写死为 `720px x 720px`。
- 两者都没有 gsetting，`org.gnome.Shell.Eval` 在 51 上被禁用 → 只能靠扩展在运行时改。

## 3. v1 实现与踩过的坑

扩展同时做两件事：改行列数、可选覆盖弹窗尺寸。

| 做法 | 原因 |
| --- | --- |
| 打补丁 `FolderView.prototype._createGrid` 与 `AppFolderDialog.prototype._init` | 这两个类是导出的，实例从这里进入我们的登记表 `SHARED.grids/dialogs` |
| `setGridModes([{rows, columns}])` 之后必须 `grid._currentMode = -1` | `IconGrid._setGridMode()` 会短路，不失效就看不到新 mode |
| `viewBox.set_style('width:…px; height:…px;')`，关闭时置空字符串 | 内联样式优先于主题，空串把控制权交回主题 |
| `import ... from 'resource:///org/gnome/shell/…'` | `gi://org/gnome/shell/…` 在 51 上不提供 `Extension` 导出，会 SyntaxError |
| 只用 `queue_relayout()` | 51 没有 `queue_allocate()`，调用会 TypeError |
| `prefs.js` 不 import `ExtensionPreferences`，自己从 `<extdir>/schemas` 建 `SettingsSchemaSource` | 51 把偏好设置宿主挪到应用侧，原 resource 路径不再提供该类 |
| 新扩展目录需要**注销重登** | 51 不热加载新装的扩展；`EnableExtension`/`ReloadExtension` 均不可用于首次加载 |

实测（隔离会话）：4×5 = 20 个槽位 vs 上游 9 个；弹窗尺寸覆盖生效；关闭扩展能回到 3×3。

## 4. 第一次异常：只有一部分文件夹变大了

用户报告「出现异常」。排查发现接管路径写错了：

- 旧的 `_adoptExistingViews()` 遍历 `Main.layoutManager.uiGroup` 的 actor 树找 `FolderView`；
- 但 App Display 在**首次打开概览之前**不挂在 actor 树上，实测遍历结果 0 个；
- 这些在 shell 启动期就创建好的 FolderView 全部停留在 3×3，之后新建的才是 4×5。

改法：走 AppDisplay 自己的文件夹图标列表，而不是遍历 actor：

```js
Main.overview._overview.controls.appDisplay._folderIcons[].view._grid
```

实测修正后 7 个已存在的文件夹网格全部变成 4×5。同时把 `_reapply()` 改成先同步再接管，
避免设置变动时漏掉晚出现的视图。

## 5. 第二次异常：图标大小不一致（核心推导）

用户描述：「GNOME-Extra 中的图标要大一些，其它的图标要小一些，把其它的调成 gnome-extra 一样。」
（后来澄清：真正想要的是**和 App Grid 一样大**，GNOME-Extra 只是当时手边那个看着偏大的文件夹，
两者数值重合纯属巧合。本节的推导不受影响——它要找的本来就是「哪个尺寸才是上游给的那一档」，
而后续实测说明 App Grid 与上游文件夹弹窗用的是同一档 96px 贴图。）

### 5.1 先排除「图标尺寸搜索」这条线索

`IconGridLayout._findBestIconSize()` 从 `[96,64,48,32,24,16]` 里挑最大的可用值，且只量**第一个**
子项。用探针模拟后所有文件夹都选到 96，横向纵向余量都很大 → 不是这条线索。

（一度怀疑是标签长度影响搜索结果，实测证明搜索结果各文件夹一致，假设被数据推翻。）

### 5.2 真正的机制：画出来的大小 = 分配尺寸，不是贴图尺寸

- 文件夹条目是 `BaseIcon extends Shell.SquareBin`，且 `setSizeManually: true`；
  `setIconSize()` 只决定**加载多大分辨率的贴图**，SquareBin 按自身分配尺寸画方块。
- `IconGridLayout.vfunc_allocate()` 用 `childSize = this._getChildrenMaxSize()` 给每个条目
  `set_size(max(childSize, natural), …)`；
  `_getChildrenMaxSize()` 取的是**该网格内所有条目最小尺寸的最大值**，也就是被**该文件夹里最长的
  应用名**撑开的值，并按文件夹分别计算、结果缓存在 `_childrenMaxSize`。
- 所以：每个文件夹天生算出自己的边长 → 图标观感不一致。上游基线实测：
  GNOME-Extra 147px、Office 146、AI/Programming 145。

### 5.3 还有一个把图标缩小的放大器

5 列时上游的尺寸搜索把贴图从 96 降到 64，实测图标方块只剩 ~90px，而 GNOME-Extra 是 ~122px。
这才是用户眼中「其它文件夹图标明显偏小」的直接数值来源。

### 5.4 顺带暴露的裁切问题

5 列 × 147 + 列间距 + 页内边距需要 ~831px，而主题弹窗只有 720px 宽 → 第 5 列必然被裁。
即「保持原弹窗」与「5 列全尺寸图标」几何上不能兼得。

## 6. v2 方案

接管 `IconGridLayout.prototype._getChildrenMaxSize`，把所有文件夹的单元格边长钉成同一个值。

关键约束与做法：

- `_getChildrenMaxSize` 在**全局原型**上，App Grid 主网格和 dash 也用它，所以只在
  layout manager 实例带 `_afgdOwned` 标记时接管（早期叫 `_afgdCellMode`，尺寸模式删掉后改名），
  否则原样调用上游实现。
- `IconGridLayout` 未导出，拿不到类对象 → 补丁在第一次见到实例时通过
  `Object.getPrototypeOf(layoutManager)` 安装，`disable()` 时按记录的 `PATCH.maxChildSizeProto` 还原。
- 贴图另用 `fixed-icon-size` 钉住：`adaptToSize()` 在页面尺寸未变时会**提前返回**，
  不重算尺寸，因此缓存的旧值会一直粘住；除了设置 GObject 属性，还显式
  `lm._iconSize = size` + 遍历子项 `child.icon.setIconSize(size)` + `notify('icon-size')`。
- `disable()` 里补一次 `_findBestIconSize()` 重算（仅当页面已测量过），把钉住的尺寸还给上游逻辑。

### 6.1 默认值的算术

| 参数 | 默认 | 依据 |
| --- | --- | --- |
| `rows-per-page` / `columns-per-page` | 4 / 5 | 用户选择，20 个/页 |
| `cell-size` | 147 | 等于上游 3×3 实测边长，即 96px 贴图（与 App Grid 同一档）加标签与内边距之后的格子 |
| `fixed-icon-size` | 96 | 上游 3×3 的贴图分辨率，`IconSize` 枚举上限也是 96 |
| `enlarge-dialog` | true | 见下 |
| `dialog-width` / `dialog-height` | 960 / 840 | 给 4 行留出高度，也装得下 5 列 × 147 |

曾把 `-1`（「按弹窗自动铺满」）设为默认，实测它随页数波动（多页文件夹 136、单页 146），
仍然是「每个文件夹不一样」，于是退回显式 147；自动模式保留为可选项。

## 7. 验证方法与数据

只用隔离的嵌套 headless 会话验证，绝不碰真实配置。要点（踩过大坑）：

- **必须**在 `dbus-run-session` 之前导出 `HOME`/`XDG_CONFIG_HOME`：D-Bus 激活的 dconf-service
  继承的是 dbus-daemon 的环境，否则测试写入会覆盖真实的 `enabled-extensions`
  （曾两次把 dash-to-panel、blur-my-shell 等真实扩展清掉，已恢复并修复隔离方式）。
- 保留真实 `XDG_RUNTIME_DIR=/run/user/1000`，私有的会让嵌套 shell 注册 GDM 后因 screencast 失败退出。
- 运行前 `rm -f /run/user/1000/gnome-shell-disable-extensions`，否则扩展静默不加载。
- GJS 里连字符 GObject 属性要用驼峰读取（`lm.columnsPerPage`、`lm.iconSize`）；
  `lm.get_property('icon-size')`、`actor.get_allocation()` 都会报错，用 `actor.allocation`。
- 未分配时 allocation 报 `-Infinity`，弹窗必须真正打开才有几何数据：
  `AppFolderIcon.open()` 在无头会话里可用；`Main.extensionManager.enableExtension/disableExtension(uuid)`
  可在同一会话里演练 enable/disable 循环。

最终实测（用用户真实的 app-folders 数据）：

| 阶段 | grid（行×列） | cell | 图标方块 | 贴图 | 弹窗页面 | 裁切 |
| --- | --- | --- | --- | --- | --- | --- |
| 上游基线 | 3×3 | 145–147（各文件夹不同） | 121–123 | 96 | 720×605/645 | 无 |
| v1（4×5，未钉尺寸） | 4×5 | 136 | 89–91 | 64 | 960×685 | — |
| v2 最终 | 4×5 | **147（7 个文件夹全一致）** | 121–123 | **96** | 960×725/765 | 首页最右 x2=871 ≤ 960，无 |
| disable 之后 | 3×3 | 147（上游自测） | 121–123 | 96 | 720×605 | 无 |
| 重新 enable | 4×5 | 147 | 121–123 | 96 | 960×725 | 无 |

真实 `org.gnome.shell enabled-extensions` 在每次运行前后逐字比对，均未改变。

第 9 节的改动之后重跑同一套场景（默认 4×5 全文件夹 + disable/enable 循环 + 列数扫描 + 翻页
改列数），日志里 `St-CRITICAL`、`JS ERROR`、`TypeError` 均为 0；残留的
`translation-x "nan"` 与关闭时的 `already disposed` 噪声在**只装探针、不装本扩展**的
上游对照组里同样出现，属 shell 自身在无头会话下的输出。

## 8. 第三次异常：设置窗口打不开

用户报告 `TypeError: row.add_end is not a function`。

原因：`add_end()` 是 `Gtk.Box` 的方法，`Adw.ActionRow` 的后缀插槽叫 **`add_suffix()`**
（libadwaita 1.10 上实测：`ActionRow.add_suffix: function`、`add_end: undefined`）。
改为 `row.add_suffix(spin)` 并补 `row.activatable_widget = spin`，点整行也能聚焦到输入框。

验证方式（这次不做静态推断）：用 `gjs -m` 跑一个 prefs 宿主替身，按 shell 的方式
`await import(.../prefs.js)`、`new mod.default(metadata)`、`fillPreferencesWindow(new Adw.PreferencesWindow())`，
但**不 present** 窗口，只遍历构建出的 widget 树。结果：7 行全部构建成功
（4 个 `Adw_ActionRow` + `Adw_SwitchRow` + 2 个尺寸行，每行内含 `Gtk_SpinButton`/`Gtk_Switch`），
`enlarge-dialog=true` 时 Width/Height 行 `sensitive=true` 绑定生效，读回
`cols=5 rows=4 cell=147 texture=96 enlarge=true dialog=960x840`。

注意几点：`gi://System` 在 GJS 模块里不可 import，脚本结尾直接销毁窗口靠自然退出；
构造 GTK/Adw 窗口需要能连上 display（本机 `WAYLAND_DISPLAY=wayland-0` 可用），
但因为没有 `present()`，不会在桌面上弹出窗口。
（这条后来又被测准了一次：`Gtk.init()` 必须显式调用，而且
`env -u DISPLAY -u WAYLAND_DISPLAY` 并不断开 compositor——GTK 会从 `XDG_RUNTIME_DIR` 里找到套接字。）

## 9. 第四次问题：`columns` 调成 8 没作用

用户报告把列数设成 8 后看不出变化。实测隔离会话里逐层定位到**三条独立原因**，缺一都表现为「没作用」。

### 9.1 分页陈旧：列数变了，页还按 9 个切

`IconGridLayout` 只在**条目插入/可见性变化**时调用 `_relocateSurplusItems()` / `_fillItemVacancies()`
来切页，而 `FolderView._init()` 在 shell 启动期就执行了 `_redisplay()`——那时 `itemsPerPage` 还是
上游的 3×3=9。于是改列数后每页仍是 9 项：4 行 8 列的弹窗第一屏只有一行 8 个加第二行 1 个，
剩余的全在第 2、第 3 页，看起来正好「什么都没发生」。实测 `Gnome items=24 pages=[9,9,6]`。

做法：`_repackPages()` 对每一页交替跑这两个上游函数（它们本身幂等：溢出的往后推、有空位的
从后一页往前拉、空页自己删除），循环到页大小字符串不再变化为止，上限 `REPACK_PASSES = 8`。
重测：`[24]`（4×8=32 一页装下）、`[19]`、`[13]`、`[11]`、`[9]`、`[8]`、`[6]` 全部单页。

### 9.2 整行画到弹窗外面：布局器从不校验列数

`_calculateSpacing()` 只负责分配 spacing，不会在放不下时减少列数；`vfunc_allocate()` 又按
`childSize + spacing` 的固定步长摆放。8 列 × 147 + 间距 = 1176px，而弹窗页宽 960px
→ 实测行范围 `-150..1110`，首尾各被裁掉 150px，中间那几列和 5 列时几乎一样，所以「看不出区别」。

做法：`pageFitSize()` 给出「这一页放得下的最大边长」，`ownedCellSize()` 把它作为**上限**压到
用户设定值下面。关键推导：`FolderGrid` 是 `page_halign/page_valign: CENTER`，
`_calculateSpacing()` 把首个条目放在 `pagePadding.left + emptySpace / 2` 处，两侧 padding 相等时
**正好抵消**，首项位置就是 `(pageWidth - contentWidth) / 2`。所以判据是

```
cols * cell + columnSpacing * (cols - 1) <= pageWidth
```

而不是把 padding 也算进去。（第一版把 padding 计入，导致默认 4×5 的边长从 147 缩到 136，
与「保留大图标」的既定决策冲突，已修正。）

### 9.3 条目盒子由贴图决定，不跟随 cell

条目实际高度是 `贴图 96 + 标签行 ~21 + .overview-icon 内边距` ≈ **147**，与我们钉住的 cell 无关。
cell 从 147 降到 109 时条目仍是 147，于是相邻条目互相重叠——又变成「改了没效果」。

做法：`_labelOverhead()` 从真实条目上量一次「盒子边长 − 贴图边长」（实测 51），缓存在 `SHARED.overhead`；
`_pinTextureFor()` 把贴图也一起压到 `cell - overhead`，即 `Math.max(16, Math.min(设定值, cell - 51))`。
量取时机有讲究：只在**贴图当前正好等于设定值**的那个网格上量，否则拿已经被压小的贴图做基准会
越算越小；并且要加 `first.get_stage()` 守卫——对尚未挂到 stage 的 actor 调 `get_preferred_width()`
会让 St 按每个子控件刷一行 `St-CRITICAL: st_widget_get_theme_node ... not in the stage`
（实测 441 条 → 加守卫后 0 条）。

### 9.4 压缩后的贴图要晚一次 allocation 才能拿到

贴图压制需要页面几何，而页面几何在设置变更后**总要晚一次 allocation** 才可用。曾用
`timeout_add` 定时重调（`RETUNE_*`），disable→enable 循环后贴图会粘在 83/84。现在的做法：
被打补丁的 `_getChildrenMaxSize()` 一旦发现算出的 cell 变化，就 `GLib.idle_add()` 到下一轮
再 `_pinTextureFor()`（测量过程中重建贴图 actor 不安全），并用 `SHARED.pinId` 去重、
在 `_restore()` 里 `GLib.source_remove()` 掉未执行的挂起项。

### 9.5 列数上限的算术与实测

| 列数 | cell | 贴图 | 行范围 (page 960) | 放得下 |
| --- | --- | --- | --- | --- |
| 5 | 147 | 96 | 88..871 | 是 |
| 6 | 147 | 96 | 9..951 | 是（6 列是 960px 弹窗的极限） |
| 7 | 126 | 75 | 3..957 | 是 |
| 8 | 109 | 58 | 2..958 | 是 |
| 10 | 85 | 34 | 1..959 | 是 |

即：**960px 宽的弹窗最多放 6 列全尺寸图标**，8 列必然要缩到 109/58。想在 8 列下保住大图，
只能把弹窗加宽：需要 `8×147 + 7×12 = 1260px`，实测 `dialog-width=1240` 时 cell=144、
贴图仍 96、行范围 146..1238（正好贴边），`cell-size=0`（把尺寸决定权交回 GNOME）时
8 列会退回 147 并再次裁切（`-3..1110`）——这条逃生舱不保证放得下，属预期行为。

本机最终选择（用户确认）：**加宽弹窗而不是缩小图标**——真实配置写的是
`rows=4 columns=8 cell=147 texture=96 dialog=1280x840`，实测 `page=1278`、行范围 `8..1268`、
cell 147 / 贴图 96、`fitsX/fitsY=true`、24 项单页装下。屏幕 1920×1080（scale 1），
1280 已接近可用上限；扩展自身的默认值仍是 5 列 + 960×840（两者也自洽）。

（这一段已被第 10 节取代：`dialog-width` 这类键已经不存在，8 列的 1308px 宽度由
`_dialogSize()` 自己算出来，不需要手工设置。）

### 9.6 重分页与翻页的相互影响

`IconGrid.goToPage()` 对越界页号是直接 `throw` 的，而 `_currentPage` 只由它自己写入。
重分页可能清空尾部的页，此时停留在最后一页的弹窗就会拿着失效页号。做法：`_repackPages()`
末尾在 `nPages > 0 && grid._currentPage >= nPages` 时把视图送回存在的最后一页
（`nPages > 0` 这个条件必不可少——`_createGrid()` 时视图还没有条目、页表为空，无条件
`goToPage(0)` 会抛 `IconGrid does not have page 0`，正是测试先抓到的错误）。

实测 24 项的 `Gnome` 文件夹：4×5 下 `[20,4]`，翻到第 2 页后改 8 列 → `nPages=1 curPage=0`
`[24]`；再改 3 列 → `[12,12]`；改回 5 列 → `[20,4]`；随后 `goToPage(_currentPage)` 不再抛错。

### 9.7 密集列数下的标签横向溢出

`vfunc_allocate()` 给每个条目的尺寸是 `max(childSize, naturalWidth)`，而应用名是**未省略**的
`St.Label`，其「自然宽度」就是整串文字。名字比单元格宽时条目会被撑宽，标签画到隔壁列上、
甚至越过弹窗边缘——密集网格看起来「糊成一片」就是这个。做法：`applyLabelCap()` 给同一布局器内
每个标签设 `max-width: <cell>px` 与 `Pango.EllipsizeMode.END`，比单元格短的名字不受影响
（默认 4×5 因此仍显示完整名字），`cell <= 0`（交回上游）时把 `set_style('')` 与 `NONE` 还原。
守卫：`_afgdLabelCap` 记录上一次生效的上限，避免每次测量都重设样式。

## 10. 只保留行列数：其余尺寸改为推导

需求（用户提出）：设置里**只留「行数」和「列数」**，默认 4 行 × 6 列，弹窗尺寸、单元格边长、
贴图分辨率全部自动取合适的值，且**各文件夹图标大小必须一致**。

做法是把 schema 从 7 个键缩到 2 个（`rows-per-page=4` / `columns-per-page=6`，范围都是 1–12），
删掉 `cell-size`、`fixed-icon-size`、`enlarge-dialog`、`dialog-width`、`dialog-height`，
原来由这几个键表达的量改成一条推导链，输入只有行列数和当前屏幕：

```
行列数 ──► _dialogSize() ──► 弹窗 CSS width/height ──► 页宽/页高
                                                              │
                              ownedCellSize() = min(147, pageFitSize())
                                                              │
                        _pinTextureFor()：贴图 = clamp(cell - 51, 16, 96)
```

### 10.1 弹窗尺寸怎么算

`_dialogSize()` 用第 9 节实测出来的常数反推「恰好放得下一整页全尺寸图标」需要多大，再用屏幕夹住：

| 常数 | 值 | 来源 |
| --- | --- | --- |
| `CELL_EDGE` | 147 | 3×3 弹窗里条目盒的边长（第 9.3 节） |
| `TEXTURE_EDGE` | 96 | 3×3 弹窗实际加载的贴图分辨率 |
| `GRID_SPACING` | 12 | Adwaita 下 `IconGridLayout` 的 row/columnSpacing |
| `PAGE_MARGIN` | 48 | 让满行不贴住弹窗边框的余量 |
| `DIALOG_CHROME` | 115 | 弹窗里除页以外的部分（标题栏、搜索框、关闭钮、页码点；两次实测 840-725） |
| `SCREEN_MARGIN` | 60 | 弹窗不许盖满屏幕 |
| `MIN_CELL` | 67 | `MIN_TEXTURE(16) + 51`，再小就不值得缩贴图了 |

```js
wantHeight = rows    * 147 + (rows    - 1) * 12 + 115;
wantWidth  = columns * 147 + (columns - 1) * 12 + 48;
高/宽 = clamp(want, 320, 该显示器尺寸 - 60);
```

显示器取 `Main.layoutManager.currentMonitor`（落在哪个屏就用哪个屏），取不到退回
`primaryMonitor`。**被测 shell 的 monitor 对象只有 `index x y width height geometry_scale` 五个键，
没有 `workArea`/`workAreaX`**（用探针实际 dump 过），所以只能按整屏尺寸夹，不能扣掉面板可视区。

### 10.2 一致性怎么保证

图标大小一致的关键不是「把 cell 写死」，而是**每个文件夹的弹窗尺寸相同**：同一弹窗 → 同一
页尺寸 → `pageFitSize()` 算出同一个上限 → `ownedCellSize()` 取 `min(147, 上限)`，与文件夹
里应用名长短无关（第 5 节的病根就是上游按各自最长名字测量）。贴图再跟着 cell 走
（`cell - 实测 overhead`，钳在 `16..96`），所以 cell 被屏幕夹小时贴图同步缩小，
不会出现「格子小、图大」的溢出。`_afgdOwned` 仍然只标记文件夹布局器，应用网格与 dash 不受影响。

`cell-size=-1`（铺满）与 `cell-size=0`（交回上游）两种模式连同 `_cellMode` getter 一起删掉了：
推导值本身就是「上限 + 屏幕夹取」，不需要再用模式切换表达。

### 10.3 顺手修掉一个一直是死代码的分支

`applyLabelCap()` 第 9.7 节写下后其实**从未生效过**：它遍历 `child.label`，而网格的孩子是
`AppViewItem`，标签在 `item.icon.label` 上（`appDisplay.js` 里 `this.label_actor = this.icon.label`）。
`child?.label` 恒为 `undefined`，循环体一次都没执行。改成 `child?.icon?.label` 后探针才打印出
`labelStyle="max-width: 147px;" labelEll=3`（`EllipsizeMode.END`），`itemBox=147x147`。
教训：加了守卫缓存的补丁要用「读回实际 actor 状态」的探针验证，只看有没有报错会漏掉整段空转。

### 10.4 实测（隔离嵌套会话，1280×1024 单屏，真实 app-folders）

| 行×列 | 弹窗 | 页 | cell | 贴图 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 4×6（默认） | 992×739 | 990×664 | 147 | 96 | `row0=24..966`、`fitsX/fitsY=true`、24 项单页；`Gnome(24)`/`System(11)`/`Office(6)` 三个文件夹数字**完全相同** |
| 4×8 | 1222×739 | 1220 | 142 | 91 | 满尺寸要 1308px，被 1280 屏夹到 1220，于是整体匀缩小 5px，仍然一致且放得下 |
| 3×3 | — | — | 147 | 96 | 分页 `[9,9,6]`，正确 |
| 1×1 | — | — | 147 | 96 | 24 个单条目页，正确 |
| 12×12 | 1220×964 | — | **67** | 16 | `fitsX=true` 但 `fitsY=false`（`col0y=-24`）：cell 触到 `MIN_CELL` 后不再让步，纵向真的溢出——见第 13 节 |

按公式，本机真实屏幕 1920×1080 上 4×8 的 `wantWidth=1308 < 1860`，夹取不触发，
即**默认全屏尺寸图标 + 8 列**同时成立——第 9.5 节里「想 8 列就得手动把 `dialog-width` 拉到
1280」这件事，现在由推导自动完成。

disable→enable 循环（5 列）：弹窗 `831×…`、cell 147 / 贴图 96、行末 `x2=806 ≤ 831`；
关闭后回到上游 3×3、页 720×605；再次开启与首次完全一致。全程 0 `JS ERROR`、0 `St-CRITICAL`。

### 10.5 配置迁移

键名 `rows-per-page`/`columns-per-page` 没变，被删的五个键不再被读取；dconf 里残留的旧值
无害（`Gio.Settings` 只暴露 schema 里声明的键），但为整洁已把真实配置 `dconf reset`
回只剩两项：

```sh
dconf dump /org/gnome/shell/extensions/app-folder-grid-dimensions/
# [/]
# columns-per-page=6
# rows-per-page=4
```

schema 改动要 `glib-compile-schemas schemas/` 并**注销重登**才对新代码生效。注销前正在运行的
shell 里，旧的 `Gio.Settings` 实例仍持有它建立时的 schema，读到的只是被 reset 后的旧默认值
（cell 147 / 贴图 96 / 960×840 + 6 列），不会因键消失而抛错——过渡态与目标观感一致。
新 prefs 文件在当前会话就能打开（第 12 节的宿主替身是在本会话里跑通的），设置窗口每次重新
拉起 prefs 进程，所以**重开设置窗口**即见新的两行界面。

### 10.6 逐文件夹复核（1920×1080、4 行 × 8 列，与本机真实设置一致）

用户反馈 `Tool` / `Gnome` / `GNOME-Extra` 三个文件夹图标大小不对，于是把探针改成
**遍历全部文件夹**，并且不只打印第一个条目，而是把该页**所有条目去重后的尺寸集合**打出来
（`itemBox` = 条目盒、`iconActor` = 图片画在多大的方块上、`iconSize` = 加载的贴图分辨率）：

```
monitor=1920x1080 folders=7          # Plasma/Xfce/Flatpak 里没有已安装应用，故不出现
System       cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x11] iconActor=[96x96x11]
Tool         cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x19] iconActor=[96x96x19]
Gnome        cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x24] iconActor=[96x96x24]
GNOME-Extra  cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x9]  iconActor=[96x96x9]
Office       cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x6]  iconActor=[96x96x6]
Programming  cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x13] iconActor=[96x96x13]
AI           cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147x8]  iconActor=[96x96x8]
```

每个文件夹里 `itemBox`/`iconActor` 都只有**一个**取值（后缀是个数），跨文件夹也完全相同：
条目 147×147、图片方块 96×96。也就是说几何层面没有差别，能剩下的只有**图标文件本身**——
`.desktop` 指向的 png/svg 自带留白或只有小尺寸位图时，同一个 96×96 方块里画出来的「图案」
就会显小或显糊（GNOME 自己的图标搜索 `_findBestIconSize` 也救不了这个，它只决定加载哪张图）。
遇到「某几个文件夹看起来不对」时，先用 `iconSize`/`itemBox` 区分是**格子**不一致还是**图**不一致，
后者要去核对 `/usr/share/icons/hicolor/*/*<name>.png` 与 svg 的实际尺寸和留白。

### 10.7 第五次问题：实时会话里「格子大小不一致」，隔离会话却全一致

用户反馈真实桌面上 `Tool` / `Gnome` / `GNOME-Extra` 的**图标方块尺寸不一致**，而 10.6 的
逐文件夹复测（同样的 1920×1080、4 行 8 列）里 7 个文件夹全是 cell 147 / 贴图 96。
差别出在 cell 的**来源**上：那时 `ownedCellSize()` 读的是「我这个布局器自己那一页量出来的
尺寸」（`pageFitSize(this)`），页面还没分配过时返回 `CELL_EDGE`。也就是说，一个文件夹拿到
147 还是被压缩的值，取决于**它的弹窗有没有被分配过、分配时弹窗有多大**：

- 弹窗尺寸被别的扩展（blur-my-shell / dash-to-panel 都动过 `AppFolderDialog`）改写过；
- 或者弹窗是在某次设置变更**之前**分配的，之后只有再打开一次才会重测；
- 或者视图是 enable 之前建立的，采用的先后顺序不同。

任何一条都只影响「这一个」文件夹，于是文件夹之间出现不同的格子。隔离会话里所有弹窗都是
enable 之后由被打补丁的 `_createGrid` / `_init` 新建的，全都同一步走，所以永远测不出这个分叉
——这也是本记录里第一次出现「实测与真实桌面不一致」的情况：**能被隔离会话复现的才叫测过**。

改法是把 cell 从「每个布局器各自算」变成**全局唯一值**：

```js
sharedCellSize() = max(MIN_CELL, min(CELL_EDGE,
        _analyticCellSize(),          // 直接向弹窗要的宽高算，不依赖任何测量
        min over owned of pageFitSize(lm)))   // 各弹窗实测上限里最小的那个
```

`_analyticCellSize()` 用 `_dialogSize()` 想要的那对宽高算，所以**任何文件夹在第一次测量之前
就和别人同值**，一致性不再依赖「弹窗有没有被打开过」。实测值仍留在 min 里当保险：弹窗真的
比要求的窄（换屏、别的主题）时不越界——但它只会把**所有**文件夹一起降，不会各降各的。

配套的重钉也改成全局：`SHARED.cell` 记录当前共享值，`SHARED.pinId` 只有**一个**挂起的 idle，
变化时 `_repinAllTextures()` 扫所有 owned 布局器，逐个 `_pinTextureFor()` + `_childrenMaxSize = -1`
+ `queue_relayout()`（原来是每个布局器各自排一个挂起的 idle，谁先量到谁先改，这正是各改各的来源）。
`_reapply()` 开头把 `SHARED.cell` 归零以便重新争取；`_restore()` 里 `GLib.source_remove(SHARED.pinId)`
并把 `SHARED.cell` / `SHARED.overhead` 归零。

复测（1920×1080、4×8，同样遍历 7 个文件夹）：

- baseline：`cell=147 texture=96/96 popup=1310x739 page=1308x664 itemBox=[147x147xN]
  iconActor=[96x96xN]` 对每个文件夹都成立，且 `ADOPT folders=7 unowned=0`（没有漏接管）。
- 破坏用例：把 `System` 的弹窗在扩展背后改成 720×720，再遍历其余文件夹 —— 共享 cell 仍是
  147，其余文件夹不受影响（隐藏弹窗的陈旧页尺寸不会污染共享值），0 `JS ERROR` / 0 `St-CRITICAL`。

## 11. 设置项（键与默认值）

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `rows-per-page` | 4 | 每页行数（上游 3）；改动自动重新分页并重算弹窗高度 |
| `columns-per-page` | 6 | 每页列数（上游 3）；同上决定宽度 |

（这一节的键名与「范围 1–12」是当时的状态：后来两键改成 `rows` / `columns`、下限提到 3、
范围收作 3–12，以现状为准。）

其余一切由 `_dialogSize()` / `ownedCellSize()` / `_pinTextureFor()` 推导（第 10 节）。改过
`schemas/*.xml` 之后必须重新编译，否则扩展 enable 时读不到键并抛 JS 错：

```sh
glib-compile-schemas schemas/
gsettings --schemadir schemas/ list-recursively org.gnome.shell.extensions.app-folder-grid-dimensions
```

## 12. 设置界面：结构与 libadwaita 限制

### 12.1 界面结构

`prefs.js` 现在只有一个分组：**每页图标数量**，即 `行数`、`列数` 两个 `Adw.SpinButton` 行
（`add_suffix()` + `activatable_widget`）。曾一度在旁边加过「自动计算的部分」三条说明行
（解释弹窗尺寸 / 图标大小 / 长名字怎么推导），用户要求删除后已经不保留了——推导逻辑只在
`extension.js` 与本记录里，界面上不再解释。

窗口标题当时是 `应用文件夹网格`，`metadata.json` 的 `name`/`description` 与 schema 里每个键的
`summary`/`description` 也一并改成了中文。**这一段是当时的状态**：界面与 schema、metadata 的文案
后来整体改回英文（现状是窗口标题 `App Folder Grid Dimensions`、分组标题 `Rows & Columns`、两个行
标签 `Rows`/`Columns`，第 17.2 节有实测），仓库文档仍用中文。

### 12.2 实测到的 libadwaita 1.10 限制

- `Adw.PreferencesGroup` **没有 `footer` 属性**（`find_property('footer')` 返回 null），
  所以解释性文字只能放进行的 subtitle，或做成不带控件的独立说明行（「自动计算的部分」
  分组就是后者）。
- `Adw.ActionRow.get_suffixes()` 在这个版本里对 `add_suffix()` 加进去的控件返回空数组，
  校验控件是否存在要看构建出的 widget 树（能数出 `Gtk_SpinButton`），别拿
  `get_suffixes()` 当依据。

验证仍用第 8 节那个「构建窗口但不 `present()`」的宿主替身：2 行全部构建成功（两个
`Gtk.SpinButton` 与 `rows-per-page`/`columns-per-page` 绑定完好）；
另跑一遍隔离嵌套会话确认 schema 重编译后扩展加载无 `JS ERROR`/`St-CRITICAL`。

文案生效方式：设置窗口每次都会重新拉起 prefs 进程，**重开设置窗口**即可看到改后的文案，
不需要重登；`metadata.json` 的 `name` 只在 shell 重启后才会刷新扩展列表里的显示。

## 13. 已知限制

- GNOME Shell 不热加载扩展，代码与 schema 的改动需**注销重登**生效；设置窗口的文案重开即可见。
- 真实桌面效果仍需**注销重登**后目视确认（本记录第 7/10 节的数字来自隔离会话）。
- 图标大小是「上限 + 屏幕夹取」而不是固定值：行列数大到当前屏幕放不下时，cell 会连同贴图一起
  缩小（第 9.2/9.3 节），看到的仍是统一的小图标而不是超出裁切。想既大又多，唯一办法是
  换更宽的显示器或多显示器（`_dialogSize()` 用的是弹窗所在显示器的尺寸）。
- 夹取有下限：cell 缩到 `MIN_CELL=67`（贴图 16）就不再让步。**行列数多到连 67px 都放不下时
  纵向会真的溢出**（隔离屏上 12×12 实测 `fitsY=false`、首行 `col0y=-24`）。这是刻意的：
  扩展不替用户改写他明确指定的行列数，只保证不出现「同一应用在各文件夹大小不一」。
- 弹窗按整屏尺寸夹取（被测 monitor 对象没有 `workArea`，第 10.1 节），因此不算底部面板；
  行数大时弹窗可能贴近面板，但 `SCREEN_MARGIN=60` 保证不会盖满屏幕。
- 本扩展依赖 shell 内部私有成员（`_grid`、`_viewBox`、`_folderIcons`、`_childrenMaxSize`、
  `_currentMode`、`_pages`、`_relocateSurplusItems`、`_fillItemVacancies`、`_currentPage`、
  `item.icon.label` 等），GNOME 小版本升级后需重新核对 `appDisplay.js` / `iconGrid.js`。
- 主题／字体变化的重测（第 14.4 节）挂在公开的 `org.gnome.desktop.interface` 上，属于**尽力而为**：
  那个 schema 不在时只是丢掉这个钩子（`enable()` 不受影响），51px 会一直停在最后一次量到的值，
  直到设置变化或重新启用扩展。屏幕变化的重算同理依赖 `monitors-changed` 这个信号名不变。
- 备选路线（未采用）：ABS/AUR 重打 `gnome-shell` 包，直接改 `FolderGrid` 常量与主题 CSS。

## 14. 重复计算、两个缺失的监听、两条 GSettings 实测事实

发布前的整仓扫描提出了几组改动，全部落地。这一节记下每处的依据——前两组是代码，
最后一组是补录的两条 GSettings 实测事实。

### 14.1 `_reapply()` 把每个弹窗应用了两遍

`_reapply()` 先调 `_adoptExistingViews()`，而后者内部已经对新接管的 grid 调了 `_applyToGrid()`、
并对**所有** dialog 调了 `_applyToDialog()`；紧接着 `_reapply()` 自己又把 grids、dialogs 全循环一遍。
`_adoptExistingViews()` 的调用点只有 `_reapply()`（`grep -n _adoptExistingViews extension.js` 确认过），
所以那两处 apply 是纯重复：每次改设置，每个弹窗 `set_style()` 两次（同样的字符串、CSS 解析两遍），
新建文件夹的 `_repackPages()`（最多 `REPACK_PASSES=8` 轮）跑两遍。改法是让 `_adoptExistingViews()`
只负责「接管」（加入 `SHARED.grids` + 挂 destroy 回收），apply 交回后面的循环。净减两行，行为等价。

### 14.2 派生尺寸按输入缓存

`_getChildrenMaxSize` 补丁 → `ownedCellSize()` → `_analyticCellSize()` → `_dialogSize()` 这条链
每次 measure pass、每个文件夹都要走一遍，而 `_analyticCellSize()` 内部还额外调一次 `_dialogSize()`，
`_applyToDialog()` 又调一次——7 个文件夹一轮约 28 次 `get_int` 加一次 monitor 查找。现在纯计算收在
`computeLayout()` 里，`_layout()` 只负责缓存：缓存的键是它的全部输入 `[rows, columns, screenWidth,
screenHeight]`，命中就复用上一次算出的 `width / height / cell`，输入变了就地重算。**不需要失效钩子**
——缓存的键就是全部输入，这一点比「在哪里加 invalidate」好验证得多。动机是「一次输入只算一次」，
量级仍是微秒。

### 14.3 屏幕变了没人重算：接 `monitors-changed`

弹窗尺寸是拿弹窗所在显示器的尺寸算的，但此前没有任何地方监听屏幕变化：改分辨率、插拔显示器之后，
已存在的弹窗与共享 cell 仍是旧屏幕推导出来的，直到用户动一下设置才追上。补
`Main.layoutManager` 的 `monitors-changed`（shell 自己在 `ui/layout.js` 里发这个信号，
`Grep` 得到多处消费者），回调就是 `_reapply()`。

### 14.4 换主题后标签高度不重测：接 `org.gnome.desktop.interface`

`SHARED.overhead`（实测 51px）此前只在 `disable()` 里清零，`_labelOverhead()` 一见到 `> 0` 就直接返回。
也就是说 `extension.js` 里那句「a theme change cannot leave these constants disagreeing」是**说过头了**：
换主题／字号之后那个值仍是旧的。现在的做法是监听 `org.gnome.desktop.interface` 的
`gtk-theme` / `color-scheme` / `font-name` / `text-scaling-factor`，回调 `_retheme()` 把
`SHARED.overhead` 清零再 `_reapply()`，注释也改成陈述实际机制。

为什么是这四个键、为什么不用 shell 私有的东西：

- 用 `gjs -m` 把 `St.Settings` 的属性列出来，里面**没有** `gtk-theme`（只有 `font-name`、
  `color-scheme`、`high-contrast`、`accent-color`、`gtk-icon-theme` 等），`St.ThemeContext` 只有
  `scale-factor`；想从 shell 对象上观察 GTK 主题换没换，观察不到。
- shell 自己重载 CSS 的时机是 `main.js` 里 `St.Settings.get()` 的 `notify::high-contrast` /
  `notify::color-scheme`，而这两个属性正是从 `org.gnome.desktop.interface` 同步来的——也就是说
  决定 51px 的主题与字体，其权威来源就是这个公开 schema，直接盯它比盯 shell 的私有信号更稳。
- `text-scaling-factor` 一并盯着，因为标签行高随它变；`font-name` 是 51px 里那一行文字的直接来源。

schema 不存在时（理论上不会，它是 GNOME 的标准接口）用 `try`/`catch` 兜住，只记一条日志、
放弃这个钩子，绝不让 `enable()` 抛错。**这里踩到一个自己的错**：catch 里先写的是 `logWarn`，
而 gjs 的全局只有 `log` / `logError`（用 `typeof globalThis[...]` 逐个验过），`logWarn` 会抛
`ReferenceError`——正好是那条「兜底路径本身把 enable() 打挂」的错误。改成 `log`。

清零后的回落路径是安全的：`overhead === 0` 时 `_pinTextureFor()` 按设计尺寸 96 给贴图，
不会算出更小的值；下一次有活的条目被量到就修正。这一点有实测（见 14.6）。

### 14.5 顺带把订阅生命周期收干净

三个钩子（设置、屏幕、主题）都经 `this._watch(target, signal, callback)` 登记进 `this._signals`，
`disable()` 遍历断开。此前只有 `changed` 一个 id 需要手动记，加了两个就容易漏；`_interfaceSettings`
在 `disable()` 里置空。

### 14.6 实测（隔离嵌套会话，1920×1080，4 行 × 8 列，真实 app-folders）

新写的 `theme2@local` 探针依次：开弹窗报一次 → 把 `font-name` 改成大号并加 1.25 文字缩放 →
报一次 → 主动 `Main.layoutManager.emit('monitors-changed')` → 报一次 → 还原字体 → 报一次。
无头会话既不会真插显示器也没有主题切换器，只能这样把信号自己发出来。

```
baseline      : cell=147 texture=96/96 itemBox=[147x147]            labelH=[19,20]
after-theme   : cell=147 texture=84/84 itemBox=[147,150,151,150]    labelH=[33,36,37]
after-monitors: cell=147 texture=84/84（屏幕没变，数字不动，钩子无报错）
after-restore : cell=147 texture=96/96                              labelH=[33,36,37]
```

- 51px 那条推导被换字号实测反证了一次：标签行从 ~19px 涨到 ~36px，overhead 随之从 51 变 63，
  贴图 96 → 84 = 147 − 63。**cell 不动、贴图跟着主题给的开销走**，正是第 9.3 节那条机制的样子。
- 还原字体后贴图回到 96，而 labelH 仍显示 33–37：那是同一轮里旧条目的分配残值（弹窗重新打开前
  没人重量它），不影响结论。
- `itemBox` 出现 147/150/151 混排值得一提：**格子（cell）一致**和**条目盒子一致**是两件事。
  盒子由内容自然高度撑出来，字号大到超出 cell 时它会略微越过 stride；共享 cell 保证的是
  图标方块与列间距一致，这一点仍然成立（`cell=147` 全程未变）。
- `monitors-changed` 走的是 `_reapply()`：`SHARED.cell = 0` 强制重新夺回共享值，所以屏幕真的变了
  会重推，没变时结果逐字相同。

启停那一轮（`cycle2@local`）在新监听下重跑：启用 `grid=8x4 cell=147 texture=96/96 owned=true
popup=1310x739 page=1308x664 pages=[19]` → 禁用 `3x3 … owned=false popup=722x720 pages=[9,9,1]`
→ 重新启用回到全尺寸，错误分类为 0。真实的 `enabled-extensions` 与 `org.gnome.desktop.interface`
的字体两项，前后逐字节一致（隔离会话的老规矩，见第 7 节）。

逐文件夹那一轮（`allf2@local`，baseline + 某个弹窗被外部扩展改成 720×720）与早先那一轮的基线
**逐字相同**：7 个文件夹全部 `cell=147 texture=96/96 owned=true popup=1310x739 page=1308x664`、
`iconActor=[96x96xN]`、`row0=23..1283`、`ADOPT folders=7 unowned=0`，错误分类为 0——
14.1 的去重与 14.2 的缓存确认没有改变任何可观察结果。

### 14.7 补录：`<range>` 是**读时**强制的，越界值不改写 dconf

这条决定了 README 的「设置」和「排查」怎么写（「排查」现在在 GUIDE.md）。在隔离 HOME 里直接写越界值：

```sh
dconf write $P/columns 20    # schema 上限 12
dconf write $P/rows     2    # schema 下限 3
$ gsettings --schemadir schemas/ get … columns   → 6（默认值，不是 20，也不是 3）
$ gsettings --schemadir schemas/ get … rows      → 4（默认值）
$ dconf dump …                                   → columns=20 仍在
```

也就是：范围校验发生在**读取**，越界的存储既不被改写也不被 clamp 到边界，而是回落到
`<default>`。推论有两条——写了没效果先怀疑写到了范围外；从旧版本升级时若 dconf 里存过后来被
收紧的取值（例如曾经的 1、2 列），改完 schema 读到的不是新下限 3 而是默认值，想保住原观感要
按新范围重写一次。而 `gsettings set`／设置界面走 `set_int`，越界**当场报错**
（「提供的值不在有效范围内」，已验），所以 `prefs.js` 的 `min: 3` 只负责滑条边界，不承担校验。

### 14.8 补录：`shell-version` 的判定是主版本号前缀匹配

`ui/extensionSystem.js` 的 `_isOutOfDate()`：

```js
const [major] = Config.PACKAGE_VERSION.split('.');
return !extension.metadata['shell-version'].some(v => v.startsWith(major));
```

只看第一段，用 `startsWith` 比。所以声明一个主版本已经覆盖它全部小版本，不需要逐个列——
这也解释了为什么 README 可以只留「唯一一处版本声明在 `metadata.json`」而不与散文里
「不声明版本号」的约定冲突。顺带 `ui/extensionUtils.js` 的 `validateMetaData()`
只要求 `uuid` / `name` / `description` / `shell-version`，多余键合法，因此 metadata 里多加一个 `url` 键是安全的。

## 15. 原先写在 `extension.js` 里的「为什么」

### 15.1 51px 的来历，以及它什么时候必须作废

`TEXTURE_EDGE 96` 与 `CELL_EDGE 147` 是上游 3×3 弹窗在这台机器上的实测值（第 9.3 节），中间那
51px 是标签行加 `.overview-icon` 内边距。它属于**主题和字体**，不属于某个文件夹，所以
`_labelOverhead()` 只从活条目上量一次并缓存；`_retheme()` 在主题或字体变化时把缓存清零重测。
换主题之后这两个常数只是「还没重测的旧值」，不是硬编码的正确值——这就是第 14.4 节那两个监听的
意义。

### 15.2 `pageFitSize()`：为什么页边距不参与

`FolderGrid` 的页是居中的（`page_halign / page_valign = CENTER`），`_calculateSpacing()` 把第一个
条目放在 `pagePadding.left + emptySpace / 2`。两侧内边距相等时那一项就等于 `(page - content) / 2`，
也就是**页边距自己抵消掉了**：一列在不在屏幕内，只由页尺寸和间距决定，
`cols * cell + columnSpacing * (cols - 1) <= pageWidth`。没分配过的 actor 里 `_pageWidth` 是 0
（上游未分配时还会报 `-Infinity`），此时返回 `null` 表示「还不知道」，不参与取最小值。

式子里的「减掉间距再整除」在代码里是 `fitExtent(extent, spacing, count)`：宽高两行共用它，
`computeLayout()` 算 cell 时用的也是同一个函数。

### 15.3 标签上限：为什么非加不可，标签到底挂在谁身上

`IconGridLayout` 按 `childSize` 的步长摆放条目，但给每个条目的尺寸是 `max(childSize, naturalWidth)`，
而应用名是**未省略**的 `St.Label`，它的自然宽度就是整串文字。名字比格子宽时条目被撑宽，标签画到
隔壁列上、甚至越过弹窗边缘——密集网格「糊成一片」就是这个（第 9.7 节）。比格子短的名字不受
`max-width` 影响，所以宽松的网格照样显示完整名字；`cell <= 0` 表示不设上限，等于把行为交回上游。
守卫 `_afgdLabelCap` 记录上一次生效的上限，避免每轮测量都重设样式。

另一个坑：网格的孩子是 `AppViewItem`，标签在它的 `BaseIcon` 上（`appDisplay.js` 里
`this.label_actor = this.icon.label`），读 `child.label` 恒为 `undefined`，整段循环会**安静地空转**
——第 10.3 节就是靠探针读回 actor 真实样式才发现的。

### 15.4 第三个补丁为什么要等一个活实例

`IconGridLayout` 没有被 `export`，模块里拿不到它的类对象，只能对某个实例取
`Object.getPrototypeOf()` 才能替换 `_getChildrenMaxSize`。所以这一步不在 `Patches.install()` 里，而在
第一次 adopt 文件夹网格时调用 `Patches.installLate()`，并用 `PATCH.maxChildSize` 保证只装一次。
上游那个函数按**本网格自己的条目**取最大最小尺寸（等于按最长应用名），结果还按文件夹缓存，于是
两个文件夹给同一个应用算出两个尺寸——第 5 节的病根。替换只对带 `_afgdOwned` 的布局器生效，
应用网格与 dash 共用同一个原型，因此完全不受影响（第 10.2 节）。

### 15.5 重贴贴图为什么要放到 idle

贴图钳位需要页面几何，而设置变更或弹窗被别的扩展改过尺寸之后，页面几何**总要晚一次 allocation**
才可用；`_getChildrenMaxSize()` 正是第一个知道新 cell 的时刻。在测量过程中重建贴图 actor 不安全，
所以只 `GLib.idle_add()` 排一次（`SHARED.pinId` 去重），下一轮对**所有**文件夹统一执行——因为
cell 是共享的，只补发现变化那一个会留下别的文件夹还在用旧贴图（第 9.4 节：早先用定时重调，
disable→enable 循环后贴图会粘在 83/84）。

这段「变了才排队、排队只排一次」在代码里是 `Patches.noteSharedCell(cell)`。

### 15.6 网格模式：为什么只给一条，还要动 `_currentMode`

`IconGrid` 每次 `allocate()` 都从模式列表里按「分配比例 vs 模式比例」挑一个；列表里只放一条就把它
钉死了。`_currentMode` 必须置 `-1`，否则 `_setGridMode()` 认为模式没变直接短路，新的行列数不会生效
——第 3 节 v1 那种「改了没效果」就有这一半原因。

这四行（`setGridModes` + `_currentMode = -1` + `rows_per_page` / `columns_per_page`）在代码里是
`_setPageGeometry(grid, rows, columns)`，实时路径交推导值、还原路径交上游的 3×3。

### 15.7 贴图跟着格子走，以及为什么要手写 `_iconSize`

条目盒子恒等于「贴图 + 标签行 + 内边距」，所以格子被屏幕夹小时贴图必须一起缩：把 147 的贴图塞进
109 的格子会互相压叠（第 9.3 节）。`fixed_icon_size` 是 `IconGridLayout._findBestIconSize()` 读的入口，
已有的图标还要逐个 `setIconSize()`，因为 `adaptToSize()` 在页尺寸没变时直接早退，会留下缓存的旧值。
overhead 还没量到时贴图保持设计尺寸，不猜。
这两条写入途径（`_iconSize` + `notify` 与遍历子项）在代码里是一个函数 `_writeIconSize()`，
实时路径与还原路径共用。

### 15.8 `_labelOverhead()` 的两道闸

一是「贴图当前必须正好等于设计尺寸」才拿来量：拿已经被压小的贴图做基准会报出更大的 overhead，
下一轮又据此把贴图压小，如此锁死在过小的尺寸上。二是 actor 必须已经挂到 stage（`first.get_stage()`）：
对未挂载的 actor 调 `get_preferred_width()` 会让 St 按每个子控件刷一行
`st_widget_get_theme_node … not in the stage`——实测 441 条，加守卫后 0 条（第 9.3 节）。

### 15.9 还原路径的三处顺序

挂起的 idle 重贴属于我们的补丁，所以 `_restore()` 一开头就 `GLib.source_remove()`：否则它可能在布局器
已经交回 GNOME、甚至 actor 已经销毁之后才跑。`_childrenMaxSize = -1` 要写在把行列数还回上游**之后**，
否则下一轮测量仍拿旧缓存。`fixed_icon_size = -1` 之后要立刻手工 `_findBestIconSize()` 并
`notify('icon-size')`，理由同第 15.7 节的早退。最后一步才是 `Patches.uninstall()`。
（这次手工重测在代码里就一行 `this._writeIconSize(layoutManager, layoutManager._findBestIconSize())`，
顺序不变。还原里的另外两段形状也收成了调用：还回上游 3×3 是
`this._setPageGeometry(grid, UPSTREAM_ROWS, UPSTREAM_COLUMNS)`，清弹窗内联尺寸是循环体
`this._setDialogStyle(dialog, '')`——两条都在原位置，没有挪到别的步骤前后。）
`release()`（删 `_afgdOwned` 与 `_afgdLabelCap`）在重测之后不改变结果，这一点是读上游源码确认的：
`_findBestIconSize()` 不会调 `_getChildrenMaxSize()`（`ui/iconGrid.js`），所以这段不存在「标记删早了
会让补丁走另一条分支」的问题。

### 15.10 为什么监听 `org.gnome.desktop.interface`

决定标签行高与内边距的是主题和字体，而 shell 自己就是从这四个键（`gtk-theme`、`color-scheme`、
`font-name`、`text-scaling-factor`）重载 CSS 的公开来源；`St.Settings` **没有 `gtk-theme` 属性**
（gjs introspection 验过，第 14.4 节），所以没有更贴切的私有信号可接。这个 hook 是尽力而为：
schema 万一缺失，`enable()` 里 `catch` 之后只是丢掉重测时机，不该让整个扩展起不来——`catch` 里
用 `log()` 而不是 `logWarn()`，因为 gjs 只暴露 `log` 与 `logError` 两个全局（第 14.4 节）。


## 16. `prefs.js` 的输入上限：从 schema 现读

界面结构见第 12.1 节，这里只记两条与「输入上限从 schema 现读」有关的实测。

### 16.1 `get_range()` 的实测形状：`3`/`12` 只留在 schema 里

原先 `prefs.js` 里写了两遍 `{min: 3, max: 12, step: 1}`，而同一份真相还在
`schemas/*.gschema.xml` 的 `<range>` 里写着第三遍。先只并成一处常量，但那是把重复从两处
留到一处；gjs 1.90 上把 `get_range()` 的形状实测出来之后，可以彻底不抄：

```
settings.get_range(key)  →  GVariant，类型 "(sv)"
    .deep_unpack()       →  [format, value]
```

- 整数键带 `<range>`：`format === 'range'`，`value` 类型是 `"(ii)"`，
  `value.deep_unpack()` 直接得到 `[3, 12]` 这个 JS 数组。本扩展两个键实测都是这一种。
- 浮点键的 range 是 `(dd)`（用 `org.gnome.desktop.interface` 的 `text-scaling-factor` 对照），
  所以守卫里必须同时看 `format` 和类型字符串：只判断 `format === 'range'` 会把一对 double
  当整数用。
- 没有 `<range>` 的键不会返回 null：整数键给 `format === 'type'`、value 类型 `ai`（空数组），
  字符串键给 `'type'`/`as`，枚举键（`clock-format`）给 `'enum'`/`as`。

于是 `settingRow()` 里 spin 的 `lower`/`upper` 来自 schema，改界面上限只需要改 schema 一处。
step 仍是代码里的 `STEP = 1`（schema 没有步长这个概念）。

### 16.2 兜底分支也实测过

`format !== 'range'` 或类型不是 `(ii)` 时用 `FALLBACK_INT_RANGE = [1, 32]`。
这一支不是纸面保险：把隔离 profile 里那份 schema 的两行 `<range>` 删掉、
`glib-compile-schemas` 重编译、再跑第 12 节那个宿主替身，两行都走兜底：
`SPIN: value=6 lower=1 upper=32 step=1 page=4`，0 条 CRITICAL。
兜底可以写宽，是因为界面上的上下限只防手滑输入，存储值真正的钳制发生在读值时（第 14.7 节），
越界值不会经过 schema 到达网格。


## 17. 设置页的两处界面事实

### 17.1 分组标题里的裸 `&` 让那一行一直是空的

- `Adw.PreferencesGroup` 的 `title` 走 Pango markup：裸 `&` 解析失败，GTK 只留一条
  `Gtk-WARNING: Failed to set text '…' from markup due to error parsing markup`，标签文本为空。替身里逐个读分组
  子树第一个非空 `Gtk.Label`，三种写法实测：

  ```
  TITLE in="Columns & Rows"     headerLabel="null"
  TITLE in="Rows & Columns"     headerLabel="null"
  TITLE in="Rows &amp; Columns" headerLabel="Rows & Columns"
  ```

- **这不是本轮换序引入的**：旧标题 `Columns & Rows` 同样含裸 `&`，所以从那五条界面文案定型起，设置页的
  分组标题在真实窗口里就没显示出来过，只在日志里留警告。历史已被压缩，`git log -S "Columns & Rows" -- prefs.js`
  只落到 `c9b30a6` 那一次大提交，查不到具体哪轮换上的。
- 修法取 `&amp;`，因为用户要的是**可见文本** `Rows & Columns`；写成 `Rows and Columns` 也能避开 markup，但那改的
  是可见措辞。`prefs.js` 里留一条两行注释钉住这件事：静默失败（空白标题）比报错更容易被下一个人再犯一次。

### 17.2 行序：`ROWS` 就是屏幕顺序

- `const ROWS = [['rows', 'Rows'], ['columns', 'Columns']]`，注释补「top to bottom」。表驱动的顺序即渲染顺序，
  没有第二处代码要改——表驱动的形状在这里正好省了事。
- 实测（隔离 profile 的 prefs 替身，加载仓库里那份 `prefs.js`）：`ROW 1: title="Rows"`、`ROW 2: title="Columns"`、
  `SPIN 1: value=4 lower=3 upper=12 step=1 page=4 numeric=true`、`SPIN 2: value=6` 同参数；
  `GROUP 1: title="Rows &amp; Columns" description="Customize the number of rows and columns in the GNOME app
  folder grid."`；`HOST OK: 2 groups, 2 rows, 2 spin buttons, window title="App Folder Grid Dimensions"`。
  本轮这一跑**没有**任何 `Failed to set text` 警告。
- 界面文案仍是五条（窗口标题、分组标题、分组描述、两个行标签），之前那次收敛没被这轮加回去。
- README 的设置表两行是「Rows（行数）」在上、「Columns（列数）」在下，「窗口里显示英文 `Rows` / `Columns`」
  那句括注同序；正文里行一律写在列前面，包括「行数 × 列数 就是一页的容量」这句。


## 18. 首次安装后启用：启用前已存在的弹窗把共享格子拖低

### 18.1 现象与触发条件

首次安装后注销重登（此时扩展还没启用），在【扩展】应用里点启用，所有应用文件夹的图标都小一号；
再注销重登一次就正常。差别不在登录次数，而在**启用那一刻是否已经有一个按上游 3×3 建好的弹窗**。

真实桌面上这条路径几乎是必然的：`org.gnome.Extensions.desktop` 在 `GNOME-Extra` 文件夹的
`apps` 列表里，打开扩展应用之前先展开了该文件夹；那一刻 `AppFolderDialog` 按主题的 720×720
建好，popdown 之后并不销毁。扩展启用时 `_adoptExistingViews()` 只收 `folderIcon.view._grid`，
没有收 `folderIcon._dialog`，于是旧弹窗既不改尺寸、也不登记，弹窗打开过的那一页一直按
720 宽参与共享 cell 的取最小。

隔离会话复现（1280×1024、4×6、微软雅黑 10）：启用前打开 Test A，`viewBox=722x720`、
`page=720x649`；启用后 A 的行列变成 4×6，但弹窗仍是 722×720，`pageFitSize = min(153, 110) = 110`，
共享 cell 被拉到 110，图标 96→63。新建的 B 弹窗尺寸是对的（`viewBox=992x739`），但它的图标
同样 63——共享 cell 取所有 owned 网格的最小值，一个旧弹窗拖低所有文件夹。对照组：不预先打开
文件夹、运行时启用，以及扩展随会话启动加载，都是 147/96。

### 18.2 只收弹窗不够：收起的弹窗不会重新分配

第一版改动只把 `folderIcon._dialog` 也 `Patches.track()` 进 `SHARED.dialogs`，让 `_reapply()`
对它调用 `_applyToDialog()`。复测发现启用后立刻读到的 A 仍是 `view=720x649`、`cell=110`：
`set_style()` 把 `_viewBox` 的内联尺寸改成了 992×739，但 `St` 不会给隐藏的 actor 重新分配，
页面要等到弹窗下一次 `popup()` 才按新尺寸 `adaptToSize()`。把 A 打开一次确实能恢复
（`view=990x668`、cell 147、图标 96），但别的文件夹在 A 被打开之前一直停在 110——不够。

### 18.3 最终改法：接管时把陈旧页尺寸清零

`_adoptExistingViews()` 在登记弹窗时，若它当前 `!visible`，就把对应网格的
`_pageWidth`/`_pageHeight` 置 0。这不等同于「永久忽略某个页面」，而是把它退回新网格的
「还没量过」状态：`pageFitSize()` 返回 null、不参与取最小，之后真正分配时
`FolderGrid.vfunc_allocate()` 会重新 `adaptToSize()`。因为清零发生在 `_applyToGrid()` 之前，
共享 cell 从一开始就是解析值 147，不会再先钉成 63 再等 idle 纠正。

复测三组：

- `preopen`：启用前开 A、关掉、启用 → 立刻 `cell=147 iconSize=96`，A 的 `page=0x0`；
  打开 B 与 A 均为 `view=990x668`、`page=990x668`、147/96，A 的 `viewBox=992x739`。
- `preopen-cycle`：preopen → enable → disable → enable，A 始终没在新启用后打开过，仍然
  147/96；最后一次 disable 后打开 A，恢复上游 720×649、3×3、图标 96、内联样式为空，
  说明清零过的页在还原路径上也能正常分配。
- `preopen-disable`：清零后直接 disable、不再 enable，打开 A 同样恢复 720×649、3×3、
  图标 96，没有触发 `IconGridLayout.adaptToSize() wasn't called`。
- `baseline` / `runtime` / `race`：147/96 不变，无 `JS ERROR`；真实
  `org.gnome.shell enabled-extensions` 前后逐字一致。

这条也解释了为什么隔离会话过去没测到：会话里所有弹窗都是 enable 之后由补丁后的 `_init`
新建的，而真实桌面上只要先打开过一次文件夹，弹窗就早于扩展存在。能被隔离会话复现的才算测过。
