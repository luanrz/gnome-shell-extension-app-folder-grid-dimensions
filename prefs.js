/*
 * app-folder-grid-dimensions@luanrz - 设置界面
 *
 * 只有两个数字行，别无其他：弹窗几何由 extension.js 从这两个数推导，所以这个文件里既没有
 * 几何算术，也没有第二份输入上下限——上下限是从下面的私有 schema 现读的，它们只防手滑
 * 输入，存储值真正的钳制发生在读值时。读时钳制与 libadwaita 的实测限制见
 * docs/GUIDE.md「开发 · 改 prefs.js」的设置读写与 libadwaita 限制。
 */

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

const SCHEMA = 'org.gnome.shell.extensions.app-folder-grid-dimensions';

/* 屏幕上的行，从上到下：schema 键名，然后是它的标签。表的顺序就是渲染顺序，
 * 没有第二处代码要改。见 docs/GUIDE.md「开发 · 改 prefs.js」的界面文案。 */
const ROWS = [['rows', 'Rows'], ['columns', 'Columns']];

/* 只有键没有 <range> 时才用（今天两个键都有），而读时钳制让宽裕的兜底无害。
 * schema 没有步长这个概念，STEP 留在代码里，滚轮与 Page 键步进都从它派生。
 * 兜底分支实测过，见 docs/GUIDE.md「开发 · 改 prefs.js」的 spin 与 `get_range()`。 */
const FALLBACK_INT_RANGE = [1, 32];
const STEP = 1;

/* 不用 ExtensionPreferences：它的 resource 路径在 shell 版本间挪过位置，而 prefs 宿主
 * 只需要一个默认导出、带 fillPreferencesWindow() 方法的类。设置从 <扩展目录>/schemas
 * 自建源读取，因为这个 schema 没有装进系统。
 * 见 docs/GUIDE.md「开发 · 改 prefs.js」的设置读写。 */
function getSettings(dir) {
    const schemaDir = dir.get_child('schemas');
    const defaultSource = Gio.SettingsSchemaSource.get_default();
    const source = schemaDir.query_exists(null)
        ? Gio.SettingsSchemaSource.new_from_directory(schemaDir.get_path(), defaultSource, false)
        : defaultSource;

    const schema = source.lookup(SCHEMA, true);
    if (!schema)
        throw new Error(`Schema ${SCHEMA} not found in ${schemaDir.get_path()}`);

    return new Gio.Settings({settings_schema: schema});
}

/*
 * 一行设置：左边标签，右边数字输入。get_range() 的实测形状：一个 "(sv)" 变体，
 * deep_unpack() 出 [format, value]——整数键的 <range> 是 format "range"、value 为 "(ii)"，
 * [下限, 上限] 直接从 schema 文件里来。全部形状见
 * docs/GUIDE.md「开发 · 改 prefs.js」的 spin 与 `get_range()`。
 */
function settingRow(settings, key, title) {
    const [format, range] = settings.get_range(key).deep_unpack();
    const [lower, upper] = format === 'range' && range.get_type_string() === '(ii)'
        ? range.deep_unpack()
        : FALLBACK_INT_RANGE;

    const spin = new Gtk.SpinButton({
        adjustment: Gtk.Adjustment.new(settings.get_int(key), lower, upper, STEP, STEP * 4, 0),
        numeric: true,
        valign: Gtk.Align.CENTER,
    });
    spin.connect('value-changed', () => settings.set_int(key, Math.round(spin.get_value())));

    const row = new Adw.ActionRow({title});
    /* libadwaita 的后缀插槽叫 add_suffix()；Gtk.Box 那套 add_end() 在这里不存在。
     * activatable_widget 让点整行也能聚焦输入框。见 docs/GUIDE.md「开发 · 改 prefs.js」。 */
    row.add_suffix(spin);
    row.activatable_widget = spin;
    return row;
}

export default class AppFolderGridDimensionsPreferences {
    constructor(metadata) {
        this._settings = getSettings(metadata.dir);
    }

    fillPreferencesWindow(window) {
        window.title = 'App Folder Grid Dimensions';

        /* 分组标题走 Pango markup：裸 '&' 解析失败后只在日志留一条 Gtk-WARNING，
         * 窗口里那一行静默变成空白——所以保持 &amp; 转义。三写法实测见
         * docs/GUIDE.md「开发 · 改 prefs.js」。 */
        const gridGroup = new Adw.PreferencesGroup({
            title: 'Rows &amp; Columns',
            description: 'Customize the number of rows and columns in the GNOME app folder grid.',
        });
        for (const [key, title] of ROWS)
            gridGroup.add(settingRow(this._settings, key, title));

        const page = new Adw.PreferencesPage();
        page.add(gridGroup);
        window.add(page);
    }
}
