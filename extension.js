/*
 * app-folder-grid-dimensions@luanrz
 *
 * 上游把应用文件夹弹窗钉在 3 行 × 3 列、按每个文件夹自己最长的应用名量格子（同一应用会在
 * 两个文件夹里画出两个尺寸），主题又把 .app-folder-dialog 固定成 720×720。
 *
 * 设置里只有行数与列数。弹窗尺寸、所有文件夹共用的单元格边长、图标贴图，都由这两个数加
 * 弹窗落在哪块屏幕推导：computeLayout() 做算术，_layout() 按输入缓存它，设置改动即时生效。
 * 机制与常数出处见 docs/GUIDE.md「机制」。
 *
 * 阅读顺序：常数与共享状态 → 纯几何 → 三个原型补丁 → 扩展类。每条注释只说自己那处的一到
 * 三行「为什么」；安装与设置见 README.md，验证与全部实测坑点见 docs/GUIDE.md「开发」。
 */

import Pango from 'gi://Pango';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/* disable() 要交回的东西：上游的 3×3 页。见 docs/GUIDE.md「机制」。 */
const UPSTREAM_ROWS = 3;
const UPSTREAM_COLUMNS = 3;

/* 上游 3×3 弹窗的实测：147px 的条目盒里画 96px 贴图，中间 51px 是标签行加
 * .overview-icon 内边距——属于主题和字体，不属于某个文件夹。
 * 常数表与推导见 docs/GUIDE.md「机制」。 */
const TEXTURE_EDGE = 96;
const CELL_EDGE = 147;

/* 最小值得加载的一档贴图，对齐 IconSize.TINY；贴图搜索档见 docs/GUIDE.md
 * 「开发 · 改 extension.js」的探针条。 */
const MIN_TEXTURE = 16;

/* 再小就放不下 MIN_TEXTURE 加标签了：缩到这里就不再让步，宁可让网格溢出——
 * 这是「放不下」的诚实信号，而不是偷偷改写用户指定的行列数。
 * 见 docs/GUIDE.md「机制 · 已知限制与兼容性」。 */
const MIN_CELL = CELL_EDGE - TEXTURE_EDGE + MIN_TEXTURE;

/* 本主题下 IconGridLayout 的 rowSpacing / columnSpacing。 */
const GRID_SPACING = 12;

/* 让满行不贴住弹窗边框的余量；以及弹窗里除「页」以外的高度：标题栏、搜索框、
 * 关闭钮、页码点。见 docs/GUIDE.md「机制」。 */
const PAGE_MARGIN = 48;
const DIALOG_CHROME = 115;

/* 屏幕至少留这么多不许被弹窗盖满。见 docs/GUIDE.md「机制 · 已知限制与兼容性」。 */
const SCREEN_MARGIN = 60;

/* 比这更小的弹窗不是「挤」，是没法用。 */
const MIN_DIALOG_EDGE = 320;

/* 重分页循环的上限；一轮就能扫过所有页，8 是余量。见 docs/GUIDE.md「机制」
 * 的「机制 · 重分页」。 */
const REPACK_PASSES = 8;

/* 决定标签行高的是主题与字体，而 shell 自己重载 CSS 的来源就是这个公开 schema——
 * 所以盯它，不盯 shell 私有信号。见 docs/GUIDE.md「开发 · 改 extension.js」。 */
const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const INTERFACE_KEYS = ['gtk-theme', 'color-scheme', 'font-name', 'text-scaling-factor'];

/* 刻意放在模块顶层：原型是进程全局的，而 enable()/disable() 可以跑任意多遍，
 * 存起来的旧实现必须一直可达。见 docs/GUIDE.md「开发 · 改 extension.js」。 */
const PATCH = {
    installed: false,
    createGrid: null,
    dialogInit: null,
    maxChildSize: null,
    maxChildSizeProto: null,
};

