# app-folder-grid-dimensions@luanrz 的构建助手（各目标说明见 docs/GUIDE.md「开发 · 构建命令与依赖」）。
# 安装之后、以及任何 extension.js 或 schema 的改动，都要注销重登才生效；只改 prefs.js
# 重开一次设置窗口即可。范围见 docs/GUIDE.md「开发 · 构建命令与依赖」。

UUID   := app-folder-grid-dimensions@luanrz
SCHEMA := org.gnome.shell.extensions.app-folder-grid-dimensions
DEST   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

JS      := extension.js prefs.js
DOCS    := README.md README.en.md docs/GUIDE.md
CONTENT := $(JS) metadata.json $(DOCS)
SCHEMAS := schemas/$(SCHEMA).gschema.xml schemas/gschemas.compiled

.PHONY: compile check zip install uninstall clean

compile: schemas/gschemas.compiled

# --strict 本身就是 schema 的语法检查：坏 XML 和坏 <range> 值都会连文件、行、列一起报出来，
# 所以不需要再单独跑一遍 xmllint。见 docs/GUIDE.md「开发 · 构建命令与依赖」。
schemas/gschemas.compiled: schemas/$(SCHEMA).gschema.xml
	@glib-compile-schemas --strict schemas/
	@echo "OK  schema"

check: compile
	@command -v node >/dev/null 2>&1 \
	    || { echo 'node is only needed for the JS syntax check (Arch: pacman -S node)'; exit 1; }
	@for f in $(JS); do node --input-type=module --check < $$f && echo "OK  $$f"; done

# 手工 staging，而不是用 `gnome-extensions pack`：它会丢弃 gschemas.compiled
# （Gio.Settings 只认编译产物），而且 --schema 在本机直接 segfault。单个以 uuid 命名的
# 顶层目录是两条安装路径共同期待的形状；`install -D` 按每个文件自己的仓库路径落位，
# docs/ 与 schemas/ 保持目录结构，而不是摊平进扩展根目录。
# 见 docs/GUIDE.md「开发 · 构建命令与依赖」。
zip: build/$(UUID).zip

build/$(UUID).zip: $(CONTENT) $(SCHEMAS)
	@rm -rf build/$(UUID) $@
	@for f in $(CONTENT) $(SCHEMAS); do install -D -m 644 $$f build/$(UUID)/$$f; done
	@cd build && zip -rq $(UUID).zip $(UUID)
	@rm -rf build/$(UUID)
	@echo "Built $@"

install: compile
	@for f in $(CONTENT) $(SCHEMAS); do install -D -m 644 $$f $(DEST)/$$f; done
	@echo "Installed into $(DEST)"

# 只删代码：那两个设置值存在用户的 dconf 数据库里，不在扩展目录，所以重装即恢复观感。
# 见 docs/GUIDE.md「开发 · 构建命令与依赖」。
uninstall:
	rm -rf $(DEST)

clean:
	rm -rf build