/* 所有文件夹共享的东西，同样放在模块顶层（被打补丁的 _getChildrenMaxSize() 要读它）：
 * 一个共享 cell、一个挂起的统一重贴、一个量出来的标签开销——不给任何文件夹留下
 * 别人已经丢掉的旧尺寸。见 docs/GUIDE.md「机制 · 共享格子」。 */
const SHARED = {
    extension: null,
    grids: new Set(),
    dialogs: new Set(),
    overhead: 0,
    cell: 0,
    pinId: 0,
};

/* 挨着 _afgdOwned 的第二个实例标记：本网格的标签被钳到的 cell。
 * 守卫避免每轮测量重设样式，见 docs/GUIDE.md「开发 · 改 extension.js」。 */
const LABEL_CAP = '_afgdLabelCap';

/* 带自有标记的才归我们管：应用网格与 dash 共用同一个原型，全靠这个旗子保持原样。
 * 见 docs/GUIDE.md「机制 · 共享格子」。 */
function isOurs(layoutManager) {
    return layoutManager?._afgdOwned === true;
}

function claim(layoutManager) {
    layoutManager._afgdOwned = true;
}

function release(layoutManager) {
    delete layoutManager._afgdOwned;
    delete layoutManager[LABEL_CAP];
}

/* `count` 个格子在 `extent` 里各能分到多少（间距夹在格子之间）——页内拟合与推导
 * cell 共用这一个表达式，页边距为何不参与见 docs/GUIDE.md「机制」。 */
function fitExtent(extent, spacing, count) {
    return Math.floor((extent - spacing * (count - 1)) / count);
}

/* 显示器的宽高；没有显示器可读时给一对 0（此时不做夹取，见 computeLayout）。 */
function monitorEdges(monitor) {
    return monitor ? [monitor.width, monitor.height] : [0, 0];
}

/* 一个已经分配过尺寸的弹窗里，整页还放得下的最大 cell；从未分配过则 null（「还不知道」，
 * 不参与取最小）。FolderGrid 的页居中、内边距抵消，所以只看页尺寸与间距——
 * 见 docs/GUIDE.md「机制」。 */
function pageFitSize(layoutManager) {
    const pageWidth = layoutManager._pageWidth;
    const pageHeight = layoutManager._pageHeight;

    if (pageWidth <= 0 || pageHeight <= 0)
        return null;

    return Math.max(MIN_CELL, Math.min(
        fitExtent(pageHeight, layoutManager.rowSpacing, layoutManager.rowsPerPage),
        fitExtent(pageWidth, layoutManager.columnSpacing, layoutManager.columnsPerPage)));
}

/* 所有文件夹必须共用的 cell，一个全局数；null 表示「把决定权交回 GNOME」
 * （应用网格、dash、任何不归我们管的文件夹）。解析值让每个文件夹在第一次测量之前
 * 就同值；弹窗实测值只作保险，一降就是所有文件夹一起降。
 * 为什么必须这样，见 docs/GUIDE.md「机制 · 共享格子」。 */
function ownedCellSize(layoutManager) {
    const extension = SHARED.extension;

    if (!isOurs(layoutManager) || !extension)
        return null;

    let cell = extension._analyticCellSize();

    for (const grid of SHARED.grids) {
        const other = grid?.layout_manager;

        if (!isOurs(other))
            continue;

        const fit = pageFitSize(other);

        if (fit !== null)
            cell = Math.min(cell, fit);
    }

    return Math.max(MIN_CELL, Math.min(CELL_EDGE, cell));
}

/* 把标签钳到 cell（cell <= 0 则解除钳制）：网格按 cell 步长摆放、却按
 * max(cell, 自然宽度) 给条目尺寸，不设上限时长名字会画到隔壁列上。
 * 见 docs/GUIDE.md「机制 · 标签上限」。 */
function applyLabelCap(layoutManager, cell) {
    if (layoutManager[LABEL_CAP] === cell)
        return;

    layoutManager[LABEL_CAP] = cell;

    const style = cell > 0 ? `max-width: ${cell}px;` : '';
    const ellipsize = cell > 0 ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE;

    for (const child of layoutManager._container) {
        /*
         * 网格的孩子是 AppViewItem，标签挂在它的 BaseIcon 上
         * （appDisplay.js：`this.label_actor = this.icon.label`），不在条目本身——
         * 在这里读 child.label 会恒为 undefined、整段循环安静地空转。
         * 见 docs/GUIDE.md「开发 · 改 extension.js」。
         */
        const label = child?.icon?.label;

        if (!label)
            continue;

        if (label._afgdStyle !== style) {
            label._afgdStyle = style;
            label.set_style(style);
        }

        if (label.ellipsize !== ellipsize)
            label.ellipsize = ellipsize;
    }
}

/* 请求的 行×列 隐含的几何：只由设置与显示器推出，夹到弹窗永远盖不满屏幕。
 * 所有文件夹共用同一条式子，所以一开始就一致，而不是各自等弹窗打开才收敛。
 * 公式与夹取规则见 docs/GUIDE.md「机制」。 */
function computeLayout({rows, columns, monitor}) {
    const [screenWidth, screenHeight] = monitorEdges(monitor);

    const wantWidth = columns * CELL_EDGE +
        (columns - 1) * GRID_SPACING + PAGE_MARGIN;
    const wantHeight = rows * CELL_EDGE +
        (rows - 1) * GRID_SPACING + DIALOG_CHROME;

    /* 读不到显示器不是拒绝工作的理由：没有可信边界，就干脆不加夹取。 */
    const maxWidth = monitor ? screenWidth - SCREEN_MARGIN : wantWidth;
    const maxHeight = monitor ? screenHeight - SCREEN_MARGIN : wantHeight;

    const width = Math.max(MIN_DIALOG_EDGE, Math.min(wantWidth, maxWidth));
    const height = Math.max(MIN_DIALOG_EDGE, Math.min(wantHeight, maxHeight));

    const cell = Math.min(CELL_EDGE,
        fitExtent(height - DIALOG_CHROME, GRID_SPACING, rows),
        fitExtent(width, GRID_SPACING, columns));

    /* 屏幕尺寸留在返回值里：缓存键要比的就是这四个输入。 */
    return {rows, columns, screenWidth, screenHeight, width, height, cell};
}

/* 三个补丁：前两个（网格工厂、弹窗 _init）可以提前装；第三个必须等一个活实例，
 * 因为 IconGridLayout 未被 export，类对象只能从实例的原型上拿。
 * 见 docs/GUIDE.md「开发 · 改 extension.js」。 */
const Patches = {
    install() {
        if (PATCH.installed)
            return;

        PATCH.createGrid = AppDisplay.FolderView.prototype._createGrid;
        PATCH.dialogInit = AppDisplay.AppFolderDialog.prototype._init;

        AppDisplay.FolderView.prototype._createGrid = function () {
            const grid = Patches.track(SHARED.grids, PATCH.createGrid.call(this));
            SHARED.extension?._applyToGrid(grid);
            return grid;
        };

        AppDisplay.AppFolderDialog.prototype._init = function (...args) {
            PATCH.dialogInit.apply(this, args);
            Patches.track(SHARED.dialogs, this);
            SHARED.extension?._applyToDialog(this);
        };

        PATCH.installed = true;
    },

    /* 把一个网格或弹窗登记进表，它才会被重新同步、被还原；销毁即出表——
     * 两张表装的都是同一生命周期的 actor，一个 `destroy` 信号就够。
     * 见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    track(set, actor) {
        if (!set.has(actor)) {
            set.add(actor);
            actor.connect('destroy', () => set.delete(actor));
        }

        return actor;
    },

    /* 共享 cell 变了，所有文件夹的贴图都要跟上——排到 idle 去做：这里正跑在
     * measure pass 里，重建 actor 不安全；而且这是页面几何第一次可用的时刻——
     * 设置变更或被别的扩展改过尺寸的弹窗，总要晚一次 allocation。
     * 去重、晚一次 allocation 的因由见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    noteSharedCell(cell) {
        if (SHARED.cell === cell)
            return;

        SHARED.cell = cell;

        if (SHARED.pinId)
            return;

        SHARED.pinId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            SHARED.pinId = 0;
            SHARED.extension?._repinAllTextures();
            return false;
        });
    },

    /* 第一次 adopt 某个文件夹网格时调用。还原时按 PATCH.maxChildSizeProto 把方法
     * 写回它原来的原型。机制见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    installLate(layoutManager) {
        if (PATCH.maxChildSize)
            return;

        const proto = Object.getPrototypeOf(layoutManager);

        PATCH.maxChildSize = proto._getChildrenMaxSize;
        PATCH.maxChildSizeProto = proto;

        /* 上游按本网格内最长的应用名量 cell、按文件夹缓存——两个文件夹就给同一个
         * 应用算出两个尺寸。共享值替换掉这套测量，只对带标记的布局器生效。
         * 见 docs/GUIDE.md「机制 · 共享格子」。 */
        proto._getChildrenMaxSize = function () {
            const cell = ownedCellSize(this);

            if (cell === null) {
                /* 不归我们管（应用网格、dash），或决定权已交回 GNOME——这时它在
                 * 我们管期间留下的标签上限必须先清掉。 */
                if (this[LABEL_CAP] !== undefined)
                    applyLabelCap(this, 0);

                return PATCH.maxChildSize.call(this);
            }

            applyLabelCap(this, cell);
            Patches.noteSharedCell(cell);

            return cell;
        };
    },

    uninstall() {
        if (!PATCH.installed)
            return;

        AppDisplay.FolderView.prototype._createGrid = PATCH.createGrid;
        AppDisplay.AppFolderDialog.prototype._init = PATCH.dialogInit;

        if (PATCH.maxChildSizeProto) {
            PATCH.maxChildSizeProto._getChildrenMaxSize = PATCH.maxChildSize;
            PATCH.maxChildSizeProto = null;
        }

        PATCH.createGrid = null;
        PATCH.dialogInit = null;
        PATCH.maxChildSize = null;
        PATCH.installed = false;
    },
};

export default class AppFolderGridDimensionsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cachedLayout = null;
        this._signals = [];
        SHARED.extension = this;

        Patches.install();

        /* shell 启动期建好的 FolderView 可能早于 enable()：先接管再挂监听。
         * 接管路径为什么不能遍历 actor 树，见 docs/GUIDE.md「开发 · 改 extension.js」。 */
        this._reapply();

        this._watch(this._settings, 'changed', () => this._reapply());

        /* 弹窗按它落在的那块屏幕定尺寸。 */
        this._watch(Main.layoutManager, 'monitors-changed', () => this._reapply());

        /* 主题与字体决定 51px 那个实测值；schema 缺失只是把开销留在旧值直到下次
         * 设置变化，不值得为此把 enable() 打挂。为什么盯这四个键、catch 里为什么
         * 必须用 log，见 docs/GUIDE.md「开发 · 改 extension.js」。 */
        try {
            this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

            for (const key of INTERFACE_KEYS)
                this._watch(this._interfaceSettings, `changed::${key}`, () => this._retheme());
        } catch (e) {
            this._interfaceSettings = null;
            log(`${INTERFACE_SCHEMA} is not available, theme changes will not re-measure`);
        }
    }

    disable() {
        for (const [target, id] of this._signals)
            target.disconnect(id);

        this._signals = [];
        this._interfaceSettings = null;

        this._restore();

        SHARED.extension = null;
        this._settings = null;
    }

    /* 连接并记下，disable() 把加过的订阅统一断开。
     * 见 docs/GUIDE.md「开发 · 改 extension.js」的订阅生命周期。 */
    _watch(target, signal, callback) {
        const id = target.connect(signal, callback);
        this._signals.push([target, id]);
        return id;
    }

    /* 主题或字体变了，实测的 overhead 作废：清零再重新推导。在量到新的活条目之前
     * _pinTextureFor() 按设计尺寸给贴图，不猜。
     * 见 docs/GUIDE.md「开发 · 改 extension.js」的 _retheme 条。 */
    _retheme() {
        SHARED.overhead = 0;
        this._reapply();
    }

    get _rows() {
        return this._settings.get_int('rows');
    }

    get _columns() {
        return this._settings.get_int('columns');
    }

    /* computeLayout() 的缓存：_getChildrenMaxSize() 在每个文件夹的每轮 measure 上
     * 都会跑，而答案只取决于两个设置加屏幕尺寸；缓存的键就是这四项输入——
     * 键覆盖输入，就不需要失效钩子。见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    _layout() {
        const rows = this._rows;
        const columns = this._columns;

        /* 弹窗所在的显示器；读不到时不拒绝工作、不做夹取。 */
        const monitor = Main.layoutManager.currentMonitor ??
            Main.layoutManager.primaryMonitor;

        /* 这里读屏幕尺寸只为做缓存键；computeLayout() 自己会推出同一对值。 */
        const [screenWidth, screenHeight] = monitorEdges(monitor);

        const cached = this._cachedLayout;

        if (cached && cached.rows === rows && cached.columns === columns &&
            cached.screenWidth === screenWidth && cached.screenHeight === screenHeight)
            return cached;

        this._cachedLayout = computeLayout({rows, columns, monitor});

        return this._cachedLayout;
    }

    /* 推导出的网格所要求的弹窗尺寸，[宽, 高]。
     * 见 docs/GUIDE.md「机制」。 */
    _dialogSize() {
        const {width, height} = this._layout();
        return [width, height];
    }

    /* 由 _dialogSize() 隐含的 cell——在任何东西被量出来之前就有值，
     * 这是各文件夹一开始就一致的原因。见 docs/GUIDE.md「机制」。 */
    _analyticCellSize() {
        return this._layout().cell;
    }

    /* 把请求的网格重放到每个文件夹与弹窗上：一切变化（设置、屏幕、主题）的统一入口。 */
    _reapply() {
        /* 请求的网格变了，共享 cell 要重新争取一次。 */
        SHARED.cell = 0;

        this._adoptExistingViews();

        for (const grid of SHARED.grids)
            this._applyToGrid(grid);

        /* 收集与应用刻意分开：原因见 _adoptExistingViews 的注释。 */
        for (const dialog of SHARED.dialogs)
            this._applyToDialog(dialog);
    }

    /* 接管已经存在的文件夹视图：AppDisplay 可能早于扩展启用而建立，且在首次打开
     * 概览之前不挂在 actor 树上——所以走它自己的 _folderIcons 列表。
     * 只收集——_reapply() 紧接着统一应用；在这里应用会让新建文件夹的
     * _repackPages() 白跑两遍。
     * 见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    _adoptExistingViews() {
        const appDisplay = Main.overview?._overview?.controls?.appDisplay;

        for (const folderIcon of appDisplay?._folderIcons ?? []) {
            const grid = folderIcon?.view?._grid;

            if (grid)
                Patches.track(SHARED.grids, grid);
        }
    }

    /* 把一个网格钉在 行×列 的一页上：IconGrid 每次 allocate() 都按「分配比例 vs 模式
     * 比例」从模式列表挑，只放一条就钉死；_currentMode 必须同时置 -1，否则
     * _setGridMode() 认为没变直接短路。见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    _setPageGeometry(grid, rows, columns) {
        grid.setGridModes([{rows, columns}]);
        grid._currentMode = -1;

        const layoutManager = grid.layout_manager;
        layoutManager.rows_per_page = rows;
        layoutManager.columns_per_page = columns;
    }

    /* 接管一个文件夹网格：页几何、标记、贴图、分页。 */
    _applyToGrid(grid) {
        const {rows, columns} = this._layout();

        this._setPageGeometry(grid, rows, columns);

        const layoutManager = grid.layout_manager;

        Patches.installLate(layoutManager);
        claim(layoutManager);

        this._pinTextureFor(layoutManager);

        /* 缓存的子项尺寸还是按旧的页几何量出来的。 */
        layoutManager._childrenMaxSize = -1;

        this._repackPages(layoutManager);

        grid.queue_relayout();
    }

    /* 设置或清除弹窗的内联尺寸——写在实际挂 .app-folder-dialog 样式类的 _viewBox 上，
     * 内联样式压过主题的 720×720，空串把控制权交回主题。
     * 见 docs/GUIDE.md「机制」。 */
    _setDialogStyle(dialog, style) {
        const viewBox = dialog._viewBox;

        if (!viewBox)
            return;

        viewBox.set_style(style);
        viewBox.queue_relayout();
    }

    /* 给一个弹窗推导出的尺寸。 */
    _applyToDialog(dialog) {
        const [width, height] = this._dialogSize();

        this._setDialogStyle(dialog, `width: ${width}px; height: ${height}px;`);
    }

    /* 上游只在条目插入时切页，旧页大小下填好的文件夹保留旧分页。两个上游函数都幂等
     * （溢出往后推、空位从后页拉、空页自己删），反复跑到页大小不再变化为止。
     * 见 docs/GUIDE.md「机制 · 重分页」。 */
    _repackPages(layoutManager) {
        /* _pages 原地增删，它的长度始终是活的。 */
        const sizes = lm => (lm._pages ?? []).map(p => p.children.length).join(',');
        let before = sizes(layoutManager);

        for (let pass = 0; pass < REPACK_PASSES; pass++) {
            /* 两个上游函数都按页号直接索引 _pages，不做越界检查。 */
            for (let i = 0; i < layoutManager._pages.length; i++) {
                layoutManager._relocateSurplusItems(i);
                layoutManager._fillItemVacancies(i);
            }

            const after = sizes(layoutManager);

            if (after === before)
                break;

            before = after;
        }

        /* 重分页可能清空尾部的页，而弹窗还停在被清掉的页上：_currentPage 只由
         * goToPage() 写入，而它对不存在的页号直接抛。
         * 见 docs/GUIDE.md「开发 · 改 extension.js」的重分页条。 */
        const grid = layoutManager._container;
        const nPages = layoutManager.nPages;

        if (nPages > 0 && grid?.goToPage && grid._currentPage >= nPages)
            grid.goToPage(Math.max(0, nPages - 1), false);
    }

    /* 共享 cell 变了：把它交给每一个文件夹，而不只是发现变化的那一个——
     * 每个都是重贴贴图、清缓存的测量值、重排三件事。
     * 见 docs/GUIDE.md「机制 · 共享格子」。 */
    _repinAllTextures() {
        for (const grid of SHARED.grids) {
            const layoutManager = grid?.layout_manager;

            if (!isOurs(layoutManager))
                continue;

            this._pinTextureFor(layoutManager);
            layoutManager._childrenMaxSize = -1;
            grid.queue_relayout();
        }
    }

    /* owned 文件夹画的贴图：共享 cell 减去标签开销，再钳在 16..96。条目盒子恒等于
     * 「贴图 + 标签 + 内边距」，格子被屏幕夹小时贴图必须一起缩；开销还没量到时
     * 贴图保持设计尺寸，不猜。
     * 见 docs/GUIDE.md「机制」与「开发 · 改 extension.js」。 */
    _pinTextureFor(layoutManager) {
        const cell = ownedCellSize(layoutManager);

        if (cell === null)
            return;

        const overhead = this._labelOverhead();

        const size = overhead > 0
            ? Math.max(MIN_TEXTURE, Math.min(TEXTURE_EDGE, Math.floor(cell - overhead)))
            : TEXTURE_EDGE;

        /* fixed-icon-size 是 _findBestIconSize() 读的入口；缓存的 _iconSize 与活条目
         * 都走 _writeIconSize()——adaptToSize() 在页尺寸没变时早退，会把旧值留下。
         * 见 docs/GUIDE.md「开发 · 改 extension.js」。 */
        layoutManager.fixed_icon_size = size;
        this._writeIconSize(layoutManager, size);
    }

    /* 按上游读取图标尺寸的两条途径写：缓存的 _iconSize 只在真变了时 notify——
     * 什么都没改的一轮要保持安静；外加每个条目自己的 BaseIcon。 */
    _writeIconSize(layoutManager, size) {
        if (layoutManager._iconSize !== size) {
            layoutManager._iconSize = size;
            layoutManager.notify('icon-size');
        }

        for (const child of layoutManager._container)
            child.icon?.setIconSize(size);
    }

    /* 条目比它的贴图大多少（96 → 147，即 51）：标签行加 .overview-icon 内边距，
     * 是主题与字体的属性而不是文件夹的，所以从活条目量一次就留着用。
     *
     * 两道闸都容易无声失守：贴图必须仍正好等于设计尺寸，否则拿被压小的贴图做基准
     * 会报出更大的 overhead、下一轮再压小、锁死在过小尺寸；actor 必须已挂到 stage，
     * 否则 St 按每个子控件刷一行 not in the stage 的 CRITICAL。
     * 见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    _labelOverhead() {
        if (SHARED.overhead > 0)
            return SHARED.overhead;

        for (const grid of SHARED.grids) {
            const first = grid?.layout_manager?._container?.get_child_at_index(0);
            const texture = first?.icon?.iconSize ?? -1;

            if (!first || texture !== TEXTURE_EDGE || !first.get_stage?.())
                continue;

            const natural = Math.max(...first.get_preferred_width(-1),
                ...first.get_preferred_height(-1));

            if (natural > texture) {
                SHARED.overhead = natural - texture;
                break;
            }
        }

        return SHARED.overhead;
    }

    /* 把一切都交回 GNOME：上游的页几何、上游的按文件夹测量、上游的标签与分页，
     * 最后才是原型。下面的顺序是要害，见 docs/GUIDE.md「开发 · 改 extension.js」。 */
    _restore() {
        /* 挂起的 idle 重贴属于我们的补丁：现在不取消，它可能在布局器已交回 GNOME、
         * 甚至 actor 已销毁之后才跑。 */
        if (SHARED.pinId) {
            GLib.source_remove(SHARED.pinId);
            SHARED.pinId = 0;
        }

        SHARED.cell = 0;
        SHARED.overhead = 0;

        for (const grid of SHARED.grids) {
            this._setPageGeometry(grid, UPSTREAM_ROWS, UPSTREAM_COLUMNS);

            const layoutManager = grid.layout_manager;
            layoutManager.fixed_icon_size = -1;

            /* adaptToSize() 对没变的页尺寸跳过重测，我们钉的值会粘住；所以在页已分配
             * 的地方手工量一次，再按实时路径同款写法写回去。
             * 还回上游 3×3 必须先于清 _childrenMaxSize——顺序见 GUIDE 的还原条。 */
            if (layoutManager._pageWidth > 0 && layoutManager._pageHeight > 0)
                this._writeIconSize(layoutManager, layoutManager._findBestIconSize());

            layoutManager._childrenMaxSize = -1;

            /* 被钳过的标签交回 GNOME 的规则。 */
            applyLabelCap(layoutManager, 0);

            release(layoutManager);

            /* 回到每页 9 个——按条目当初插入时的分页。 */
            this._repackPages(layoutManager);

            grid.queue_relayout();
        }

        for (const dialog of SHARED.dialogs)
            this._setDialogStyle(dialog, '');

        Patches.uninstall();
    }
}
